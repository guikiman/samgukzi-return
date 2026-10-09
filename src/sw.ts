/**
 * [E43] PWA ServiceWorker — 오프라인 캐싱 전략
 *
 * CacheStrategy:
 *   1. 프리캐시: 웹 앱 셸(HTML, JS, CSS) 설치 시 캐싱
 *   2. Network-First: API/데이터 요청은 네트워크 우선
 *   3. Cache-First: 정적 리소스는 캐시 우선
 *   4. 오프라인 폴백: 네트워크 불가 시 캐시에서 제공
 */

const CACHE_NAME = 'samgukzi-return-v1';
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/dist/index.js',
];

self.addEventListener('install', (event: ExtendableEvent) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_URLS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url);

    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirstWithFallback(event.request));
        return;
    }

    if (url.origin === self.location.origin) {
        if (url.pathname.startsWith('/dist/') || url.pathname.match(/\.(js|css|png|jpg|svg|woff2?)$/)) {
            event.respondWith(cacheFirst(event.request));
            return;
        }
    }

    event.respondWith(networkFirst(event.request));
});

async function networkFirstWithFallback(request: Request): Promise<Response> {
    try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('오프라인 — 네트워크 연결 필요', { status: 503 });
    }
}

async function cacheFirst(request: Request): Promise<Response> {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
        return response;
    } catch {
        return new Response('리소스를 찾을 수 없습니다', { status: 404 });
    }
}

async function networkFirst(request: Request): Promise<Response> {
    try {
        const response = await fetch(request);
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('네트워크 오프라인', { status: 503 });
    }
}
