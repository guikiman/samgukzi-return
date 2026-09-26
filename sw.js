/**
 * [E43] PWA ServiceWorker — 오프라인 캐싱 전략 (배포 산물, 프로젝트 루트)
 *
 * CacheStrategy:
 *   1. 프리캐시: 앱 셸(index.html, style.css, 메인 번들) 설치 시 캐싱
 *   2. Network-First: 내비게이션 요청은 네트워크 우선 → 오프라인 시 캐시 폴백
 *   3. Network-First + Cache Fallback: 정적 리소스는 새 배포본을 우선 사용하고, 오프라인에서만 캐시 사용
 *   4. 그 외: 네트워크 우선, 실패 시 캐시 → 최종 503
 *
 * 스코프 상대 경로 사용 — GitHub Pages 서브경로(/REPO/) 배포와 루트 배포 모두 호환.
 * (구 src/sw.ts의 /dist/index.js 등 절대 경로 프리캐시는 존재하지 않는 자원이라
 *  오프라인 폴백이 동작하지 않아, 실제 번들 경로에 맞춰 본 파일로 대체)
 */

// [E43] 배포 후 이전 Tauri/WebView 자산이 남지 않도록 캐시 버전 관리
const CACHE_NAME = 'rtk8-v6';

/** 스코프 기준 상대 경로 → 절대 URL (서브경로 배포 호환) */
function scoped(path) {
    return new URL(path, self.registration.scope).href;
}

/** 프리캐시: 앱 셸 + 런타임 fetch 시나리오 데이터 */
const PRECACHE_PATHS = [
    '.',
    'index.html',
    'style.css',
    'assets/map-china-4096.webp',
    'src/data/scenarios/index.json',
];

/**
 * dist 산물 전체 프리캐시 — 번들리스 ESM 구조(main.js가 수백 개 모듈 import)라
 * 오프라인 부팅을 위해서는 dist 전체가 필요하다.
 * scripts/generate_sw_precache.mjs가 생성한 매니페스트(sw-precache.json)를 읽고,
 * 매니페스트가 없으면(구버전 배포 등) 앱 셸만이라도 캐시한다.
 */
async function precacheDistModules(cache) {
    try {
        const res = await fetch(scoped('sw-precache.json'), { cache: 'no-store' });
        if (!res.ok) return;
        const manifest = await res.json();
        const urls = (manifest.files ?? []).map((f) => scoped(f));
        // chunked addAll — 일부 실패가 전체 설치를 깨지 않도록
        const CHUNK = 50;
        for (let i = 0; i < urls.length; i += CHUNK) {
            await Promise.allSettled(urls.slice(i, i + CHUNK).map((u) => cache.add(u)));
        }
    } catch {
        // 매니페스트 부재 — 앱 셸 폴백으로 동작
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await Promise.allSettled(PRECACHE_PATHS.map((p) => cache.add(scoped(p))));
            await precacheDistModules(cache);
        }),
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
        ),
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirstWithFallback(event.request));
        return;
    }

    if (url.origin === self.location.origin) {
        const underDist = url.pathname.startsWith(
            new URL(self.registration.scope).pathname + 'dist/',
        ) || url.pathname.startsWith('/dist/');
        if (underDist || /\.(js|css|png|jpg|jpeg|svg|woff2?|json)$/.test(url.pathname)) {
            // [E43] 최신 배포 자산을 우선하되, 오프라인에서는 v6 캐시로 부트스트랩한다.
            event.respondWith(networkFirstWithCache(event.request));
            return;
        }
    }

    event.respondWith(networkFirst(event.request));
});

/** 내비게이션: 네트워크 우선, 실패 시 캐시 → 503 */
async function networkFirstWithFallback(request) {
    let response;
    try {
        response = await fetch(request);
    } catch {
        response = null; // 네트워크 자체 실패
    }
    // 503(오프라인 시뮬레이션/게이트웨이 오류)은 성공으로 취급하지 않는다 —
    // fetch()는 HTTP 오류 상태에서 throw하지 않으므로 명시적으로 ok를 검사해야 한다.
    if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
        return response;
    }
    const candidates = [
        await caches.match(request),
        await caches.match(scoped('index.html'), { ignoreSearch: true }),
        await caches.match(scoped('.'), { ignoreSearch: true }),
    ];
    for (const cached of candidates) {
        // 오염된(오프라인 시 저장된) 비-200 응답은 폴백으로 사용하지 않는다
        if (cached && cached.ok) return cached;
    }
    return new Response('오프라인 — 네트워크 연결 필요', { status: 503 });
}

/** 정적 리소스: 네트워크 우선, 오프라인이면 현재 버전 캐시 사용 */
async function networkFirstWithCache(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
            return response;
        }
        const cached = await caches.match(request);
        if (cached && cached.status === 200) return cached;
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached && cached.status === 200) return cached;
        return new Response('리소스를 찾을 수 없습니다', { status: 404 });
    }
}

/** 기타: 네트워크 우선 → 캐시 → 503 */
async function networkFirst(request) {
    try {
        return await fetch(request);
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('네트워크 오프라인', { status: 503 });
    }
}
