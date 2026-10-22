/* Gridiron service worker.
   Bump APP_VERSION on every deploy of index.html, or the old shell keeps being
   served from cache. The nflverse CSV and The Odds API are never handled here:
   the page caches both itself, with its own freshness rules and refresh buttons. */
const APP_VERSION='2.4.0';
const CACHE='gridiron-'+APP_VERSION;
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(SHELL.map(u=>c.add(u)))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;   // nflverse, The Odds API: the page handles those
  e.respondWith(caches.match(req).then(hit=>{
    const net=fetch(req).then(res=>{ if(res&&res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(req,c));} return res; }).catch(()=>hit);
    return hit||net;
  }));
});
