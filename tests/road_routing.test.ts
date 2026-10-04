/**
 * 도로 우회 경로 — 물을 피해 돌아가되, 도시는 그대로 연결한다.
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer } from '../src/core/china_map_renderer';

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

type Internals = {
    isLand: (x: number, y: number) => boolean;
    routeRoadOnLand: (ax: number, ay: number, bx: number, by: number) => Array<{ x: number; y: number }>;
    segmentMostlyLand: (ax: number, ay: number, bx: number, by: number) => boolean;
};

const rig = (isLand: (x: number, y: number) => boolean): Internals => {
    const r = new ChinaMapRenderer(createMockCanvas());
    Object.assign(r as unknown as Record<string, unknown>, { isLand });
    return r as unknown as Internals;
};

describe('도로 우회 경로', () => {
    it('전부 육지면 우회 지점을 만들지 않는다', () => {
        const h = rig(() => true);
        expect(h.routeRoadOnLand(0.2, 0.5, 0.8, 0.5)).toEqual([]);
    });

    it('물 위를 지나는 도로를 우회시킨다 (도시는 그대로 연결된다)', () => {
        // 강이 y 전폭을 가로지르는 경우는 단일 우회점으로 불가능하다(양쪽 어디로든 물을 다시 만난다).
        // 실제 지형은 그렇지 않다 — 물 덩어리(강 하구·호수)로 모델링한다.
        const isLand = (x: number, y: number): boolean => {
            const inMouth = x > 0.45 && x < 0.55 && y > 0.44 && y < 0.56;
            return !inMouth;
        };
        const h = rig(isLand);
        const via = h.routeRoadOnLand(0.30, 0.50, 0.70, 0.50);
        expect(via.length, '우회 지점을 찾지 못했다').toBeGreaterThan(0);
        for (const p of via) {
            expect(h.isLand(p.x, p.y), '우회점이 물 위에 있다').toBe(true);
        }
        // via 는 단일 점이 아니라 다각형 경로다 — 모든 연속 다리를 확인해야 한다.
        const nodes = [{ x: 0.30, y: 0.50 }, ...via, { x: 0.70, y: 0.50 }];
        for (let i = 0; i < nodes.length - 1; i++) {
            expect(
                h.segmentMostlyLand(nodes[i].x, nodes[i].y, nodes[i + 1].x, nodes[i + 1].y),
                `${i} 번째 다리가 물을 지난다 — 경로가 물 위를 지른다`,
            ).toBe(true);
        }
    });

    it('우회 불가가 되면 빈 배열을 돌려준다 (잘못된 경로를 지어내지 않는다)', () => {
        // 중간에 매우 넓은 바다가 있어 0.18 안에 우회할 수 없다
        const h = rig((x: number) => x < 0.05 || x > 0.95);
        expect(h.routeRoadOnLand(0.10, 0.50, 0.90, 0.50)).toEqual([]);
    });

    it('우회점은 원래 두 점을 잇는 선분의 어느 쪽으로도 벗어나지 않는다 (무한대 우회 방지)', () => {
        const h = rig((x: number) => x < 0.45 || x > 0.55);
        const via = h.routeRoadOnLand(0.30, 0.50, 0.70, 0.50);
        for (const p of via) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(1);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(1);
        }
    });

    it('segmentMostlyLand 는 끝점 하나라도 바다면 false', () => {
        const h = rig((x: number) => x < 0.5);
        expect(h.segmentMostlyLand(0.1, 0.5, 0.4, 0.5)).toBe(true);
        expect(h.segmentMostlyLand(0.1, 0.5, 0.9, 0.5)).toBe(false);
    });
});
