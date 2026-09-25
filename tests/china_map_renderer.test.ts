/**
 * 중국 전도 도시 클릭 좌표 히트 테스트 (모듈 단위)
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer, pointInPolygon } from '../src/core/china_map_renderer';
import type { MapCityView } from '../src/core/china_map_renderer';
import { CITY_IMAGE_ANCHORS, MAP_FEATURE_ANCHORS } from '../src/core/scenario_system';

function createMockCanvas(): HTMLCanvasElement {
    const canvas = {
        width: 1200,
        height: 700,
        getContext: () => ({
            clearRect: () => {},
            fillRect: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            closePath: () => {},
            fill: () => {},
            stroke: () => {},
            arc: () => {},
            rect: () => {},
            quadraticCurveTo: () => {},
            fillText: () => {},
            strokeText: () => {},
            measureText: () => ({ width: 20 }),
            createLinearGradient: () => ({ addColorStop: () => {} }),
            createRadialGradient: () => ({ addColorStop: () => {} }),
            setLineDash: () => {},
        }),
    } as unknown as HTMLCanvasElement;
    return canvas;
}

describe('ChinaMapRenderer', () => {
    it('제공된 1536×1024 도시·관문 좌표가 정규화 앵커로 등록되어 있다', () => {
        expect(CITY_IMAGE_ANCHORS['장안'].x).toBeCloseTo(487 / 1536, 5);
        expect(CITY_IMAGE_ANCHORS['장안'].y).toBeCloseTo(168 / 1024, 5);
        expect(CITY_IMAGE_ANCHORS['낙양'].x).toBeCloseTo(750 / 1536, 5);
        expect(CITY_IMAGE_ANCHORS['낙양'].y).toBeCloseTo(348 / 1024, 5);
        expect(MAP_FEATURE_ANCHORS['호로관']).toMatchObject({
            x: 634 / 1536,
            y: 145 / 1024,
            kind: 'PASS',
        });
        expect(MAP_FEATURE_ANCHORS['적벽'].kind).toBe('BATTLEFIELD');
    });

    it('도시 배치 후 화면 중앙 클릭 시 정규 좌표 변환 일관성', () => {
        const renderer = new ChinaMapRenderer(createMockCanvas());
        const cities: MapCityView[] = [
            { id: 'c1', name: '허창', x: 0.60, y: 0.40, ownerColor: '#2a5a8a', isPlayer: true, garrison: 10000 },
            { id: 'c2', name: '건업', x: 0.76, y: 0.55, ownerColor: '#b04a2a', isPlayer: false, garrison: 8000 },
        ];
        renderer.setCities(cities);

        // 정규→픽셀→정규 roundtrip (screenToNorm은 public)
        const norm = renderer.screenToNorm(600, 350);
        expect(norm.x).toBeCloseTo(0.5, 5);
        expect(norm.y).toBeCloseTo(0.46, 5);
    });

    it('이미지 앵커 좌표를 우선하여 도시를 1:1로 찾는다', () => {
        const renderer = new ChinaMapRenderer(createMockCanvas());
        renderer.setCities([
            { id: 'anchor', name: '도시', x: 0.10, y: 0.10, imageX: 0.60, imageY: 0.40, ownerColor: '#2a5a8a', isPlayer: true, garrison: 100 },
            { id: 'normal', name: '일반', x: 0.60, y: 0.40, ownerColor: '#2a5a8a', isPlayer: true, garrison: 100 },
        ]);
        const point = renderer.getCityScreenPosition('anchor')!;
        const normal = renderer.getCityScreenPosition('normal')!;
        expect(point).toEqual(normal);
        expect(renderer.cityAt(point.x, point.y)?.id).toBe('anchor');
    });

    it('캔버스 크기가 바뀌어도 정규화 앵커 위치를 유지한다', () => {
        const canvas = createMockCanvas();
        const renderer = new ChinaMapRenderer(canvas);
        renderer.setCities([
            { id: 'c1', name: '도시', x: 0.25, y: 0.60, imageX: 0.25, imageY: 0.60, hitRadius: 18, ownerColor: '#2a5a8a', isPlayer: true, garrison: 100 },
        ]);
        const before = renderer.getCityScreenPosition('c1')!;
        canvas.width = 600;
        canvas.height = 400;
        const after = renderer.getCityScreenPosition('c1')!;
        expect(after).not.toEqual(before);
        expect(renderer.cityAt(after.x, after.y)?.id).toBe('c1');
    });

    it('이미지 앵커가 없을 때 기존 도시 좌표를 사용한다', () => {
        const renderer = new ChinaMapRenderer(createMockCanvas());
        renderer.setCities([
            { id: 'c1', name: '허창', x: 0.60, y: 0.40, ownerColor: '#2a5a8a', isPlayer: true, garrison: 10000 },
        ]);
        const point = renderer.getCityScreenPosition('c1');
        expect(point).not.toBeNull();
        expect(renderer.cityAt(point!.x, point!.y)?.id).toBe('c1');
    });

    it('전체 도시 모드에서는 방문하지 않은 도시도 표시한다', () => {
        const renderer = new ChinaMapRenderer(createMockCanvas());
        renderer.setCities([
            { id: 'owned', name: '낙양', x: 0.50, y: 0.40, ownerColor: '#2a5a8a', isPlayer: true, isDiscovered: true, garrison: 100 },
            { id: 'unknown', name: '강릉', x: 0.70, y: 0.55, ownerColor: '#b04a2a', isPlayer: false, isDiscovered: false, garrison: 80 },
        ]);

        expect(renderer.getVisibleCityIds()).toEqual(['owned', 'unknown']);
        expect(renderer.getCityScreenPosition('unknown')).not.toBeNull();
    });

    it('발견 도시 모드에서는 방문 도시와 인접 도시를 표시한다', () => {
        const renderer = new ChinaMapRenderer(createMockCanvas());
        renderer.setCities([
            { id: 'visited', name: '청도', x: 0.50, y: 0.50, ownerColor: '#4a9a5a', isPlayer: false, isDiscovered: true, garrison: 80 },
            { id: 'adjacent', name: '강릉', x: 0.62, y: 0.55, ownerColor: '#b04a2a', isPlayer: false, isDiscovered: false, isAdjacentToDiscovered: true, garrison: 60 },
            { id: 'unknown', name: '동정', x: 0.80, y: 0.80, ownerColor: '#b04a2a', isPlayer: false, isDiscovered: false, garrison: 60 },
        ]);
        renderer.setDiscoveredOnly(true);

        expect(renderer.getVisibleCityIds()).toEqual(['visited', 'adjacent']);
        expect(renderer.getCityScreenPosition('adjacent')).not.toBeNull();
        expect(renderer.getCityScreenPosition('unknown')).toBeNull();
    });

    it('발견 도시 모드에서는 방문하지 않은 비소유 도시를 숨긴다', () => {
        const renderer = new ChinaMapRenderer(createMockCanvas());
        renderer.setCities([
            { id: 'owned', name: '낙양', x: 0.50, y: 0.40, ownerColor: '#2a5a8a', isPlayer: true, isDiscovered: true, garrison: 100 },
            { id: 'visited', name: '청두', x: 0.60, y: 0.50, ownerColor: '#b04a2a', isPlayer: false, isDiscovered: true, garrison: 80 },
            { id: 'unknown', name: '강릉', x: 0.70, y: 0.55, ownerColor: '#b04a2a', isPlayer: false, isDiscovered: false, garrison: 80 },
        ]);
        renderer.setDiscoveredOnly(true);

        expect(renderer.getVisibleCityIds()).toEqual(['owned', 'visited']);
        expect(renderer.getCityScreenPosition('unknown')).toBeNull();
        const point = renderer.getCityScreenPosition('visited');
        expect(point).not.toBeNull();
        expect(renderer.cityAt(point!.x, point!.y)?.id).toBe('visited');
    });

    it('pan 후 좌표가 이동한다', () => {
        const renderer = new ChinaMapRenderer(createMockCanvas());
        renderer.pan(50, 30);
        const norm = renderer.screenToNorm(600, 350);
        expect(norm.x).toBeLessThan(0.5);
        expect(norm.y).toBeLessThan(0.46);
    });

    it('pointInPolygon: 대륙 내부/외부 판정', () => {
        const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
        expect(pointInPolygon(0.5, 0.5, square)).toBe(true);
        expect(pointInPolygon(-0.1, 0.5, square)).toBe(false);
        expect(pointInPolygon(1.1, 0.5, square)).toBe(false);
    });

    it('zoomAt은 커서 아래 정규 좌표를 대략 보존한다', () => {
        const renderer = new ChinaMapRenderer(createMockCanvas());
        const before = renderer.screenToNorm(900, 500);
        renderer.zoomAt(1.2, 900, 500);
        const after = renderer.screenToNorm(900, 500);
        expect(after.x).toBeCloseTo(before.x, 1);
        expect(after.y).toBeCloseTo(before.y, 1);
    });
});
