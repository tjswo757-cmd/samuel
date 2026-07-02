/* ============================================================================
   사무엘학교 PWA Service Worker
   목적: 설치형 PWA가 네트워크 없이도 실행되도록(오프라인) 보장.
   설계 원칙(자주 수정되는 단일 index.html 특성 반영):
     - 문서(HTML 내비게이션): network-first → 온라인이면 항상 최신, 오프라인이면 캐시로 폴백
       → "옛 버전에 갇히는" 흔한 SW 함정 회피
     - 버전 고정된 외부 CDN(Pretendard 폰트·Firebase 모듈): stale-while-revalidate (빠르고 안전)
     - 같은 출처 정적 자원(아이콘·과정 이미지·manifest): cache-first(요청 시 런타임 캐시)
     - Firebase 실시간/인증 트래픽(firebaseio·googleapis 등): 절대 캐시 안 함(항상 네트워크)
   업데이트: 버전 올리면 install에서 즉시 활성화(skipWaiting) + 옛 캐시 정리(activate)
   ============================================================================ */

const CACHE_VERSION = 'samuel-v4-2026-07-02';
const CORE_CACHE = `${CACHE_VERSION}-core`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// 설치 시 미리 받아두는 최소 핵심(앱 껍데기). 무거운 과정 이미지는 '요청 시'에만 캐시.
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// 캐시하면 안 되는(항상 네트워크여야 하는) 실시간/인증 도메인
const NEVER_CACHE = [
  'firebaseio.com',         // Realtime Database (presence/동기화)
  'firebasedatabase.app',
  'identitytoolkit',        // 인증
  'securetoken',
  'googleapis.com',         // 토큰/인증 API
  'google-analytics',
  'analytics.google.com',
];

self.addEventListener('install', (event) => {
  // 첫 설치면 자동으로 곧장 활성화됨(오프라인 즉시 가능).
  // 업데이트면 일부러 skipWaiting 하지 않음 → 옛 버전이 닫힐 때(다음 실행) 자연스럽게 교체
  //  → 암송/필기 도중 갑작스런 새로고침으로 방해받지 않게 함
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CORE_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))   // 옛 버전 캐시 정리
      ))
      .then(() => self.clients.claim())     // 열려있는 탭 즉시 제어
  );
});

function isNeverCache(url) {
  return NEVER_CACHE.some((d) => url.includes(d));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET만 처리. 그 외(POST 등)와 실시간/인증 트래픽은 그대로 네트워크로.
  if (req.method !== 'GET' || isNeverCache(req.url)) return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) 문서(HTML 내비게이션): network-first → 오프라인이면 캐시된 index.html
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CORE_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 2) 외부 CDN(폰트·Firebase 모듈): stale-while-revalidate
  //    URL에 버전이 박혀 있어(pretendard@v1.3.9, firebasejs/10.12.5) 캐시가 안전.
  if (!sameOrigin) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;   // 캐시 있으면 즉시 반환 + 백그라운드 갱신
        })
      )
    );
    return;
  }

  // 2.5) 같은 출처 앱 코드(styles.css·app.js·firebase.js 등): network-first
  //      → index.html처럼 온라인이면 항상 최신 코드, 오프라인이면 캐시로 폴백('옛 코드에 갇힘' 방지)
  if (sameOrigin && /\.(css|js|mjs)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CORE_CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 3) 같은 출처 정적 자원(아이콘·과정 이미지·json 등): cache-first + 런타임 캐시
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// index.html이 새 버전 적용을 요청하면 즉시 활성화
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
