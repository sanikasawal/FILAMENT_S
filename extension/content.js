'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════
const DEFAULT_WS_URL = 'wss://filament-orchestrator-sjs5thynia-uc.a.run.app/ws';
const FRAME_INTERVAL_MS = 3000;
const AUDIO_SAMPLE_RATE = 16000;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_MESSAGES = 50;
const TOAST_DURATION_MS = 7000;
const MAX_TOASTS = 2;

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
let currentView = 'timeline';
let isSignedIn = false;
let tokenTimestamp = null;
let screenStream = null;
let micStream = null;
let captureCanvas = null;
let captureCtx = null;
let frameInterval = null;
let audioCtxIn = null;
let workletNode = null;
let audioCtxOut = null;
const messages = [];

// Load saved settings
chrome.storage.local.get(['filament_ws_url', 'filament_oauth_token', 'filament_token_time'], (r) => {
  if (r.filament_ws_url) wsUrl = r.filament_ws_url;
  if (r.filament_oauth_token && typeof r.filament_oauth_token === 'string' && r.filament_oauth_token.length > 10) {
    isSignedIn = true;
  }
  if (r.filament_token_time) tokenTimestamp = r.filament_token_time;
});

// ══════════════════════════════════════════════════════════════════════════════
// SVG ICONS (stroke style, no emojis)
// ══════════════════════════════════════════════════════════════════════════════
const ICON = {
  mic: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  micOff: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  x: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  gear: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  screen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
  micPerm: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
};

// ══════════════════════════════════════════════════════════════════════════════
// UI CONSTRUCTION
// ══════════════════════════════════════════════════════════════════════════════
function injectUI() {
  if (document.getElementById('filament-root')) return;

  const logoH = chrome.runtime.getURL('logo-filament.svg');
  const logoV = chrome.runtime.getURL('logo-filament-vertical.svg');

  const root = document.createElement('div');
  root.id = 'filament-root';
  root.innerHTML = `
    <div id="fil-toasts"></div>

    <div id="fil-container" class="st-idle">
      <div id="fil-panel">
        <div class="fil-panel-header">
          <div class="fil-header-glow"></div>
          <img src="${logoH}" class="fil-header-logo" alt="" />
          <span class="fil-header-name" id="fil-header-name">Filament</span>
          <div class="fil-header-spacer"></div>
          <div class="fil-header-status" id="fil-header-status">
            <span class="fil-status-dot" id="fil-status-dot"></span>
            <span id="fil-status-label">Ready</span>
          </div>
          <button class="fil-close-btn" id="fil-close-btn" aria-label="Close panel">${ICON.x}</button>
        </div>

        <div id="fil-panel-body">
          <!-- Timeline View -->
          <div id="fil-view-timeline" class="fil-view active">
            <div class="fil-timeline" id="fil-messages">
              <div class="fil-empty" id="fil-empty">
                <div class="fil-empty-icon"><img src="${logoH}" alt="" /></div>
                <p class="fil-empty-text">Tap the tab to begin</p>
                <p class="fil-empty-sub">Filament will speak when it has<br>something worth saying</p>
              </div>
            </div>
          </div>

          <!-- Onboarding View -->
          <div id="fil-view-onboarding" class="fil-view">
            <div class="fil-onboarding" id="fil-onboarding-content">
              <div class="ob-logo"><img src="${logoH}" alt="" /></div>
              <div class="ob-title" id="fil-ob-title">Welcome to Filament</div>
              <div class="ob-sub" id="fil-ob-sub">Sign in to let Filament surface insights<br>from your Gmail and Google Drive</div>
              <div id="fil-ob-auth-area">
                <button class="btn-google" id="fil-signin-btn">
                  <span class="g-icon">G</span>
                  Sign in with Google
                </button>
              </div>
              <div class="ob-divider"></div>
              <div class="field-group">
                <div class="field-label">Backend Server</div>
                <input class="field-input" id="fil-ws-input" type="text" spellcheck="false" />
                <div class="conn-test" id="fil-conn-test" style="display:none;">
                  <span class="ct-dot"></span>
                  <span id="fil-conn-test-text"></span>
                </div>
                <div class="field-row">
                  <button class="field-btn" id="fil-test-btn">Test</button>
                  <button class="field-btn primary" id="fil-save-btn">Save</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Settings View -->
          <div id="fil-view-settings" class="fil-view">
            <div class="fil-onboarding top-align">
              <div class="signed-in-row" id="fil-settings-auth">
                <div class="si-avatar" id="fil-settings-avatar">?</div>
                <div class="si-info">
                  <div class="si-name" id="fil-settings-name">Not signed in</div>
                  <div class="si-email" id="fil-settings-email"></div>
                </div>
                <span class="si-check" id="fil-settings-check">&#x2713;</span>
              </div>
              <div class="token-row" id="fil-token-row" style="display:none;">
                <div class="token-status" id="fil-token-status"></div>
                <div class="token-time" id="fil-token-time"></div>
              </div>
              <div class="field-group">
                <div class="field-label">Backend Server</div>
                <input class="field-input" id="fil-settings-ws" type="text" spellcheck="false" />
                <div class="conn-test" id="fil-settings-conn" style="display:none;">
                  <span class="ct-dot"></span>
                  <span id="fil-settings-conn-text"></span>
                </div>
                <div class="field-row">
                  <button class="field-btn" id="fil-settings-test">Test</button>
                  <button class="field-btn primary" id="fil-settings-save">Save</button>
                </div>
              </div>
              <div class="ob-divider"></div>
              <div class="fil-settings-footer">
                <span class="fil-version">Filament v1.0.0</span>
                <span class="kbd"><key>&#x2318;</key><key>&#x21E7;</key><key>F</key> toggle</span>
              </div>
              <button class="sign-out-link" id="fil-signout-btn">Sign out</button>
            </div>
          </div>

          <!-- Permission Explainer View -->
          <div id="fil-view-permissions" class="fil-view">
            <div class="fil-onboarding">
              <div class="ob-logo"><img src="${logoH}" alt="" /></div>
              <div class="ob-title">Permissions needed</div>
              <div class="ob-sub">Filament needs your screen and microphone<br>to watch and listen</div>
              <div class="perm-list">
                <div class="perm-item">
                  <div class="perm-icon screen">${ICON.screen}</div>
                  <div class="perm-info">
                    <div class="perm-name">Screen capture</div>
                    <div class="perm-desc">See what you're working on to give relevant insights</div>
                  </div>
                </div>
                <div class="perm-item">
                  <div class="perm-icon mic">${ICON.micPerm}</div>
                  <div class="perm-info">
                    <div class="perm-name">Microphone</div>
                    <div class="perm-desc">Hear your voice so Filament can speak back</div>
                  </div>
                </div>
              </div>
              <button class="btn-google" id="fil-perm-continue">Continue</button>
              <div class="fil-privacy">Your screen and audio are never stored — only analyzed in real-time</div>
            </div>
          </div>
        </div>

        <div class="fil-panel-footer" id="fil-footer">
          <div class="ft-avatar" id="fil-ft-avatar">?</div>
          <div class="ft-dot off" id="fil-ft-dot"></div>
          <div class="ft-label" id="fil-ft-label">Ready</div>
          <button class="ft-btn start" id="fil-start-btn" style="display:none;">Start</button>
          <button class="ft-btn" id="fil-mute-btn" style="display:none;">Mute</button>
          <button class="ft-btn stop" id="fil-stop-btn" style="display:none;">Stop</button>
          <button class="ft-btn start" id="fil-reconnect-btn" style="display:none;">Reconnect</button>
          <button class="ft-gear" id="fil-gear-btn" aria-label="Settings">${ICON.gear}</button>
        </div>
      </div>

      <div class="fil-edge-tab" id="fil-edge-tab">
        <div class="fil-tab-glow"></div>
        <div class="fil-tab-badge" id="fil-tab-badge"></div>
        <div class="fil-edge-wave"><img src="${logoV}" alt="Filament" /></div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // ── Event Listeners ──
  document.getElementById('fil-edge-tab').addEventListener('click', onTabClick);
  document.getElementById('fil-close-btn').addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  document.getElementById('fil-mute-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
  document.getElementById('fil-stop-btn').addEventListener('click', (e) => { e.stopPropagation(); deactivateFilament(); });
  document.getElementById('fil-start-btn').addEventListener('click', (e) => { e.stopPropagation(); activateFilament(); });
  document.getElementById('fil-reconnect-btn').addEventListener('click', (e) => { e.stopPropagation(); activateFilament(); });
  document.getElementById('fil-gear-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(); });
  document.getElementById('fil-signin-btn').addEventListener('click', (e) => { e.stopPropagation(); startOAuth(); });
  document.getElementById('fil-signout-btn').addEventListener('click', (e) => { e.stopPropagation(); signOut(); });
  document.getElementById('fil-perm-continue').addEventListener('click', (e) => { e.stopPropagation(); startCapture(); });
  document.getElementById('fil-test-btn').addEventListener('click', (e) => { e.stopPropagation(); testConnection('fil-conn-test', 'fil-conn-test-text', 'fil-ws-input'); });
  document.getElementById('fil-save-btn').addEventListener('click', (e) => { e.stopPropagation(); saveSettings('fil-ws-input'); });
  document.getElementById('fil-settings-test').addEventListener('click', (e) => { e.stopPropagation(); testConnection('fil-settings-conn', 'fil-settings-conn-text', 'fil-settings-ws'); });
  document.getElementById('fil-settings-save').addEventListener('click', (e) => { e.stopPropagation(); saveSettings('fil-settings-ws'); });

  // Click outside to close
  document.addEventListener('click', (e) => {
    if (!isPanelOpen) return;
    const r = document.getElementById('filament-root');
    if (r && !r.contains(e.target)) closePanel();
  });

  // Initialize
  const wsInput = document.getElementById('fil-ws-input');
  const settingsWs = document.getElementById('fil-settings-ws');
  if (wsInput) wsInput.value = wsUrl;
  if (settingsWs) settingsWs.value = wsUrl;

  updateFooter();
  checkAuthStatus();
}

// ══════════════════════════════════════════════════════════════════════════════
// STATE MACHINE
// ══════════════════════════════════════════════════════════════════════════════
function setState(newState) {
  currentState = newState;
  const container = document.getElementById('fil-container');
  if (!container) return;
  container.className = `st-${newState}`;
  updateHeaderStatus(newState);
  updateFooter();
}

function updateHeaderStatus(state) {
  const label = document.getElementById('fil-status-label');
  const dot = document.getElementById('fil-status-dot');
  if (!label) return;

  const labels = {
    idle: 'Ready',
    connecting: 'Connecting',
    listening: 'Listening',
    speaking: 'Speaking',
    muted: 'Muted',
    error: 'Error',
    searching: 'Searching Gmail',
  };

  label.textContent = labels[state] || state;
  if (dot) {
    dot.className = 'fil-status-dot' + ((state === 'listening' || state === 'connecting' || state === 'searching') ? ' blink' : '');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VIEW SWITCHING
// ══════════════════════════════════════════════════════════════════════════════
function showView(name) {
  currentView = name;
  const views = ['timeline', 'onboarding', 'settings', 'permissions'];
  views.forEach(v => {
    const el = document.getElementById(`fil-view-${v}`);
    if (el) {
      el.classList.toggle('active', v === name);
    }
  });
  const headerName = document.getElementById('fil-header-name');
  if (headerName) headerName.textContent = name === 'settings' ? 'Settings' : 'Filament';
  const gear = document.getElementById('fil-gear-btn');
  if (gear) gear.classList.toggle('active', name === 'settings');
}

function toggleSettings() {
  if (currentView === 'settings') {
    showView('timeline');
  } else {
    updateSettingsView();
    showView('settings');
  }
}

function updateSettingsView() {
  const nameEl = document.getElementById('fil-settings-name');
  const emailEl = document.getElementById('fil-settings-email');
  const avatarEl = document.getElementById('fil-settings-avatar');
  const wsEl = document.getElementById('fil-settings-ws');
  if (wsEl) wsEl.value = wsUrl;

  if (isSignedIn) {
    if (nameEl) nameEl.textContent = 'Signed in';
    if (emailEl) emailEl.textContent = '';
    if (avatarEl) avatarEl.textContent = 'V';
    updateTokenStatus();
  } else {
    if (nameEl) nameEl.textContent = 'Not signed in';
    if (emailEl) emailEl.textContent = '';
    if (avatarEl) avatarEl.textContent = '?';
  }
}

function updateTokenStatus() {
  const row = document.getElementById('fil-token-row');
  const status = document.getElementById('fil-token-status');
  const time = document.getElementById('fil-token-time');
  if (!row || !status || !time) return;

  if (!tokenTimestamp) {
    row.style.display = 'none';
    return;
  }

  row.style.display = 'flex';
  const ageMin = Math.floor((Date.now() - tokenTimestamp) / 60000);
  const expired = ageMin > 55;

  status.className = 'token-status ' + (expired ? 'expired' : 'valid');
  status.textContent = expired ? 'Token expired' : 'Token valid';
  time.textContent = expired ? `Expired ${ageMin - 55}m ago` : `Refreshed ${ageMin}m ago`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PANEL
// ══════════════════════════════════════════════════════════════════════════════
function openPanel() {
  const panel = document.getElementById('fil-panel');
  const tab = document.getElementById('fil-edge-tab');
  if (panel) panel.classList.add('open');
  if (tab) tab.classList.add('active');
  isPanelOpen = true;
  unreadCount = 0;
  updateBadge();
}

function closePanel() {
  const panel = document.getElementById('fil-panel');
  const tab = document.getElementById('fil-edge-tab');
  if (panel) panel.classList.remove('open');
  if (tab && !isActive) tab.classList.remove('active');
  isPanelOpen = false;
  if (currentView === 'settings') showView('timeline');
}

function onTabClick(e) {
  e.stopPropagation();
  if (isPanelOpen) {
    closePanel();
  } else {
    checkAuthStatus();
    openPanel();
  }
}

function checkAuthStatus() {
  try {
    chrome.storage.local.get(['filament_oauth_token', 'filament_token_time'], (r) => {
      if (chrome.runtime.lastError) return;
      const token = r.filament_oauth_token;
      isSignedIn = token && typeof token === 'string' && token.length > 10;
      tokenTimestamp = r.filament_token_time || null;

      if (!isSignedIn && !isActive) {
        showView('onboarding');
        updateOnboardingForSignIn();
      } else if (isSignedIn && !isActive) {
        showView('onboarding');
        updateOnboardingForReady();
      } else {
        showView('timeline');
      }
      updateFooter();
    });
  } catch (_) {}
}

function updateOnboardingForSignIn() {
  const title = document.getElementById('fil-ob-title');
  const sub = document.getElementById('fil-ob-sub');
  const area = document.getElementById('fil-ob-auth-area');
  if (title) title.textContent = 'Welcome to Filament';
  if (sub) sub.innerHTML = 'Sign in to let Filament surface insights<br>from your Gmail and Google Drive';
  if (area) {
    area.innerHTML = `
      <button class="btn-google" id="fil-signin-btn">
        <span class="g-icon">G</span>
        Sign in with Google
      </button>
    `;
    document.getElementById('fil-signin-btn').addEventListener('click', (e) => { e.stopPropagation(); startOAuth(); });
  }
}

function updateOnboardingForReady() {
  const title = document.getElementById('fil-ob-title');
  const sub = document.getElementById('fil-ob-sub');
  const area = document.getElementById('fil-ob-auth-area');
  if (title) title.textContent = 'Ready to go';
  if (sub) sub.innerHTML = 'Tap Start to begin watching your screen<br>and listening for context';
  if (area) {
    area.innerHTML = `
      <div class="signed-in-row">
        <div class="si-avatar">V</div>
        <div class="si-info">
          <div class="si-name">Signed in to Google</div>
          <div class="si-email"></div>
        </div>
        <span class="si-check">&#x2713;</span>
      </div>
    `;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FOOTER
// ══════════════════════════════════════════════════════════════════════════════
function updateFooter() {
  const startBtn = document.getElementById('fil-start-btn');
  const muteBtn = document.getElementById('fil-mute-btn');
  const stopBtn = document.getElementById('fil-stop-btn');
  const reconnectBtn = document.getElementById('fil-reconnect-btn');
  const dotEl = document.getElementById('fil-ft-dot');
  const labelEl = document.getElementById('fil-ft-label');
  const avatarEl = document.getElementById('fil-ft-avatar');

  if (!startBtn) return;

  // Hide all action buttons first
  startBtn.style.display = 'none';
  muteBtn.style.display = 'none';
  stopBtn.style.display = 'none';
  reconnectBtn.style.display = 'none';

  // Avatar
  if (avatarEl) {
    avatarEl.textContent = isSignedIn ? 'V' : '?';
    avatarEl.classList.toggle('hidden', !isSignedIn && !isActive);
  }

  if (currentState === 'error' && !isActive) {
    // Disconnected
    if (dotEl) dotEl.className = 'ft-dot err';
    if (labelEl) labelEl.textContent = 'Disconnected';
    reconnectBtn.style.display = '';
  } else if (isActive && isMuted) {
    if (dotEl) dotEl.className = 'ft-dot warn';
    if (labelEl) labelEl.textContent = 'Muted';
    muteBtn.style.display = '';
    muteBtn.textContent = 'Unmute';
    muteBtn.className = 'ft-btn muted';
    stopBtn.style.display = '';
  } else if (isActive) {
    if (dotEl) dotEl.className = 'ft-dot on';
    if (labelEl) labelEl.textContent = 'Connected';
    muteBtn.style.display = '';
    muteBtn.textContent = 'Mute';
    muteBtn.className = 'ft-btn';
    stopBtn.style.display = '';
  } else if (isSignedIn) {
    if (dotEl) dotEl.className = 'ft-dot off';
    if (labelEl) labelEl.textContent = 'Ready';
    startBtn.style.display = '';
  } else {
    if (dotEl) dotEl.className = 'ft-dot off';
    if (labelEl) labelEl.textContent = 'Not signed in';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGES (Timeline)
// ══════════════════════════════════════════════════════════════════════════════
function addMessage(text, type = 'nudge', source = null) {
  const msg = { text, type, source, timestamp: Date.now(), read: isPanelOpen };
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
  div.className = 'tl-item';

  // Dot class
  let dotClass = 'tl-dot';
  if (msg.type === 'error') dotClass += ' error';
  else if (msg.source === 'morning_brief') dotClass += ' morning';
  else if (msg.source === 'intent') dotClass += ' intent';
  else if (msg.read) dotClass += ' read';
  else if (msg.type === 'system') dotClass += ' faded';
  else dotClass += ' new';

  // Tag
  let tagHtml = '';
  const tagMap = {
    morning_brief: '<div class="tl-tag morning">Morning Brief</div>',
    intent: '<div class="tl-tag intent">Intent</div>',
    gmail: '<div class="tl-tag gmail">Gmail</div>',
    drive: '<div class="tl-tag drive">Drive</div>',
  };
  if (msg.source && tagMap[msg.source]) tagHtml = tagMap[msg.source];

  // Dim class for system messages
  const textClass = msg.type === 'system' ? 'tl-text dim' : 'tl-text';

  div.innerHTML = `
    <div class="${dotClass}"></div>
    <div class="tl-body">
      ${tagHtml}
      <div class="tl-time">${relativeTime(msg.timestamp)}</div>
      <p class="${textClass}">${escapeHtml(msg.text)}</p>
    </div>
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
  const badge = document.getElementById('fil-tab-badge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
    badge.classList.add('visible');
    badge.classList.remove('bump');
    void badge.offsetWidth;
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

  while (container.children.length >= MAX_TOASTS) {
    container.removeChild(container.firstChild);
  }

  const logoUrl = chrome.runtime.getURL('logo-filament.svg');
  const toast = document.createElement('div');
  toast.className = 'fil-toast';
  toast.innerHTML = `
    <div class="fil-toast-icon"><img src="${logoUrl}" alt="" /></div>
    <div class="fil-toast-content">
      <div class="fil-toast-title">${escapeHtml(title)}</div>
      <div class="fil-toast-text">${escapeHtml(text)}</div>
    </div>
    <button class="fil-toast-close" aria-label="Dismiss">${ICON.x}</button>
    <div class="fil-toast-bar" style="width:100%"></div>
  `;

  container.appendChild(toast);

  const bar = toast.querySelector('.fil-toast-bar');
  const start = Date.now();
  const tick = () => {
    const elapsed = Date.now() - start;
    const pct = Math.max(0, 1 - elapsed / duration) * 100;
    bar.style.width = pct + '%';
    if (pct > 0 && toast.parentNode) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const timer = setTimeout(() => dismissToast(toast), duration);
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
// AUTH (OAuth via background.js)
// ══════════════════════════════════════════════════════════════════════════════
function startOAuth() {
  const btn = document.getElementById('fil-signin-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }

  chrome.runtime.sendMessage({ type: 'start_oauth' }, (response) => {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="g-icon">G</span> Sign in with Google'; }
    if (chrome.runtime.lastError) {
      showToast('Sign-in failed: ' + chrome.runtime.lastError.message);
      return;
    }
    if (response && response.token) {
      isSignedIn = true;
      tokenTimestamp = Date.now();
      checkAuthStatus();
      showToast('Signed in to Google', 'Filament');
    } else {
      showToast('Sign-in cancelled or failed');
    }
  });
}

function signOut() {
  chrome.runtime.sendMessage({ type: 'clear_token' }, () => {
    isSignedIn = false;
    tokenTimestamp = null;
    if (isActive) deactivateFilament();
    checkAuthStatus();
    showToast('Signed out');
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS (WebSocket URL)
// ══════════════════════════════════════════════════════════════════════════════
function testConnection(resultId, textId, inputId) {
  const url = document.getElementById(inputId)?.value?.trim();
  if (!url) return;

  const resultEl = document.getElementById(resultId);
  const textEl = document.getElementById(textId);
  if (!resultEl || !textEl) return;

  resultEl.style.display = 'flex';
  resultEl.className = 'conn-test testing';
  textEl.textContent = 'Connecting...';

  const testWs = new WebSocket(url);
  const timeout = setTimeout(() => {
    testWs.close();
    resultEl.className = 'conn-test fail';
    textEl.textContent = 'Timeout — backend not reachable';
  }, 5000);

  testWs.onopen = () => {
    clearTimeout(timeout);
    testWs.close();
    resultEl.className = 'conn-test success';
    textEl.textContent = 'Connected';
  };
  testWs.onerror = () => {
    clearTimeout(timeout);
    resultEl.className = 'conn-test fail';
    textEl.textContent = 'Connection failed — is the backend running?';
  };
}

function saveSettings(inputId) {
  const url = document.getElementById(inputId)?.value?.trim();
  if (!url) return;
  wsUrl = url;
  chrome.storage.local.set({ filament_ws_url: url }, () => {
    showToast('Settings saved — reload page to apply');
    // Sync both inputs
    const wsInput = document.getElementById('fil-ws-input');
    const settingsWs = document.getElementById('fil-settings-ws');
    if (wsInput) wsInput.value = url;
    if (settingsWs) settingsWs.value = url;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIVATION
// ══════════════════════════════════════════════════════════════════════════════
function activateFilament() {
  showView('permissions');
}

async function startCapture() {
  setState('connecting');
  showView('timeline');

  // Remove old empty state, show new connecting empty
  const empty = document.getElementById('fil-empty');
  if (empty) {
    empty.querySelector('.fil-empty-text').textContent = 'Starting...';
    empty.querySelector('.fil-empty-sub').textContent = 'Requesting screen and microphone access';
  }

  try {
    await startScreenCapture();
    await startMicrophone();
    connectWebSocket();
    isActive = true;
    setState('listening');
    const tab = document.getElementById('fil-edge-tab');
    if (tab) tab.classList.add('active');

    if (empty) {
      empty.querySelector('.fil-empty-text').textContent = 'Watching quietly';
      empty.querySelector('.fil-empty-sub').textContent = 'Filament will speak when it has something worth saying';
    }
    updateFooter();
    showToast('Watching your screen and listening', 'Filament Active');
  } catch (err) {
    console.error('[Filament] Activation error:', err);
    setState('error');
    showView('onboarding');
    const title = document.getElementById('fil-ob-title');
    const sub = document.getElementById('fil-ob-sub');
    if (title) { title.textContent = 'Permission denied'; title.style.color = 'rgba(255,111,97,0.8)'; }
    if (sub) sub.innerHTML = 'Filament needs screen and microphone<br>access to work. Please try again.';
    const area = document.getElementById('fil-ob-auth-area');
    if (area) {
      area.innerHTML = '<button class="btn-google" id="fil-retry-btn">Try Again</button>';
      document.getElementById('fil-retry-btn').addEventListener('click', (e) => { e.stopPropagation(); activateFilament(); });
    }
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

  wsReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
  if (ws) {
    ws.close();
    ws = null;
  }

  isActive = false;
  isMuted = false;
  setState('idle');
  const tab = document.getElementById('fil-edge-tab');
  if (tab && !isPanelOpen) tab.classList.remove('active');
  updateFooter();
  showToast('Session ended', 'Stopped');
  addMessage('Session ended by user', 'system');
}

// ══════════════════════════════════════════════════════════════════════════════
// SCREEN CAPTURE (preserved from original)
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
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════════════
// MICROPHONE (preserved from original)
// ══════════════════════════════════════════════════════════════════════════════
async function startMicrophone() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: AUDIO_SAMPLE_RATE, channelCount: 1, echoCancellation: true },
  });

  audioCtxIn = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
  const workletUrl = chrome.runtime.getURL('worklet-processor.js');
  await audioCtxIn.audioWorklet.addModule(workletUrl);

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
// AUDIO PLAYBACK (preserved from original — queued, no overlap)
// ══════════════════════════════════════════════════════════════════════════════
let nextPlayTime = 0;
let lastSourceNode = null;

function playAudioPCM(arrayBuffer) {
  if (!audioCtxOut) {
    audioCtxOut = new AudioContext({ sampleRate: 24000 });
    nextPlayTime = 0;
  }

  if (audioCtxOut.state === 'suspended') audioCtxOut.resume();

  const int16 = new Int16Array(arrayBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

  const audioBuf = audioCtxOut.createBuffer(1, float32.length, 24000);
  audioBuf.getChannelData(0).set(float32);
  const src = audioCtxOut.createBufferSource();
  src.buffer = audioBuf;
  src.connect(audioCtxOut.destination);

  const now = audioCtxOut.currentTime;
  const startTime = Math.max(now, nextPlayTime);
  src.start(startTime);
  nextPlayTime = startTime + audioBuf.duration;

  lastSourceNode = src;
  src.onended = () => {
    if (lastSourceNode === src && isActive && !isMuted) {
      setState('listening');
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET (preserved from original with minor additions)
// ══════════════════════════════════════════════════════════════════════════════
async function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  let pendingToken = null;
  try {
    pendingToken = await new Promise(resolve =>
      chrome.storage.local.get(['filament_oauth_token'], r => resolve(r.filament_oauth_token || null))
    );
  } catch (e) {}

  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    wsReconnectAttempts = 0;
    if (currentState === 'connecting' || currentState === 'error') setState('listening');

    try {
      ws.send(JSON.stringify({ type: 'auth', token: pendingToken }));
      console.log('[Filament] Auth token sent:', pendingToken ? 'yes' : 'NONE');
      if (!pendingToken) {
        addMessage('Sign in to Google first for Gmail/Drive access.', 'error');
      }
      // Token age check
      if (tokenTimestamp && (Date.now() - tokenTimestamp) > 55 * 60 * 1000) {
        addMessage('Your Google token may be expired. Re-authenticate in settings.', 'error');
      }
    } catch (e) {
      console.warn('[Filament] Extension context invalidated');
    }
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
  };

  ws.onclose = () => {
    if (isActive && wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      wsReconnectAttempts++;
      setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
    } else if (isActive) {
      setState('error');
      addMessage('Lost connection to backend', 'error');
      updateFooter();
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLS
// ══════════════════════════════════════════════════════════════════════════════
function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) {
    setState('muted');
  } else if (isActive) {
    setState('listening');
  }
  updateFooter();
}

// ══════════════════════════════════════════════════════════════════════════════
// BACKGROUND MESSAGE LISTENER
// ══════════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'toggle_panel') {
    if (isPanelOpen) closePanel();
    else { checkAuthStatus(); openPanel(); }
    return;
  }

  if (!isActive || !ws || ws.readyState !== WebSocket.OPEN) return;

  if (msg.type === 'morning_brief') {
    ws.send(JSON.stringify({ type: 'frame', data: '', context: 'morning_brief' }));
    addMessage('Morning brief triggered', 'system', 'morning_brief');
  }

  if (msg.type === 'intent_reader') {
    ws.send(JSON.stringify({
      type: 'frame',
      data: '',
      context: 'intent_reader',
      fromDoc: msg.fromDoc || '',
    }));
    addMessage('Detected navigation from document to Gmail', 'system', 'intent');
  }
});

// Auto-send token when user signs in
chrome.storage.onChanged.addListener((changes) => {
  try {
    if (changes.filament_oauth_token && changes.filament_oauth_token.newValue) {
      const token = changes.filament_oauth_token.newValue;
      isSignedIn = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'auth', token }));
        console.log('[Filament] Auth token updated');
      }
      updateFooter();
    }
    if (changes.filament_token_time && changes.filament_token_time.newValue) {
      tokenTimestamp = changes.filament_token_time.newValue;
    }
  } catch (e) {}
});

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════
injectUI();
