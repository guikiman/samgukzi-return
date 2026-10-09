/**
 * 해안선 유지 — 도시 아이콘이 바다에 걸리지 않는다.
 *
 * [왜 이 테스트가 필요한가]
 * 해안 배치(coastBias)가 한계 없이 도시를 물가로 끌어당겨, 4개 도시(연주·하비·오·계양)가
 * 수면에서 0.004(≈3.6px) 까지 밀렸다. 아이콘 폭이 12~16px 라 절반이 바다에 걸쳐
 * "섬에 떠 있다" 는 인상이 되었다.
 *
 * [방향 선택 회귀]
 * 처음 구현은 "가장 깊은 육지 방향"으로 밀었는데, 탐색 반경 안에서 모든 방향이 최대 깊이에
 * 도달해 동률이 되고 첫 방향이 선택됐다. 그 결과 도시가 해안선을 따라 옆으로 미끄러졌다
 * (x 그대로, y만 이동). 아래 테스트는 안쪽(x 감소)으로 밀리는지까지 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer, type MapCityView } from '../src/core/china_map_renderer';

const S = 256;

function createMockCanvas(): HTMLCanvasElement {
    return {
        width: 1200, height: 700,
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

/** x 가 coastX 미만이면 육지 — 세로 해안선. */
function coastMask(coastX: number): Uint8Array {
    const m = new Uint8Array(S * S);
    for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) m[py * S + px] = px / S < coastX ? 255 : 0;
    }
    return m;
}

/** 본토(좌측 0.5) + 우측에 작은 섬(반경 0.03). */
function islandMask(): Uint8Array {
    const m = coastMask(0.5);
    for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
            if (Math.hypot(px / S - 0.8, py / S - 0.5) < 0.03) m[py * S + px] = 255;
        }
    }
    return m;
}

function rig(alpha: Uint8Array) {
    const r = new ChinaMapRenderer(createMockCanvas());
    const it = r as unknown as { mapImage: unknown; landAlpha: Uint8Array; landMask: unknown };
    it.mapImage = {};
    it.landMask = {};
    it.landAlpha = alpha;
    const h = r as unknown as {
        cityPos: Map<string, { x: number; y: number }>;
        shoreDistance: (x: number, y: number) => number;
        pushInlandFromShore: () => void;
    };
    const margin = (r.constructor as unknown as { MIN_SHORE_MARGIN: number }).MIN_SHORE_MARGIN;
    return {
        r,
        margin,
        pos: (id: string) => h.cityPos.get(id),
        shore: (x: number, y: number) => h.shoreDistance(x, y),
        push: () => h.pushInlandFromShore(),
    };
}

const city = (id: string, x: number, y: number): MapCityView => ({
    id, name: id, x, y, imageX: x, imageY: y,
    ownerColor: '#2a5a8a', isPlayer: false, garrison: 1000, population: 50000,
    hexCoord: { q: 0, r: 0 },
});

describe('도시 해안선 유지', () => {
    it('해안선에 붙은 도시를 안쪽(x 감소)으로 민다', () => {
        const h = rig(coastMask(0.5));
        h.r.setCities([city('a', 0.495, 0.5)]);
        const p = h.pos('a')!;
        expect(p.x, '안쪽(왼쪽)으로 이동해야 한다').toBeLessThan(0.495);
        expect(h.shore(p.x, p.y), '아직 수면에 너무 붙어 있다')
            .toBeGreaterThanOrEqual(h.margin - 1e-6);
    });

    it('해안을 따라 옆으로 미끄러지지 않는다 (y 불변)', () => {
        const h = rig(coastMask(0.5));
        h.r.setCities([city('a', 0.495, 0.5)]);
        const p = h.pos('a')!;
        expect(Math.abs(p.y - 0.5), `y 가 ${p.y} 로 변했다 — 해안을 따라 미끄러짐`)
            .toBeLessThan(1e-6);
    });

    it('필요 이상으로 멀리 밀지 않는다', () => {
        const h = rig(coastMask(0.5));
        h.r.setCities([city('a', 0.492, 0.5)]);
        const p = h.pos('a')!;
        expect(0.492 - p.x, '과도하게 밀렸다').toBeLessThanOrEqual(h.margin + 0.01);
    });

    it('이동 후에도 전부 육지 위다', () => {
        const h = rig(coastMask(0.5));
        h.r.setCities([
            city('a', 0.495, 0.5), city('b', 0.49, 0.3), city('c', 0.497, 0.7),
        ]);
        for (const id of ['a', 'b', 'c']) {
            const p = h.pos(id)!;
            expect(h.shore(p.x, p.y) > 0, `${id} 가 바다로 밀려났다`).toBe(true);
        }
    });

    it('섬 위의 도시는 바다로 던지지 않는다 (해안섬 침범 방지)', () => {
        const h = rig(islandMask());
        h.r.setCities([city('isle', 0.8, 0.5)]);
        const p = h.pos('isle')!;
        expect(h.shore(p.x, p.y) > 0, '섬의 도시가 바다로 밀려났다').toBe(true);
        // 본토로 옮겨 가지 않았는지 — 여전히 우측 섬 영역
        expect(p.x, '섬에서 본토로 옮겨 갔다').toBeGreaterThan(0.7);
    });

    it('이미 충분히 안쪽인 도시는 pushInland 가 건드리지 않는다', () => {
        const h = rig(coastMask(0.5));
        h.r.setCities([city('deep', 0.3, 0.5)]);
        const before = { ...h.pos('deep')! };
        h.push();
        const after = h.pos('deep')!;
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
    });

    it('좁은 지협(양쪽이 물)에서도 반대편 바다를 건너지 않는다', () => {
        // 실제 장사의 상황 — 남서쪽 물(0.002)과 북동쪽 물(0.008) 사이에 낀 지협.
        // 필요한 만큼 한 번에 밀면 반대편 바다를 넘어가므로, 한 칸씩 옮겨야 한다.
        const m = new Uint8Array(S * S);
        for (let py = 0; py < S; py++) {
            for (let px = 0; px < S; px++) {
                const x = px / S;
                const y = py / S;
                // 대각선 지협: |y - 0.5 - 0.25*(x-0.55)| < 0.006
                const onSpit = Math.abs(y - 0.5 - 0.25 * (x - 0.55)) < 0.006;
                m[py * S + px] = onSpit ? 255 : 0;
            }
        }
        const h = rig(m);
        h.r.setCities([city('spit', 0.58, 0.5075)]);
        h.push();
        const p = h.pos('spit')!;
        expect(h.shore(p.x, p.y) > 0, '지협 도시가 바다로 밀려났다').toBe(true);
        // 지협 위에 계속 있어야 한다 (본토/반대편으로 튀지 않음)
        expect(Math.abs(p.y - 0.5 - 0.25 * (p.x - 0.55)) < 0.02, '지협을 벗어났다').toBe(true);
    });
});
