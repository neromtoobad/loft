// Loft's service worker. It makes Loft installable as an app, and when the
// phone is offline it shows a plain page instead of the browser's error.
// Nothing is cached: balances and payments must always be live.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loft</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f1ea;color:#16120e;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
h1{font:400 34px Georgia,serif;margin:0 0 8px}p{color:rgba(22,18,14,.6);margin:0 0 20px}button{font:inherit;border:0;border-radius:999px;padding:12px 22px;background:#16120e;color:#fff}</style></head>
<body><div><h1>You're offline</h1><p>Loft needs a connection to show your dollars.</p><button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Only page loads; API calls, assets and everything else go straight to the network.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE, { headers: { "content-type": "text/html; charset=utf-8" } })),
  );
});
