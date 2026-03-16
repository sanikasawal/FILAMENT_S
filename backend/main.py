"""Filament Backend — Orchestrator Service

Supports two modes controlled by AGENT_MODE env var:
  - "local"  (default): Uses ADK Runner with Gemini Live API (bidiGenerateContent).
  - "remote": Agents run on separate Cloud Run instances; orchestrator calls via HTTP.

The WebSocket endpoint remains the same either way — the extension doesn't know
which mode is active.
"""

import asyncio
import base64
import json
import logging
import os
import re

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from google.genai import types
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode

from agents.live_agent import live_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

AGENT_MODE = os.environ.get("AGENT_MODE", "local")

# ── ADK Runner (used by local mode) ──
adk_session_service = InMemorySessionService()
adk_runner = Runner(
    agent=live_agent,
    app_name="filament",
    session_service=adk_session_service,
)
logger.info(f"ADK Runner ready: agent={live_agent.name}, model={live_agent.model}")

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
    logger.info("Local mode: ADK Runner + Gemini Live API")


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
        "agent": live_agent.name,
        "model": live_agent.model,
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


async def _call_workspace_agent(query: str, session_id: str, oauth_token: str | None = None) -> dict:
    import httpx
    headers = _auth_headers(WORKSPACE_AGENT_URL)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{WORKSPACE_AGENT_URL}/context",
            json={"query": query, "session_id": session_id, "oauth_token": oauth_token or ""},
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


async def _remote_pipeline(frame_b64: str, session_id: str, websocket: WebSocket, oauth_token: str | None = None):
    try:
        analysis = await _call_screen_analyst(frame_b64, session_id)
        logger.info(f"Screen: pattern={analysis.get('pattern')}, confidence={analysis.get('confidence')}")

        if analysis.get("pattern") == "none" or analysis.get("confidence", 0) < 0.5:
            return

        context_query = analysis.get("context_query", "")
        if not context_query:
            return

        workspace_ctx = await _call_workspace_agent(context_query, session_id, oauth_token)
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


# ── WebSocket endpoint ──

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"WebSocket accepted (mode={AGENT_MODE})")

    # Wait for auth token before doing anything
    token_holder = {"token": None}
    try:
        auth_msg = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        data = json.loads(auth_msg)
        if data.get("type") == "auth":
            token_holder["token"] = data.get("token")
            logger.info(f"Auth token received: {'yes' if token_holder['token'] else 'none (not signed in)'}")
        else:
            logger.warning(f"Expected auth message, got type={data.get('type')} — proceeding without token")
    except asyncio.TimeoutError:
        logger.warning("No auth message received within 10s — proceeding without token")
    except Exception as e:
        logger.warning(f"Auth parse error: {e}")

    session_id = f"session_{id(websocket)}"

    if AGENT_MODE == "remote":
        await _remote_ws_handler(websocket, session_id, token_holder)
    else:
        await _local_ws_handler(websocket, session_id, token_holder)


async def _remote_ws_handler(websocket: WebSocket, session_id: str, token_holder: dict):
    """Handle WebSocket in remote mode — fan out to agent services via HTTP."""
    try:
        while True:
            message = await websocket.receive()

            if "text" in message:
                data = json.loads(message["text"])
                msg_type = data.get("type")

                if msg_type == "auth":
                    token_holder["token"] = data.get("token")
                    logger.info(f"Remote: auth token updated: {'yes' if token_holder['token'] else 'none'}")
                    continue

                if msg_type == "frame":
                    frame_b64 = data.get("data", "")
                    asyncio.create_task(
                        _remote_pipeline(frame_b64, session_id, websocket, token_holder["token"])
                    )

                elif msg_type == "audio":
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "content": "audio_received",
                    }))

    except WebSocketDisconnect:
        logger.info("Client disconnected (remote mode)")
    except Exception as e:
        logger.error(f"Remote WS error: {e}")


def _clean_text(text: str) -> str | None:
    """Strip markdown formatting, return None if empty."""
    t = text.strip()
    if not t:
        return None
    t = re.sub(r'\*\*([^*]+)\*\*', r'\1', t)
    return t.strip() or None


async def _local_ws_handler(websocket: WebSocket, session_id: str, token_holder: dict):
    """Handle WebSocket in local mode — ADK Runner with Gemini Live API.

    ADK manages the Gemini Live session and automatically handles tool calls
    (fetch_workspace_context). OAuth token is stored in ADK session state so
    the tool can access it via tool_context.state["oauth_token"].

    Restarts the ADK session automatically when Gemini closes it, keeping
    the user's WebSocket connection alive for multi-turn conversations.
    """
    run_config = RunConfig(
        response_modalities=["AUDIO"],
        streaming_mode=StreamingMode.BIDI,
    )

    # Create ADK session — OAuth token lives in session state
    try:
        await adk_session_service.create_session(
            app_name="filament",
            user_id="user",
            session_id=session_id,
            state={"oauth_token": token_holder["token"] or ""},
        )
        logger.info(f"ADK session created: {session_id}")
    except Exception:
        # Session already exists (e.g. reconnect) — update token
        session = await adk_session_service.get_session(
            app_name="filament", user_id="user", session_id=session_id
        )
        if session:
            session.state["oauth_token"] = token_holder["token"] or ""

    user_disconnected = False
    session_num = 0

    while not user_disconnected:
        session_num += 1
        logger.info(f"Starting ADK Live session #{session_num} (ws={session_id})")

        live_request_queue = LiveRequestQueue()

        async def upstream(queue: LiveRequestQueue):
            nonlocal user_disconnected
            frame_count = 0
            audio_count = 0
            try:
                while True:
                    message = await websocket.receive()

                    if "text" in message:
                        data = json.loads(message["text"])
                        msg_type = data.get("type")

                        # Accept auth token updates at any time
                        if msg_type == "auth":
                            token_holder["token"] = data.get("token")
                            session = await adk_session_service.get_session(
                                app_name="filament", user_id="user", session_id=session_id
                            )
                            if session:
                                session.state["oauth_token"] = token_holder["token"] or ""
                            logger.info(f"Auth token updated: {'yes' if token_holder['token'] else 'none'}")
                            continue

                        if msg_type == "frame":
                            context = data.get("context", "")
                            frame_data = data.get("data", "")

                            if context == "morning_brief":
                                queue.send_content(types.Content(
                                    role="user",
                                    parts=[types.Part(text="The user just opened a new tab in the morning. Give them a brief summary of what's in their inbox and recent files. Call fetch_workspace_context first.")],
                                ))
                                logger.info("Morning brief trigger sent")

                            elif context == "intent_reader":
                                from_doc = data.get("fromDoc", "")
                                queue.send_content(types.Content(
                                    role="user",
                                    parts=[types.Part(text=f"The user just navigated from {from_doc} to Gmail. They likely want to compose an email about that document. Call fetch_workspace_context to find relevant context.")],
                                ))
                                logger.info(f"Intent reader trigger sent (from={from_doc})")

                            elif frame_data:
                                frame_count += 1
                                blob = types.Blob(
                                    mime_type="image/jpeg",
                                    data=base64.b64decode(frame_data),
                                )
                                queue.send_realtime(blob)
                                if frame_count <= 5 or frame_count % 10 == 0:
                                    logger.info(f"Frame #{frame_count} sent ({len(frame_data)} chars)")

                                # Every 3rd frame (~9s), nudge Gemini to do proactive analysis
                                if frame_count % 3 == 0 and token_holder["token"]:
                                    queue.send_content(types.Content(
                                        role="user",
                                        parts=[types.Part(text="Look at the screen carefully. If you see something genuinely actionable (empty fields, documents being edited, forms with missing data), call fetch_workspace_context with a query based on what you see. If the screen shows nothing actionable (a homepage, search engine, blank page), stay silent — do not speak.")],
                                    ))
                                    logger.info(f"Proactive analysis prompt sent after frame #{frame_count}")

                        elif msg_type == "audio":
                            audio_data = data.get("data", "")
                            if audio_data:
                                audio_count += 1
                                blob = types.Blob(
                                    mime_type="audio/pcm;rate=16000",
                                    data=base64.b64decode(audio_data),
                                )
                                queue.send_realtime(blob)
                                if audio_count <= 3 or audio_count % 50 == 0:
                                    logger.info(f"Audio #{audio_count} sent ({len(audio_data)} chars)")

                    elif "bytes" in message:
                        blob = types.Blob(
                            mime_type="audio/pcm;rate=16000",
                            data=message["bytes"],
                        )
                        queue.send_realtime(blob)

            except WebSocketDisconnect:
                logger.info("Client disconnected")
                user_disconnected = True
            except Exception as e:
                logger.error(f"upstream error: {e}", exc_info=True)
            finally:
                queue.close()

        async def downstream(queue: LiveRequestQueue):
            """Receive ADK events and forward to WebSocket.

            ADK automatically executes fetch_workspace_context tool calls using
            the OAuth token stored in session state. We intercept function_call
            events only to send a status message to the user.
            """
            text_buffer = []
            response_count = 0
            try:
                async for event in adk_runner.run_live(
                    user_id="user",
                    session_id=session_id,
                    live_request_queue=queue,
                    run_config=run_config,
                ):
                    response_count += 1

                    # Audio and text parts
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if getattr(part, 'thought', False):
                                continue
                            if part.inline_data and part.inline_data.mime_type.startswith("audio/"):
                                await websocket.send_bytes(part.inline_data.data)
                            elif part.text:
                                text_buffer.append(part.text)

                    # Flush text when model finishes its turn
                    if getattr(event, 'turn_complete', False):
                        full_text = "".join(text_buffer).strip()
                        text_buffer.clear()
                        cleaned = _clean_text(full_text)
                        if cleaned:
                            logger.info(f"Agent text: {cleaned[:100]}")
                            await websocket.send_text(json.dumps({
                                "type": "text",
                                "content": cleaned,
                            }))

                    # Tool call status message (ADK handles actual execution automatically)
                    if hasattr(event, 'get_function_calls'):
                        for fc in event.get_function_calls():
                            if fc.name == "fetch_workspace_context":
                                source = fc.args.get("source", "both")
                                query = fc.args.get("query", "")
                                source_label = (
                                    "email" if source == "gmail"
                                    else "Drive" if source == "drive"
                                    else "email and Drive"
                                )
                                await websocket.send_text(json.dumps({
                                    "type": "text",
                                    "content": f"Searching your {source_label} for: \"{query}\"...",
                                }))
                                logger.info(f"TOOL CALL: fetch_workspace_context(query={query!r}, source={source})")

            except Exception as e:
                logger.error(f"downstream error: {e}", exc_info=True)

        upstream_task = asyncio.create_task(upstream(live_request_queue))
        downstream_task = asyncio.create_task(downstream(live_request_queue))

        done, pending = await asyncio.wait(
            [upstream_task, downstream_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

        if user_disconnected:
            logger.info(f"User disconnected — ending WebSocket session (ws={session_id})")
            break

        logger.info(f"ADK session #{session_num} ended — restarting in 1s...")
        await asyncio.sleep(1)

    logger.info(f"WebSocket session ended (session={session_id})")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
