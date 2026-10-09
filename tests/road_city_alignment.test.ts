/**
 * 좌표 의존 레이어의 재계산 순서 — 도로가 도시에서 떨어져 그려지는 회귀를 막는다.
 *
 * [무엇을 막는가]
 * rebuildRoads() 가 rebuildCityPositions() 보다 먼저 불리면 도로가 "완화 전" 좌표로 만들어지고,
 * 도시는 그 뒤 최대 0.07 만큼 옮겨진다. 그 결과 도로 끝점이 도시 아이콘에서 최대 수십 픽셀
 * 어긋나 "도로가 끊겼다" 는 증상이 났다(육지 판정 문제가 아니었다).
 * 이 테스트는 도로 끝점이 반드시 확정된 도시 좌표와 일치함을 단언한다.
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer, type MapCityView } from '../src/core/china_map_renderer';
import mapCoords from '../assets/map-coordinates-4096.json';

const S = 256;

function createMockCanvas(w = 1200, h = 700): HTMLCanvasElement {
    return {
        width: w, height: h,
        getContext: () => ({
            clearRect: () => {}, fillRect: () => {}, beginPath: () => {},
            moveTo: () => {}, lineTo: () => {}, closePath: () => {},
            fill: () => {}, stroke: () => {}, arc: () => {}, rect: () => {},
            quadraticCurveTo: () => {}, fillText: () => {}, strokeText: () => {},
            measureText: () => ({ width: 20 }),
            setLineDash: () => {}, save: () => {}, restore: () => {},
        }),
    } as unknown as HTMLCanvasElement;
}

/** 완화 단계가 실제로 돌도록 mapImage/landAlpha 를 주입한다. */
function enableRelax(r: ChinaMapRenderer, alpha?: Uint8Array): void {
    const it = r as unknown as { mapImage: unknown; landAlpha: Uint8Array; landMask: unknown };
    it.mapImage = {};
    it.landMask = {};
    it.landAlpha = alpha ?? new Uint8Array(S * S).fill(255);
}

/** 실측 42도시를 세력 3개로 나눠 붙인다 — MST 가 실제로 여러 도로를 만들도록. */
function realCities(): MapCityView[] {
    const raw = (mapCoords as { cities: Array<{ name: string; x: number; y: number }> }).cities;
    return raw.map((c, i) => ({
        id: `c${i}`,
        name: c.name,
        x: c.x / 4096,
        y: c.y / 4096,
        imageX: c.x / 4096,
        imageY: c.y / 4096,
        ownerColor: `f${i % 3}`,
        isPlayer: i === 0,
        garrison: 1000,
        population: 50000,
        hexCoord: { q: i % 8, r: Math.floor(i / 8) },
    }));
}

const cityPos = (r: ChinaMapRenderer): Map<string, { x: number; y: number }> =>
    (r as unknown as { cityPos: Map<string, { x: number; y: number }> }).cityPos;
const roadsOf = (r: ChinaMapRenderer): Array<{ ax: number; ay: number; bx: number; by: number }> =>
    (r as unknown as { roads: Array<{ ax: number; ay: number; bx: number; by: number }> }).roads;

describe('도로 좌표는 확정된 도시 좌표를 따른다', () => {
    it('모든 도로 끝점이 도시 좌표와 일치한다 (순서 회귀 방지)', () => {
        const cities = realCities();
        const r = new ChinaMapRenderer(createMockCanvas());
        enableRelax(r);
        r.setCities(cities);

        const pos = cityPos(r);
        const pts = cities.map(c => pos.get(c.id)!);
        const maxDev = (x: number, y: number): number =>
            Math.min(...pts.map(p => Math.hypot(p.x - x, p.y - y)));

        for (const road of roadsOf(r)) {
            const dA = maxDev(road.ax, road.ay);
            const dB = maxDev(road.bx, road.by);
            expect(dA, `도로 시작점이 어떤 도시와도 ${(dA * 1000).toFixed(1)} 만큼 떨어져 있다 — 재계산 순서 확인`).toBeLessThan(1e-6);
            expect(dB, `도로 끝점이 어떤 도시와도 ${(dB * 1000).toFixed(1)} 만큼 떨어져 있다 — 재계산 순서 확인`).toBeLessThan(1e-6);
        }
    });

    it('도로가 실제로 만들어진다 (검증문이 비어있지 않도록)', () => {
        const cities = realCities();
        const r = new ChinaMapRenderer(createMockCanvas());
        enableRelax(r);
        r.setCities(cities);
        expect(roadsOf(r).length).toBeGreaterThan(10);
    });

    it('도시가 실제로 옮겨졌을 때 도로도 함께 옮겨진다', () => {
        // 360x520 은 간격이 커 도시가 확실히 밀린다 — 이때 어긋나면 순서 버그다.
        const cities = realCities();
        const r = new ChinaMapRenderer(createMockCanvas(360, 520));
        enableRelax(r);
        r.setCities(cities);

        const pos = cityPos(r);
        let moved = 0;
        for (const c of cities) {
            const p = pos.get(c.id)!;
            if (Math.hypot(p.x - c.x, p.y - c.y) > 1e-6) moved++;
        }
        expect(moved, '완화가 실행되지 않았다 — 이 테스트가 무의미해진다').toBeGreaterThan(0);

        const pts = cities.map(c => pos.get(c.id)!);
        for (const road of roadsOf(r)) {
            const dA = Math.min(...pts.map(p => Math.hypot(p.x - road.ax, p.y - road.ay)));
            const dB = Math.min(...pts.map(p => Math.hypot(p.x - road.bx, p.y - road.by)));
            expect(dA, '도시가 옮겨졌는데 도로 시작점이 옛 자리에 있다').toBeLessThan(1e-6);
            expect(dB, '도시가 옮겨졌는데 도로 끝점이 옛 자리에 있다').toBeLessThan(1e-6);
        }
    });
});
