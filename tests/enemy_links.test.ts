/**
 * 적대 세력 접점선 — 점선으로 그릴 적대 관계를 만든다.
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer, type MapCityView } from '../src/core/china_map_renderer';

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

const city = (id: string, x: number, y: number, owner: string, isPlayer = false): MapCityView => ({
    id, name: id, x, y, imageX: x, imageY: y,
    ownerColor: owner, isPlayer, garrison: 1000, population: 50000,
    hexCoord: { q: 0, r: 0 },
});

describe('적대 세력 접점선', () => {
    it('같은 세력끼리는 잇지 않는다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([
            city('a', 0.30, 0.50, '#111'),
            city('b', 0.32, 0.50, '#111'),
        ]);
        expect(r.getEnemyLinks(), '같은 세력 사이에 접점선이 생겼다').toHaveLength(0);
    });

    it('다른 세력끼리는 가장 가까운 하나로 잇는다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([
            city('a', 0.30, 0.50, '#111'),
            city('b', 0.34, 0.50, '#222'),
        ]);
        const links = r.getEnemyLinks();
        expect(links).toHaveLength(1);
        expect(Math.hypot(links[0].ax - links[0].bx, links[0].ay - links[0].by)).toBeCloseTo(0.04, 3);
    });

    it('A↔B 와 B↔A 는 한 번만 그린다 (중복 없음)', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([
            city('a', 0.30, 0.50, '#111'),
            city('b', 0.34, 0.50, '#222'),
        ]);
        expect(r.getEnemyLinks()).toHaveLength(1);
    });

    it('거리가 멀면 접점선을 그리지 않는다 (화면을 가로지르는 선 방지)', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([
            city('a', 0.10, 0.10, '#111'),
            city('b', 0.80, 0.80, '#222'),
        ]);
        expect(r.getEnemyLinks(), '원거리 세력이 연결되었다').toHaveLength(0);
    });

    it('가까운 적 세력이 있으면 그 도시를 고른다 (먼 도시 아님)', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([
            city('me', 0.30, 0.50, '#111'),
            city('near', 0.31, 0.50, '#222'),
            city('far', 0.38, 0.50, '#222'),
        ]);
        const links = r.getEnemyLinks();
        const touchesNear = links.some(l =>
            Math.hypot(l.ax - 0.31, l.ay - 0.50) < 1e-6 || Math.hypot(l.bx - 0.31, l.by - 0.50) < 1e-6);
        expect(touchesNear, '가장 가까운 적을 고르지 않았다').toBe(true);
    });

    it('아군이 닿아 있으면 involvesPlayer 로 표시된다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([
            city('me', 0.30, 0.50, '#111', true),
            city('foe', 0.34, 0.50, '#222'),
        ]);
        expect(r.getEnemyLinks()[0].involvesPlayer).toBe(true);
    });

    it('도시가 하나뿐이면 접점선이 없다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([city('a', 0.3, 0.5, '#111')]);
        expect(r.getEnemyLinks()).toHaveLength(0);
    });

    it('세력이 하나뿐이면 접점선이 없다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([
            city('a', 0.30, 0.50, '#111'),
            city('b', 0.34, 0.50, '#111'),
            city('c', 0.38, 0.50, '#111'),
        ]);
        expect(r.getEnemyLinks()).toHaveLength(0);
    });
});
