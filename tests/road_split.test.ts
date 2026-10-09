/**
 * 도로 분할 — 육지 구간은 그리고, 짧은 물길만 다리로 잇는다.
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer, type RoadSegment } from '../src/core/china_map_renderer';

function createMockCanvas(): HTMLCanvasElement {
    return {
        width: 1200,
        height: 700,
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

const road = (ax: number, ay: number, bx: number, by: number): RoadSegment =>
    ({ ax, ay, bx, by, factionKey: 'f', color: '#888', isPlayer: false });

describe('도로 분할', () => {
    it('전부 육지면 구간 하나로 유지된다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        (r as unknown as { isLand: (x: number, y: number) => boolean }).isLand = () => true;
        const out = (r as unknown as {
            splitRoadByLand(rd: RoadSegment, n: number): { onLand: Array<[number, number]>; onWater: Array<[number, number]> };
        }).splitRoadByLand(road(0.1, 0.5, 0.9, 0.5), 8);
        expect(out.onWater).toHaveLength(0);
        expect(out.onLand).toHaveLength(1);
        expect(out.onLand[0][0]).toBeCloseTo(0, 5);
        expect(out.onLand[0][1]).toBeCloseTo(1, 5);
    });

    it('중간에 물이 있으면 육지 구간 둘로 나뉜다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        // x < 0.4 또는 x > 0.6 이면 육지 — 가운데가 바다
        (r as unknown as { isLand: (x: number, y: number) => boolean }).isLand =
            (x: number) => x < 0.4 || x > 0.6;
        const out = (r as unknown as {
            splitRoadByLand(rd: RoadSegment, n: number): { onLand: Array<[number, number]>; onWater: Array<[number, number]> };
        }).splitRoadByLand(road(0.1, 0.5, 0.9, 0.5), 20);
        expect(out.onLand.length, '육지 구간이 둘이어야 한다').toBe(2);
        expect(out.onWater.length, '물 구간이 하나 있어야 한다').toBe(1);
        expect(out.onLand[0][0]).toBeCloseTo(0, 5);
        expect(out.onLand[0][1]).toBeLessThan(0.5);
        expect(out.onWater[0][0]).toBeCloseTo(out.onLand[0][1], 5);
        expect(out.onWater[0][1]).toBeCloseTo(out.onLand[1][0], 5);
    });

    it('구간이 빈틈없이 이어진다 (떨어진 조각이 없다)', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        (r as unknown as { isLand: (x: number, y: number) => boolean }).isLand =
            (x: number) => Math.sin(x * 22) < 0; // 물과 육지가 여러 번 번갈아 나온다
        const out = (r as unknown as {
            splitRoadByLand(rd: RoadSegment, n: number): { onLand: Array<[number, number]>; onWater: Array<[number, number]> };
        }).splitRoadByLand(road(0.05, 0.5, 0.95, 0.5), 200);
        const all = [...out.onLand, ...out.onWater].sort((a, b) => a[0] - b[0]);
        expect(all[0][0]).toBeCloseTo(0, 6);
        expect(all[all.length - 1][1]).toBeCloseTo(1, 6);
        for (let i = 1; i < all.length; i++) {
            expect(all[i][0], `${i} 번째 구간 앞에 빈틈`).toBeCloseTo(all[i - 1][1], 6);
        }
    });

    it('시작점이 바다면 첫 구간이 물로 시작한다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        (r as unknown as { isLand: (x: number, y: number) => boolean }).isLand = (x: number) => x > 0.5;
        const out = (r as unknown as {
            splitRoadByLand(rd: RoadSegment, n: number): { onLand: Array<[number, number]>; onWater: Array<[number, number]> };
        }).splitRoadByLand(road(0.1, 0.5, 0.9, 0.5), 10);
        expect(out.onWater[0][0]).toBeCloseTo(0, 5);
        expect(out.onLand[0][0]).toBeGreaterThan(0.4);
    });
});
