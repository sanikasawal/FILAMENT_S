# Filament UI Redesign — Design Spec

**Date:** 2026-03-16
**Author:** Vishal + Claude
**Preview:** `extension/logo-filament-preview.html`

---

## Design Identity

**Philosophy:** Invisible until valuable. A ghost that comes alive only when it has something worth saying.

**Aesthetic:** Dark frosted glass, Granola-style minimalism, Google iridescent gradients, one continuous surface.

**Logo:** 3-wave continuous sine path (no text, no mascot). Single `<path>` element with iridescent gradient + glow filter.
- Horizontal: `extension/logo-filament.svg` (panel header)
- Vertical: `extension/logo-filament-vertical.svg` (edge tab)

**Font:** Plus Jakarta Sans (Google Fonts) — weights 300/400/500/600

---

## Color System

```css
/* Surfaces */
--bg-surface: rgba(14, 14, 16, 0.92);   /* frosted glass panel */
--bg-solid: #0A0A0C;                     /* fallback */

/* Borders — always faded, never hard */
--border: rgba(255, 255, 255, 0.04);
--border-hover: rgba(255, 255, 255, 0.08);

/* Text */
--text-primary: rgba(255, 255, 255, 0.65);
--text-secondary: rgba(255, 255, 255, 0.35);
--text-muted: rgba(255, 255, 255, 0.18);

/* Google Iridescent Gradient (8-stop smooth blend) */
--gradient: linear-gradient(90deg,
  #4285F4, #3BA0E8, #00BFA5, #34A853,
  #8BC34A, #FFB74D, #FF8A65, #FF6F61
);

/* State Colors */
--listening: rgba(0, 191, 165, 0.7);     /* teal */
--speaking: rgba(139, 195, 74, 0.7);     /* lime-green */
--connecting: rgba(255, 183, 77, 0.7);   /* amber */
--error: rgba(255, 111, 97, 0.7);        /* coral */
--muted: rgba(255, 183, 77, 0.5);        /* dim amber */
```

---

## Architecture

**Old:** FAB orb (bottom-right) + separate popup for settings
**New:** Edge tab (right edge) + side panel (slides in) + inline settings

```
┌────────────────────────── Browser Window ──────────────────────────┐
│                                                                     │
│                         [webpage content]                           │
│                                                                     │
│                                                              ┌────┐ │
│                                                              │edge│ │
│                                                              │tab │ │
│                                                              │    │ │
│                                                              └────┘ │
└─────────────────────────────────────────────────────────────────────┘

When clicked:

┌────────────────────────── Browser Window ──────────────────────────┐
│                                                                     │
│                         [webpage content]               ┌────┬────┐ │
│                                                         │edge│    │ │
│                                                         │tab │panel│ │
│                                                         │    │    │ │
│                                                         └────┴────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Edge Tab

- **Width:** 36px
- **Position:** Fixed, right edge, vertically centered
- **Background:** Transparent (shares panel surface)
- **Content:** Vertical 3-wave logo mark
- **Separator:** Faded gradient line (not hard border), only middle 60%

#### States

| State | Tab Opacity | Wave Opacity | Glow | Animation |
|-------|-------------|-------------|------|-----------|
| Ghost/Idle | 12% | 50% | None | Static |
| Hover | 35% | 70% | None | Static |
| Connecting | 100% | 40% | Amber radial | Wave fades in/out |
| Listening | 100% | 70% | Blue-teal radial | Gentle pulse 3s |
| Speaking | 100% | 90% | Full iridescent radial | Wave scaleY breathes 1.5s |
| Muted | 100% | 20% | None | Grayscale filter |
| Error | 100% | 50% | Red radial | Fast pulse 1.5s |

#### Speaking State — Audio Visualization
- **Gradient Pulse:** Entire tab background shifts through iridescent gradient, pulsing with audio intensity
- **Waveform:** The 3-wave logo elongates/compresses vertically (`scaleY`) in response to audio bass levels
- Both effects combined: the tab IS the visualizer

### 2. Side Panel

- **Width:** 360px
- **Position:** Slides in from right edge, attached to tab
- **Background:** `rgba(14, 14, 16, 0.92)` with `backdrop-filter: blur(24px)`
- **Border:** Single outer border `rgba(255,255,255,0.04)`, 18px radius
- **Shadow:** `0 16px 60px rgba(0,0,0,0.5)`
- **Surface:** One continuous frosted glass — tab + panel share the same background

### 3. Living Header

- **Content:** Wave logo (48px) + "Filament" text + status indicator + close button
- **Divider:** Faded gradient line (not hard border), tapers to transparent on sides
- **Gradient glow:** State-dependent color that fades downward into timeline
  - Listening: blue-teal top fade
  - Speaking: full iridescent sweep
  - Searching: blue sweep animation (translateX)
  - Error: red top fade

### 4. Timeline

- **Layout:** Vertical line on left, dot markers, content branching right
- **Vertical line:** `rgba(255,255,255,0.03)`, caps at first/last item
- **Scrollbar:** Hidden

#### Timeline Dots

| Dot State | Style | Animation |
|-----------|-------|-----------|
| New/Unread | Iridescent gradient fill + glow shadow | Pulsing glow 2.5s |
| Read | `rgba(255,255,255,0.08)` solid | Static |
| Faded/Old | `rgba(255,255,255,0.04)` solid | Static |
| Error | `rgba(255,111,97,0.5)` + red glow | Static |
| Searching | Blue tinted text | Blinking dot |

#### Message Styling

```
tl-time:  9px, rgba(255,255,255,0.18), weight 500
tl-text:  12px, rgba(255,255,255,0.6), line-height 1.55
tl-dim:   10.5px, rgba(255,255,255,0.22)
```

### 5. Empty State

- Centered in timeline area
- Faded wave logo (48px, 40% opacity)
- "Watching quietly" — 12px, rgba(255,255,255,0.25)
- "Filament will speak when it has something worth saying" — 10.5px, rgba(255,255,255,0.14)

### 6. Footer

- **Content:** Google avatar (20px circle) + connection dot + status label + action buttons + gear icon
- **Divider:** Same faded gradient line as header
- **Buttons:** Pill-shaped, ghost style (transparent bg, subtle border)

#### Footer Connection States

| State | Dot Color | Label | Actions |
|-------|-----------|-------|---------|
| Connected | Teal glow | "Connected" | Mute, Stop |
| Muted | Amber glow | "Muted" | Unmute, Stop |
| Disconnected | Red glow | "Disconnected" | Reconnect |
| Ready (idle) | Gray | "Ready" | Start |

### 7. Settings Drawer

- Opens inline above footer (pushes timeline up)
- Triggered by gear icon
- Shows: Server URL (monospace), Google account email
- Same faded gradient divider on top

---

## Animations

| Animation | Duration | Easing | Used For |
|-----------|----------|--------|----------|
| `gradientPulse` | 2-3s | ease-in-out | Tab/header glow breathing |
| `blink` | 1.8s | ease-in-out | Status dots (listening/connecting) |
| `dotPulse` | 2.5s | ease-in-out | New timeline dot glow |
| `waveBreath` | 1.5s | ease-in-out | Wave scaleY on speaking |
| `fadeInOut` | 2s | ease-in-out | Connecting wave opacity |
| `searchSweep` | 2s | ease-in-out | Header glow during Gmail/Drive search |
| Panel slide | 0.3s | cubic-bezier(0.2, 0, 0, 1) | Panel open/close |
| Ghost→visible | 0.6s | cubic-bezier(0.2, 0, 0, 1) | Tab hover transition |

**Reduced motion:** All animations should be disabled when `prefers-reduced-motion: reduce` is active.

---

## Onboarding & Settings Flow

### First-Run Takeover

When the user has not signed in, the entire panel body becomes a sign-in screen. No timeline, no footer actions — just onboarding.

#### Screen: "First Run — Sign In"
- Faded wave logo (56px, 25% opacity)
- "Welcome to Filament" — 16px, weight 600
- "Sign in to let Filament surface insights from your Gmail and Google Drive" — 11px muted
- **"Sign in with Google" button** — pill shape, white Google "G" icon, ghost border style
- Faded gradient divider
- **Backend Server** field — monospace input, pre-filled with production URL
- Test + Save buttons

#### Screen: "Signed In — Ready"
- Same layout but sign-in button replaced with signed-in row:
  - Avatar circle (gradient), name, email, checkmark
- Backend URL with green "Connected" test result
- Footer appears with "Start" button

#### Screen: "Settings via Gear" (reopens from active session)
- Header shows "Settings" instead of "Filament"
- Signed-in row at top
- Backend URL with test/save
- Version info
- "Sign out" link (red, subtle)
- Footer still shows Mute/Stop (session continues in background)

#### Screen: "Connection Failed"
- Error state glow
- "Can't connect" title in coral
- "Check that the backend is running" subtitle
- Backend URL input highlighted with red border
- "Connection failed — is the backend running?" error message
- Edit + Retry buttons

### Flow Logic

```
First open → not signed in?
  → Show "First Run — Sign In" takeover
  → User clicks "Sign in with Google" → OAuth flow
  → On success → transition to "Signed In — Ready"
  → User clicks "Start" → activate session → show timeline

Already signed in?
  → Show empty state or timeline
  → Gear icon → swap panel body to settings view
  → Close settings → return to timeline
```

### What Moves from Popup to Panel

| Feature | Old (popup.html) | New (content.js panel) |
|---------|-----------------|----------------------|
| Google Sign In | popup.js OAuth button | Panel onboarding takeover |
| Sign Out | popup.js button | Settings view sign-out link |
| WebSocket URL | popup.html input | Panel settings field |
| Test Connection | popup.js WebSocket test | Panel inline test with result |
| Save Settings | popup.js chrome.storage | Panel inline save |
| Auth Status | popup.html badge | Footer avatar + dot |

**popup.html / popup.js become optional** — can be removed or kept as a minimal "Open Filament" trigger.

---

## Files to Modify

| File | Changes |
|------|---------|
| `extension/orb.css` | **Full rewrite** — new dark theme, edge tab, panel, timeline, all states |
| `extension/content.js` | **Major rewrite** — replace orb with edge tab, replace panel layout, add timeline, inline settings, audio visualizer |
| `extension/popup.html` | **Delete or minimal** — settings move into panel footer |
| `extension/popup.js` | **Delete or minimal** — settings logic moves to content.js |
| `extension/manifest.json` | Remove popup if fully deprecated, keep OAuth config |
| `extension/logo-filament.svg` | **Done** — 3-wave iridescent horizontal |
| `extension/logo-filament-vertical.svg` | **Done** — 3-wave iridescent vertical |

---

## Toasts (Panel Closed Notifications)

When the panel is closed and Filament has something to say:

1. **Edge tab badge** — gradient pill badge appears at top of tab showing unread count (1, 2, 3... 9+)
   - Badge uses the iridescent gradient background
   - 16px height, 8px font, white text, glow shadow
   - Clears when panel is opened
2. **Toast slides out** from the edge tab — dark frosted glass card
   - Max 2 stacked toasts (latest on top, older one scaled to 0.97 at 70% opacity)
   - Width: 300px, positioned left of the edge tab
   - Contains: wave logo icon, "Filament" title, message text (2 line clamp)
   - Gradient progress bar at bottom (auto-dismiss in 7s)
   - Close button (×) on top-right
   - Slides in with spring animation, slides out left on dismiss
3. **Tab glow intensifies** — the tab's gradient pulse becomes brighter when new insights arrive

---

## Unread Badge

- **Position:** Top of edge tab, horizontally centered
- **Style:** Iridescent gradient fill, white text, 8px font, 700 weight
- **Size:** 16px height, min-width 16px, pill-shaped border-radius
- **Shadow:** `0 0 8px rgba(66,133,244,0.3), 0 2px 4px rgba(0,0,0,0.3)`
- **Behavior:** Appears with spring animation when count > 0, clears on panel open
- **Max display:** "9+" for 10 or more unread

---

## Permission Explainer

Shown after "Start" is clicked, before browser permission dialogs appear.

### Screen: "Permissions Needed"
- Wave logo (48px, faded)
- "Permissions needed" — 16px, weight 600
- "Filament needs access to your screen and microphone" — 11px muted
- **Permission cards** (2 items):
  - Screen capture — blue icon, "See what you're working on to give relevant insights"
  - Microphone — teal icon, "Hear your voice so Filament can speak back to you"
- "Continue" button (same pill style as sign-in)
- Privacy note: "Your screen and audio are never stored — only analyzed in real-time" (8px, very muted)

### Screen: "Requesting Access"
- Connecting state glow
- Mic icon centered, amber tinted
- "Waiting for permission..." + "Allow screen sharing in the browser dialog above"
- Cancel button in footer

### Screen: "Permission Denied"
- Error state glow
- "Permission denied" title in coral
- "Please try again" subtitle
- "Try Again" button
- Footer shows "No access" with red dot

### Flow
```
User clicks Start
  → Show "Permissions Needed" explainer
  → User clicks Continue
  → Call getDisplayMedia() → browser dialog
  → If allowed → call getUserMedia() → connect WebSocket → listening
  → If denied → show "Permission Denied" screen
```

---

## Timeline Source Tags

Messages from special sources get colored tag pills above the text:

| Tag | Color | Used For |
|-----|-------|----------|
| `Morning Brief` | Amber bg, amber text | Morning brief auto-trigger |
| `Intent` | Blue bg, blue text | Doc→Gmail navigation detection |
| `Gmail` | Coral bg, coral text | Gmail search results |
| `Drive` | Teal bg, teal text | Drive search results |

- Tags are 8px uppercase, 600 weight, pill-shaped (4px radius)
- Regular insights have no tag — just timestamp + text
- System messages (session started, connected) remain dim with no tag

### Timeline Dot Colors by Type

| Type | Dot Style |
|------|-----------|
| Morning Brief | Amber gradient (`#FFB74D → #FF8A65`) |
| Intent Reader | Blue gradient (`#4285F4 → #3BA0E8`) |
| Gmail/Drive result | Standard iridescent (new) |
| Regular insight | Standard iridescent (new) |
| Read | White 8% opacity |
| System/old | White 4% opacity |

---

## Token Expiry Handling

### In Settings View
- Below the signed-in row, show a **token status row**:
  - Green pill: "Token valid" + "Refreshed 12m ago"
  - Red pill: "Token expired" + "Expired 23m ago"
- When expired:
  - Signed-in row border turns red
  - Checkmark replaced with "!" warning
  - "Re-authenticate" button appears (same style as Google sign-in)
  - Status in header shows "Token expired"
  - Footer dot turns red

### Auto-detection
- On WebSocket open, check token age (stored timestamp in `chrome.storage`)
- If token is older than 55 minutes, show warning in timeline
- If workspace tool call fails with 401, auto-show "Token expired" in timeline and settings

---

## Panel Positioning & Sizing

```
Position:  fixed, right: 0, vertically centered
Tab:       36px wide, max-height: 70vh, min-height: 200px
Panel:     360px wide, same height as tab
Combined:  396px total width from right edge
Z-index:   2147483640 (same as current — above everything)
```

### Rules
- **No page push** — panel overlays on top of page content
- **Over scrollbar** — tab and panel sit on top of the browser scrollbar
- **Vertically centered** — `top: 50%; transform: translateY(-50%)`
- **Tab rounds only left side** — `border-radius: 18px 0 0 18px` (flush with right edge)
- **Panel rounds only left side** — same radius, flush with tab

---

## Panel Toggle Behavior

| Action | Panel Closed | Panel Open |
|--------|-------------|------------|
| **Click edge tab** | Opens panel, clears badge | Closes panel |
| **Click outside** | — | Closes panel |
| **Keyboard `Cmd+Shift+F`** | Opens panel | Closes panel |
| **Close button (×)** | — | Closes panel |
| **Gear icon** | — | Swaps to settings view |
| **Gear icon (in settings)** | — | Returns to timeline |

---

## Keyboard Shortcut

- **`Cmd+Shift+F`** (Mac) / **`Ctrl+Shift+F`** (Windows) — toggle panel open/close
- Shown in settings footer as a hint: `⌘ ⇧ F toggle panel`
- Registered via `chrome.commands` in manifest.json

---

## OAuth Technical Note

Content scripts cannot call `chrome.identity.launchWebAuthFlow` directly. The sign-in flow:

```
Panel "Sign in" button clicked (content.js)
  → chrome.runtime.sendMessage({ type: 'start_oauth' })
  → background.js receives, calls launchWebAuthFlow()
  → On success, stores token in chrome.storage.local
  → chrome.storage.onChanged fires in content.js
  → Panel UI updates to "Signed in" state
```

This is the same pattern the current popup uses, just triggered from the panel instead.

---

## Design Rules

1. **No hard borders** — always use faded gradient lines that taper to transparent
2. **No emojis** — SVG icons only (stroke style, 1.5px weight)
3. **One surface** — tab and panel share the same frosted glass background
4. **Ghost by default** — the tab is nearly invisible until needed
5. **Color = state** — the gradient glow communicates what Filament is doing
6. **Whitespace** — generous padding, let content breathe
7. **Respect reduced motion** — `prefers-reduced-motion` disables all animations
8. **One panel, many views** — timeline, settings, onboarding, permission all swap in the same panel body
9. **No separate popup** — everything lives in the content script panel
10. **Privacy forward** — always tell users what data is accessed and that nothing is stored
