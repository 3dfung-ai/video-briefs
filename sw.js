/* Video Briefs offline cache: the app opens with no internet; briefs live in the page's own storage. */
const CACHE = 'videobriefs-750a84';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('videobriefs-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const rel = u.pathname.startsWith(scope) ? u.pathname.slice(scope.length) : null;
  if (rel === null || !(rel === '' || rel === 'index.html' || SHELL.includes('./' + rel))) return;   // only the app's own files
  if (r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('.html')) {
    // newest page when online, cached page when offline or on a stalled network
    e.respondWith(withTimeout(fetch(r), 4000)
      .then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', cp)); } return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));
});
