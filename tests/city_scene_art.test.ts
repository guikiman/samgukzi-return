/**
 * 도시 진입 화면 배경 — 경로, 라벨 앵커, cover 배치 계산.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    computeCoverPlacement,
    anchorFor,
    CITY_SCENE_ART_ANCHORS,
    CITY_SCENE_ART_PATH,
} from '../src/core/city_scene_art';
import { CITY_BUILDING_TYPES } from '../src/core/city_3d_renderer';

const REPO_ROOT = resolve(__dirname, '..');

describe('배경 그림 파일', () => {
    it('경로가 assets/ 아래다 — 서비스워커 프리캐시를 위해서', () => {
        expect(CITY_SCENE_ART_PATH.startsWith('assets/')).toBe(true);
    });

    it('파일이 실제로 존재한다', () => {
        expect(existsSync(resolve(REPO_ROOT, CITY_SCENE_ART_PATH))).toBe(true);
    });

    it('오프라인에서도 도시 화면이 채워진다 — 프리캐시에 들어 있어야 한다', () => {
        // 빠지면 온라인에서는 되지만 오프라인에서 조용히 절차 렌더로 물러난다.
        const sw = readFileSync(resolve(REPO_ROOT, 'sw.js'), 'utf8');
        expect(sw).toContain(CITY_SCENE_ART_PATH);
    });

    it('대장에 등록되어 있다 — 저작권 게이트의 allowlist 대상', () => {
        const prov = JSON.parse(readFileSync(resolve(REPO_ROOT, 'assets/PROVENANCE.json'), 'utf8')) as {
            assets: Array<{ path: string; license?: string }>;
        };
        const entry = prov.assets.find(a => a.path === CITY_SCENE_ART_PATH);
        expect(entry, '자산 대장에 없다').toBeDefined();
        expect(entry!.license, '라이선스가 비었거나 미확인').toBeTruthy();
        expect(String(entry!.license).toUpperCase()).not.toContain('UNVERIFIED');
    });
});

describe('라벨 앵커', () => {
    it('건물 8종 모두 앵커가 있다', () => {
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
                expect(
                    Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y),
                    `앵커 ${i} 와 ${j} 가 겹친다`,
                ).toBeGreaterThan(8);
            }
        }
    });

    it('앵커 없는 타입은 종전 링으로 물러난다', () => {
        const a = anchorFor('UNKNOWN' as never, 0, 8);
        expect(Number.isFinite(a.x)).toBe(true);
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThanOrEqual(100);
    });
});

describe('computeCoverPlacement', () => {
    it('정확히 같은 비율이면 자르지 않는다', () => {
        const p = computeCoverPlacement(1672, 940, 1672, 940);
        expect(p.sx).toBe(0);
        expect(p.sy).toBe(0);
        expect(p.sw).toBe(1672);
        expect(p.sh).toBe(940);
    });

    it('더 좁은 무대로 보내면 위아래가 잘리고 대칭이다', () => {
        const p = computeCoverPlacement(1672, 940, 480, 240);
        expect(p.sw).toBeCloseTo(1672, 6);
        expect(p.sx).toBeCloseTo(0, 6);
        expect(p.sh).toBeLessThan(940);
        expect(p.sy).toBeCloseTo((940 - p.sh) / 2, 6);
    });

    it('배치가 항상 무대 크기를 덮는다', () => {
        for (const [w, h] of [[1672, 940], [1000, 1000], [400, 1200], [16, 9]] as Array<[number, number]>) {
            const p = computeCoverPlacement(w, h, 480, 240);
            expect(p.sw * p.scale, `${w}x${h} 가로 부족`).toBeGreaterThanOrEqual(480 - 1e-9);
            expect(p.sh * p.scale, `${w}x${h} 세로 부족`).toBeGreaterThanOrEqual(240 - 1e-9);
        }
    });

    it('크기가 0 이하면 예외를 던진다 — 조용히 빈 화면이 된다', () => {
        expect(() => computeCoverPlacement(0, 100, 480, 240)).toThrow();
        expect(() => computeCoverPlacement(100, 100, 0, 240)).toThrow();
    });
});
