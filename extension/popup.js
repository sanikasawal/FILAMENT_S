'use strict';

const wsUrlInput = document.getElementById('ws-url');
const saveBtn = document.getElementById('save-btn');
const testBtn = document.getElementById('test-btn');
const connResult = document.getElementById('conn-result');
const connText = connResult.querySelector('.conn-text');
const statusToast = document.getElementById('status-toast');
const signinBtn = document.getElementById('signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const authStatus = document.getElementById('auth-status');
const authStatusText = document.getElementById('auth-status-text');

// ── Load saved settings ──────────────────────────────────────────────────────
chrome.storage.local.get(['filament_ws_url', 'filament_oauth_token'], (result) => {
  wsUrlInput.value = result.filament_ws_url || 'wss://filament-orchestrator-sjs5thynia-uc.a.run.app/ws';
  updateAuthUI(result.filament_oauth_token);
});

// ── OAuth Config ─────────────────────────────────────────────────────────────
const OAUTH_CLIENT_ID = '76839905027-9mruei1o58bfots328vsp8a8k5l1suik.apps.googleusercontent.com';
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly';

// ── Google Sign In (runs directly in popup — real user gesture context) ──────
signinBtn.addEventListener('click', () => {
  signinBtn.disabled = true;
  signinBtn.textContent = 'Signing in...';

  // Clear stale token
  chrome.storage.local.remove(['filament_oauth_token'], () => {
    const redirectUrl = chrome.identity.getRedirectURL();
    console.log('[Filament Popup] Redirect URL:', redirectUrl);

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&scope=${encodeURIComponent(OAUTH_SCOPES)}` +
      `&prompt=consent`;

    // Call launchWebAuthFlow directly from popup (not via background.js)
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      signinBtn.disabled = false;
      signinBtn.textContent = 'Sign in with Google';

      if (chrome.runtime.lastError) {
        console.error('[Filament Popup] OAuth error:', chrome.runtime.lastError.message);
        showStatusToast('Error: ' + chrome.runtime.lastError.message);
        updateAuthUI(null);
        return;
      }

      if (!responseUrl) {
        console.error('[Filament Popup] No response URL from OAuth');
        showStatusToast('Sign-in cancelled or failed');
        updateAuthUI(null);
        return;
      }

      // Extract access_token from URL fragment
      const fragment = responseUrl.split('#')[1];
      if (!fragment) {
        console.error('[Filament Popup] No fragment in response URL');
        showStatusToast('Sign-in failed — no token in response');
        updateAuthUI(null);
        return;
      }

      const params = new URLSearchParams(fragment);
      const token = params.get('access_token');
      console.log('[Filament Popup] Got token:', token ? 'yes' : 'no');

      if (token) {
        chrome.storage.local.set({ filament_oauth_token: token }, () => {
          updateAuthUI(token);
          showStatusToast('Signed in — Filament can now access your email');
        });
      } else {
        showStatusToast('Sign-in failed — no access_token');
        updateAuthUI(null);
      }
    });
  });
});

signoutBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clear_token' }, () => {
    updateAuthUI(null);
    showStatusToast('Signed out');
  });
});

function updateAuthUI(token) {
  if (token && typeof token === 'string' && token.length > 10) {
    authStatus.className = 'auth-status connected';
    authStatusText.textContent = 'Signed in to Google';
    signinBtn.style.display = 'none';
    signoutBtn.style.display = '';
  } else {
    authStatus.className = 'auth-status disconnected';
    authStatusText.textContent = 'Not signed in';
    signinBtn.style.display = '';
    signoutBtn.style.display = 'none';
  }
}

// ── Save ─────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const url = wsUrlInput.value.trim();
  if (!url) return;
  chrome.storage.local.set({ filament_ws_url: url }, () => {
    showStatusToast('Settings saved — reload the page to apply');
  });
});

// ── Test Connection ──────────────────────────────────────────────────────────
testBtn.addEventListener('click', () => {
  const url = wsUrlInput.value.trim();
  if (!url) return;

  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  showConnResult('Connecting...', 'testing');

  const testWs = new WebSocket(url);
  const timeout = setTimeout(() => {
    testWs.close();
    showConnResult('Timeout — backend not reachable', 'error');
    resetTestBtn();
  }, 5000);

  testWs.onopen = () => {
    clearTimeout(timeout);
    testWs.close();
    showConnResult('Connected successfully', 'success');
    resetTestBtn();
  };

  testWs.onerror = () => {
    clearTimeout(timeout);
    showConnResult('Connection failed — is the backend running?', 'error');
    resetTestBtn();
  };
});

function resetTestBtn() {
  testBtn.disabled = false;
  testBtn.textContent = 'Test';
}

// ── Connection Result ────────────────────────────────────────────────────────
function showConnResult(text, type) {
  connText.textContent = text;
  connResult.className = `conn-result visible ${type}`;
}

// ── Status Toast ─────────────────────────────────────────────────────────────
let toastTimer = null;
function showStatusToast(text) {
  statusToast.textContent = text;
  statusToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => statusToast.classList.remove('show'), 3000);
}
