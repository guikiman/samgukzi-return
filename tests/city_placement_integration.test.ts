/**
 * rebuildCityPositions 의 2단계(완화) 경로를 실제로 실행해 검증한다.
 *
 * [왜 이런 테스트가 필요했는가]
 * rebuildCityPositions 는 `if (!this.mapImage) return;` 로 끝나므로, 유닛 테스트에서는
 * 완화 단계가 한 번도 실행되지 않았다. 통합 후 테스트 수가 늘지 않은 이유가 이것이었다.
 * mapImage 와 landAlpha 를 직접 주입해 그 경로를 강제로 태운다.
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer, type MapCityView } from '../src/core/china_map_renderer';
import mapCoords from '../assets/map-coordinates-4096.json';

const S = 256;

function createMockCanvas(w = 1200, h = 700): HTMLCanvasElement {
    return {
        width: w,
        height: h,
        getContext: () => ({
            clearRect: () => {}, fillRect: () => {}, beginPath: () => {},
            moveTo: () => {}, lineTo: () => {}, closePath: () => {},
            fill: () => {}, stroke: () => {}, arc: () => {}, rect: () => {},
            quadraticCurveTo: () => {}, fillText: () => {}, strokeText: () => {},
            measureText: () => ({ width: 20 }),
            setLineDash: () => {}, save: () => {}, restore: () => {},
            drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(S * S * 4) }),
            createImageData: () => ({ data: new Uint8ClampedArray(S * S * 4) }),
        }),
    } as unknown as HTMLCanvasElement;
}

/** 전부 육지인 마스크 — 지형 제약 없이 순수 간격 완화만 볼 때 쓴다. */
function allLandMask(): Uint8Array {
    return new Uint8Array(S * S).fill(255);
}

function withMask(r: ChinaMapRenderer, alpha: Uint8Array): void {
    const internals = r as unknown as { mapImage: unknown; landAlpha: Uint8Array; landMask: unknown };
    internals.mapImage = {};      // 조기 반환을 피하기 위한 더미
    internals.landMask = {};      // getLandMask 가 다시 그리지 않도록
    internals.landAlpha = alpha;
}

const citiesOf = (): MapCityView[] =>
    (mapCoords as { cities: Array<{ name: string; x: number; y: number }> }).cities.map((c, i) => ({
        id: `c${i}`,
        name: c.name,
        x: c.x / 4096,
        y: c.y / 4096,
        imageX: c.x / 4096,
        imageY: c.y / 4096,
        ownerColor: '#2a5a8a',
        isPlayer: false,
        garrison: 1000,
        population: 50000,
        hexCoord: { q: i % 8, r: Math.floor(i / 8) },
    }));

const positionsOf = (r: ChinaMapRenderer, cities: MapCityView[]): Map<string, { x: number; y: number }> =>
    (r as unknown as { cityPos: Map<string, { x: number; y: number }> }).cityPos;

describe('rebuildCityPositions 2단계(완화) 경로', () => {
    it('완화 단계가 실제로 실행되어 도시가 밀린다', () => {
        const cities = citiesOf();
        const r = new ChinaMapRenderer(createMockCanvas(360, 520));
        withMask(r, allLandMask());
        r.setCities(cities);

        const pos = positionsOf(r, cities);
        let moved = 0;
        for (const c of cities) {
            const p = pos.get(c.id)!;
            if (Math.hypot(p.x - c.x, p.y - c.y) > 1e-6) moved++;
        }
        expect(moved, '완화 단계가 실행되지 않았다 — mapImage 조기 반환 확인 필요').toBeGreaterThan(0);
    });

    it('완화 후에도 모든 도시가 육지 위에 있다', () => {
        const cities = citiesOf();
        const r = new ChinaMapRenderer(createMockCanvas(360, 520));
        withMask(r, allLandMask());
        r.setCities(cities);
        const pos = positionsOf(r, cities);
        for (const c of cities) {
            const p = pos.get(c.id)!;
            expect(p.x, `${c.name} 이 [0,1] 밖으로 나갔다`).toBeGreaterThanOrEqual(0);
            expect(p.x, `${c.name} 이 [0,1] 밖으로 나갔다`).toBeLessThanOrEqual(1);
            expect(p.y, `${c.name} 이 [0,1] 밖으로 나갔다`).toBeGreaterThanOrEqual(0);
            expect(p.y, `${c.name} 이 [0,1] 밖으로 나갔다`).toBeLessThanOrEqual(1);
        }
    });

    it('좁은 창(360x520)에서도 모든 도시 쌍이 필요 간격 이상 떨어진다', () => {
        const cities = citiesOf();
        const r = new ChinaMapRenderer(createMockCanvas(360, 520));
        withMask(r, allLandMask());
        r.setCities(cities);

        const gap = (r as unknown as { requiredCityGap(): number }).requiredCityGap();
        const pos = positionsOf(r, cities);
        for (let i = 0; i < cities.length; i++) {
            for (let j = i + 1; j < cities.length; j++) {
                const a = pos.get(cities[i].id)!;
                const b = pos.get(cities[j].id)!;
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                expect(d, `${cities[i].name}-${cities[j].name} 가 붙었다`).toBeGreaterThanOrEqual(gap - 1e-3);
            }
        }
    });

    it('게임 데이터(hexCoord·원본 좌표)는 변경되지 않는다 — 표시 전용임이 보장된다', () => {
        const cities = citiesOf();
        const before = cities.map(c => ({
            id: c.id, x: c.x, y: c.y, q: c.hexCoord.q, r: c.hexCoord.r,
        }));
        const r = new ChinaMapRenderer(createMockCanvas(360, 520));
        withMask(r, allLandMask());
        r.setCities(cities);

        for (let i = 0; i < cities.length; i++) {
            const c = cities[i];
            const b = before[i];
            expect(c.hexCoord.q, `${c.name} 의 hexCoord.q 가 바뀌었다`).toBe(b.q);
            expect(c.hexCoord.r, `${c.name} 의 hexCoord.r 가 바뀌었다`).toBe(b.r);
            expect(c.x, `${c.name} 의 x 가 바뀌었다`).toBe(b.x);
            expect(c.y, `${c.name} 의 y 가 바뀌었다`).toBe(b.y);
        }
    });

    it('이동량은 허용 오차(0.07)를 넘지 않는다', () => {
        const cities = citiesOf();
        const r = new ChinaMapRenderer(createMockCanvas(360, 520));
        withMask(r, allLandMask());
        r.setCities(cities);
        const pos = positionsOf(r, cities);
        for (const c of cities) {
            const p = pos.get(c.id)!;
            expect(Math.hypot(p.x - c.x, p.y - c.y), `${c.name} 가 너무 멀리 밀렸다`)
                .toBeLessThanOrEqual(0.07 + 1e-6);
        }
    });
});

describe('해안 방향 밀기', () => {
    /** x 가 coastX 보다 작으면 육지, 크면 바다 — 세로 해안선. */
    const coastMask = (coastX: number): Uint8Array => {
        const m = new Uint8Array(S * S);
        for (let py = 0; py < S; py++) {
            for (let px = 0; px < S; px++) {
                m[py * S + px] = px / S < coastX ? 255 : 0;
            }
        }
        return m;
    };

    it('해안(바다가 있는 방향)으로 도시를 민다', () => {
        // 해안선이 x=0.5 이고 바다는 오른쪽 — 도시들은 안쪽(x<0.45)에 둔다.
        const picks = [0.10, 0.20, 0.30, 0.40].map((x, i) => ({
            id: `k${i}`, name: `도시${i}`, x, y: 0.12 + i * 0.25,
            imageX: x, imageY: 0.12 + i * 0.25,
            ownerColor: '#2a5a8a', isPlayer: false, garrison: 1000, population: 50000,
            hexCoord: { q: i, r: i },
        }));
        const before = picks.map(p => p.x);

        const r = new ChinaMapRenderer(createMockCanvas(1200, 700));
        withMask(r, coastMask(0.5));
        r.setCities(picks);
        const pos = positionsOf(r, picks);

        let movedCoastward = 0;
        for (let i = 0; i < picks.length; i++) {
            const p = pos.get(picks[i].id)!;
            if (p.x > before[i] + 1e-4) movedCoastward++;
            expect(p.x, `${picks[i].name} 이 바다(x>=0.5) 위로 밀려났다`).toBeLessThan(0.5);
        }
        expect(movedCoastward, '어떤 도시도 해안 쪽으로 밀리지 않았다').toBeGreaterThan(0);
    });

    it('해안 밀기가 도시를 바다로 밀어내지 않는다', () => {
        const picks = [0.10, 0.20, 0.30, 0.40].map((x, i) => ({
            id: `m${i}`, name: `도시${i}`, x, y: 0.12 + i * 0.25,
            imageX: x, imageY: 0.12 + i * 0.25,
            ownerColor: '#2a5a8a', isPlayer: false, garrison: 1000, population: 50000,
            hexCoord: { q: i, r: i },
        }));
        const r = new ChinaMapRenderer(createMockCanvas(1200, 700));
        withMask(r, coastMask(0.5));
        r.setCities(picks);
        const pos = positionsOf(r, picks);
        for (const p of picks) {
            const q = pos.get(p.id)!;
            expect(q.x, `${p.name} 이 해안선 너머로 밀렸다`).toBeLessThan(0.5);
        }
    });
});
