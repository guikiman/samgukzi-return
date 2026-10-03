/**
 * 도시 진입 화면 배경 — 경로, 라벨 앵커, cover 배치 계산.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    computeCoverPlacement,
    mapAnchorToStage,
    anchorFor,
    resolveVisibleAnchor,
    separateOverlaps,
    CITY_SCENE_ART_ANCHORS,
    CITY_SCENE_ART_PATH,
    toStageInset,
    isVisibleRect,
    renderStatBar,
    statBarPercent,
    type SceneInset,
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
    it('건물 9종 모두 앵커가 있다', () => {
        expect(CITY_BUILDING_TYPES.every(k => CITY_SCENE_ART_ANCHORS[k] !== undefined)).toBe(true);
        // [2026-10-03] 8 → 9. 주막(TAVERN) 추가.
        //   원인은 좌표가 아니라 타입 부재였다 — FacilityType.TAVERN 은 있는데
        //   CityBuildingType 에 없어서 시장 앞 건물에 배지가 나올 수 없었다.
        expect(CITY_BUILDING_TYPES).toHaveLength(9);
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

describe('resolveVisibleAnchor — HUD 가 앵커를 덮지 못하게 한다', () => {
    // 실측값. 1440x900 창에서 우측 통제 열(360px 고정)이 그림의 74.2% 지점부터 시작한다.
    // 1001px 창에선 62.8% 부터라, 이 값을 상수로 박아두면 좁은 창에서 반드시 죽는다.
    const rightColumn = (startPercent: number): SceneInset[] => [
        { left: startPercent, top: -10, right: 115, bottom: 115 },
    ];

    it('인셋이 없으면 앵커가 한 치도 움직이지 않는다', () => {
        for (const [type, anchor] of Object.entries(CITY_SCENE_ART_ANCHORS)) {
            expect(resolveVisibleAnchor(anchor, []), type).toEqual(anchor);
        }
    });

    it('HUD 패널에 덮인 앵커는 보이는 곳으로 밀려난다', () => {
        // 성벽(75)·자택(90) 은 원래 우측 통제 열 아래에 있어 눌리지 않았다.
        for (const start of [62.8, 74.2, 80.6]) {
            const insets = rightColumn(start);
            for (const type of ['WALL', 'HOUSE'] as const) {
                const resolved = resolveVisibleAnchor(CITY_SCENE_ART_ANCHORS[type], insets);
                expect(resolved.x, `${type} 이 ${start}% 통제 열 아래에 남았다`)
                    .toBeLessThanOrEqual(start);
            }
        }
    });

    it('밀려난 뒤에도 그림 밖으로 나가지 않는다', () => {
        const insets = rightColumn(10);
        for (const [type, anchor] of Object.entries(CITY_SCENE_ART_ANCHORS)) {
            const resolved = resolveVisibleAnchor(anchor, insets);
            expect(resolved.x, `${type} x`).toBeGreaterThanOrEqual(2);
            expect(resolved.x, `${type} x`).toBeLessThanOrEqual(98);
            expect(resolved.y, `${type} y`).toBeGreaterThanOrEqual(2);
            expect(resolved.y, `${type} y`).toBeLessThanOrEqual(98);
        }
    });

    it('결과는 안정적이다 — 다시 풀어도 같은 점이 나온다', () => {
        const insets = rightColumn(74.2);
        for (const [type, anchor] of Object.entries(CITY_SCENE_ART_ANCHORS)) {
            const once = resolveVisibleAnchor(anchor, insets);
            expect(resolveVisibleAnchor(once, insets), `${type} 이 자리에서 흔들린다`).toEqual(once);
        }
    });

    it('겹친 인셋에서도 마지막에는 자유 영역에 놓인다', () => {
        // 좌상단 헤더(0~62 x, 0~19 y)와 우측 열(74~115 x)이 함께 있는 실제 배치.
        const insets: SceneInset[] = [
            { left: -5, top: -5, right: 62, bottom: 19 },
            { left: 74, top: -10, right: 115, bottom: 115 },
        ];
        for (const [type, anchor] of Object.entries(CITY_SCENE_ART_ANCHORS)) {
            const r = resolveVisibleAnchor(anchor, insets);
            for (const inset of insets) {
                const covered = r.x > inset.left && r.x < inset.right && r.y > inset.top && r.y < inset.bottom;
                expect(covered, `${type} 이 인셋 안에 남았다`).toBe(false);
            }
        }
    });
});

describe('separateOverlaps — 배지끼리도 겹치지 않게 한다', () => {
    // 실측: 배지 34px, 무대 929x523 → 약 3.7 x / 6.5 y
    const GAP_X = 3.7;
    const GAP_Y = 6.5;

    const overlaps = (list: Array<{ x: number; y: number }>, gx = GAP_X, gy = GAP_Y): Array<[number, number]> => {
        const pairs: Array<[number, number]> = [];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                if (Math.abs(list[i].x - list[j].x) < gx && Math.abs(list[i].y - list[j].y) < gy) {
                    pairs.push([i, j]);
                }
            }
        }
        return pairs;
    };

    it('겹치지 않으면 아무것도 안 움직인다', () => {
        const list = Object.values(CITY_SCENE_ART_ANCHORS);
        expect(separateOverlaps(list, GAP_X, GAP_Y)).toEqual(list);
    });

    it('같은 탈출구로 몰린 배지들을 벌린다 — 실제로 벌려진 경우를 재현', () => {
        // 통제 열에 눌린 성벽·자택·사원이 전부 x=57.5 로 모인 실제 결과.
        const collapsed = [{ x: 57.5, y: 27 }, { x: 57.5, y: 30 }, { x: 57.5, y: 42 }];
        expect(overlaps(collapsed).length, '재현 조건이 틀렸다').toBeGreaterThan(0);
        expect(overlaps(separateOverlaps(collapsed, GAP_X, GAP_Y))).toEqual([]);
    });

    it('앞선 배지는 건드리지 않는다 — 뒤쪽만 밀린다', () => {
        const list = [{ x: 57.5, y: 27 }, { x: 57.5, y: 30 }];
        const out = separateOverlaps(list, GAP_X, GAP_Y);
        expect(out[0]).toEqual({ x: 57.5, y: 27 });
        expect(out[1].y).toBeGreaterThan(27);
    });

    it('배열 길이와 순서를 보존한다', () => {
        const list = Object.values(CITY_SCENE_ART_ANCHORS);
        expect(separateOverlaps(list, GAP_X, GAP_Y)).toHaveLength(list.length);
    });

    it('빈 배열은 빈 배열', () => {
        expect(separateOverlaps([], GAP_X, GAP_Y)).toEqual([]);
    });

    it('무대 안에 머문다 — 아래로 밀려도 98 을 넘지 않는다', () => {
        const stack = Array.from({ length: 12 }, (_, i) => ({ x: 50, y: 90 + i }));
        const out = separateOverlaps(stack, GAP_X, GAP_Y);
        for (const p of out) {
            expect(p.x).toBeGreaterThanOrEqual(2);
            expect(p.x).toBeLessThanOrEqual(98);
            expect(p.y).toBeGreaterThanOrEqual(2);
            expect(p.y).toBeLessThanOrEqual(98);
        }
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


// ================================================================
// mapAnchorToStage — "그림 %" → "무대 %" ([49] 2026-10-02)
//
// 진입 화면이 창 크기 그대로가 되면서 종횡비 고정을 풀었다. 앵커 표는 *그림의 %* 라
// object-fit: cover 가 그림을 자르는 만큼 보정이 필요하다. 이 블록은 그 보정이
// CSS 가 아니라 계산으로 유지된다는 것을 고정한다.
// ================================================================

const ART_W = 1672;
const ART_H = 940;

describe('mapAnchorToStage — 그림 % → 무대 %', () => {
    it('16:9 무대면 항등이다 (기존 드리프트 0px 이 깨지지 않는다)', () => {
        for (const anchor of Object.values(CITY_SCENE_ART_ANCHORS)) {
            const m = mapAnchorToStage(anchor, ART_W, ART_H, 1672, 940);
            expect(m.x, `${anchor.x} x`).toBeCloseTo(anchor.x, 6);
            expect(m.y, `${anchor.y} y`).toBeCloseTo(anchor.y, 6);
        }
    });

    it('크기를 ratio 로만 줘도(1672x940 → 3344x1880) 항등이다', () => {
        const m = mapAnchorToStage({ x: 39, y: 15 }, ART_W, ART_H, 3344, 1880);
        expect(m.x).toBeCloseTo(39, 6);
        expect(m.y).toBeCloseTo(15, 6);
    });

    it('세로 창(4:3)에서는 좌우가 잘려 앵커가 바깥으로 벌어진다', () => {
        // 무대가 그림보다 좁으면 좌우가 잘린다. 중앙(50%) 기준으로 밀려난다.
        //   그림 39% → 무대 25.5%  (왼쪽으로, 즉 50% 에서 멀어진다)
        //   그림  0% → 무대 -61.2% (화면 밖 — 이 창에선 안 보이는 그림)
        const center = mapAnchorToStage({ x: 50, y: 50 }, ART_W, ART_H, 960, 1200);
        expect(center.x).toBeCloseTo(50, 6);
        const left = mapAnchorToStage({ x: 39, y: 15 }, ART_W, ART_H, 960, 1200);
        expect(left.x).toBeCloseTo(25.542553, 4);
        expect(left.x, '왼쪽 앵커는 50% 에서 멀어진다').toBeLessThan(39);
        // 세로로는 그림이 그대로 다 보이므로 y 는 안 움직인다.
        expect(left.y).toBeCloseTo(15, 6);
    });

    it('가로로 긴 창(21:9)에서는 위아래가 잘려 앵커가 바깥으로 벌어진다', () => {
        const center = mapAnchorToStage({ x: 50, y: 50 }, ART_W, ART_H, 2520, 1080);
        expect(center.y).toBeCloseTo(50, 6);
        const top = mapAnchorToStage({ x: 39, y: 15 }, ART_W, ART_H, 2520, 1080);
        expect(top.y).toBeCloseTo(4.086922, 4);
        expect(top.y, '위쪽 앵커는 50% 에서 멀어진다').toBeLessThan(15);
        // 가로로는 그림이 그대로 다 보인다.
        expect(top.x).toBeCloseTo(39, 6);
    });

    it('자르기 대칭이다 — 좌우로 돌려놓은 두 앵커의 거리는 같다', () => {
        const left = mapAnchorToStage({ x: 20, y: 50 }, ART_W, ART_H, 960, 1200);
        const right = mapAnchorToStage({ x: 80, y: 50 }, ART_W, ART_H, 960, 1200);
        expect(left.x).toBeCloseTo(100 - right.x, 6);
    });

    it('cover 로 보정한 뒤 실제 픽셀이 그림 위 앵커와 일치한다 (핵심 불변식)', () => {
        // 이게 이 함수의 존재 이유다. 보정 전(그림 % 를 그대로 %로 씀)과 비교하면
        // 최대 470px 어긋나던 것이 0 으로 수렴해야 한다.
        for (const [sw, sh] of [[960, 1200], [1440, 1080], [2520, 1080], [800, 600], [1920, 1080]]) {
            const cover = computeCoverPlacement(ART_W, ART_H, sw, sh);
            for (const anchor of Object.values(CITY_SCENE_ART_ANCHORS)) {
                const wantX = (anchor.x / 100) * ART_W;
                const wantY = (anchor.y / 100) * ART_H;
                const m = mapAnchorToStage(anchor, ART_W, ART_H, sw, sh);
                // 무대 % → 무대 px → 잘린 그림 좌표. 원래 앵커 px 와 같아야 한다.
                const gotX = (m.x / 100) * sw / cover.scale + cover.sx;
                const gotY = (m.y / 100) * sh / cover.scale + cover.sy;
                expect(gotX, `${sw}x${sh} 의 x`).toBeCloseTo(wantX, 6);
                expect(gotY, `${sw}x${sh} 의 y`).toBeCloseTo(wantY, 6);
            }
        }
    });

    it('보정하지 않았을 때의 오차를 실제로 줄인다 (항등 함수만 보지 않도록)', () => {
        // 세로 창에서 좌측 앵커는 그림 % 그대로 쓰면 이만큼 어긋난다.
        //   그림 12% 를 그대로 12% 로 쓰면 → 실제론 그림 -34.5% 에 있다.
        //   즉 둔영/사원/자택 라벨이 엉뚱한 건물 위를 가리킨다.
        const anchor = { x: 12, y: 40 };
        const fixed = mapAnchorToStage(anchor, ART_W, ART_H, 960, 1200);
        expect(fixed.x).toBeCloseTo(-34.489362, 4);
        expect(Math.abs(fixed.x - anchor.x), '보정이 실제로 어긋남을 없앤다').toBeGreaterThan(1);
    });

    it('잘려 나간 앵커는 음수/100 초과로 나온다 — 그것이 정답이다', () => {
        // 극단적으로 좁은 창에서는 좌측 앵커가 화면 밖으로 나간다. clampToStage 가
        // 화면 안으로 당기는 몫이므로 여기서 클램프하면 안 된다.
        const m = mapAnchorToStage({ x: 0, y: 50 }, ART_W, ART_H, 200, 1200);
        expect(m.x).toBeLessThan(0);
    });

    it('결과는 유한하다 (NaN 이 배지에 찍히면 안 된다)', () => {
        for (const [sw, sh] of [[1, 4000], [4000, 1], [333, 333]]) {
            for (const anchor of Object.values(CITY_SCENE_ART_ANCHORS)) {
                const m = mapAnchorToStage(anchor, ART_W, ART_H, sw, sh);
                expect(Number.isFinite(m.x), `${sw}x${sh} x`).toBe(true);
                expect(Number.isFinite(m.y), `${sw}x${sh} y`).toBe(true);
            }
        }
    });

    it('크기를 잴 수 없으면 앵커를 그대로 돌려준다 (패널 숨김·로드 전)', () => {
        const anchor = { x: 39, y: 15 };
        expect(mapAnchorToStage(anchor, 0, 0, 960, 1200)).toEqual(anchor);
        expect(mapAnchorToStage(anchor, ART_W, ART_H, 0, 1200)).toEqual(anchor);
        expect(mapAnchorToStage(anchor, ART_W, ART_H, 960, 0)).toEqual(anchor);
        expect(mapAnchorToStage(anchor, ART_W, ART_H, 0, 0)).toEqual(anchor);
    });

    it('입력 앵커를 변형하지 않는다 (참조로 받은 원본이 바뀌면 안 된다)', () => {
        const anchor = { x: 39, y: 15 };
        mapAnchorToStage(anchor, ART_W, ART_H, 960, 1200);
        expect(anchor).toEqual({ x: 39, y: 15 });
    });
// ── 무대 % 인셋 변환 [49] ──────────────────────────────────────────────
// main.ts 의 measureCitySceneInsets() 가 쓴다.
// 좌표 계산은 여기서 검증한다 — 문자열을 읽지 않고 실제 숫자를 계산한다.

describe('[49] toStageInset — 픽셀 rect → 무대 %', () => {
    const stage = { left: 100, top: 50, width: 1000, height: 500 };

    it('무대 좌상단이 기준점이다', () => {
        // 무대 왼쪽 위와 정확히 겹치는 패널 → 모든 값이 0
        const r = toStageInset({ left: 100, top: 50, right: 200, bottom: 150 }, stage);
        expect(r.left).toBeCloseTo(0);
        expect(r.top).toBeCloseTo(0);
    });

    it('패널이 무대 절반을 덮으면 50 이다', () => {
        const r = toStageInset({ left: 100, top: 50, right: 600, bottom: 300 }, stage);
        expect(r.right).toBeCloseTo(50);
        expect(r.bottom).toBeCloseTo(50);
    });

    it('무대 왼쪽 위 밖으로 뻗으면 음수가 된다 (그림 밖 HUD)', () => {
        const r = toStageInset({ left: 0, top: 0, right: 200, bottom: 100 }, stage);
        expect(r.left).toBeLessThan(0);
        expect(r.top).toBeLessThan(0);
    });

    it('오프셋된 무대에서도 상대 좌표가 맞는다', () => {
        const moved = { left: 500, top: 300, width: 800, height: 600 };
        const r = toStageInset({ left: 900, top: 600, right: 1300, bottom: 900 }, moved);
        expect(r.left).toBeCloseTo(50);
        expect(r.top).toBeCloseTo(50);
        expect(r.right).toBeCloseTo(100);
        expect(r.bottom).toBeCloseTo(100);
    });

    it('결정론이다', () => {
        const pane = { left: 120, top: 70, right: 380, bottom: 260 };
        expect(toStageInset(pane, stage)).toEqual(toStageInset(pane, stage));
    });
});

describe('[49] isVisibleRect — 숨은 패널 걸러내기', () => {
    it('가로·세로가 모두 양수면 보인다', () => {
        expect(isVisibleRect({ width: 100, height: 50 })).toBe(true);
    });

    it('폭이나 높이가 0 이면 숨었다 (도시를 열기 전)', () => {
        expect(isVisibleRect({ width: 0, height: 0 })).toBe(false);
        expect(isVisibleRect({ width: 100, height: 0 })).toBe(false);
        expect(isVisibleRect({ width: 0, height: 100 })).toBe(false);
    });

    it('음수 크기는 없다(드문 경우)를 방어한다', () => {
        expect(isVisibleRect({ width: -1, height: 10 })).toBe(false);
    });
});
// ── 내정치 바 [49] ────────────────────────────────────────────────────
// main.ts 의 statBar() 가 쓴다.

describe('[49] statBarPercent — 계율을 0~100 으로', () => {
    it('정상 범위는 그대로比例', () => {
        expect(statBarPercent(50, 100)).toBe(50);
        expect(statBarPercent(30, 60)).toBe(50);
    });

    it('최댓값을 넘으면 100 에 눌러 붙는다 (계율이 깨지지 않게)', () => {
        expect(statBarPercent(150, 100)).toBe(100);
    });

    it('음수면 0 이다', () => {
        expect(statBarPercent(-5, 100)).toBe(0);
    });

    it('max 가 0 이면 0 이다 (나누기 0 방지)', () => {
        expect(statBarPercent(10, 0)).toBe(0);
    });

    it('NaN 이면 0 이다 (깨진 값이 화면을 망가뜨리지 않게)', () => {
        expect(statBarPercent(NaN, 100)).toBe(0);
        expect(statBarPercent(10, NaN)).toBe(0);
    });
});

describe('[49] renderStatBar — 수치→HTML', () => {
    it('라벨·값·색을 모두 싣는다', () => {
        const html = renderStatBar({ label: '치안', value: 80, max: 100, color: '#0a0' });
        expect(html).toContain('치안');
        expect(html).toContain('width:80%');
        expect(html).toContain('#0a0');
        expect(html).toContain('>80<');   // 반올림된 값
    });

    it('value 를 반올림해 보여준다', () => {
        expect(renderStatBar({ label: 'x', value: 79.6, max: 100, color: '#000' })).toContain('>80<');
        expect(renderStatBar({ label: 'x', value: 79.4, max: 100, color: '#000' })).toContain('>79<');
    });

    it('계율이 100 을 넘지 않는다', () => {
        const html = renderStatBar({ label: 'x', value: 999, max: 100, color: '#000' });
        expect(html).toContain('width:100%');
        expect(html).not.toContain('width:999');
    });

    it('라벨에 HTML 이 들어와도 실행되지 않는다 (이스케이프)', () => {
        const html = renderStatBar({ label: '<img src=x onerror=alert(1)>', value: 1, max: 2, color: '#000' });
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });

    it('결정론이다', () => {
        const input = { label: '치안', value: 50, max: 100, color: '#123' };
        expect(renderStatBar(input)).toBe(renderStatBar(input));
    });
});
});
