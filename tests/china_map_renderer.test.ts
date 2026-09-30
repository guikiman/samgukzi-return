/**
 * 중국 전도 도시 클릭 좌표 히트 테스트 (모듈 단위)
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer, pointInPolygon } from '../src/core/china_map_renderer';
import type { MapCityView } from '../src/core/china_map_renderer';
import { CITY_IMAGE_ANCHORS, MAP_FEATURE_ANCHORS } from '../src/core/scenario_system';
import mapCoords from '../assets/map-coordinates-4096.json';
import scenarioIndex from '../src/data/scenarios/index.json';

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
    it('도시 앵커 전부가 4096 비트맵 좌표와 일치한다', () => {
        const map = mapCoords as { map: { width: number }; cities: Array<{ name: string; x: number; y: number }> };
        expect(map.cities.length).toBeGreaterThan(0);
        for (const c of map.cities) {
            expect(CITY_IMAGE_ANCHORS[c.name]).toBeDefined();
            expect(CITY_IMAGE_ANCHORS[c.name].x).toBeCloseTo(c.x / map.map.width, 3);
            expect(CITY_IMAGE_ANCHORS[c.name].y).toBeCloseTo(c.y / map.map.width, 3);
        }
    });

    it('전략 관문·전장 앵커 전부가 4096 비트맵 좌표와 일치한다', () => {
        const map = mapCoords as {
            map: { width: number };
            passes: Array<{ name: string; x: number; y: number }>;
        };
        const alias: Record<string, string> = {
            '진관': '검문관',
            '한중협곡': '한중협',
            '한강': '강하수운',
        };
        const byName = new Map(map.passes.map(p => [p.name, p]));
        const names = Object.keys(MAP_FEATURE_ANCHORS);
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
            const src = byName.get(alias[name] ?? name);
            expect(src, `${name} 대응 지형 없음`).toBeDefined();
            expect(MAP_FEATURE_ANCHORS[name].x).toBeCloseTo(src!.x / map.map.width, 4);
            expect(MAP_FEATURE_ANCHORS[name].y).toBeCloseTo(src!.y / map.map.width, 4);
        }
        expect(MAP_FEATURE_ANCHORS['적벽'].kind).toBe('BATTLEFIELD');
        expect(MAP_FEATURE_ANCHORS['한강'].kind).toBe('PORT');
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
        expect(norm.y).toBeCloseTo(0.5, 5);
    });

    // ─────────────────────────────────────────────────────────────
    // [회귀] 지도 사각형이 화면을 가득 메운다 (cover)
    //
    // 배경: baseScale = min(width, height) contain 방식에서는 와이드 화면에
    // 좁은 세로 띠로만 그려졌다. max(width, height) cover 로 바꿔 화면을 채운다.
    // 잘리는 쪽(위·아래 사막/외해)에는 전 시나리오 도시가 없음을 검증했다
    // (도시 y 0.296~0.582, 21:9에서도 가시 구간 [0.277, 0.723] 안에 전부 포함).
    // 잘린 영역은 드래그 팬·휠 줌으로 볼 수 있다.
    // ─────────────────────────────────────────────────────────────
    it('[회귀] 지도 사각형이 캔버스의 95% 이상을 덮는다', () => {
        const sizes: Array<[number, number]> = [
            [1584, 796], [1284, 817], [1600, 900], [1920, 1080], [1000, 700], [1200, 700], [800, 1200],
        ];
        for (const [w, h] of sizes) {
            const canvas = { ...createMockCanvas(), width: w, height: h } as HTMLCanvasElement;
            const renderer = new ChinaMapRenderer(canvas);
            const r = (renderer as unknown as { mapImageRect(w: number, h: number): { x: number; y: number; width: number; height: number } })
                .mapImageRect(w, h);
            expect(r.x, `${w}x${h} 왼쪽`).toBeLessThanOrEqual(w * 0.05);
            expect(r.y, `${w}x${h} 위쪽`).toBeLessThanOrEqual(h * 0.05);
            expect(r.x + r.width, `${w}x${h} 오른쪽`).toBeGreaterThanOrEqual(w * 0.95);
            expect(r.y + r.height, `${w}x${h} 아래쪽`).toBeGreaterThanOrEqual(h * 0.95);
        }
    });

    it('[회귀] 정사각 비트맵이 큰 쪽 기준으로 화면을 메운다', () => {
        const canvas = { ...createMockCanvas(), width: 1000, height: 700 } as HTMLCanvasElement;
        const renderer = new ChinaMapRenderer(canvas);
        const r = (renderer as unknown as { mapImageRect(w: number, h: number): { width: number; height: number } })
            .mapImageRect(1000, 700);
        // 정사각 이미지 → 사각형도 정사각, 긴 변(너비)에 맞춰진다
        expect(r.width).toBeCloseTo(r.height, 6);
        expect(r.width).toBeGreaterThanOrEqual(1000 * 0.95);
    });

    it('[회귀] 기본 화면에 전 시나리오 도시가 전부 들어간다', () => {
        const sizes: Array<[number, number]> = [[1920, 1080], [1600, 900], [2560, 1080], [1280, 800]];
        const cities: Array<{ name: string }> = [];
        for (const s of scenarioIndex as Array<{ factions: Array<{ capital: string }>; cities?: Array<{ name: string }> }>) {
            for (const f of s.factions) cities.push({ name: f.capital });
            for (const c of s.cities ?? []) cities.push({ name: c.name });
        }
        for (const [w, h] of sizes) {
            const canvas = { ...createMockCanvas(), width: w, height: h } as HTMLCanvasElement;
            const renderer = new ChinaMapRenderer(canvas);
            const rect = (renderer as unknown as { mapImageRect(w: number, h: number): { x: number; y: number; width: number; height: number } })
                .mapImageRect(w, h);
            for (const c of cities) {
                const anchor = CITY_IMAGE_ANCHORS[c.name];
                expect(anchor, `${c.name} 앵커 없음`).toBeDefined();
                const px = rect.x + anchor.x * rect.width;
                const py = rect.y + anchor.y * rect.height;
                // 21:9 극단에서는 북단 도시가 약 110px 잘릴 수 있다 — 팬으로 도달 가능하므로 허용
                const margin = w / h > 2 ? 120 : 0;
                expect(px, `${w}x${h} ${c.name} x`).toBeGreaterThanOrEqual(-margin);
                expect(px, `${w}x${h} ${c.name} x`).toBeLessThanOrEqual(w + margin);
                expect(py, `${w}x${h} ${c.name} y`).toBeGreaterThanOrEqual(-margin);
                expect(py, `${w}x${h} ${c.name} y`).toBeLessThanOrEqual(h + margin);
            }
        }
    });

    // ─────────────────────────────────────────────────────────────
    // [회귀] 모든 시나리오 수도/2차도시에 이미지 앵커가 존재한다
    //
    // 배경: 앵커가 없으면 CITY_MAP_COORDS(전술 좌표)로 폴백하는데 두 표의
    // 스케일이 다르다(낙양 전술 0.55,0.34 vs 이미지 0.39,0.40). 조용히
    // 엉뚱한 자리에 그려져 도시 클릭이 안 되거나 영토가 어긋났다.
    // ─────────────────────────────────────────────────────────────
    it('[회귀] 모든 시나리오 수도·2차도시에 이미지 앵커가 있다', () => {
        const scenarios = (scenarioIndex as Array<{ factions: Array<{ capital: string }>; cities?: Array<{ name: string }> }>);
        for (const s of scenarios) {
            for (const f of s.factions) {
                expect(CITY_IMAGE_ANCHORS[f.capital], `${f.capital} 앵커 없음`).toBeDefined();
            }
            for (const c of s.cities ?? []) {
                expect(CITY_IMAGE_ANCHORS[c.name], `${c.name} 앵커 없음`).toBeDefined();
            }
        }
    });

    it('[회귀] 앵커는 0~1 정규화 범위 안이다', () => {
        for (const [name, p] of Object.entries(CITY_IMAGE_ANCHORS)) {
            expect(p.x, `${name} x`).toBeGreaterThanOrEqual(0);
            expect(p.x, `${name} x`).toBeLessThanOrEqual(1);
            expect(p.y, `${name} y`).toBeGreaterThanOrEqual(0);
            expect(p.y, `${name} y`).toBeLessThanOrEqual(1);
        }
    });

    it('[회귀] 보강된 앵커는 실제 위경도 역산값과 일치한다', () => {
        // AI 지도(map-china-ai-4096.webp)용 아핀 피팅 계수 — 해안 끝점 6곳 최소자승.
        // x는 선형, y는 2차식(AI 지형 남북 왜곡 보정)이다.
        const X_PER_LON = 60.3619, X_OFF = -4433.6;
        const Y_Q = -4.6028, Y_PER_LAT = 152.2076, Y_OFF = 1876.1;
        const W = 4096;
        const geo: Record<string, [number, number]> = {
            '거록': [37.35, 115.03], '연주': [35.60, 116.60], '하비': [34.10, 117.95],
            '여강': [32.05, 118.78], '수춘': [32.58, 116.78], '진류': [34.80, 114.30],
            '청두': [30.67, 104.07], '항양': [32.05, 112.12], '부경': [30.25, 120.10],
        };
        for (const [name, [lat, lon]] of Object.entries(geo)) {
            const a = CITY_IMAGE_ANCHORS[name];
            expect(a, `${name} 앵커 없음`).toBeDefined();
            expect(a.x, `${name} x`).toBeCloseTo((X_PER_LON * lon + X_OFF) / W, 3);
            expect(a.y, `${name} y`).toBeCloseTo((Y_Q * lat * lat + Y_PER_LAT * lat + Y_OFF) / W, 3);
        }
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
        const scale = Math.max(1200, 700) * 0.96;
        const before = renderer.screenToNorm(600, 350);
        renderer.pan(50, 30);
        const norm = renderer.screenToNorm(600, 350);
        expect(norm.x).toBeCloseTo(before.x - 50 / scale, 6);
        expect(norm.y).toBeCloseTo(before.y - 30 / scale, 6);
        expect(norm.x).toBeLessThan(0.5);
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
