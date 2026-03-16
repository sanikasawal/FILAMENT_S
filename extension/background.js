'use strict';

// ── Morning Brief trigger ─────────────────────────────────────────────────────
// Fires when a new tab is created before 11am
chrome.tabs.onCreated.addListener(async (tab) => {
  const now = new Date();
  if (now.getHours() < 11) {
    // Wait for tab to load then send morning brief trigger
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.sendMessage(tab.id, { type: 'morning_brief' }).catch(() => {});
      }
    });
  }
});

// ── Intent Reader: detect navigation from Docs/Sheets to Gmail ───────────────
let lastDocUrl = null;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const url = tab.url;

  // Track if user was on a Google Workspace file
  if (url.match(/docs\.google\.com\/(spreadsheets|document)/)) {
    lastDocUrl = url;
  }

  // If they navigate to Gmail after being on a doc, trigger Intent Reader
  if (url.includes('mail.google.com') && lastDocUrl) {
    chrome.tabs.sendMessage(tabId, {
      type: 'intent_reader',
      fromDoc: lastDocUrl,
    }).catch(() => {});
    lastDocUrl = null;
  }
});

// ── OAuth token helper ────────────────────────────────────────────────────────
const OAUTH_CLIENT_ID = '76839905027-9mruei1o58bfots328vsp8a8k5l1suik.apps.googleusercontent.com';
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly';

function getTokenViaWebAuthFlow(interactive) {
  return new Promise((resolve) => {
    const redirectUrl = chrome.identity.getRedirectURL();
    console.log('[Filament] Redirect URL:', redirectUrl);
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&scope=${encodeURIComponent(OAUTH_SCOPES)}`;

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        console.warn('[Filament] Web auth flow error:', chrome.runtime.lastError?.message);
        resolve(null);
        return;
      }
      // Extract access_token from the URL fragment
      const fragment = responseUrl.split('#')[1];
      if (!fragment) { resolve(null); return; }
      const params = new URLSearchParams(fragment);
      const token = params.get('access_token');
      console.log('[Filament] Got token via web auth flow:', token ? 'yes' : 'no');
      if (token) {
        chrome.storage.local.set({ filament_oauth_token: token });
      }
      resolve(token);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'store_token') {
    chrome.storage.local.set({ filament_oauth_token: msg.token }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (msg.type === 'get_token') {
    (async () => {
      // Try cached token first (but skip empty/falsy values)
      const stored = await new Promise(r =>
        chrome.storage.local.get(['filament_oauth_token'], res => r(res.filament_oauth_token))
      );
      if (stored && typeof stored === 'string' && stored.length > 10) {
        console.log('[Filament] Using cached token');
        sendResponse({ token: stored });
        return;
      }

      // Skip getAuthToken — it doesn't work for unpacked extensions.
      // Go straight to launchWebAuthFlow which works with Web Application OAuth clients.
      console.log('[Filament] Launching OAuth sign-in via launchWebAuthFlow...');
      console.log('[Filament] Redirect URL will be:', chrome.identity.getRedirectURL());
      const webToken = await getTokenViaWebAuthFlow(true);
      if (webToken) {
        console.log('[Filament] Got OAuth token successfully');
      } else {
        console.error('[Filament] OAuth failed — no token received. Check Google Cloud Console redirect URI matches:', chrome.identity.getRedirectURL());
      }
      sendResponse({ token: webToken });
    })();
    return true; // async
  }
  if (msg.type === 'clear_token') {
    chrome.storage.local.remove(['filament_oauth_token'], () => {
      console.log('[Filament] Cached token cleared');
      sendResponse({ success: true });
    });
    return true;
  }
});
