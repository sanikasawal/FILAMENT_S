```
   ███████╗██╗██╗      █████╗ ███╗   ███╗███████╗███╗   ██╗████████╗
   ██╔════╝██║██║     ██╔══██╗████╗ ████║██╔════╝████╗  ██║╚══██╔══╝
   █████╗  ██║██║     ███████║██╔████╔██║█████╗  ██╔██╗ ██║   ██║
   ██╔══╝  ██║██║     ██╔══██║██║╚██╔╝██║██╔══╝  ██║╚██╗██║   ██║
   ██║     ██║███████╗██║  ██║██║ ╚═╝ ██║███████╗██║ ╚████║   ██║
   ╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝   ╚═╝

        ┌─────────────────────────────────────────────────┐
        │   Ambient AI Workspace Co-Pilot                 │
        │   No text box. No prompt. No button.            │
        │   Just presence.                                │
        └─────────────────────────────────────────────────┘

                    ╭──────╮
                   ╱  ◉  ◉  ╲       ← Filament sees your screen
                  │    ▽     │       ← listens to your voice
                  │  ╰───╯   │       ← speaks when it matters
                   ╲________╱
                    │ ││ ││ │
                    ╰─╯╰─╯╰─╯
```

# Filament

**An ambient AI workspace co-pilot that watches your screen, listens to your voice, cross-references your Google Workspace data, and speaks at the right moment.**

Built for the **Build With AI NYC Hackathon 2026** — Live Agent Category.

---

## How It Works

```
  ┌──────────────────┐       WebSocket        ┌──────────────────────┐
  │  Chrome Extension │◄─────────────────────►│   FastAPI Backend     │
  │                    │  frames + audio (in)  │                      │
  │  Screen Capture    │  audio + text  (out)  │  Gemini Live API     │
  │  Mic Capture       │                       │  (bidiGenerateContent)│
  │  Audio Playback    │                       │                      │
  │  Floating Orb UI   │                       │  Tool: Gmail + Drive │
  └──────────────────┘                        └──────────────────────┘
         │                                              │
         │  getDisplayMedia()                           │  fetch_workspace_context()
         │  getUserMedia()                              │
         ▼                                              ▼
    User's Screen                               Google Workspace
    + Microphone                                Gmail API + Drive API
```

1. **You click the floating orb** on any webpage
2. Filament starts capturing your screen (1 frame/3s) and microphone
3. Frames and audio stream to the backend over WebSocket
4. The backend pipes everything into the **Gemini Live API** (`gemini-2.5-flash-native-audio-latest`)
5. When the model spots something actionable, it calls `fetch_workspace_context` to search your **Gmail and Google Drive**
6. It **speaks a short nudge** back to you — audio played directly in your browser
7. You can also **talk to it** naturally and it responds with voice

---

## Demo Scenarios

### Scenario 1: Missing Data in a Spreadsheet
```
User opens Google Sheet with empty cells
        ↓  (Filament watches for ~8 seconds)
Filament calls fetch_workspace_context("...based on what it sees...")
        ↓  (searches Gmail for relevant context)
Filament speaks: "That cell looks empty. I found a recent email
                  with the value you need — want me to pull it up?"
```

### Scenario 2: Navigation Detection
```
User switches from Google Docs → Gmail
        ↓  (Filament detects the pattern)
Filament speaks: "You're probably here to follow up on that thread —
                  I can pull the latest email about it."
```

### Scenario 3: Morning Brief
```
User opens new tab before 11am
        ↓  (morning brief trigger)
Filament speaks: "Good morning! You have unread emails
                  and a recent file was shared with you."
```

### Scenario 4: Voice Query
```
User says: "What was the last email I sent?"
        ↓  (Filament hears the question)
Filament calls fetch_workspace_context("in:sent newer_than:1d", source="gmail")
        ↓  (finds the email)
Filament speaks the answer directly
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome Extension Manifest V3, Vanilla JS |
| Screen Capture | `getDisplayMedia()` → canvas → JPEG @ 1fps |
| Audio Capture | `getUserMedia()` → AudioWorklet → PCM Int16 16kHz |
| Transport | WebSocket (bidirectional, persistent) |
| Backend | FastAPI (Python 3.11) on Google Cloud Run |
| AI Model | `gemini-2.5-flash-native-audio-latest` via Gemini Live API |
| Workspace Data | Gmail API + Drive API via OAuth 2.0 |
| Voice Output | Web Audio API, PCM 24kHz sequential playback |
| Deployment | Google Cloud Run, us-central1 |

---

## Project Structure

```
filament/
├── README.md                    ← you are here
├── CLAUDE.md                    ← AI assistant context
├── extension/                   ← Chrome Extension (Manifest V3)
│   ├── manifest.json            ← permissions, OAuth scopes
│   ├── content.js               ← orb UI, screen/mic capture, audio playback
│   ├── background.js            ← morning brief + intent reader triggers
│   ├── popup.html / popup.js    ← settings (backend URL config)
│   └── orb.css                  ← floating orb + panel styles
├── backend/                     ← FastAPI Python backend
│   ├── main.py                  ← WebSocket handler, Gemini Live session
│   ├── tools.py                 ← fetch_workspace_context (Gmail + Drive)
│   ├── agents/
│   │   └── live_agent.py        ← system prompt for the Gemini model
│   ├── services/                ← microservice endpoints (remote mode)
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── docker-compose.yml       ← local multi-service dev
│   ├── cloudbuild.yaml          ← Cloud Build CI/CD
│   ├── deploy.sh                ← Cloud Run deployment
│   ├── setup-iam.sh             ← service-to-service auth
│   └── entrypoint.sh            ← routes to correct service
└── .gitignore
```

---

## Quick Start

### Prerequisites
- Python 3.11+ — install via `brew install python@3.11` (Mac) or [python.org](https://python.org)
- Chrome browser
- A free Gemini API key — takes 2 minutes (see Step 1 below)

---

### Step 1 — Get a Gemini API Key (free)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **"Get API Key"** in the left sidebar → **"Create API Key"**
4. Copy the key (looks like `AIzaSy...`)

---

### Step 2 — Run the Backend

```bash
cd backend

# Create a virtual environment
python3.11 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set up your environment
cp .env.example .env
# Open .env and paste your Gemini API key from Step 1

# Start the backend
python main.py
```

The backend starts on `http://localhost:8080`.

---

### Step 3 — Load the Chrome Extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked** → select the `extension/` folder from this repo
4. The Filament orb will appear on every webpage (bottom right corner)

---

### Step 4 — Sign in & Use Filament

1. Navigate to any webpage
2. Click the **Filament orb**
3. Click **Sign in with Google** — grant Gmail and Drive access
4. Click the orb again to start a session
5. Grant **screen sharing** and **microphone** permissions when prompted
6. Filament is now watching your screen and listening — speak naturally or just work and it will nudge you when it sees something useful

---

## Architecture Modes

Filament supports two execution modes:

### Local Mode (Default)
Single process — the backend opens one Gemini Live session that handles everything:
screen analysis, workspace lookup, and spoken nudge generation.

```
Extension ←→ WebSocket ←→ main.py ←→ Gemini Live API
                                          ↕
                                   fetch_workspace_context()
```

### Remote Mode (Cloud Run)
Microservices — each agent runs as a separate Cloud Run instance:

```
Extension ←→ WebSocket ←→ Orchestrator
                              ├──→ Screen Analyst   (analyzes frames)
                              ├──→ Workspace Agent  (Gmail + Drive lookup)
                              └──→ Nudge Composer   (generates spoken output)
```

Set `AGENT_MODE=remote` and configure service URLs in `.env`.

---

## Key Design Decisions

- **Voice-first**: The primary output is always spoken audio, not text. Text appears in the panel as a secondary transcript.
- **Proactive, not reactive**: Filament doesn't wait for you to ask. It watches your screen and speaks when it has something worth saying.
- **No mock data**: All workspace data comes from real Gmail and Drive API calls. If OAuth isn't configured, the tool returns empty results honestly.
- **Single Live session**: Uses the Gemini Live API's `bidiGenerateContent` for real-time bidirectional streaming — frames and audio in, spoken audio out.
- **End-of-turn signaling**: Every ~9 seconds, the backend sends an `end_of_turn` signal to the Gemini session, prompting the model to analyze accumulated frames and respond.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_API_KEY` | Yes | Gemini API key from AI Studio |
| `AGENT_MODE` | No | `local` (default) or `remote` |
| `PORT` | No | Backend port (default: 8080) |
| `SCREEN_ANALYST_URL` | Remote only | URL for screen analyst service |
| `WORKSPACE_AGENT_URL` | Remote only | URL for workspace agent service |
| `NUDGE_COMPOSER_URL` | Remote only | URL for nudge composer service |

---

## Deployment (Cloud Run)

```bash
# Build and deploy all services
chmod +x backend/deploy.sh
./backend/deploy.sh

# Or use Cloud Build
gcloud builds submit --config backend/cloudbuild.yaml
```

---

## Team

| Name | Role | Contact |
|---|---|---|
| **Vishal Sunil Kumar** | Founding Engineer | vishals2602@gmail.com |
| **Sanika** | Co-presenter | |

---

## License

Built for the Build With AI NYC Hackathon 2026. All rights reserved.

---

```
        ╔═══════════════════════════════════════════════╗
        ║                                               ║
        ║   "The best interface is no interface."        ║
        ║                                               ║
        ║   Filament doesn't wait for you to ask.       ║
        ║   It watches. It listens. It speaks            ║
        ║   when it matters.                             ║
        ║                                               ║
        ╚═══════════════════════════════════════════════╝
```
