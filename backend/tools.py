"""Workspace context tool — fetches Gmail + Drive data via Google API Python SDK.

Uses the OAuth token passed from the Chrome extension (stored in session state)
to make authenticated API calls on behalf of the user.
"""

import logging
import os
from google.adk.tools import FunctionTool
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

NO_DATA = {
    "emails": [],
    "files": [],
    "key_facts": [],
    "source": "none",
}


def _build_gmail_service(token: str | None):
    """Build an authenticated Gmail API client."""
    if not token:
        return None
    creds = Credentials(token=token)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _build_drive_service(token: str | None):
    """Build an authenticated Drive API client."""
    if not token:
        return None
    creds = Credentials(token=token)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _get_plain_body(payload: dict) -> str:
    """Extract plain text body from a Gmail message payload."""
    import base64
    # Simple single-part message
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    # Multipart message — find text/plain part
    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
        # Nested multipart
        if part.get("parts"):
            result = _get_plain_body(part)
            if result:
                return result
    return ""


def _search_gmail(service, query: str, max_results: int = 5) -> list[dict]:
    """Search Gmail and return message summaries with body text."""
    results = []
    try:
        resp = service.users().messages().list(
            userId="me", q=query, maxResults=max_results
        ).execute()

        messages = resp.get("messages", [])
        for msg_meta in messages[:max_results]:
            msg = service.users().messages().get(
                userId="me", id=msg_meta["id"], format="full",
            ).execute()

            headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
            body = _get_plain_body(msg.get("payload", {}))
            # Truncate body to keep response manageable
            if len(body) > 500:
                body = body[:500] + "..."
            results.append({
                "from": headers.get("From", "Unknown"),
                "subject": headers.get("Subject", ""),
                "snippet": msg.get("snippet", ""),
                "body": body,
                "date": headers.get("Date", ""),
            })
    except HttpError as e:
        logger.warning(f"Gmail API error: {e}")
    except Exception as e:
        logger.warning(f"Gmail search failed: {e}")
    return results


def _search_drive(service, query: str, max_results: int = 3) -> list[dict]:
    """Search Drive and return file summaries."""
    results = []
    try:
        resp = service.files().list(
            q=f"fullText contains '{query}'",
            pageSize=max_results,
            fields="files(id, name, modifiedTime, webViewLink)",
        ).execute()

        for f in resp.get("files", []):
            results.append({
                "name": f.get("name", ""),
                "last_edited": f.get("modifiedTime", ""),
                "link": f.get("webViewLink", ""),
            })
    except HttpError as e:
        logger.warning(f"Drive API error: {e}")
    except Exception as e:
        logger.warning(f"Drive search failed: {e}")
    return results


def fetch_workspace_context(query: str, source: str = "both", tool_context=None) -> dict:
    """Fetch relevant Gmail and Drive context for the given query.

    Uses the user's OAuth token from the session state to make authenticated
    API calls. Returns empty results if the token is missing or APIs fail.

    Args:
        query: Search query (supports Gmail search operators like 'in:sent', 'from:name')
        source: Where to search - 'gmail', 'drive', or 'both' (default)
    """
    # Try to get the OAuth token from session state
    oauth_token = None
    if tool_context and hasattr(tool_context, "state"):
        oauth_token = tool_context.state.get("oauth_token")

    if not oauth_token:
        logger.info("No OAuth token — returning empty result")
        return NO_DATA

    gmail_svc = _build_gmail_service(oauth_token)
    drive_svc = _build_drive_service(oauth_token)

    search_gmail = source in ("gmail", "both")
    search_drive = source in ("drive", "both")

    emails = _search_gmail(gmail_svc, query) if gmail_svc and search_gmail else []
    files = _search_drive(drive_svc, query) if drive_svc and search_drive else []

    if not emails and not files:
        logger.info("No results from Gmail/Drive — returning empty result")
        return NO_DATA

    # Extract key facts from the results — prefer body over snippet
    key_facts = []
    for email in emails[:2]:
        body = email.get("body", "")
        snippet = email.get("snippet", "")
        content = body if body else snippet
        if content:
            key_facts.append(f"Email from {email['from']} (Subject: {email.get('subject', '')}): {content[:300]}")
    for f in files[:2]:
        key_facts.append(f"File: {f['name']} (last edited: {f['last_edited']})")

    return {
        "emails": emails,
        "files": files,
        "key_facts": key_facts[:3],
        "source": "live",
    }


fetch_workspace_context_tool = FunctionTool(func=fetch_workspace_context)
