"""Filament Backend — Orchestrator Service

Supports two modes controlled by AGENT_MODE env var:
  - "local"  (default): Uses raw Gemini Live API (bidiGenerateContent) directly.
  - "remote": Agents run on separate Cloud Run instances; orchestrator calls via HTTP.

The WebSocket endpoint remains the same either way — the extension doesn't know
which mode is active.
"""

import asyncio
import base64
import json
import logging
import os

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from google import genai
from google.genai import types

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

AGENT_MODE = os.environ.get("AGENT_MODE", "local")

# ── Gemini client (used by local mode) ──
genai_client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY"))

# ── Workspace tool for manual invocation ──
from tools import fetch_workspace_context
from agents.live_agent import LIVE_AGENT_PROMPT

LIVE_MODEL = "gemini-2.5-flash-native-audio-latest"

# Function declaration for the Gemini Live API tool calling
WORKSPACE_TOOL_DECL = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="fetch_workspace_context",
            description=(
                "Search the user's Gmail and/or Google Drive. "
                "Use Gmail search operators in the query for precision: "
                "'in:sent' for sent emails, 'in:inbox' for received, "
                "'from:name' to filter by sender, 'to:name' for recipient, "
                "'newer_than:7d' for recent emails, 'subject:keyword' for subject search. "
                "Set source to 'gmail' for email only, 'drive' for files only, or 'both'."
            ),
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "query": types.Schema(
                        type="STRING",
                        description="Search query. Use Gmail operators for email (e.g. 'in:sent newer_than:1d', 'from:name subject:topic'). For Drive, use keywords.",
                    ),
                    "source": types.Schema(
                        type="STRING",
                        description="Where to search: 'gmail', 'drive', or 'both'. Default is 'both'.",
                    ),
                },
                required=["query"],
            ),
        ),
    ],
)


class _ToolContext:
    """Minimal context object to pass OAuth token to fetch_workspace_context."""
    def __init__(self, oauth_token):
        self.state = {"oauth_token": oauth_token}


# ── Remote mode URLs ──
if AGENT_MODE == "remote":
    SCREEN_ANALYST_URL = os.environ.get("SCREEN_ANALYST_URL", "http://localhost:8001")
    WORKSPACE_AGENT_URL = os.environ.get("WORKSPACE_AGENT_URL", "http://localhost:8002")
    NUDGE_COMPOSER_URL = os.environ.get("NUDGE_COMPOSER_URL", "http://localhost:8003")
    logger.info(
        f"Remote mode: screen={SCREEN_ANALYST_URL}, "
        f"workspace={WORKSPACE_AGENT_URL}, nudge={NUDGE_COMPOSER_URL}"
    )
else:
    logger.info("Local mode: raw Gemini Live API (bypassing ADK)")


app = FastAPI(title="Filament Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def health():
    return {
        "status": "Filament backend running",
        "mode": AGENT_MODE,
        "model": LIVE_MODEL,
    }


# ── Remote mode helpers ──

def _get_id_token(audience: str) -> str | None:
    try:
        import google.auth.transport.requests
        import google.oauth2.id_token
        request = google.auth.transport.requests.Request()
        return google.oauth2.id_token.fetch_id_token(request, audience)
    except Exception:
        return None


def _auth_headers(url: str) -> dict:
    token = _get_id_token(url)
    if token:
        return {"Authorization": f"Bearer {token}"}
    return {}


async def _call_screen_analyst(frame_b64: str, session_id: str) -> dict:
    import httpx
    headers = _auth_headers(SCREEN_ANALYST_URL)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{SCREEN_ANALYST_URL}/analyze",
            json={"frame_b64": frame_b64, "session_id": session_id},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()


async def _call_workspace_agent(query: str, session_id: str) -> dict:
    import httpx
    headers = _auth_headers(WORKSPACE_AGENT_URL)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{WORKSPACE_AGENT_URL}/context",
            json={"query": query, "session_id": session_id},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()


async def _call_nudge_composer(screen_analysis: dict, workspace_context: dict, session_id: str) -> dict:
    import httpx
    headers = _auth_headers(NUDGE_COMPOSER_URL)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{NUDGE_COMPOSER_URL}/compose",
            json={
                "screen_analysis": screen_analysis,
                "workspace_context": workspace_context,
                "session_id": session_id,
            },
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()


async def _remote_pipeline(frame_b64: str, session_id: str, websocket: WebSocket):
    try:
        analysis = await _call_screen_analyst(frame_b64, session_id)
        logger.info(f"Screen: pattern={analysis.get('pattern')}, confidence={analysis.get('confidence')}")

        if analysis.get("pattern") == "none" or analysis.get("confidence", 0) < 0.5:
            return

        context_query = analysis.get("context_query", "")
        if not context_query:
            return

        workspace_ctx = await _call_workspace_agent(context_query, session_id)
        logger.info(f"Workspace: has_context={workspace_ctx.get('has_context')}")

        if not workspace_ctx.get("has_context"):
            return

        nudge = await _call_nudge_composer(analysis, workspace_ctx, session_id)
        logger.info(f"Nudge: should_speak={nudge.get('should_speak')}")

        if nudge.get("should_speak") and nudge.get("nudge_text"):
            await websocket.send_text(json.dumps({
                "type": "text",
                "content": nudge["nudge_text"],
            }))
    except Exception as e:
        logger.error(f"Remote pipeline error: {e}")


# ── WebSocket endpoint (same interface for both modes) ──

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"WebSocket accepted (mode={AGENT_MODE})")

    # Auth token holder — can be updated at any time during the session
    token_holder = {"token": None}

    # Try to receive auth as first message, but don't block long
    try:
        first_msg = await asyncio.wait_for(websocket.receive_text(), timeout=2.0)
        data = json.loads(first_msg)
        if data.get("type") == "auth":
            token_holder["token"] = data.get("token")
            logger.info(f"Auth token received (immediate): {'yes' if token_holder['token'] else 'none'}")
    except asyncio.TimeoutError:
        logger.info("No immediate auth message, will accept later")
    except Exception as e:
        logger.warning(f"Auth parse error: {e}")

    session_id = f"session_{id(websocket)}"

    if AGENT_MODE == "remote":
        await _remote_ws_handler(websocket, session_id)
    else:
        await _local_ws_handler(websocket, session_id, token_holder)


async def _remote_ws_handler(websocket: WebSocket, session_id: str):
    """Handle WebSocket in remote mode — fan out to agent services via HTTP."""
    try:
        while True:
            message = await websocket.receive()

            if "text" in message:
                data = json.loads(message["text"])
                msg_type = data.get("type")

                if msg_type == "frame":
                    frame_b64 = data.get("data", "")
                    asyncio.create_task(
                        _remote_pipeline(frame_b64, session_id, websocket)
                    )

                elif msg_type == "audio":
                    audio_b64 = data.get("data", "")
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "content": "audio_received",
                    }))

    except WebSocketDisconnect:
        logger.info("Client disconnected (remote mode)")
    except Exception as e:
        logger.error(f"Remote WS error: {e}")


async def _local_ws_handler(websocket: WebSocket, session_id: str, token_holder: dict):
    """Handle WebSocket in local mode — direct Gemini Live API (no ADK).

    Bypasses ADK's run_live() which has a Pydantic serialization bug in v1.26.0.
    Uses google.genai Live API directly — confirmed working.
    """
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(
            parts=[types.Part(text=LIVE_AGENT_PROMPT)]
        ),
        tools=[WORKSPACE_TOOL_DECL],
    )

    try:
        async with genai_client.aio.live.connect(
            model=LIVE_MODEL,
            config=config,
        ) as live_session:
            logger.info(f"Gemini Live session connected (session={session_id})")

            async def ws_to_gemini():
                """Forward frames and audio from WebSocket to Gemini Live session."""
                frame_count = 0
                audio_count = 0
                try:
                    while True:
                        message = await websocket.receive()

                        if "text" in message:
                            data = json.loads(message["text"])
                            msg_type = data.get("type")

                            # Accept auth token at any time
                            if msg_type == "auth":
                                token_holder["token"] = data.get("token")
                                logger.info(f"Auth token updated: {'yes' if token_holder['token'] else 'none'}")
                                continue

                            if msg_type == "frame":
                                context = data.get("context", "")
                                frame_data = data.get("data", "")

                                # Special context triggers from background.js
                                if context == "morning_brief":
                                    await live_session.send_client_content(
                                        turns=types.Content(
                                            role="user",
                                            parts=[types.Part(text="The user just opened a new tab in the morning. Give them a brief summary of what's in their inbox and recent files. Call fetch_workspace_context first.")],
                                        ),
                                        turn_complete=True,
                                    )
                                    logger.info("Morning brief trigger sent")
                                elif context == "intent_reader":
                                    from_doc = data.get("fromDoc", "")
                                    await live_session.send_client_content(
                                        turns=types.Content(
                                            role="user",
                                            parts=[types.Part(text=f"The user just navigated from {from_doc} to Gmail. They likely want to compose an email about that document. Call fetch_workspace_context to find relevant context.")],
                                        ),
                                        turn_complete=True,
                                    )
                                    logger.info(f"Intent reader trigger sent (from={from_doc})")
                                elif frame_data:
                                    frame_count += 1
                                    blob = types.Blob(
                                        mime_type="image/jpeg",
                                        data=base64.b64decode(frame_data),
                                    )
                                    await live_session.send_realtime_input(media=blob)
                                    if frame_count <= 5 or frame_count % 10 == 0:
                                        logger.info(f"Frame #{frame_count} sent to Gemini ({len(frame_data)} chars)")

                                    # Every 3rd frame (~9s), send a text nudge to trigger proactive analysis
                                    if frame_count % 3 == 0:
                                        await live_session.send_client_content(
                                            turns=types.Content(
                                                role="user",
                                                parts=[types.Part(text="Look at the screen carefully. If you see something genuinely actionable (empty fields, documents being edited, forms with missing data), call fetch_workspace_context with a query based on what you see. If the screen shows nothing actionable (a homepage, search engine, blank page), stay silent — do not speak.")],
                                            ),
                                            turn_complete=True,
                                        )
                                        logger.info(f"Proactive analysis prompt sent after frame #{frame_count}")

                            elif msg_type == "audio":
                                audio_data = data.get("data", "")
                                if audio_data:
                                    audio_count += 1
                                    blob = types.Blob(
                                        mime_type="audio/pcm;rate=16000",
                                        data=base64.b64decode(audio_data),
                                    )
                                    await live_session.send_realtime_input(audio=blob)
                                    if audio_count <= 3 or audio_count % 50 == 0:
                                        logger.info(f"Audio #{audio_count} sent to Gemini ({len(audio_data)} chars)")

                        elif "bytes" in message:
                            blob = types.Blob(
                                mime_type="audio/pcm;rate=16000",
                                data=message["bytes"],
                            )
                            await live_session.send_realtime_input(audio=blob)

                except WebSocketDisconnect:
                    logger.info(f"Client disconnected (sent {frame_count} frames, {audio_count} audio)")
                except Exception as e:
                    logger.error(f"ws_to_gemini error: {e}", exc_info=True)

            def _clean_text(text: str) -> str | None:
                """Clean up model text: strip markdown, return None if pure noise."""
                t = text.strip()
                if not t:
                    return None
                # Strip markdown bold markers
                import re
                t = re.sub(r'\*\*([^*]+)\*\*', r'\1', t)
                t = t.strip()
                if not t:
                    return None
                return t

            async def gemini_to_ws():
                """Forward Gemini Live responses to WebSocket, handle tool calls."""
                logger.info("gemini_to_ws: starting receive loop")
                response_count = 0
                text_buffer = []  # Accumulate text fragments per turn
                try:
                    async for response in live_session.receive():
                        response_count += 1
                        if response_count <= 5:
                            logger.info(f"Gemini response #{response_count}: "
                                       f"has_content={response.server_content is not None}, "
                                       f"has_tool_call={response.tool_call is not None}")
                        # Model output: audio and/or text
                        if response.server_content:
                            model_turn = response.server_content.model_turn
                            if model_turn and model_turn.parts:
                                for part in model_turn.parts:
                                    if part.inline_data and part.inline_data.mime_type.startswith("audio/"):
                                        await websocket.send_bytes(part.inline_data.data)
                                    elif part.text:
                                        text_buffer.append(part.text)

                            # turn_complete = model is done speaking this turn
                            if response.server_content.turn_complete:
                                full_text = "".join(text_buffer).strip()
                                text_buffer.clear()
                                cleaned = _clean_text(full_text)
                                if cleaned:
                                    logger.info(f"Agent text: {cleaned[:100]}")
                                    await websocket.send_text(json.dumps({
                                        "type": "text",
                                        "content": cleaned,
                                    }))
                                elif full_text:
                                    logger.debug(f"Filtered text: {full_text[:80]}...")

                        # Tool calls: execute fetch_workspace_context and return results
                        if response.tool_call:
                            fn_responses = []
                            for fc in response.tool_call.function_calls:
                                logger.info(f"TOOL CALL: {fc.name}({fc.args})")
                                if fc.name == "fetch_workspace_context":
                                    query = fc.args.get("query", "")
                                    source = fc.args.get("source", "both")
                                    # Tell the user what's happening
                                    source_label = "email" if source == "gmail" else "Drive" if source == "drive" else "email and Drive"
                                    await websocket.send_text(json.dumps({
                                        "type": "text",
                                        "content": f"Searching your {source_label} for: \"{query}\"...",
                                    }))
                                    ctx = _ToolContext(token_holder["token"])
                                    result = fetch_workspace_context(query, source=source, tool_context=ctx)
                                    n_emails = len(result.get('emails', []))
                                    n_files = len(result.get('files', []))
                                    logger.info(
                                        f"Tool result: source={result.get('source')}, "
                                        f"emails={n_emails}, files={n_files}"
                                    )
                                    # Brief status — Gemini will synthesize the actual answer
                                    if result.get("source") == "live" and (n_emails or n_files):
                                        await websocket.send_text(json.dumps({
                                            "type": "text",
                                            "content": f"Found {n_emails} email(s) and {n_files} file(s). Processing...",
                                        }))
                                    elif result.get("source") == "none":
                                        await websocket.send_text(json.dumps({
                                            "type": "text",
                                            "content": "No OAuth token — can't access your email. Check extension permissions.",
                                        }))
                                    fn_responses.append(types.FunctionResponse(
                                        id=fc.id,
                                        name=fc.name,
                                        response=result,
                                    ))
                                else:
                                    logger.warning(f"Unknown tool call: {fc.name}")
                                    fn_responses.append(types.FunctionResponse(
                                        id=fc.id,
                                        name=fc.name,
                                        response={"error": f"Unknown tool: {fc.name}"},
                                    ))

                            if fn_responses:
                                await live_session.send_tool_response(
                                    function_responses=fn_responses,
                                )

                except Exception as e:
                    logger.error(f"gemini_to_ws error: {e}")

            tasks = [
                asyncio.create_task(ws_to_gemini()),
                asyncio.create_task(gemini_to_ws()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

            for task in pending:
                task.cancel()

    except Exception as e:
        logger.error(f"Gemini Live session error: {e}", exc_info=True)
        try:
            await websocket.send_text(json.dumps({
                "type": "text",
                "content": f"Connection error: {e}",
            }))
        except Exception:
            pass

    logger.info(f"WebSocket session ended (session={session_id})")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
