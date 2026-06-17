# PWA Strategy

> This document covers the Progressive Web App architecture for Intimidation-Tactics: offline capability, install behaviour, update flow, and storage management.

---

## Goals

| Goal | Rationale |
|------|-----------|
| **Full offline play** after first load | Core feature — no internet required to build/view decks once cards are imported |
| **Installable** on desktop and mobile | App-like experience without an app store |
| **Zero stale-JS on update** | Vite hashes JS chunks; an old cached shell loading new hashed chunks produces a blank page — must be prevented |
| **Network-first for Scryfall** | Card images and API calls must always reflect live data when online |

---

## Architecture

```
Browser
  └─ index.html  (app shell)
       └─ /sw.js  (Service Worker — cache: mtg-builder-v2)
            ├─ Navigation requests  → Network-first, fallback to cache
            ├─ scryfall.com requests → Network-first, fallback to cache
            └─ Static assets        → Cache-first, fill from network
```

---

## Service Worker (`public/sw.js`)

Cache name: **`mtg-builder-v2`**  
Pre-cached on install: `/` and `/manifest.webmanifest`

### Lifecycle

#### Install
```js
const CACHE_NAME = "mtg-builder-v2";
const PRECACHE   = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();   // activate immediately — don't wait for old clients to close
});
```

`skipWaiting()` ensures a freshly downloaded SW activates as soon as it installs rather than waiting for all existing tabs to close.

#### Activate
```js
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
```

On activate, all caches **not** named `mtg-builder-v2` are deleted. `clients.claim()` takes control of all tabs immediately so the new SW starts handling fetches right away.

**Version bumping:** To force a cache purge on users, increment `CACHE_NAME` from `mtg-builder-v2` to `mtg-builder-v3`. Old cache is deleted on next activate.

#### Fetch — Three-Tier Strategy

| Request type | Strategy | Rationale |
|-------------|----------|-----------|
| `mode === "navigate"` | Network-first → cache fallback | Prevents stale Vite shell with broken hashed JS filenames |
| `hostname.includes("scryfall.com")` | Network-first → cache fallback | Always show live card data / images when online |
| Everything else (static assets) | Cache-first → network fill | Fast loads for hashed JS/CSS chunks |

The navigate strategy is critical: Vite production builds hash all JS filenames (e.g. `index-abc123.js`). If the old `index.html` (from cache) references `index-abc123.js` but the new SW only has `index-def456.js`, the page is blank. By always fetching `index.html` from the network first, we guarantee the shell always references the correct chunk hashes.

---

## Registration (`src/pwa.ts`)

```ts
export function registerServiceWorker(onUpdate?: () => void): void {
  // Dev mode: unregister all SWs and clear all caches to avoid stale state
  if (import.meta.env.MODE !== "production") {
    void navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    return;
  }

  // Production: register and listen for updates
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            onUpdate?.();   // triggers "Update available" toast in UI
          }
        });
      });
    });
  });
}
```

**Key behaviours:**
- In **development**, all SWs and caches are wiped on page load. This eliminates a common pain point where dev builds serve stale production caches.
- In **production**, when a new SW version is downloaded and installed, `onUpdate()` is called. The app uses this to show an "Update available — reload?" toast (or equivalent UI) to the user.

---

## Web App Manifest (`public/manifest.webmanifest`)

The manifest enables "Add to Home Screen" / install prompts. Key fields:

- `display: "standalone"` — hides browser chrome when launched from home screen
- `start_url: "/"` — always opens the app shell, not a deep link
- `theme_color` / `background_color` — match the Tailwind dark palette
- Icons at 192px and 512px for Android/iOS splash screens

---

## Offline Data Flow

```
First load (online)                 Subsequent loads (offline OK)
──────────────────                  ──────────────────────────────
1. App shell loads                  1. SW serves cached /index.html
2. User imports Scryfall bulk JSON  2. IndexedDB has all 30k+ cards
3. cards stored in Dexie/IndexedDB  3. Deck builder fully functional
4. SW caches static assets          4. Scryfall images served from SW cache
```

Card data is **never** stored in the SW cache — it lives in IndexedDB (Dexie) because:
- IndexedDB supports transactions, structured queries, and 500 MB+ storage
- SW cache is limited to HTTP responses and unsuitable for large structured datasets
- SW cache has a much smaller typical quota budget

---

## Storage Quota Management

Browsers grant varying IndexedDB quotas (typically the lesser of 1 GB or 20% of free disk). The app should:

1. **Check quota before import** using `navigator.storage.estimate()`
2. **Warn at 80% usage** with a dismissible banner
3. **Block import at 95% usage** and prompt the user to free space

```ts
// Recommended pre-import guard
const { usage, quota } = await navigator.storage.estimate();
const usagePct = (usage ?? 0) / (quota ?? Infinity);
if (usagePct > 0.95) throw new Error("Storage full — cannot import");
if (usagePct > 0.80) console.warn("Storage > 80% full");
```

---

## Update UX Recommendations

When `onUpdate()` fires (new SW installed):

1. Show a non-intrusive toast: **"A new version is available."** with a **[Reload]** button
2. On click: `window.location.reload()` — the new SW is already waiting in `installed` state and `skipWaiting()` ensures it activates immediately
3. Do **not** auto-reload without user consent — interrupting an active deck-building session would be a bad experience

---

## Testing Checklist

- [ ] Lighthouse PWA audit score ≥ 90
- [ ] App installs successfully on Chrome (desktop) and Safari (iOS)
- [ ] Offline mode: import cards → disconnect → reload → deck builder still works
- [ ] Update flow: deploy new build → existing installed app shows update toast
- [ ] Dev mode: no SW active in `http://localhost:5173`
- [ ] Cache-busting: bump `CACHE_NAME` → old caches deleted on next activate
