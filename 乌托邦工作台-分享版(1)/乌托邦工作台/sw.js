/* 乌托邦工作台 Service Worker：缓存外壳，支持离线打开与「添加到主屏幕」 */
var CACHE = 'utopia-v6';
var SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 数据请求（云服务）绝不缓存；其余缓存优先、后台更新 */
self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.indexOf('/.cloud/') >= 0 || url.indexOf('workbuddy.host') >= 0) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(e.request).then(function (hit) {
        var fetching = fetch(e.request).then(function (res) {
          if (res && res.status === 200 && (url.indexOf('http') === 0)) {
            try { cache.put(e.request, res.clone()); } catch (err) {}
          }
          return res;
        }).catch(function () { return hit || Response.error(); });
        return hit || fetching;
      });
    })
  );
});
