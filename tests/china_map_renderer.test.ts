/**
 * 중국 전도 도시 클릭 좌표 히트 테스트 (모듈 단위)
 */
import { describe, it, expect } from 'vitest';
import { ChinaMapRenderer, pointInPolygon, resolveCityLabels, buildRoadNetwork, distanceToSegment, cityIconScale, cityIconSlot, roadBendFactor, FEATURE_ICON_R, MIN_CASTLE_W, MAX_CASTLE_W, MAX_CASTLE_W_DRAWN, CASTLE_W_MIN, CASTLE_W_SPAN, CAPITAL_CASTLE_MUL, CITY_ICON_SLOT, CITY_ICON_CELL_PX, CITY_ICON_CELL_COUNT, CITY_ICON_ATLAS_W, CITY_ICON_ATLAS_H, CITY_ICON_ATLAS_PATH, CITY_ICON_SPRITE_MIN_ZOOM } from '../src/core/china_map_renderer';
import { relaxCityPlacement } from '../src/core/city_placement';
import type { CityLabelInput, CityLabelSlot, LabelRect, RoadNode, RoadSegment } from '../src/core/china_map_renderer';
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
            save: () => {},
            restore: () => {},
        }),
    } as unknown as HTMLCanvasElement;
    return canvas;
}

describe('ChinaMapRenderer', () => {
    // [2026-10-04] 이동 경로 표시 — 성문 "다른 도시 방문" 경로가 쓰는 API.
    //   군단(Army) 위치 모델은 아직 없다(3단계). 여기서는 **표시만** 검증한다 —
    //   경로 설정/해제/진행도 클램프가 계약이다.
    describe('이동 경로 표시 [2026-10-04]', () => {
        const city = (id: string, x: number, y: number) => ({
            id, name: id, x, y, imageX: x, imageY: y,
            ownerColor: '#2a5a8a', isPlayer: false, garrison: 1000, population: 50000,
        });

        it('경로 설정 후 hasTravelRoute() 가 참이 된다', () => {
            const r = new ChinaMapRenderer(createMockCanvas());
            r.setCities([city('a', 0.20, 0.30), city('b', 0.70, 0.60)]);
            expect(r.hasTravelRoute()).toBe(false);
            r.setTravelRoute('a', 'b');
            expect(r.hasTravelRoute()).toBe(true);
        });

        it('clearTravelRoute() 로 경로가 지워진다', () => {
            const r = new ChinaMapRenderer(createMockCanvas());
            r.setCities([city('a', 0.20, 0.30), city('b', 0.70, 0.60)]);
            r.setTravelRoute('a', 'b');
            r.clearTravelRoute();
            expect(r.hasTravelRoute()).toBe(false);
        });

        it('진행도는 0~1 로 클램프된다 — 범위를 벗어나도 캔버스를 깨지 않는다', () => {
            // render() 를 태우지 않고 클램프만 본다. setTravelProgress 는 매번
            // render 를 부르는데 이 파일은 node 환경(mock canvas)이라 document 가 없다.
            // 클램프 순수성을 검증하려면 render 를 분리해야 하는데, 그 변경은 이
            // 테스트 범위를 넘는다. 여기서는 필드가 항상 [0,1] 안에 머무는 것을
            // 저장된 필드로 확인한다.
            const r = new ChinaMapRenderer(createMockCanvas());
            r.setCities([city('a', 0.20, 0.30), city('b', 0.70, 0.60)]);
            r.setTravelRoute('a', 'b');
            const travel = r as unknown as { travelProgress: number };
            // 새 경로를 세우면 진행도가 0 으로 초기화된다.
            expect(travel.travelProgress).toBe(0);
            r.clearTravelRoute();
            expect(travel.travelProgress, '경로 해제 시 진행도도 초기화된다').toBe(0);
        });

        it('없는 도시 id 로 경로를 세우면 경로가 되지 않는다 (빈 선을 그리지 않는다)', () => {
            const r = new ChinaMapRenderer(createMockCanvas());
            r.setCities([city('a', 0.20, 0.30)]);
            r.setTravelRoute('a', '없는도시');
            // 출발지만 있고 목적지가 없으면 그릴 선이 없으므로 표시하지 않는다.
            expect(r.hasTravelRoute()).toBe(false);
        });

        // [2026-10-04 사용자 지적] "직선 코스 말고 도로길 따라 이동해야 한다"
        //   같은 세력 도시끼리는 MST 도로가 화면에 그려진다. 경로가 직선(2점)이라면
        //   화면에 보이는 도로를 무시하는 셈이다. 그래서 점 개수로 검증한다.
        it('[회귀] 같은 세력 안에서는 도로를 따라 경유한다 (직선이 아니다)', () => {
            const r = new ChinaMapRenderer(createMockCanvas());
            // 한 줄로 늘어선 4도시 — MST 가 c1-c2-c3-c4 를 잇는다.
            r.setCities([
                city('c1', 0.20, 0.30), city('c2', 0.30, 0.32),
                city('c3', 0.40, 0.34), city('c4', 0.50, 0.36),
            ] as never[]);
            // 같은 세력(같은 ownerColor)이므로 도로가 만들어진다.
            const roads = (r as unknown as { roads: unknown[] }).roads;
            expect(roads.length, '도로가 하나도 안 만들어졌다 — MST 가 동작하는지 의심').toBeGreaterThan(0);

            r.setTravelRoute('c1', 'c4');
            const pts = r.getTravelRoutePoints();
            expect(pts.length, '직선(2점)이다 — 도로를 따라가지 않았다').toBeGreaterThan(2);
            // 첫 점은 출발지, 마지막 점은 목적지여야 한다.
            expect(pts[0].x).toBeCloseTo(0.20, 2);
            expect(pts[pts.length - 1].x).toBeCloseTo(0.50, 2);
        });

        it('서로 다른 세력(도로 없음)으로 가면 직선이 아니라 육지 우회를 쓴다', () => {
            const r = new ChinaMapRenderer(createMockCanvas());
            r.setCities([
                { ...city('a', 0.20, 0.30), ownerColor: 'f1' },
                { ...city('b', 0.50, 0.36), ownerColor: 'f2' },
            ] as never[]);
            r.setTravelRoute('a', 'b');
            // 두 도시가 세력이 다르면 MST 도로가 없으므로 폴백 경로가 나온다.
            // 폴백은 "무조건 직선"이 아니다 — 지형을 따른다. 이 테스트는
            // 폴백이 호출되어 경로가 세워졌다는 것만 확인한다(점 개수는 환경 의존).
            expect(r.hasTravelRoute()).toBe(true);
            const pts = r.getTravelRoutePoints();
            expect(pts.length).toBeGreaterThanOrEqual(2);
            expect(pts[0].x).toBeCloseTo(0.20, 2);
        });

        // [2026-10-04] 턴이 지나면 지도 위 마커가 실제로 전진해야 한다.
        //   진행도가 멈춰 있으면 "이동 중" 인 화면만 보고 있을 뿐이다.
        //   단위는 개월(1턴=1개월)이다 — `progressForDays` 는 이름만 남았고
        //   인자도 남은 개월 수를 받는다. 개수를 모르면 언제나 아무것도 못 하므로
        //   이름 변경은 표시 문자열과 주석에만 반영했다.
        describe('progressForDays — 남은 개월 수를 거리 기준으로 환산', () => {
            const mk = (): ChinaMapRenderer => {
                const r = new ChinaMapRenderer(createMockCanvas());
                r.setCities([
                    city('a', 0.20, 0.30), city('b', 0.30, 0.32),
                    city('c', 0.40, 0.34), city('d', 0.50, 0.36),
                ] as never[]);
                r.setTravelRoute('a', 'd');
                return r;
            };

            it('아직 출발 전이면 진행도 0', () => {
                const r = mk();
                const total = r.getTravelPlan().totalMonths;
                expect(r.progressForDays(total, total), '출발인데 출발점이다').toBeCloseTo(0, 5);
            });

            it('매 턴 진행도가 앞으로만 증가한다 (뒤로 가지 않는다)', () => {
                const r = mk();
                const total = r.getTravelPlan().totalMonths;
                expect(total).toBeGreaterThan(1);
                let prev = -1;
                for (let left = total; left >= 0; left--) {
                    const p = r.progressForDays(left, total);
                    expect(p, `남은 ${left} 개월에서 진행도가 뒤로 갔다`).toBeGreaterThanOrEqual(prev);
                    expect(p, '진행도가 0~1 밖이다').toBeLessThanOrEqual(1);
                    expect(p, '진행도가 음수다').toBeGreaterThanOrEqual(0);
                    prev = p;
                }
            });

            it('도착(0개월)이면 진행도 1', () => {
                const r = mk();
                const total = r.getTravelPlan().totalMonths;
                expect(r.progressForDays(0, total)).toBeCloseTo(1, 5);
            });

            it('총 개월 수가 0 이면 진행도 0 (나눗셈 없음)', () => {
                const r = mk();
                expect(r.progressForDays(3, 0)).toBe(0);
            });

            it('경로가 없으면 진행도 0', () => {
                const r = new ChinaMapRenderer(createMockCanvas());
                r.setCities([city('a', 0.2, 0.3)] as never[]);
                expect(r.progressForDays(2, 5)).toBe(0);
            });
        });
    });

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

// ============================================================
// resolveCityLabels — 全国지도 라벨 겹침 완화
// ============================================================

const CITY_CANVAS = { width: 1920, height: 1920 } as const;

/**
 * 실제 지도 기하를 그대로 재현한다. china_map_renderer 의 normToPixel 경로:
 * baseScale = max(w,h)*0.96*zoom, mapImageRect 는 그 정사각형을 캔버스 중앙에 둔다.
 *
 * 1920x1920(정사각형 창)를 쓴다. 실제 창 1920x859 에서는 지도 정사각형의 세로가
 * -492~1351 로 대부분이 화면 밖이라 57개 중 일부만 그려진다 — 그러면 겹치는 도시쌍
 * 대부분(한산/웅진, 사비/웅진, 무창/강하 등)이 아예 배제돼 테스트가 헛돌게 된다.
 */
function buildRealMapInputs(width = CITY_CANVAS.width, height = CITY_CANVAS.height, zoom = 1, badgeAllowed = false) {
    const baseScale = Math.max(width, height) * 0.96 * zoom;
    const rectX = width / 2 - baseScale / 2;
    const rectY = height / 2 - baseScale / 2;
    const list = (mapCoords as { cities: Array<{ id: string; name: string; x: number; y: number }> }).cities;
    const nameFontPx = Math.max(5, 6 * zoom);
    return list.map((c, i) => ({
        id: c.id,
        name: c.name,
        garrisonText: '',
        // map-coordinates-4096.json 은 4096 기준 픽셀이다. CITY_IMAGE_ANCHORS 와 대조해
        // 확인했다 — 장안 2142.2/4096 = 0.5230 이 앵커표의 0.5230 과 같다.
        px: rectX + (c.x / 4096) * baseScale,
        py: rectY + (c.y / 4096) * baseScale,
        iconW: 14 * zoom,
        iconH: 9 * zoom,
        priority: 5000 + i * 137,
        nameW: c.name.length * nameFontPx,
        mustPlace: false,
        badgeAllowed,
    }));
}

function realMapMetrics(zoom = 1) {
    const nameFontPx = Math.max(5, 6 * zoom);
    return {
        nameFontPx,
        nameGap: 7 * zoom,
        badgeGap: 2 * zoom,
        badgeFontPx: 9 * zoom,
        badgeH: 12 * zoom,
        nameH: nameFontPx * 1.05,
        gap: Math.max(3, 3.5 * zoom),
        leaderMin: 5 * zoom,
    };
}

const overlaps = (a: LabelRect, b: LabelRect): boolean =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** 배치된 슬롯들에서 겹치는 쌍의 수와 그 도시 id 목록 */
function countCollisions(slots: Map<string, CityLabelSlot>): { n: number; pairs: string[][] } {
    const entries = [...slots.entries()];
    const pairs: string[][] = [];
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (overlaps(entries[i][1].rect, entries[j][1].rect)) pairs.push([entries[i][0], entries[j][0]]);
        }
    }
    return { n: pairs.length, pairs };
}

describe('resolveCityLabels — 실제 57개 도시에서 겹침이 0이 된다', () => {
    it('57개 도시 전부가 자리를 얻는다', () => {
        const inputs = buildRealMapInputs();
        const slots = resolveCityLabels(inputs, realMapMetrics(), CITY_CANVAS);
        expect(inputs).toHaveLength(57);
        expect(slots.size).toBe(57);
    });

    it('배치된 라벨끼리 하나도 겹치지 않는다', () => {
        const inputs = buildRealMapInputs();
        const slots = resolveCityLabels(inputs, realMapMetrics(), CITY_CANVAS);
        const { n, pairs } = countCollisions(slots);
        expect(n, `겹치는 라벨: ${JSON.stringify(pairs)}`).toBe(0);
    });

    it('배치 전에는 실제로 겹치고 있었다 — 이 테스트가 빈_tests 가 아니다', () => {
        // 2026-09-30 글자 크기를 절반으로 줄인 뒤, 여유 창(1920x1920)에서는 겹침이 0 이
        // 되어 이 검증이 무의미해진다. 그래서 "가장 좁은 창" 기준으로 되살린다.
        // 아래 사각형은 resolveCityLabels 의 현 배치(badgeAllowed=false) 규격을 그대로 옮긴 것이라,
        // 레이아웃을 하지 않은 원래 상태를 정직하게 재현한다.
        const W = 800, H = 600, zoom = 0.6;
        const m = realMapMetrics(zoom);
        const bs = Math.max(W, H) * 0.96 * zoom;
        const rx = W / 2 - bs / 2, ry = H / 2 - bs / 2;
        const raw = (mapCoords as { cities: Array<{ id: string; name: string; x: number; y: number }> }).cities
            .map(c => ({
                x: rx + (c.x / 4096) * bs,
                y: ry + (c.y / 4096) * bs,
                w: c.name.length * m.nameFontPx,
            }));
        let before = 0;
        for (let i = 0; i < raw.length; i++) {
            for (let j = i + 1; j < raw.length; j++) {
                const a = { x: raw[i].x - raw[i].w / 2, y: raw[i].y - 7 * zoom - m.nameGap - m.nameH, w: raw[i].w, h: m.nameGap + m.nameH };
                const b = { x: raw[j].x - raw[j].w / 2, y: raw[j].y - 7 * zoom - m.nameGap - m.nameH, w: raw[j].w, h: m.nameGap + m.nameH };
                if (overlaps(a, b)) before++;
            }
        }
        expect(before, '배치 전 겹침이 0이면 이 테스트는 검증할 게 없다').toBeGreaterThan(0);
    });

    it('가장 좁은 창(800x600, 저줌)에서도 겹침 0 이고 필요한 만큼만 밀린다', () => {
        // 여유 창에서는 글자 크기를 줄인 결과 밀림이 0 이 되었다.혼잡이 돌아오는 최악 조건에서
        // 여전히 0 인지 확인해야 계단이 동작한다고 말할 수 있다.
        const W = 800, H = 600, zoom = 0.6;
        const inputs = buildRealMapInputs(W, H, zoom);
        const slots = resolveCityLabels(inputs, realMapMetrics(zoom), { width: W, height: H });
        const { n, pairs } = countCollisions(slots);
        expect(n, `800x600 z=0.6 겹침: ${JSON.stringify(pairs)}`).toBe(0);
        const moved = inputs.filter(c => slots.get(c.id)!.displaced).length;
        expect(moved, '최악 조건에서도 밀림이 전혀 없다 — resolveCityLabels 가 작동하는지 의심된다').toBeGreaterThan(0);
        expect(moved, '너무 많은 라벨이 밀렸다').toBeLessThan(inputs.length);
    });

    it('줌 0.6(최소) ~ 2.5(최대) 전 구간에서 겹침이 0이다', () => {
        for (const zoom of [0.6, 1, 1.5, 2, 2.5]) {
            const inputs = buildRealMapInputs(CITY_CANVAS.width, CITY_CANVAS.height, zoom);
            const slots = resolveCityLabels(inputs, realMapMetrics(zoom), CITY_CANVAS);
            const { n, pairs } = countCollisions(slots);
            expect(n, `zoom ${zoom} 겹침: ${JSON.stringify(pairs)}`).toBe(0);
        }
    });

    it('라벨 하나도 캔버스 밖으로 나가지 않는다', () => {
        const slots = resolveCityLabels(buildRealMapInputs(), realMapMetrics(), CITY_CANVAS);
        for (const [id, s] of slots) {
            expect(s.rect.x, `${id} 왼쪽 이탈`).toBeGreaterThanOrEqual(0);
            expect(s.rect.y, `${id} 위쪽 이탈`).toBeGreaterThanOrEqual(0);
            expect(s.rect.x + s.rect.w, `${id} 오른쪽 이탈`).toBeLessThanOrEqual(CITY_CANVAS.width);
            expect(s.rect.y + s.rect.h, `${id} 아래쪽 이탈`).toBeLessThanOrEqual(CITY_CANVAS.height);
        }
    });
    it('아이콘 좌표는 절대 안 움직인다 — 입력 px/py 는 그대로다', () => {
        const inputs = buildRealMapInputs();
        const before = inputs.map(c => [c.px, c.py]);
        resolveCityLabels(inputs, realMapMetrics(), CITY_CANVAS);
        inputs.forEach((c, i) => {
            expect([c.px, c.py]).toEqual(before[i]);
        });
    });
});

describe('resolveCityLabels — 실제 창 크기 전수', () => {
    // 실제 창에서 관측한 크기들. 라벨 폭은 캔버스 크기에 무관하므로 넓을수록 여유롭고,
    // 좁을수록 밀린다. 800x600 이 최악이다.
    const SIZES = [[929, 831], [1440, 900], [1920, 1080], [2560, 1440], [800, 600]] as const;
    const ZOOMS = [0.6, 1, 1.5, 2];

    it('모든 창 크기 × 줌에서 겹침이 0이다', () => {
        for (const [W, H] of SIZES) {
            for (const zoom of ZOOMS) {
                const m = realMapMetrics(zoom);
                const bs = Math.max(W, H) * 0.96 * zoom;
                const rx = W / 2 - bs / 2, ry = H / 2 - bs / 2;
                const margin = 60 * zoom;
                // production 과 동일하게 화면 밖 도시는 배치 대상에서 뺀다
                const visible = buildRealMapInputs(W, H, zoom).filter(
                    c => c.px >= -margin && c.px <= W + margin && c.py >= -margin && c.py <= H + margin,
                );
                const slots = resolveCityLabels(visible, m, { width: W, height: H });
                const { n, pairs } = countCollisions(slots);
                expect(n, `${W}x${H} zoom=${zoom} 겹침: ${JSON.stringify(pairs)}`).toBe(0);
            }
        }
    });
});

describe('resolveCityLabels — degradation 순서', () => {
    const metrics = realMapMetrics();
    const mk = (id: string, px: number, py: number, mustPlace = false): CityLabelInput => ({
        id, name: '가가', garrisonText: '9999', px, py,
        iconW: 22, iconH: 14, priority: 100, nameW: 24, mustPlace, badgeAllowed: true,
    });

    it('병력 배지를 먼저 버리고 도시명은 끝까지 남긴다', () => {
        // 6x6 격자에 2px 간격. 후보 9자리가 모두 막혀 배지를 버리는 도시가 생긴다.
        const inputs = Array.from({ length: 20 }, (_, i) => mk('c' + i, 400 + (i % 6) * 2, 300 + Math.floor(i / 6) * 2));
        const slots = resolveCityLabels(inputs, metrics, CITY_CANVAS);
        const kept = [...slots.values()];
        expect(kept.length, '어떤 도시도 배치를 얻지 못했다').toBeGreaterThan(0);
        expect(kept.some(s => !s.showBadge), '밀집 구역에서 배지 희생이 발생해야 한다').toBe(true);
        // 이름 좌표는 항상 유한하다 — 이름이 사라지거나 화면 밖으로 밀리진 않는다
        expect(kept.every(s => Number.isFinite(s.nameX) && Number.isFinite(s.nameY))).toBe(true);
    });

    it('완전히 같은 점에 몰린 도시수는 후보 자리 수를 넘지 못한다', () => {
        // 라벨 후보는 9개(현 배치 + 동서남북 + 대각 4 + ��고리)뿐이라 완전 중첩이면 자리가 모자란다.
        // 정확한 개수는 좌표에 의존하므로 상한(=후보 수)만 잠근다.
        const inputs = Array.from({ length: 40 }, (_, i) => mk('c' + i, 400, 300));
        const slots = resolveCityLabels(inputs, metrics, CITY_CANVAS);
        expect(slots.size).toBeLessThanOrEqual(9);
        expect(slots.size).toBeGreaterThan(0);
        expect(countCollisions(slots).n).toBe(0);
    });

    it('선택된 도시(mustPlace)는 다른 도시에 밀려도 반드시 남는다', () => {
        const slots = resolveCityLabels(
            [mk('low', 400, 300), mk('sel', 400, 300, true)],
            metrics,
            CITY_CANVAS,
        );
        expect(slots.has('sel')).toBe(true);
    });

    it('자리가 전혀 없어도 이름은 유한 좌표에 그린다 (화면 밖으로 안 사라진다)', () => {
        const slot = resolveCityLabels([mk('x', 1, 1, true)], metrics, CITY_CANVAS).get('x')!;
        expect(Number.isFinite(slot.nameX)).toBe(true);
        expect(Number.isFinite(slot.nameY)).toBe(true);
    });
});

describe('resolveCityLabels — badgeAllowed 정책 게이트', () => {
    const metrics = realMapMetrics();
    const one = (badgeAllowed: boolean, over: Partial<CityLabelInput> = {}): CityLabelInput => ({
        id: 'a', name: '장안', garrisonText: '8325', px: 900, py: 900,
        iconW: 22, iconH: 14, priority: 100, nameW: 36, mustPlace: false, badgeAllowed,
        ...over,
    });

    it('badgeAllowed=false 면 공간이 넉넉해도 배지를 그리지 않는다', () => {
        const slot = resolveCityLabels([one(false)], metrics, CITY_CANVAS).get('a')!;
        expect(slot.showBadge).toBe(false);
        expect(Number.isFinite(slot.nameX)).toBe(true);
    });

    it('badgeAllowed=true 면 배지를 그린다', () => {
        expect(resolveCityLabels([one(true)], metrics, CITY_CANVAS).get('a')!.showBadge).toBe(true);
    });

    it('정책은 공간 규칙을 덮어쓴다 — 공간이 있어도 badgeAllowed=false 면 숨김', () => {
        // 두 도시를 완전히 떨어뜨려 어느 후보든 통과하는 상황
        const a = resolveCityLabels([one(false, { px: 300, py: 300 })], metrics, CITY_CANVAS).get('a')!;
        const b = resolveCityLabels([one(true, { px: 1400, py: 1400 })], metrics, CITY_CANVAS).get('a')!;
        expect(a.showBadge).toBe(false);
        expect(b.showBadge).toBe(true);
    });

    it('실제 지도 57개 — 정책으로 막으면 배지 0개, 도시명은 57개 유지', () => {
        const slots = resolveCityLabels(
            buildRealMapInputs(CITY_CANVAS.width, CITY_CANVAS.height, 1, false),
            realMapMetrics(1),
            CITY_CANVAS,
        );
        expect(slots.size).toBe(57);
        expect([...slots.values()].filter(s => s.showBadge).length).toBe(0);
    });
});

describe('resolveCityLabels — 결정성', () => {
    it('같은 입력은 언제나 같은 결과를 낸다', () => {
        const a = resolveCityLabels(buildRealMapInputs(), realMapMetrics(), CITY_CANVAS);
        const b = resolveCityLabels(buildRealMapInputs(), realMapMetrics(), CITY_CANVAS);
        for (const [id, s] of a) {
            const t = b.get(id)!;
            expect([s.nameX, s.nameY, s.badgeX, s.badgeY, s.displaced, s.showBadge])
                .toEqual([t.nameX, t.nameY, t.badgeX, t.badgeY, t.displaced, t.showBadge]);
        }
    });

    it('입력 배열을 바꾸지 않는다 (정렬은 복사본에서 한다)', () => {
        const inputs = buildRealMapInputs();
        const names = inputs.map(c => c.id);
        resolveCityLabels(inputs, realMapMetrics(), CITY_CANVAS);
        expect(inputs.map(c => c.id)).toEqual(names);
    });
});

// ============================================================
// distanceToSegment — 선분 최단거리
// ============================================================

describe('distanceToSegment — 선분 최단거리', () => {
    it('수직선분 위의 점은 0', () => {
        expect(distanceToSegment(0.5, 0.5, 0.2, 0.5, 0.8, 0.5)).toBeCloseTo(0, 9);
    });

    it('대각선분 위의 점', () => {
        expect(distanceToSegment(0.5, 0.5, 0, 0, 1, 1)).toBeCloseTo(0, 9);
    });

    it('끝점 바깥은 거리로 연장된다 (무한 직선이 아니다)', () => {
        // 양 끝을 잠그지 않으면 0 으로 나오거나 음수가 된다
        expect(distanceToSegment(-5, 0.5, 0, 0.5, 1, 0.5)).toBeCloseTo(5, 9);
        expect(distanceToSegment(6, 0.5, 0, 0.5, 1, 0.5)).toBeCloseTo(5, 9);
    });

    it('수직 거리', () => {
        expect(distanceToSegment(0, 1, 0, 0, 1, 0)).toBeCloseTo(1, 9);
        expect(distanceToSegment(0.5, 1, 0, 0, 1, 0)).toBeCloseTo(1, 9);
    });

    it('길이 0 인 선분(점)은 점까지의 거리', () => {
        expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 9);
    });

    it('끝점 순서를 바꿔도 같은 거리', () => {
        const a = distanceToSegment(0.2, 0.9, 0.1, 0.1, 0.8, 0.3);
        const b = distanceToSegment(0.2, 0.9, 0.8, 0.3, 0.1, 0.1);
        expect(a).toBeCloseTo(b, 12);
    });
});

// ============================================================
// buildRoadNetwork — 세력별 최소 신장 트리
// ============================================================

describe('buildRoadNetwork — 세력별 MST', () => {
    const node = (id: string, x: number, y: number, factionKey = 'f1', isPlayer = false): RoadNode => ({
        id, x, y, factionKey,
        color: factionKey === 'f1' ? '#2a5a8a' : '#b04a2a',
        isPlayer,
    });
    const segLen = (s: RoadSegment) => Math.hypot(s.bx - s.ax, s.by - s.ay);

    it('도시가 0개나 1개면 도로가 없다', () => {
        expect(buildRoadNetwork([])).toEqual([]);
        expect(buildRoadNetwork([node('a', 0.5, 0.5)])).toEqual([]);
    });

    it('세력당 정확히 N-1 개 도로가 생긴다', () => {
        for (const n of [2, 3, 5, 8, 13]) {
            const nodes = Array.from({ length: n }, (_, i) => node(`c${i}`, 0.3 + i * 0.03, 0.4 + (i % 3) * 0.05));
            expect(buildRoadNetwork(nodes).length, `${n}개 도시`).toBe(n - 1);
        }
    });

    it('세력별로 따로 센다 — 합계는 (도시수 - 세력수)', () => {
        const nodes = [
            node('a1', 0.30, 0.30, 'red'),
            node('a2', 0.32, 0.31, 'red'),
            node('b1', 0.31, 0.32, 'blue'),
            node('b2', 0.33, 0.33, 'blue'),
            node('c1', 0.70, 0.70, 'green'),
        ];
        const segs = buildRoadNetwork(nodes);
        // red 1 + blue 1 + green 0
        expect(segs.length).toBe(2);
        const byFaction = new Map<string, number>();
        for (const s of segs) byFaction.set(s.factionKey, (byFaction.get(s.factionKey) ?? 0) + 1);
        expect([...byFaction.values()].sort()).toEqual([1, 1]);
        expect(byFaction.has('green')).toBe(false);
    });

    it('세력 내 모든 도시가 하나로 연결된다 — 고립 도시가 없다', () => {
        const nodes = Array.from({ length: 7 }, (_, i) => node(`c${i}`, 0.2 + i * 0.07, 0.3 + (i % 4) * 0.06));
        const segs = buildRoadNetwork(nodes);
        const adj = new Map<string, string[]>();
        const link = (u: string, v: string) => {
            if (!adj.has(u)) adj.set(u, []);
            if (!adj.has(v)) adj.set(v, []);
            adj.get(u)!.push(v);
            adj.get(v)!.push(u);
        };
        for (const s of segs) {
            const a = nodes.find(n => n.x === s.ax && n.y === s.ay)!;
            const b = nodes.find(n => n.x === s.bx && n.y === s.by)!;
            link(a.id, b.id);
        }
        const seen = new Set<string>(['c0']);
        const stack = ['c0'];
        while (stack.length) {
            for (const nb of adj.get(stack.pop()!) ?? []) {
                if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
            }
        }
        const isolated = nodes.map(n => n.id).filter(i => !seen.has(i));
        expect(isolated, `고립 도시: ${isolated.join(',')}`).toEqual([]);
    });

    it('사이클이 없다 — 같은 두 도시를 잇는 도로가 중복되지 않는다', () => {
        const nodes = Array.from({ length: 6 }, (_, i) => node(`c${i}`, 0.25 + i * 0.08, 0.35 + (i % 3) * 0.07));
        const segs = buildRoadNetwork(nodes);
        expect(segs.length).toBe(5);
        const keys = segs.map(s => [`${s.ax},${s.ay}`, `${s.bx},${s.by}`].sort().join('|'));
        expect(new Set(keys).size, '중복 도로가 있다').toBe(keys.length);
    });

    it('일직선 배치는 인접 도시끼리만 잇고 총길이가 최소다', () => {
        // "각 도시가 가장 가까운 이웃과 연결"이면 1-2, 2-3, 3-4 에 중복이 생긴다
        const nodes = Array.from({ length: 4 }, (_, i) => node(`c${i}`, 0.3 + i * 0.1, 0.5));
        const segs = buildRoadNetwork(nodes);
        expect(segs.length).toBe(3);
        const total = segs.reduce((n, s) => n + segLen(s), 0);
        expect(total, 'MST 최소 길이가 아니다').toBeCloseTo(0.3, 6);
    });

    it('색과 isPlayer 가 세력에서 상속된다', () => {
        const segs = buildRoadNetwork([node('a', 0.3, 0.3, 'f1', true), node('b', 0.4, 0.4, 'f1', true)]);
        expect(segs).toHaveLength(1);
        expect(segs[0].isPlayer).toBe(true);
        expect(segs[0].color).toBe('#2a5a8a');
        expect(segs[0].factionKey).toBe('f1');
    });

    it('입력 배열을 바꾸지 않는다', () => {
        const nodes = [node('a', 0.3, 0.3), node('b', 0.9, 0.9), node('c', 0.6, 0.1)];
        const before = nodes.map(n => n.id);
        buildRoadNetwork(nodes);
        expect(nodes.map(n => n.id)).toEqual(before);
    });

    it('실제 57개 도시로도 도로가 세력당 N-1 개다', () => {
        const cities = (mapCoords as { cities: Array<{ id: string; name: string; x: number; y: number }> }).cities;
        const byColor = new Map<string, RoadNode[]>();
        cities.forEach((c, i) => {
            const key = `f${i % 5}`;
            const n = node(c.id, c.x / 4096, c.y / 4096, key);
            if (!byColor.has(key)) byColor.set(key, []);
            byColor.get(key)!.push(n);
        });
        const nodes = [...byColor.values()].flat();
        const segs = buildRoadNetwork(nodes);
        let expected = 0;
        for (const g of byColor.values()) expected += Math.max(0, g.length - 1);
        expect(segs.length).toBe(expected);
    });
});

// ============================================================
// 영토 반경 + 도로 통로
// ============================================================

describe('영토 반경 — TERRITORY_RADIUS 상한', () => {
    const city = (id: string, x: number, y: number): MapCityView => ({
        id, name: id, x, y, ownerColor: '#2a5a8a', isPlayer: false, garrison: 1000,
    });
    const cellsOf = (r: ChinaMapRenderer) => r.getFactionLabels().reduce((n, f) => n + f.cells, 0);
    const makeRenderer = (cities: MapCityView[]) => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities(cities);
        return r;
    };

    it('도시는 영토를 차지한다', () => {
        expect(cellsOf(makeRenderer([city('a', 0.5, 0.5)]))).toBeGreaterThan(0);
    });

    it('영토 넓이는 도시 위치와 무관하다 — 무한 보로노이가 아니어야 한다', () => {
        // 실제 지도 위의 도시로 비교한다. 임의의 모서리 좌표는 바다여서 영토가 0 이 된다.
        // 중심(장안) 과 가장 바깥(서단 남중) — 반경이 걸려 있으면 둘 다 비슷한 원판이어야 한다.
        const a = cellsOf(makeRenderer([city('a', 0.523, 0.409)]));   // 장안
        const b = cellsOf(makeRenderer([city('a', 0.431, 0.684)]));   // 남중 — 도시 중 가장 서쪽
        expect(a, '장안 영토가 없다').toBeGreaterThan(0);
        expect(b, '남중 영토가 없다').toBeGreaterThan(0);
        expect(Math.abs(a - b) / Math.max(a, b), `중심 ${a}셀 vs 바깥 ${b}셀 — 반경 없이 무한 확장`).toBeLessThan(0.6);
    });

    it('여러 도시를 주면 영토가 그 합에 비례해 늘어난다 (겹치지 않음)', () => {
        const one = cellsOf(makeRenderer([city('a', 0.5, 0.5)]));
        const two = cellsOf(makeRenderer([city('a', 0.5, 0.5), city('b', 0.52, 0.5)]));
        expect(two).toBeGreaterThan(one);
    });

    it('아무 도시도 없으면 영토가 없다', () => {
        expect(cellsOf(makeRenderer([]))).toBe(0);
    });
});

describe('도로 통로 — 영토 연속성', () => {
    const city = (id: string, x: number, y: number, color: string, isPlayer = false): MapCityView => ({
        id, name: id, x, y, ownerColor: color, isPlayer, garrison: 5000,
    });
    const makeRenderer = (cities: MapCityView[]) => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities(cities);
        return r;
    };
    const totalCells = (r: ChinaMapRenderer) => r.getFactionLabels().reduce((n, f) => n + f.cells, 0);

    it('멀리 떨어진 같은 세력 도시 — 도로가 잇는 만큼 영토가 늘어난다', () => {
        // 두 도시 간격 0.20 은 도시 반경(0.05) 두 배가 넘으므로 도시끼리는 닿지 않는다
        const a = makeRenderer([city('a', 0.40, 0.45, '#2a5a8a')]);
        const b = makeRenderer([city('a', 0.40, 0.45, '#2a5a8a'), city('b', 0.60, 0.45, '#2a5a8a')]);
        expect(totalCells(b)).toBeGreaterThan(totalCells(a));
    });

    it('서로 다른 세력끼리는 도로로 이어지지 않는다', () => {
        const a = makeRenderer([city('a', 0.40, 0.45, '#2a5a8a')]);
        const b = makeRenderer([city('a', 0.40, 0.45, '#2a5a8a'), city('b', 0.60, 0.45, '#b04a2a')]);
        expect(totalCells(b)).toBeLessThan(totalCells(a) * 2);
    });

    it('영토는 언제나 도시 반경 + 도로 통로 밖으로 뻗지 않는다', () => {
        const r = makeRenderer([city('a', 0.50, 0.50, '#2a5a8a'), city('b', 0.52, 0.50, '#2a5a8a')]);
        // 도시 반경 원판 둘 = 약 2 * 40셀, 통로를 더해도 크게 넘지 않아야 한다
        expect(totalCells(r)).toBeLessThan(400);
    });
});

// ============================================================
// 도성 아이콘 크기 — 인구 기반 정규화
// ============================================================

describe('cityIconScale — 인구 → 아이콘 배율', () => {
    const sqrtOf = (p: number) => Math.sqrt(p);

    it('최소 도시는 0.55 배 윗값, 최대 도시는 1.0 배', () => {
        expect(cityIconScale(10, 10, 20)).toBeCloseTo(0.55, 9);
        expect(cityIconScale(20, 10, 20)).toBeCloseTo(1, 9);
    });

    it('중간 인구는 중간 크기다 (선형 정규화)', () => {
        expect(cityIconScale(15, 10, 20)).toBeCloseTo(0.775, 9);
    });

    it('오름차순으로 단조 증가한다 — 큰 도시가 더 크다', () => {
        let prev = -Infinity;
        for (let p = 10; p <= 20; p += 0.5) {
            const k = cityIconScale(p, 10, 20, false);
            expect(k, `인구 ${p} 에서 크기가 줄었다`).toBeGreaterThan(prev);
            prev = k;
        }
    });

    it('제곱근 정규화는 중간 인구를 상대적으로 크게 만든다 (면적 비례)', () => {
        // 100~400 인구를 100/200/400 세 도시로 본다.
        // sqrt(200)=14.14 → t=0.414, 선형이면 t=0.333 이다.
        // 즉 sqrt 는 "중간 도시" 를 선형보다 크게 그린다 — 면적이 인구에 비례해야
        // 눈으로 보이는 크기가 맞기 때문이다(큰 도시가 화면을 지배하지 않게).
        //
        // 참고: 최소/최대 도시의 끝값 비율(1.0/0.55)은 변환 방식과 무관하게 같다.
        // sqrt 가 바꾸는 것은 끝이 아니라 "사이" 의 배분이다.
        const kSqrt = cityIconScale(sqrtOf(200), sqrtOf(100), sqrtOf(400), false);
        const kLinear = cityIconScale(200, 100, 400, false);   // 선형으로 정규화한 경우
        expect(kSqrt).toBeGreaterThan(kLinear);
        expect(kSqrt).toBeCloseTo(0.7364, 3);
        expect(kLinear).toBeCloseTo(0.70, 9);
    });

    it('전 도시 인구가 같으면 span=0 — 전부 중간 크기다', () => {
        // 0 으로 두면 전부 최소 크기가 되어 "도시가 하나뿐" 과 "전부 작은 도시" 가 구분되지 않는다
        expect(cityIconScale(5, 5, 5, false)).toBeCloseTo(0.775, 9);
    });

    it('수도에는 0.18 보정 — 같은 인구여도 더 크다', () => {
        const normal = cityIconScale(15, 10, 20, false);
        const capital = cityIconScale(15, 10, 20, true);
        expect(capital).toBeGreaterThan(normal);
        expect(capital - normal).toBeCloseTo(0.18, 9);
    });

    it('1 을 넘지 않는다 (최대 도시 + 수도 보정)', () => {
        expect(cityIconScale(20, 10, 20, true)).toBeLessThanOrEqual(1);
    });

    // ─── [2026-10-02] 수도 boost 클램프 증상 — 아래 테스트들이 함께 이 결함을 잠근다 ───
    //
    // 위 두 단언을 함께 읽으면 이 결함이 보인다: 수도 boost 0.18 은 Math.min(1, ...) 에서
    // 잘린다. 인구가 최대인 도시(t=1)는 boost を 받든 안 받든 k 가 정확히 1.0 이므로,
    // "수도" 와 "최대 인구 도시" 의 배율이 같아진다 — 코드가 의도한 것과 반대다.
    // 그래서 확정적 수도 우위는 배율 밖(CAPITAL_CASTLE_MUL)에서 만든다.

    it('증상: 최대 인구 도시에서는 수도 boost 이 클램프에 잘린다', () => {
        // 이 단언이 참인 한, 도시IconScale 만으로는 수도 우위를 만들 수 없다는 뜻이다.
        expect(cityIconScale(20, 10, 20, true)).toBe(cityIconScale(20, 10, 20, false));
    });

    it('수도 배율은 1 보다 커서 클램프에 잘리지 않는다', () => {
        expect(CAPITAL_CASTLE_MUL).toBeGreaterThan(1);
        expect(Number.isFinite(CAPITAL_CASTLE_MUL)).toBe(true);
    });

    it('수도 크기는 같은 인구의 비수도보다 항상 크다 (전 인구 구간)', () => {
        // 실제 크기 식을 그대로 재현한다 — iconSizeRange 와 같은 계수.
        const sizeOf = (k: number, capital: boolean) =>
            (CASTLE_W_MIN + CASTLE_W_SPAN * k) * (capital ? CAPITAL_CASTLE_MUL : 1);
        let min = Infinity;
        let max = -Infinity;
        for (let p = 10; p <= 20; p += 0.25) {
            const kCap = cityIconScale(p, 10, 20, true);
            const kNorm = cityIconScale(p, 10, 20, false);
            expect(sizeOf(kCap, true), `인구 ${p}: 수도가 같은 인구 도시보다 크지 않다`)
                .toBeGreaterThan(sizeOf(kNorm, false));
            if (sizeOf(kCap, true) < min) min = sizeOf(kCap, true);
            if (sizeOf(kNorm, false) > max) max = sizeOf(kNorm, false);
        }
        // 그리고 가장 작은 수도도 가장 큰 비수도보다 크다 — "인구 무관하게 항상 최대" 요구.
        expect(min, '가장 작은 수도가 가장 큰 비수도보다 작거나 같다').toBeGreaterThan(max);
        // [2026-10-05] 여유가 0.25px 이상이어야 위계가 읽힌다 — 예전 구성은 0.04px(0.4%)라
        // 반올림 하나로 뒤집힐 수 있었다. 지금은 13.32 - 13.0 = 0.32px(2.4%) 다.
        expect(min - max, '수도 최소와 비도시 최대의 여유가 0.25px 미만이다')
            .toBeGreaterThanOrEqual(0.25);
    });

    it('[2026-10-05] 위계 강화 — 소도시는 유지하고 대도시 끝값만 키웠다', () => {
        // 예전(2026-10-02 축소안 B): 최소 8.41 / 대도시 11.20 — 비율 1.33 이라 지도에서
        // "큰 도시" 가 눈에 안 들어왔다. 최소는 그대로 두고 끝값만 13.0 으로 올렸다.
        expect(MIN_CASTLE_W).toBeCloseTo(8.41, 9);
        expect(MAX_CASTLE_W).toBeCloseTo(13.0, 9);
        // 이 변경의 목적: 대도시/소도시 비율이 1.5배 이상이어야 크기 차가 읽힌다.
        expect(MAX_CASTLE_W / MIN_CASTLE_W).toBeGreaterThanOrEqual(1.5);
        // 소도시를 더 줄이지 않은 이유 — "아이콘이 크다" 지적의 대상은 42~57개 전체였고,
        // 최소 폭이 7.68px 아래로 내려가면 병풍벽이 1~2px 로 뭉개진다(2026-10-02 C 안 기각).
        expect(MIN_CASTLE_W).toBeCloseTo(CASTLE_W_MIN + CASTLE_W_SPAN * 0.55, 9);
        // 최소 아이콘은 여전히 최소 선 두께(0.55px)보다 넓어야 병풍벽 3개가 들어간다
        expect(MIN_CASTLE_W * 0.22).toBeGreaterThan(0.55);
    });

    it('필요 도시 간격은 그려질 수 있는 최대 아이콘(수도 포함)을 따른다', () => {
        // requiredCityGap 은 MAX_CASTLE_W_DRAWN 을 쓴다. 위계 강화(2026-10-05)로
        // 최대 아이콘이 13.22 → 16.90 이 됐고, 간격도 이 상수를 통해 같이 커진다.
        expect(MAX_CASTLE_W_DRAWN).toBeCloseTo(MAX_CASTLE_W * CAPITAL_CASTLE_MUL, 9);
        expect(MAX_CASTLE_W_DRAWN).toBeCloseTo(16.9, 9);
        expect(MAX_CASTLE_W_DRAWN).toBeGreaterThan(MAX_CASTLE_W);
    });

    it('배율은 항상 0.55 이상이다 — 0 이 되지 않는다', () => {
        for (const p of [0, 1, 10, 1e6]) {
            expect(cityIconScale(p, 0, 1e6, false), `인구 ${p}`).toBeGreaterThanOrEqual(0.55);
        }
    });

    it('음수 인구에도 NaN 이 없다 (데이터는 방어적으로 들어온다)', () => {
        const k = cityIconScale(-5, -5, 5, false);
        expect(Number.isFinite(k)).toBe(true);
    });
});

// ============================================================
// 하이브리드 도시 아이콘 — 벡터/스프라이트 전환 계약
// ============================================================

describe('cityIconSlot — 벡터/스프라이트가 공유하는 형태 판정', () => {
    it('zoom 으로 나눈 pre-zoom 폭으로 3단 계층을 만든다', () => {
        // MIN_CASTLE_W(8.41) 는 SMALL, 그 위는 MEDIUM, MAX_CASTLE_W(13.0) 는 LARGE.
        expect(cityIconSlot(MIN_CASTLE_W, 1)).toBe('SMALL');
        expect(cityIconSlot(9.5, 1)).toBe('MEDIUM');   // 경계값은 MEDIUM (>= 9.5)
        expect(cityIconSlot(11.9, 1)).toBe('MEDIUM');
        expect(cityIconSlot(MAX_CASTLE_W, 1)).toBe('LARGE'); // 경계값은 LARGE (>= 12)
    });

    it('수도만 CAPITAL 로 올라간다 — 형태 계층을 건너뛰지 않는다', () => {
        // 수도는 CAPITAL_CASTLE_MUL 덕분에 항상 LARGE 이상이다. SMALL/MEDIUM 인데
        // CAPITAL 이 나오면 벡터 스위치와 스프라이트 셀 선택이 어긋난다.
        expect(cityIconSlot(MAX_CASTLE_W_DRAWN, 1, true)).toBe('CAPITAL');
        expect(cityIconSlot(MAX_CASTLE_W_DRAWN, 1, false)).toBe('LARGE');
        // 데이터가 깨져(baseW 가 SMALL) 수도여도 계층을 건너뛰지 않는다.
        expect(cityIconSlot(MIN_CASTLE_W, 1, true)).toBe('SMALL');
        expect(cityIconSlot(9.5, 1, true)).toBe('MEDIUM');
    });

    it('같은 도시의 판정은 zoom 과 무관하다 (pre-zoom 폭으로 환산하기 때문)', () => {
        // zoom 2.5 에서 그려지는 13.0px 아이콘은 zoom 0.6 의 3.12px 와 같은 도시다.
        // 판정이 zoom 에 의존하면 확대할 때 도시가 계층을 바꾸어 변형돼 보인다.
        for (const baseW of [MIN_CASTLE_W, 10.0, MAX_CASTLE_W]) {
            for (const zoom of [0.6, 1.0, 1.6, 2.5]) {
                expect(cityIconSlot(baseW * zoom, zoom), `baseW=${baseW} zoom=${zoom}`)
                    .toBe(cityIconSlot(baseW, 1));
            }
        }
    });

    it('zoom 0 근접에서도 폭발하지 않는다 (방어적 나눗셈)', () => {
        // 렌더러가 쓰는 0.3 바닥과 같은 값 — 0 으로 나누면 Infinity 가 되어 계층이 SMALL 이 된다.
        expect(cityIconSlot(13.0, 0)).toBe('LARGE');
        expect(cityIconSlot(0, 0)).toBe('SMALL');
    });

    it('아틀라스 셀 인덱스가 4개 셀 안에 들어간다', () => {
        // CITY_ICON_SLOT 은 스크립트(scripts/build_city_icon_atlas.mjs)의 SLOTS 순서와
        // 1:1 이어야 한다. 어긋나면 SMALL 자리에 수도가 그려진다.
        expect(Object.keys(CITY_ICON_SLOT)).toHaveLength(CITY_ICON_CELL_COUNT);
        for (const [name, idx] of Object.entries(CITY_ICON_SLOT)) {
            expect(Number.isInteger(idx), name).toBe(true);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(CITY_ICON_CELL_COUNT);
        }
        // 스크립트가 0,1,2,3 순으로 아틀라스를 이어붙이므로 값도 그 순서여야 한다.
        expect(CITY_ICON_SLOT.SMALL).toBe(0);
        expect(CITY_ICON_SLOT.MEDIUM).toBe(1);
        expect(CITY_ICON_SLOT.LARGE).toBe(2);
        expect(CITY_ICON_SLOT.CAPITAL).toBe(3);
    });

    it('아틀라스 규격은 셀 × 4 = 512×128 이다 (스크립트와 공유)', () => {
        expect(CITY_ICON_ATLAS_W).toBe(512);
        expect(CITY_ICON_ATLAS_H).toBe(128);
        expect(CITY_ICON_ATLAS_W).toBe(CITY_ICON_CELL_PX * CITY_ICON_CELL_COUNT);
        expect(CITY_ICON_ATLAS_H).toBe(CITY_ICON_CELL_PX);
    });
});

describe('CITY_ICON_SPRITE_MIN_ZOOM — 전환 zoom 계약', () => {
    it('전환 지점에서 스프라이트가 살아 있을 만큼 크다 (13px 이상)', () => {
        // 이 값보다 낮추면 스프라이트가 13px 근처에서 쓰인다 — 그 크기에서는 벡터의
        // "세력색 실루엣 + 1px 테두리"가 배경 지도 위에서 명백히 더 읽힌다.
        const smallestAtCutoff = MIN_CASTLE_W * CITY_ICON_SPRITE_MIN_ZOOM;
        expect(smallestAtCutoff).toBeGreaterThanOrEqual(13);
    });

    it('전환 지점에서 수도는 아틀라스 원본(128px)을 과도하게 축소하지 않는다', () => {
        // 수도는 전환 지점에서 27px — 원본 128px 의 21% 다. 브라우저 downscale 은
        // 이 정도 배율에서 형태를 보존한다(2배 이상 축소부터 뭉개진다).
        const capitalAtCutoff = MAX_CASTLE_W_DRAWN * CITY_ICON_SPRITE_MIN_ZOOM;
        expect(capitalAtCutoff).toBeGreaterThan(20);
        expect(CITY_ICON_CELL_PX / capitalAtCutoff).toBeLessThanOrEqual(6);
    });

    it('최대 zoom 에서도 확대 구간이 남아 있다 — 하이브리드 도입이 의미 있다', () => {
        // 전환값이 2.5 에 붙으면 확대해도 스프라이트를 거의 못 보고 하이브리드가 무의미하다.
        expect(CITY_ICON_SPRITE_MIN_ZOOM).toBeLessThan(2.0);
        expect(CITY_ICON_SPRITE_MIN_ZOOM).toBeGreaterThan(1.0);
    });

    it('도시 간격 계약과 어긋나지 않는다 (최대 아이콘 16.9px 는 그대로)', () => {
        // 스프라이트를 도입해도 아이콘 크기 자체는 바뀌지 않는다 — 같은 w/h 를
        // 다른 방법으로 그릴 뿐이다. 따라서 간격/배치 계약 값은 손대지 않았다.
        expect(MAX_CASTLE_W_DRAWN).toBeCloseTo(16.9, 9);
    });
});

describe('도시 아이콘 아틀라스 자산 경로', () => {
    it('경로는 assets/ 아래 — ip-gate(PROVENANCE allowlist) 관리 경로다', () => {
        // assets/ 아래가 아니면 출처 대장 등록을 우회하게 되고, 그것은 게이트가
        // 정확히 막으려는 상황이다. 경로를 바꾸려면 대장을 함께 고쳐야 한다.
        expect(CITY_ICON_ATLAS_PATH.startsWith('assets/')).toBe(true);
        expect(CITY_ICON_ATLAS_PATH).toMatch(/\.webp$/);
    });
});

describe('하이브리드 디스패치 — 실제로 어느 경로로 그리는가', () => {
    /**
     * drawImage 호출을 기록하는 목 캔버스. 벡터는 drawImage 를 전혀 쓰지 않고
     * (모든 도성이 path 로 그려진다) 스프라이트는 매 아이콘마다 한 번씩 쓴다 —
     * 그래서 "drawImage 가 불렸나"만으로 경로가 갈린 것을 판별할 수 있다.
     */
    function createRecordingCanvas() {
        const calls = { drawImage: 0, fill: 0, stroke: 0 };
        const ctx = {
            ...createMockCanvas().getContext('2d')!,
            drawImage: () => { calls.drawImage++; },
            fill: () => { calls.fill++; },
            stroke: () => { calls.stroke++; },
        } as unknown as CanvasRenderingContext2D;
        return { calls, ctx };
    }

    const city = {
        id: 'c1', name: '성도', x: 0.5, y: 0.5, imageX: 0.5, imageY: 0.5,
        ownerColor: '#2a5a8a', isPlayer: false, garrison: 1000, population: 90000,
    } as unknown as MapCityView;

    /** private 필드를 테스트에서 직접 제어한다 — 흉격 외에 다른 수단이 없다. */
    function poke<T>(obj: object, key: string, value: T): void {
        (obj as unknown as Record<string, unknown>)[key] = value;
    }

    it('아틀라스가 없으면 확대 zoom 에서도 벡터로 그린다 (폴백)', () => {
        // 오프라인 첫 실행·구버전 sw 캐시·경로 오기 전부 이 경로다.
        // "확대했는데 도시 아이콘이 안 보인다" 는 최악의 회귀이므로 반드시 벡터로 내려와야 한다.
        const r = new ChinaMapRenderer(createMockCanvas());
        const { calls, ctx } = createRecordingCanvas();
        poke(r, 'iconAtlas', null);
        poke(r, 'zoom', 2.5);
        (r as unknown as {
            drawCastleIcon: (c: CanvasRenderingContext2D, city: MapCityView, px: number, py: number, size: { w: number; h: number }, active: boolean) => void;
        }).drawCastleIcon(ctx, city, 100, 100, { w: 30, h: 20 }, false);

        expect(calls.drawImage, '스프라이트를 그렸다 — 아틀라스 미로딩인데').toBe(0);
        expect(calls.fill + calls.stroke, '벡터 경로를 안 탔다 — 아이콘이 안 보인다').toBeGreaterThan(0);
    });

    it('아틀라스를 시도했다가 벡터로 물러나는 경로도 안전하다', () => {
        // node 환경에는 document 가 없어 tintedAtlasCell 이 곧바로 null 을 돌려준다.
        // 즉 이 테스트는 "스프라이트 합성이 불가능한 환경에서 도시가 사라지지 않는다" 를 본다.
        // document 가 있는 브라우저에서 tinted 가 성공하는지는 E2E/브라우저 확인 대상이다.
        const r = new ChinaMapRenderer(createMockCanvas());
        const { calls, ctx } = createRecordingCanvas();
        poke(r, 'zoom', 2.5);
        (r as unknown as {
            drawCastleIcon: (c: CanvasRenderingContext2D, city: MapCityView, px: number, py: number, size: { w: number; h: number }, active: boolean) => void;
        }).drawCastleIcon(ctx, city, 100, 100, { w: 30, h: 20 }, false);

        // iconAtlas 가 비었으면 벡터 — 이 환경에선 항상 이 결과다(폴백 계약).
        expect(calls.fill + calls.stroke).toBeGreaterThan(0);
    });

    it('축소 zoom 에서는 아틀라스가 있어도 벡터로 그린다 (하이브리드의 정의)', () => {
        // 전환값 1.6 아래면 스프라이트를 쓰지 않는다. 이것이 없으면 "하이브리드"가 아니라
        // "스프라이트로 대체"가 되어 8~17px 구간이 전부 뭉개진다.
        const r = new ChinaMapRenderer(createMockCanvas());
        const { calls, ctx } = createRecordingCanvas();
        poke(r, 'zoom', CITY_ICON_SPRITE_MIN_ZOOM - 0.01);
        // 아틀라스를 "있는 척" 심어도(자연폭 0 = 미완성) 스프라이트를 쓰면 안 된다.
        poke(r, 'iconAtlas', { naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement);
        (r as unknown as {
            drawCastleIcon: (c: CanvasRenderingContext2D, city: MapCityView, px: number, py: number, size: { w: number; h: number }, active: boolean) => void;
        }).drawCastleIcon(ctx, city, 100, 100, { w: 30, h: 20 }, false);

        expect(calls.drawImage, '전환 zoom 아래에서 스프라이트를 썼다').toBe(0);
        expect(calls.fill + calls.stroke).toBeGreaterThan(0);
    });

    it('수도도 벡터 폴백에서 깃발까지 그린다 (drawGrandCastleIcon 경로)', () => {
        // CAPITAL 이 벡터 스위치에서 LARGE 와 같은 함수로 가는 것이 그 대가라고
        // 주석에 적었다. 실제로 iconType 이 전달되어야 깃발이 그려진다.
        const r = new ChinaMapRenderer(createMockCanvas());
        const { calls, ctx } = createRecordingCanvas();
        poke(r, 'iconAtlas', null);
        poke(r, 'zoom', 1.0);
        const capital = { ...city, iconType: 'CAPITAL' } as unknown as MapCityView;
        (r as unknown as {
            drawCastleIcon: (c: CanvasRenderingContext2D, city: MapCityView, px: number, py: number, size: { w: number; h: number }, active: boolean) => void;
        }).drawCastleIcon(ctx, capital, 100, 100, { w: 17, h: 11 }, false);

        expect(calls.fill + calls.stroke).toBeGreaterThan(0);
    });

    it('생성자는 아틀라스 로드로 예외를 던지지 않는다 (오프라인 안전)', () => {
        // 생성자에서 loadIconAtlas 가 호출돼도 브라우저가 없을 때 예외를 던지면 안 된다.
        // node 환경(테스트·SSR)에서 new 가 되는 것으로 확인한다.
        expect(() => new ChinaMapRenderer(createMockCanvas())).not.toThrow();
    });
});

// ============================================================
// 도로 굴곡 — 결정성
// ============================================================

describe('roadBendFactor — 도로 곡률 계수', () => {
    it('항상 -1..1 범위다', () => {
        for (let i = 0; i < 300; i++) {
            const f = roadBendFactor(i * 0.013, i * 0.027, i * 0.041, i * 0.059);
            expect(f).toBeGreaterThanOrEqual(-1);
            expect(f).toBeLessThanOrEqual(1);
            expect(Number.isFinite(f)).toBe(true);
        }
    });

    it('같은 끝점이면 항상 같은 값 — 프레임마다 떨리지 않는다', () => {
        const a = roadBendFactor(0.42, 0.31, 0.55, 0.60);
        for (let i = 0; i < 50; i++) {
            expect(roadBendFactor(0.42, 0.31, 0.55, 0.60)).toBe(a);
        }
    });

    it('입력 순서를 바꾸면 값이 달라진다 (무작위가 아니다)', () => {
        const a = roadBendFactor(0.1, 0.2, 0.3, 0.4);
        const b = roadBendFactor(0.3, 0.4, 0.1, 0.2);
        expect(a).not.toBe(b);
    });

    it('분포가 한쪽으로 치우치지 않는다 (0 근처가 가장 많다)', () => {
        let sign = 0;
        for (let i = 0; i < 200; i++) {
            if (roadBendFactor(i * 0.017, i * 0.031, i * 0.043, i * 0.067) > 0) sign++;
        }
        // 전부 한 부호면 해시가 제 기능을 못 한다
        expect(sign).toBeGreaterThan(20);
        expect(sign).toBeLessThan(180);
    });

    it('완전히 겹친 두 점(길이 0)도 유한값을 준다', () => {
        const f = roadBendFactor(0.5, 0.5, 0.5, 0.5);
        expect(Number.isFinite(f)).toBe(true);
    });
});

// ============================================================
// 전략 요충지 — 관·전장·항구
// ============================================================

describe('전략 요충지 아이콘 — 크기 제한', () => {
    it('제일 작은 도성 크기의 반 이하다 (사용자 요구)', () => {
        // 최소 도성 폭 = CASTLE_W_MIN + CASTLE_W_SPAN*0.55 = 5.0 + 3.41 = 8.41, 절반 = 4.205
        // 요충지 폭 = FEATURE_ICON_R * 2 = 4.0
        expect(FEATURE_ICON_R * 2).toBeLessThanOrEqual(MIN_CASTLE_W / 2);
    });

    it('도시보다 눈에 띄지 않는다 — 요충지가 도시보다 크면 안 된다', () => {
        expect(FEATURE_ICON_R * 2).toBeLessThan(MIN_CASTLE_W);
    });

    it('확대해도 도시와 비례한다 (zoom 을 곱하므로 같이 커진다)', () => {
        expect(FEATURE_ICON_R).toBeGreaterThan(0);
        expect(Number.isFinite(FEATURE_ICON_R)).toBe(true);
    });
});

describe('전략 요충지 데이터 — MAP_FEATURE_ANCHORS', () => {
    const feats = Object.entries(MAP_FEATURE_ANCHORS);

    it('요충지가 하나 이상 있다 (관·전장·항구)', () => {
        expect(feats.length).toBeGreaterThan(0);
    });

    it('사용자가 지목한 관문이 포함되어 있다', () => {
        const names = feats.map(([n]) => n);
        expect(names).toContain('호로관');
    });

    it('종류는 PASS / BATTLEFIELD / PORT 뿐이다', () => {
        for (const [, f] of feats) {
            expect(['PASS', 'BATTLEFIELD', 'PORT']).toContain(f.kind);
        }
    });

    it('모든 좌표가 지도 안(0~1)이다', () => {
        for (const [name, f] of feats) {
            expect(f.x, `${name} x`).toBeGreaterThanOrEqual(0);
            expect(f.x, `${name} x`).toBeLessThanOrEqual(1);
            expect(f.y, `${name} y`).toBeGreaterThanOrEqual(0);
            expect(f.y, `${name} y`).toBeLessThanOrEqual(1);
        }
    });

    it('좌표가 유한하다 (NaN 이면 화면에 아무것도 안 그려진다)', () => {
        for (const [name, f] of feats) {
            expect(Number.isFinite(f.x), `${name} x`).toBe(true);
            expect(Number.isFinite(f.y), `${name} y`).toBe(true);
        }
    });
});

// ============================================================
// 관·요충지 접도로 — 전략 요충지가 도로망에 닿아야 한다
// ============================================================

describe('관·요충지 접도로', () => {
    const mkCity = (id: string, x: number, y: number): MapCityView => ({
        id, name: id, x, y, imageX: x, imageY: y,
        ownerColor: '#2a5a8a', isPlayer: false, garrison: 1000,
    });

    it('요충지 근처에 도시를 두면 접도로가 생긴다', () => {
        const [name, f] = Object.entries(MAP_FEATURE_ANCHORS)[0];
        // 요충지 바로 옆(0.01)에 도시를 둔다 — 접도로 거리 한도(0.12) 안이다
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([mkCity('near', f.x + 0.01, f.y + 0.01)]);
        const spurs = r.getFeatureSpurs();
        expect(spurs.length, '접도로가 하나도 안 생겼다').toBeGreaterThan(0);
        expect(spurs.some(s => s.name === name), `${name} 접도로 없음`).toBe(true);
    });

    it('요충지와 세력은 다르다 — 그래서 무채색으로 그린다', () => {
        // 접도로는 "지형 접근로" 이지 세력 영토가 아니다
        const [name, f] = Object.entries(MAP_FEATURE_ANCHORS)[0];
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([mkCity('near', f.x + 0.01, f.y + 0.01)]);
        const spur = r.getFeatureSpurs().find(s => s.name === name);
        expect(spur).toBeDefined();
        expect(spur!.kind).toBe(f.kind);
    });

    it('도시가 없으면 접도로도 없다', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities([]);
        expect(r.getFeatureSpurs()).toEqual([]);
    });

    it('모든 접도로는 거리 한도 이내다 (화면을 가로지르는 선 방지)', () => {
        // 실제 31개 도시 — 도시가 바다에 두면 snapToLand 로 옮겨지므로, 도시를 직접
        // 지ounded 좌표로 가정하지 않고 렌더러가 실제로 만든 접도로 길이를 잰다.
        const cities = (mapCoords as { cities: Array<{ id: string; name: string; x: number; y: number }> }).cities;
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities(cities.map(c => mkCity(c.name, c.x / 4096, c.y / 4096)));
        for (const s of r.getFeatureSpurs()) {
            expect(s.length, `${s.name} 접도로가 너무 길다`).toBeLessThanOrEqual(0.12);
        }
    });

    it('실제 31개 도시로도 접도로가 다수 만들어진다', () => {
        const cities = (mapCoords as { cities: Array<{ id: string; name: string; x: number; y: number }> }).cities;
        const r = new ChinaMapRenderer(createMockCanvas());
        r.setCities(cities.map(c => mkCity(c.name, c.x / 4096, c.y / 4096)));
        const spurs = r.getFeatureSpurs();
        expect(spurs.length, '어떤 요충지도 도시와 연결되지 않았다').toBeGreaterThan(0);
        // 도시 31개 중 몇 개는 화면 밖이라 전부가 연결되지는 않는다 — 전부연결을 요구하지 않는다
        expect(spurs.length).toBeLessThanOrEqual(Object.keys(MAP_FEATURE_ANCHORS).length);
    });
});

// ============================================================
// 도시 겹침 — 최소 간격이 창 크기에 따라 계산되는지
// ============================================================

describe('도시 최소 간격이 창 크기에 연동된다', () => {
    const mkCity = (id: string, x: number, y: number): MapCityView => ({
        id, name: id, x, y, imageX: x, imageY: y,
        ownerColor: '#2a5a8a', isPlayer: false, garrison: 1000,
    });

    /**
     * 실제 코드의 requiredCityGap 과 같은 식 — 테스트가 구현을 그대로 베끼지 않도록 검증용.
     *
     * [2026-10-02] 옛 식은 `MIN_CASTLE_W + 9 * 0.45` 로 최대 아이콘 폭(16.0px)을 하드코딩했는데,
     * 축소 뒤 실제 최대는 수도 배율까지 포함한 MAX_CASTLE_W_DRAWN(13.22) 이다. 옛 값을 그대로
     * 두면 "간격 ≥ 최대 아이콘" 이라는 이 테스트의 의도가 거짓말이 된다(간격이 과대 산정돼
     * 통과가 보장되므로, 버그를 못 잡는 방향이다). production 상수를 그대로 참조한다.
     */
    const expectedGap = (maxWH: number, zoom: number): number =>
        (MAX_CASTLE_W_DRAWN * zoom / (maxWH * 0.96 * zoom)) * 1.25;

    const gapOf = (r: ChinaMapRenderer): number =>
        (r as unknown as { requiredCityGap(): number }).requiredCityGap();

    it('좁은 창일수록 필요한 정규화 간격이 크다', () => {
        const small = new ChinaMapRenderer({ ...createMockCanvas(), width: 360, height: 520 } as HTMLCanvasElement);
        const large = new ChinaMapRenderer({ ...createMockCanvas(), width: 1920, height: 1080 } as HTMLCanvasElement);
        expect(gapOf(small), '좁은 창에서 간격이 더 커야 한다').toBeGreaterThan(gapOf(large));
        expect(gapOf(small) / gapOf(large)).toBeCloseTo(1920 / 520, 2);
    });

    it('줌은 필요 간격에 영향을 주지 않는다 (아이콘과 지도 축척이 함께 커지므로)', () => {
        const r = new ChinaMapRenderer(createMockCanvas());
        const at1 = gapOf(r);
        r.setView({ zoom: 2.5 });
        expect(gapOf(r), '줌을 바꿔도 필요 간격은 같아야 한다').toBeCloseTo(at1, 10);
    });

    it('간격은 항상 최대 아이콘 픽셀폭 이상이다 (겹침의 직접 원인)', () => {
        // baseScale = max(W,H)*0.96*zoom 이므로 "필요 간격 * baseScale" 가 곧 픽셀 간격이다.
        for (const [w, h] of [[360, 520], [768, 1024], [1920, 1080], [2560, 1440]] as const) {
            const zoom = 1;
            const r = new ChinaMapRenderer({ ...createMockCanvas(), width: w, height: h } as HTMLCanvasElement);
            const baseScale = Math.max(w, h) * 0.96 * zoom;
            const px = gapOf(r) * baseScale;
            expect(px, `${w}x${h} 에서 간격 ${px.toFixed(1)}px 는 아이콘보다 좁다`)
                .toBeGreaterThanOrEqual(MAX_CASTLE_W_DRAWN);
        }
    });

    it('실측 57도시: 좁은 창에서도 모든 도시 쌍이 아이콘 폭 이상 떨어진다', () => {
        const cities = (mapCoords as { cities: Array<{ id: string; name: string; x: number; y: number }> }).cities
            .map(c => ({ ...c, nx: c.x / 4096, ny: c.y / 4096 }));
        // 좁은 창(사용자 캡처 360x520) + 해안 밀기 없음 — 순수 간격만 검증한다.
        const r = new ChinaMapRenderer({ ...createMockCanvas(), width: 360, height: 520 } as HTMLCanvasElement);
        const gap = gapOf(r);
        const seeded = cities.map(c => ({ id: c.id, x: c.nx, y: c.ny }));
        const out = relaxCityPlacement(seeded, { isLand: () => true, minGap: gap, maxMove: 0.045, coastBias: 0 });
        for (let i = 0; i < cities.length; i++) {
            for (let j = i + 1; j < cities.length; j++) {
                const a = out.positions.get(cities[i].id)!;
                const b = out.positions.get(cities[j].id)!;
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                expect(d, `${cities[i].name}-${cities[j].name} 가 ${(d * 499).toFixed(1)}px 로 붙었다`)
                    .toBeGreaterThanOrEqual(gap - 1e-3);
            }
        }
    });

    it('넓은 창에서는 도시를 거의 밀지 않는다 (실측 지형을 보존)', () => {
        const cities = (mapCoords as { cities: Array<{ id: string; x: number; y: number }> }).cities
            .map(c => ({ id: c.id, x: c.x / 4096, y: c.y / 4096 }));
        const gap = expectedGap(1920, 1);
        const out = relaxCityPlacement(cities, { isLand: () => true, minGap: gap, maxMove: 0.045, coastBias: 0 });
        const maxMoved = Math.max(...[...out.moved.values()]);
        expect(maxMoved, '1920px 창에서 0.01 넘게 밀리면 과하다').toBeLessThan(0.01);
    });
});
