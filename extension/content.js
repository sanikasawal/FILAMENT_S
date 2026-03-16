'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════
const DEFAULT_WS_URL = 'wss://filament-orchestrator-sjs5thynia-uc.a.run.app/ws';
const FRAME_INTERVAL_MS = 3000; // 1 frame every 3s — enough for the model, less noise
const AUDIO_SAMPLE_RATE = 16000;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_MESSAGES = 50;
const TOAST_DURATION_MS = 7000;

// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════
let wsUrl = DEFAULT_WS_URL;
let ws = null;
let wsReconnectAttempts = 0;
let isActive = false;
let isMuted = false;
let isPanelOpen = false;
let unreadCount = 0;
let currentState = 'idle';
let screenStream = null;
let micStream = null;
let captureCanvas = null;
let captureCtx = null;
let frameInterval = null;
let audioCtxIn = null;
let workletNode = null;
let audioCtxOut = null;
const messages = [];

// Load saved WS URL
chrome.storage.local.get(['filament_ws_url'], (r) => {
  if (r.filament_ws_url) wsUrl = r.filament_ws_url;
});

// ══════════════════════════════════════════════════════════════════════════════
// SVG ICONS
// ══════════════════════════════════════════════════════════════════════════════
// Friendly bird mascot — uses all 4 Google colors
const BIRD = `<svg viewBox="0 0 24 24" fill="none"><circle cx="10" cy="12.5" r="7.5" fill="#4285F4"/><path d="M5.5 15c0 1.8 2 3.5 4.5 3.5s4.5-1.7 4.5-3.5c-1.5 1-3 1.3-4.5 1.3S7 16 5.5 15z" fill="#D2E3FC"/><path d="M4 10C2 9 1.5 6.5 3 5.5c.5 1.5 2 3 3.5 3.2L4 10z" fill="#34A853"/><path d="M2.5 14.5L.8 12l1.7.4.5 2z" fill="#EA4335"/><circle cx="13.5" cy="10" r="2.2" fill="white"/><circle cx="14" cy="9.5" r="1.1" fill="#202124"/><circle cx="14.5" cy="9" r="0.4" fill="white"/><path d="M17.5 12L21 10.5 17.5 9z" fill="#FBBC05"/></svg>`;

const ICON = {
  mic: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  micOff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  power: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" x2="12" y1="2" y2="12"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  sparkle: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z"/></svg>',
  zap: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  alert: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
};

// ══════════════════════════════════════════════════════════════════════════════
// UI CONSTRUCTION
// ══════════════════════════════════════════════════════════════════════════════
function injectUI() {
  if (document.getElementById('filament-root')) return;

  const root = document.createElement('div');
  root.id = 'filament-root';
  root.innerHTML = `
    <div id="fil-toasts"></div>

    <div id="fil-panel">
      <div class="fil-panel-header">
        <div class="fil-panel-brand">
          <div class="fil-mini-orb">${BIRD}</div>
          <span class="fil-panel-title">Filament</span>
        </div>
        <div id="fil-status-pill">
          <span class="fil-status-dot"></span>
          <span class="fil-status-label">Ready</span>
        </div>
        <button class="fil-close-btn" id="fil-close-btn" aria-label="Close panel">${ICON.x}</button>
      </div>
      <div class="fil-panel-body" id="fil-messages">
        <div class="fil-empty" id="fil-empty">
          <div class="fil-empty-icon">${BIRD}</div>
          <p class="fil-empty-text">Tap the orb to begin</p>
          <p class="fil-empty-sub">Filament watches quietly and speaks only when it has something worth saying</p>
        </div>
      </div>
      <div class="fil-panel-footer" id="fil-footer">
        <button class="fil-action-btn" id="fil-mute-btn">${ICON.mic} Mute</button>
        <button class="fil-action-btn danger" id="fil-stop-btn">${ICON.power} Stop</button>
      </div>
    </div>

    <div id="fil-orb-wrap" class="idle">
      <div class="fil-ring fil-ring-1"></div>
      <div class="fil-ring fil-ring-2"></div>
      <div class="fil-ring fil-ring-3"></div>
      <button id="fil-orb" aria-label="Filament AI assistant">
        <span class="fil-orb-icon">${BIRD}</span>
      </button>
      <div id="fil-conn-dot"></div>
      <div id="fil-count-badge"></div>
    </div>
  `;

  document.body.appendChild(root);

  // Event listeners
  document.getElementById('fil-orb').addEventListener('click', onOrbClick);
  document.getElementById('fil-close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    closePanel();
  });
  document.getElementById('fil-mute-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute();
  });
  document.getElementById('fil-stop-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (isActive) deactivateFilament();
    else activateFilament();
  });

  // Click outside to close panel
  document.addEventListener('click', (e) => {
    if (!isPanelOpen) return;
    const root = document.getElementById('filament-root');
    if (root && !root.contains(e.target)) closePanel();
  });

  updateFooterVisibility();
}

// ══════════════════════════════════════════════════════════════════════════════
// STATE MACHINE
// ══════════════════════════════════════════════════════════════════════════════
function setState(newState) {
  currentState = newState;
  const wrap = document.getElementById('fil-orb-wrap');
  if (!wrap) return;
  wrap.className = newState;
  updateStatusPill(newState);
}

function updateStatusPill(state) {
  const pill = document.getElementById('fil-status-pill');
  if (!pill) return;

  const labels = {
    idle: 'Ready',
    connecting: 'Connecting...',
    listening: 'Watching...',
    speaking: 'Speaking',
    muted: 'Muted',
    error: 'Error',
  };

  pill.className = state;
  pill.querySelector('.fil-status-label').textContent = labels[state] || state;
}

function setConnectionDot(status) {
  const dot = document.getElementById('fil-conn-dot');
  if (!dot) return;
  dot.className = status === 'hidden' ? '' : `visible ${status}`;
}

function updateFooterVisibility() {
  const footer = document.getElementById('fil-footer');
  if (footer) footer.style.display = isActive ? 'flex' : 'none';
}

function updateStopButton() {
  const btn = document.getElementById('fil-stop-btn');
  if (!btn) return;
  if (isActive) {
    btn.innerHTML = `${ICON.power} Stop`;
    btn.className = 'fil-action-btn danger';
  } else {
    btn.innerHTML = `${ICON.play} Start`;
    btn.className = 'fil-action-btn success';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PANEL
// ══════════════════════════════════════════════════════════════════════════════
function openPanel() {
  const panel = document.getElementById('fil-panel');
  if (panel) panel.classList.add('open');
  isPanelOpen = true;
  unreadCount = 0;
  updateBadge();
}

function closePanel() {
  const panel = document.getElementById('fil-panel');
  if (panel) panel.classList.remove('open');
  isPanelOpen = false;
}

function togglePanel() {
  isPanelOpen ? closePanel() : openPanel();
}

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGES
// ══════════════════════════════════════════════════════════════════════════════
function addMessage(text, type = 'nudge') {
  const msg = { text, type, timestamp: Date.now() };
  messages.unshift(msg);
  if (messages.length > MAX_MESSAGES) messages.pop();

  // Remove empty state
  const empty = document.getElementById('fil-empty');
  if (empty) empty.remove();

  // Prepend message element
  const container = document.getElementById('fil-messages');
  if (!container) return;
  const el = createMessageEl(msg);
  container.insertBefore(el, container.firstChild);

  // Trim excess DOM nodes
  while (container.children.length > MAX_MESSAGES) {
    container.removeChild(container.lastChild);
  }

  // Badge if panel closed
  if (!isPanelOpen) {
    unreadCount++;
    updateBadge();
  }
}

function createMessageEl(msg) {
  const div = document.createElement('div');
  div.className = 'fil-msg';

  const labelIcons = { nudge: ICON.sparkle, error: ICON.alert, system: ICON.zap };
  const labelClass = msg.type === 'nudge' ? '' : ` ${msg.type}`;
  const labelText = msg.type === 'nudge' ? 'Insight' : msg.type === 'error' ? 'Notice' : 'Activity';

  div.innerHTML = `
    <div class="fil-msg-header">
      <span class="fil-msg-label${labelClass}">${labelIcons[msg.type] || ICON.sparkle} ${labelText}</span>
      <span class="fil-msg-time">${relativeTime(msg.timestamp)}</span>
    </div>
    <p class="fil-msg-text">${escapeHtml(msg.text)}</p>
  `;
  return div;
}

function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return 'earlier';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ══════════════════════════════════════════════════════════════════════════════
// BADGE
// ══════════════════════════════════════════════════════════════════════════════
function updateBadge() {
  const badge = document.getElementById('fil-count-badge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.classList.add('visible');
    // Trigger bump animation
    badge.classList.remove('bump');
    void badge.offsetWidth; // reflow
    badge.classList.add('bump');
  } else {
    badge.classList.remove('visible');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TOASTS
// ══════════════════════════════════════════════════════════════════════════════
function showToast(text, title = 'Filament', duration = TOAST_DURATION_MS) {
  const container = document.getElementById('fil-toasts');
  if (!container) return;

  // Max 3 toasts
  while (container.children.length >= 3) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = 'fil-toast';
  toast.innerHTML = `
    <div class="fil-toast-icon">${ICON.sparkle}</div>
    <div class="fil-toast-content">
      <div class="fil-toast-title">${escapeHtml(title)}</div>
      <div class="fil-toast-text">${escapeHtml(text)}</div>
    </div>
    <button class="fil-toast-close">${ICON.x}</button>
    <div class="fil-toast-bar" style="width:100%"></div>
  `;

  container.appendChild(toast);

  // Progress bar countdown
  const bar = toast.querySelector('.fil-toast-bar');
  const start = Date.now();
  const tick = () => {
    const elapsed = Date.now() - start;
    const pct = Math.max(0, 1 - elapsed / duration) * 100;
    bar.style.width = pct + '%';
    if (pct > 0 && toast.parentNode) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Auto-dismiss
  const timer = setTimeout(() => dismissToast(toast), duration);

  // Close button
  toast.querySelector('.fil-toast-close').addEventListener('click', () => {
    clearTimeout(timer);
    dismissToast(toast);
  });
}

function dismissToast(toast) {
  if (!toast.parentNode) return;
  toast.classList.add('removing');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// ORB CLICK
// ══════════════════════════════════════════════════════════════════════════════
async function onOrbClick(e) {
  e.stopPropagation();
  if (!isActive) {
    openPanel();
    await activateFilament();
  } else {
    togglePanel();
  }
}

async function activateFilament() {
  setState('connecting');
  setConnectionDot('connecting');
  updateEmptyText('Starting screen capture...', 'Requesting permissions');

  try {
    await startScreenCapture();
    updateEmptyText('Starting microphone...', 'Almost there');
    await startMicrophone();
    connectWebSocket();
    isActive = true;
    setState('listening');
    setConnectionDot('connected');
    updateEmptyText('Watching quietly...', "I\u2019ll speak when something catches my eye");
    updateFooterVisibility();
    updateStopButton();
    showToast('Watching your screen and listening', 'Filament Active');
  } catch (err) {
    console.error('[Filament] Activation error:', err);
    setState('error');
    setConnectionDot('error');
    updateEmptyText('Could not start Filament', err.message);
    addMessage('Activation failed: ' + err.message, 'error');
  }
}

function deactivateFilament() {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  clearInterval(frameInterval);
  frameInterval = null;

  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (audioCtxIn) {
    audioCtxIn.close().catch(() => {});
    audioCtxIn = null;
  }

  wsReconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect
  if (ws) {
    ws.close();
    ws = null;
  }

  isActive = false;
  isMuted = false;
  setState('idle');
  setConnectionDot('hidden');
  updateFooterVisibility();
  updateStopButton();
  updateMuteButton();
  showToast('Session ended', 'Stopped');
  addMessage('Session ended by user', 'system');
}

function updateEmptyText(main, sub) {
  const el = document.getElementById('fil-empty');
  if (!el) return;
  const t = el.querySelector('.fil-empty-text');
  const s = el.querySelector('.fil-empty-sub');
  if (t) t.textContent = main;
  if (s) s.textContent = sub;
}

// ══════════════════════════════════════════════════════════════════════════════
// SCREEN CAPTURE
// ══════════════════════════════════════════════════════════════════════════════
async function startScreenCapture() {
  screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 1 },
    audio: false,
  });

  const video = document.createElement('video');
  video.srcObject = screenStream;
  video.muted = true;
  await video.play();

  captureCanvas = document.createElement('canvas');
  captureCanvas.width = 1280;
  captureCanvas.height = 720;
  captureCtx = captureCanvas.getContext('2d');

  frameInterval = setInterval(() => sendFrame(video), FRAME_INTERVAL_MS);

  screenStream.getVideoTracks()[0].addEventListener('ended', () => {
    clearInterval(frameInterval);
    screenStream = null;
    if (isActive) {
      addMessage('Screen sharing stopped', 'system');
      deactivateFilament();
    }
  });
}

function sendFrame(video) {
  if (!ws || ws.readyState !== WebSocket.OPEN || isMuted) return;
  try {
    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.7);
    const base64 = dataUrl.split(',')[1];
    ws.send(JSON.stringify({ type: 'frame', data: base64 }));
  } catch (_) {
    // Video not ready
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MICROPHONE
// ══════════════════════════════════════════════════════════════════════════════
async function startMicrophone() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: AUDIO_SAMPLE_RATE, channelCount: 1, echoCancellation: true },
  });

  audioCtxIn = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });

  // Register AudioWorklet processor via inline Blob (replaces deprecated ScriptProcessorNode)
  const workletCode = `
    class PcmCaptureProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (input && input[0] && input[0].length > 0) {
          this.port.postMessage(input[0]);
        }
        return true;
      }
    }
    registerProcessor('pcm-capture', PcmCaptureProcessor);
  `;
  const blob = new Blob([workletCode], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(blob);
  await audioCtxIn.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  const source = audioCtxIn.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioCtxIn, 'pcm-capture');

  workletNode.port.onmessage = (event) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || isMuted) return;
    const float32 = event.data;
    const int16 = float32ToInt16(float32);
    const base64 = arrayBufferToBase64(int16.buffer);
    ws.send(JSON.stringify({ type: 'audio', data: base64 }));
  };

  source.connect(workletNode);
  workletNode.connect(audioCtxIn.destination);
}

function float32ToInt16(arr) {
  const out = new Int16Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const s = Math.max(-1, Math.min(1, arr[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIO PLAYBACK (queued — chunks play sequentially, never overlap)
// ══════════════════════════════════════════════════════════════════════════════
let nextPlayTime = 0;
let lastSourceNode = null;

function playAudioPCM(arrayBuffer) {
  if (!audioCtxOut) {
    audioCtxOut = new AudioContext({ sampleRate: 24000 });
    nextPlayTime = 0;
  }

  // Resume context if suspended (Chrome autoplay policy)
  if (audioCtxOut.state === 'suspended') audioCtxOut.resume();

  const int16 = new Int16Array(arrayBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

  const audioBuf = audioCtxOut.createBuffer(1, float32.length, 24000);
  audioBuf.getChannelData(0).set(float32);
  const src = audioCtxOut.createBufferSource();
  src.buffer = audioBuf;
  src.connect(audioCtxOut.destination);

  // Schedule this chunk right after the previous one ends
  const now = audioCtxOut.currentTime;
  const startTime = Math.max(now, nextPlayTime);
  src.start(startTime);
  nextPlayTime = startTime + audioBuf.duration;

  // Track the last source so we can detect when all audio finishes
  lastSourceNode = src;
  src.onended = () => {
    // Only go back to listening when THIS was the last chunk
    if (lastSourceNode === src && isActive && !isMuted) {
      setState('listening');
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════════════════════════════
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    wsReconnectAttempts = 0;
    setConnectionDot('connected');
    if (currentState === 'connecting' || currentState === 'error') setState('listening');

    // Read OAuth token directly from chrome.storage.local (set by popup.js sign-in)
    chrome.storage.local.get(['filament_oauth_token'], (result) => {
      const token = result.filament_oauth_token || null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'auth', token }));
        console.log('[Filament] Auth token sent:', token ? 'yes (' + token.substring(0, 10) + '...)' : 'NONE');
        if (!token) {
          addMessage('Sign in to Google via the Filament extension popup first.', 'error');
        }
      }
    });
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      setState('speaking');
      playAudioPCM(event.data);
    } else {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'text' && msg.content) {
          addMessage(msg.content, 'nudge');
          if (!isPanelOpen) showToast(msg.content, 'New Insight');
        }
      } catch (_) {}
    }
  };

  ws.onerror = () => {
    console.error('[Filament] WebSocket error');
    setConnectionDot('error');
  };

  ws.onclose = () => {
    if (isActive && wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      setConnectionDot('connecting');
      wsReconnectAttempts++;
      setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
    } else if (isActive) {
      setState('error');
      setConnectionDot('error');
      addMessage('Lost connection to backend', 'error');
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLS
// ══════════════════════════════════════════════════════════════════════════════
function toggleMute() {
  isMuted = !isMuted;
  updateMuteButton();
  if (isMuted) {
    setState('muted');
  } else if (isActive) {
    setState('listening');
  }
}

function updateMuteButton() {
  const btn = document.getElementById('fil-mute-btn');
  if (!btn) return;
  btn.innerHTML = isMuted ? `${ICON.micOff} Unmute` : `${ICON.mic} Mute`;
}

// ══════════════════════════════════════════════════════════════════════════════
// BACKGROUND MESSAGE LISTENER
// ══════════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg) => {
  if (!isActive || !ws || ws.readyState !== WebSocket.OPEN) return;

  if (msg.type === 'morning_brief') {
    ws.send(JSON.stringify({ type: 'frame', data: '', context: 'morning_brief' }));
    addMessage('Morning brief triggered', 'system');
  }

  if (msg.type === 'intent_reader') {
    ws.send(JSON.stringify({
      type: 'frame',
      data: '',
      context: 'intent_reader',
      fromDoc: msg.fromDoc || '',
    }));
    addMessage('Detected navigation from document to Gmail', 'system');
  }
});

// ── Auto-send token when user signs in via popup ────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.filament_oauth_token && changes.filament_oauth_token.newValue) {
    const token = changes.filament_oauth_token.newValue;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'auth', token }));
      console.log('[Filament] Auth token updated from popup sign-in');
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════
injectUI();
