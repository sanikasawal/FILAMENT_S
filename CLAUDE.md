# Filament — Claude Code Context

## What This Project Is
Filament is an ambient AI workspace co-pilot built for the **Build With AI NYC Hackathon 2026** (Live Agents category). It's a Chrome Extension + FastAPI backend that watches your screen, listens to your voice, and speaks proactive nudges by cross-referencing your Gmail and Google Drive.

## Team
- **Vishal Sunil Kumar** — original author, Google Cloud account (`vishals2602@gmail.com`)
- **Sanika** — co-presenter, running locally on MacBook (Apple Silicon)

## Architecture
```
Chrome Extension (content.js)
  ├── Screen capture: getDisplayMedia() → canvas → JPEG @ 1 frame/3s
  ├── Audio capture: getUserMedia() → AudioWorklet → PCM Int16 16kHz
  └── WebSocket → backend /ws

FastAPI Backend (main.py)
  ├── AGENT_MODE=local  → single Gemini Live session handles everything
  └── AGENT_MODE=remote → 4 Cloud Run microservices (orchestrator routes to others)

Gemini Live API (gemini-2.5-flash-native-audio-latest)
  └── Tool: fetch_workspace_context(query, source) → Gmail API + Drive API
```

## Key Files
- `extension/content.js` — orb UI, screen/mic capture, WebSocket, audio playback
- `extension/background.js` — OAuth, morning brief trigger
- `extension/popup.js` / `popup.html` — settings panel, sign-in button
- `extension/manifest.json` — OAuth client ID, extension key (locked)
- `backend/main.py` — WebSocket handler, Gemini Live session, tool calling
- `backend/tools.py` — `fetch_workspace_context` (Gmail + Drive)
- `backend/agents/live_agent.py` — system prompt for Gemini
- `backend/agents/nudge_composer.py` — nudge composition prompt
- `backend/deploy.sh` — Cloud Run deployment script

## Deployed Services (Google Cloud Run — project: gcloud-hackathon-9er4rb4nr0k7a)
- Orchestrator: `https://filament-orchestrator-sjs5thynia-uc.a.run.app`
- Screen Analyst: `https://filament-screen-analyst-sjs5thynia-uc.a.run.app`
- Workspace Agent: `https://filament-workspace-agent-sjs5thynia-uc.a.run.app`
- Nudge Composer: `https://filament-nudge-composer-sjs5thynia-uc.a.run.app`

## OAuth Setup
- OAuth Client ID: `76839905027-9mruei1o58bfots328vsp8a8k5l1suik.apps.googleusercontent.com`
- Google Cloud Project: `filament-490403` (project: `gcloud-hackathon-9er4rb4nr0k7a`)
- Extension ID (locked via manifest key): `kaghjhkdpobhkkjnmjhcediamhbelool`
- Scopes: `gmail.readonly`, `drive.readonly`
- Test users: `sanikasawal2001@gmail.com`
- The extension key in manifest.json locks the extension ID so OAuth works for all users who load it unpacked

## Local Development Setup
```bash
# 1. Install Python 3.11
brew install python@3.11

# 2. Backend
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # add your GOOGLE_API_KEY

# 3. Run backend (local mode)
python main.py  # starts on http://localhost:8080

# 4. Load extension
# chrome://extensions/ → Developer mode → Load unpacked → select extension/
```

## Environment Variables
- `GOOGLE_API_KEY` — Gemini API key from https://aistudio.google.com (required)
- `AGENT_MODE` — `local` (default) or `remote` (Cloud Run microservices)

## Deployment
```bash
# Authenticate
gcloud auth login vishals2602@gmail.com
gcloud config set project gcloud-hackathon-9er4rb4nr0k7a

# Deploy all 4 services
cd backend
/opt/homebrew/bin/bash deploy.sh  # use homebrew bash (macOS ships with bash 3.2 which lacks associative arrays)

# Wire orchestrator to service URLs (run after first deploy)
export SCREEN_ANALYST_URL=https://filament-screen-analyst-sjs5thynia-uc.a.run.app
export WORKSPACE_AGENT_URL=https://filament-workspace-agent-sjs5thynia-uc.a.run.app
export NUDGE_COMPOSER_URL=https://filament-nudge-composer-sjs5thynia-uc.a.run.app
/opt/homebrew/bin/bash deploy.sh orchestrator
```

## Known Issues & Decisions
- macOS ships with bash 3.2 — always use `/opt/homebrew/bin/bash deploy.sh` not `./deploy.sh`
- `PORT` is reserved in Cloud Run — do not set it as an env var in deploy.sh
- Extension uses `launchWebAuthFlow` (not `getAuthToken`) — requires the extension key to be fixed in manifest.json so redirect URI matches OAuth client
- `fetch_workspace_context` supports `source` param: `gmail`, `drive`, or `both`
- Gmail search operators work in the query (e.g. `in:sent`, `newer_than:1d`, `from:name`)
- Do NOT add hardcoded names/values (Sarah, NYC, tax rate) to system prompts — biases the model

## WebSocket Default URL
- Local: `ws://localhost:8080/ws`
- Production: `wss://filament-orchestrator-sjs5thynia-uc.a.run.app/ws`
- Currently set to production in `extension/content.js` and `extension/popup.js`
- Users can override via the popup settings panel

## Hackathon Submission Checklist
- [x] Public GitHub repo: https://github.com/Vishal2602/FILAMENT
- [x] Backend deployed on Google Cloud Run
- [x] Uses Gemini Live API (gemini-2.5-flash-native-audio-latest)
- [x] Uses Google GenAI SDK + ADK
- [x] Uses Gmail API + Drive API (Google Cloud services)
- [x] Automated deployment scripts (deploy.sh, cloudbuild.yaml)
- [ ] Architecture diagram
- [ ] Demo video (<4 min)
- [ ] Text description / submission writeup
