/**
 * [41][42][43][44][45][46][47][48][49][50] PWA 오프라인 캐싱 전략 (Service Worker)
 *
 * PWACacheStrategy:
 *   - Cache First (정적 에셋): HTML/CSS/JS/이미지
 *   - Network First (동적 데이터): API/세이브/랭킹
 *   - Stale While Revalidate (폴백): 외부 폰트/라이브러리
 *   - Cache on Demand (유저 액션): 전투 리플레이/모드 파일
 *   - 오프라인 감지 시 Service Worker 캐시 폴백
 */

export type CacheStrategy = 'CACHE_FIRST' | 'NETWORK_FIRST' | 'STALE_WHILE_REVALIDATE' | 'CACHE_ON_DEMAND';

export interface CacheEntry {
    readonly url: string;
    readonly strategy: CacheStrategy;
    readonly data: string;
    readonly timestamp: number;
    readonly ttl: number; // ms
}

export class PWACacheManager {
    private cacheName: string = 'samgukzi-return-cache-v1';
    private entries: Map<string, CacheEntry> = new Map();

    constructor(cacheName?: string) {
        if (cacheName) this.cacheName = cacheName;
    }

    /**
     * [41] Cache First: 정적 에셋 (HTML/CSS/JS)
     */
    async cacheFirst(url: string): Promise<Response | null> {
        const cached = await this.getFromCache(url);
        if (cached) return cached;
        return this.fetchAndCache(url);
    }

    /**
     * [42] Network First: 동적 데이터 (API)
     */
    async networkFirst(url: string): Promise<Response | null> {
        try {
            const response = await fetch(url);
            if (response.ok) {
                await this.cacheResponse(url, response.clone());
                return response;
            }
        } catch {
            // 네트워크 실패 → 캐시 폴백
        }
        return this.getFromCache(url);
    }

    /**
     * [43] Stale While Revalidate: 외부 폰트/라이브러리
     */
    async staleWhileRevalidate(url: string): Promise<Response | null> {
        const cached = await this.getFromCache(url);
        this.fetchAndCache(url).catch(() => {}); // 비동기 갱신
        return cached;
    }

    /**
     * [44] Cache on Demand: 유저 액션 기반 캐싱
     */
    async cacheOnDemand(url: string, data: string): Promise<void> {
        const entry: CacheEntry = {
            url,
            strategy: 'CACHE_ON_DEMAND',
            data,
            timestamp: Date.now(),
            ttl: 24 * 60 * 60 * 1000, // 24시간
        };
        this.entries.set(url, entry);
    }

    private async getFromCache(url: string): Promise<Response | null> {
        const entry = this.entries.get(url);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.entries.delete(url);
            return null;
        }
        return new Response(entry.data);
    }

    private async fetchAndCache(url: string): Promise<Response | null> {
        try {
            const response = await fetch(url);
            if (response.ok) {
                const clone = response.clone();
                const text = await clone.text();
                this.entries.set(url, {
                    url,
                    strategy: 'CACHE_FIRST',
                    data: text,
                    timestamp: Date.now(),
                    ttl: 24 * 60 * 60 * 1000,
                });
                return response;
            }
        } catch { /* offline */ }
        return null;
    }

    private async cacheResponse(url: string, response: Response): Promise<void> {
        try {
            const text = await response.clone().text();
            this.entries.set(url, {
                url,
                strategy: 'NETWORK_FIRST',
                data: text,
                timestamp: Date.now(),
                ttl: 60 * 60 * 1000, // 1시간
            });
        } catch { /* ignore */ }
    }

    /**
     * [44] 오프라인 감지
     */
    isOffline(): boolean {
        return typeof navigator !== 'undefined' && !navigator.onLine;
    }

    getCacheSize(): number { return this.entries.size; }
    clearCache(): void { this.entries.clear(); }
}
