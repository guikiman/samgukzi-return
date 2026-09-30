/**
 * 도시 진입 화면 배경 — 표본 배치 계산과 라벨 앵커.
 */
import { describe, it, expect } from 'vitest';
import {
    computeCoverPlacement,
    anchorFor,
    CITY_SCENE_ART_ANCHORS,
    CITY_SCENE_ART_PATH,
} from '../src/core/city_scene_art';
import { CITY_BUILDING_TYPES } from '../src/core/city_3d_renderer';

describe('computeCoverPlacement', () => {
    it('16:9 원본을 2:1 캔버스에 맞추면 위아래가 잘린다', () => {
        const p = computeCoverPlacement(850, 478, 480, 240);
        // 너비는 꽉 차고, 세로만 잘린다.
        expect(p.sw).toBeCloseTo(850, 6);
        expect(p.sh).toBeLessThan(478);
        expect(p.sx).toBeCloseTo(0, 6);
        // 잘린 양은 위아래가 대칭으로 나뉜다.
        expect(p.sy).toBeCloseTo((478 - p.sh) / 2, 6);
    });

    it('잘리는 비율이 위아래 각 5.6% 안팎이다 — 프롬프트 안전 마진과 일치', () => {
        const srcH = 478;
        const p = computeCoverPlacement(850, srcH, 480, 240);
        const cutPct = (p.sy / srcH) * 100;
        expect(cutPct).toBeGreaterThan(5);
        expect(cutPct).toBeLessThan(6.2);
    });

    it('캔버스보다 더 넓은 원본이면 좌우가 잘린다', () => {
        // 2.5:1 원본을 2:1 캔버스에 넣으면 세로가 꽉 차고 좌우가 잘린다.
        const p = computeCoverPlacement(1000, 400, 480, 240);
        expect(p.sh).toBeCloseTo(400, 6);
        expect(p.sy).toBeCloseTo(0, 6);
        expect(p.sw).toBeLessThan(1000);
        expect(p.sx).toBeCloseTo((1000 - p.sw) / 2, 6);
    });

    it('정사각 원본은 세로가 잘린다 — 가로로 자르지 않는다', () => {
        const p = computeCoverPlacement(1000, 1000, 480, 240);
        expect(p.sw).toBeCloseTo(1000, 6);
        expect(p.sx).toBeCloseTo(0, 6);
        expect(p.sh).toBeCloseTo(500, 6);
        expect(p.sy).toBeCloseTo(250, 6);
    });

    it('정확히 같은 비율이면 자르지 않는다', () => {
        const p = computeCoverPlacement(480, 240, 480, 240);
        expect(p.sx).toBe(0);
        expect(p.sy).toBe(0);
        expect(p.sw).toBe(480);
        expect(p.sh).toBe(240);
        expect(p.scale).toBe(1);
    });

    it('배치가 항상 캔버스 크기를 덮는다', () => {
        const cases: Array<[number, number]> = [[850, 478], [1000, 1000], [1920, 960], [400, 1200], [16, 9]];
        for (const [w, h] of cases) {
            const p = computeCoverPlacement(w, h, 480, 240);
            expect(p.sw * p.scale, `${w}x${h} 가로가 부족`).toBeGreaterThanOrEqual(480 - 1e-9);
            expect(p.sh * p.scale, `${w}x${h} 세로가 부족`).toBeGreaterThanOrEqual(240 - 1e-9);
        }
    });

    it('크기가 0 이하면 예외를 던진다 — 조용히 0 을 그려 빈 화면이 된다', () => {
        expect(() => computeCoverPlacement(0, 100, 480, 240)).toThrow();
        expect(() => computeCoverPlacement(100, 100, 0, 240)).toThrow();
        expect(() => computeCoverPlacement(-1, 100, 480, 240)).toThrow();
    });
});

describe('라벨 앵커', () => {
    it('건물 8종 모두 앵커가 있다', () => {
        // 하나라도 빠지면 해당 건물 라벨이 그림과 무관한 자리에 뜬다.
        expect(CITY_BUILDING_TYPES.every(k => CITY_SCENE_ART_ANCHORS[k] !== undefined)).toBe(true);
        expect(CITY_BUILDING_TYPES).toHaveLength(8);
    });

    it('앵커는 모두 화면 안에 있다', () => {
        for (const [type, a] of Object.entries(CITY_SCENE_ART_ANCHORS)) {
            expect(a.x, `${type} x`).toBeGreaterThanOrEqual(0);
            expect(a.x, `${type} x`).toBeLessThanOrEqual(100);
            expect(a.y, `${type} y`).toBeGreaterThanOrEqual(0);
            expect(a.y, `${type} y`).toBeLessThanOrEqual(100);
        }
    });

    it('앵커가 겹치지 않는다 — 두 라벨이 한 자리에 서면 안 된다', () => {
        const list = Object.values(CITY_SCENE_ART_ANCHORS);
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const dx = list[i].x - list[j].x;
                const dy = list[i].y - list[j].y;
                expect(Math.hypot(dx, dy), `앵커 ${i} 와 ${j} 가 겹친다`).toBeGreaterThan(8);
            }
        }
    });

    it('앵커 없는 타입은 타원 링으로 물러난다 — 앵커 표가 빈자리여도 배치는 된다', () => {
        const missing = 'UNKNOWN' as never;
        const a = anchorFor(missing, 0, 8);
        expect(Number.isFinite(a.x)).toBe(true);
        expect(Number.isFinite(a.y)).toBe(true);
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThanOrEqual(100);
    });
});

describe('자산 경로', () => {
    it('배경 파일 경로가 assets/ 아래다 — 서비스워커 프리캐시를 위해서', () => {
        expect(CITY_SCENE_ART_PATH.startsWith('assets/')).toBe(true);
    });
});
