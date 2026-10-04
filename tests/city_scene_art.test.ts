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
    clampAnchorToCover,
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
import { CITY_BUILDING_TYPES, City3DRenderer } from '../src/core/city_3d_renderer';

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

// ================================================================
// [2026-10-03] 앵커 값 자체를 고정한다 — 새 배경 그림 판독 결과.
//
// 왜 이 블록이 필요한가
// 앞의 테스트들은 전부 "형태"만 본다(9종 존재, 0~100 범위, 서로 8% 이상 떨어짐).
// 앵커가 *엉뚱한 건물* 로 돌아가도 —— 예를 들어 성문이 성벽 망루로 되돌아가도 ——
// 그 테스트들은 전부 통과한다. 실제로 2026-10-03 이전까지 그랬다.
// 그러므로 "어느 건물의 몇 픽셀인가" 를 값으로 고정해 둔다.
//
// 좌표는 원본 PNG(1672×940 = 게임 자산과 동일 규격) 위에 격자를 겹쳐 판독한 값이다.
// 규격이 같으므로 변환 계수가 1:1 이고, 아래 px 값에 16.72 / 9.4 로 나누면 % 가 된다.
// 판독 근거 원본: D:\samkukzi-re_DATA\도시 화면 ChatGPT Image 2026년 10월 3일 오후 12_27_07.png
// ================================================================

const ART_PX_W = 1672;
const ART_PX_H = 940;

/** 판독한 픽셀 좌표 → 앵커 표의 % 값과 일치하는지 본다. */
function expectAnchorMatchesPixels(type: string, px: number, py: number): void {
    const a = CITY_SCENE_ART_ANCHORS[type as keyof typeof CITY_SCENE_ART_ANCHORS];
    expect(a, `${type} 앵커가 없다`).toBeDefined();
    expect(a.x, `${type} x (px ${px} → %)`).toBeCloseTo((px / ART_PX_W) * 100, 1);
    expect(a.y, `${type} y (py ${py} → %)`).toBeCloseTo((py / ART_PX_H) * 100, 1);
}

describe('앵커 값 — 새 배경 그림 판독 결과에 고정', () => {
    it('판독 원본의 규격이 게임 자산 규격과 같다 — 좌표를 그대로 옮길 수 있는 전제', () => {
        // 이 전제가 깨지면 아래 픽셀 고정값이 전부 틀어진다(1672×940 이 아니면).
        // ART_W/ART_H 상수는 mapAnchorToStage 테스트가 이미 쓰는 값이므로 여기서 확인한다.
        expect(ART_PX_W).toBe(ART_W);
        expect(ART_PX_H).toBe(ART_H);
    });

    it('이름이 겹치는 9종은 판독 픽셀과 일치한다', () => {
        expectAnchorMatchesPixels('GOVERNMENT', 536, 250);   // 관청
        expectAnchorMatchesPixels('BARRACKS', 370, 590);    // 병영
        expectAnchorMatchesPixels('MARKET', 1040, 590);     // 시장
        // [2026-10-03 사용자 실측] 아래 둘은 이전 판독이 틀렸다. 그림에서 직접 재서 넘긴
        //   좌표로 바꾼다 — 공방은 이전 값보다 100px 왼쪽이 실제 위치였다.
        expectAnchorMatchesPixels('FARM', 1370, 637);       // 농장
        expectAnchorMatchesPixels('WORKSHOP', 1090, 418);   // 공방
        expectAnchorMatchesPixels('WALL', 836, 755);        // 성문
    });

    // [2026-10-03] 9종 → 12종. 아래 3채는 그림에 있고 코드에 없던 건물이므로
    //   좌표를 새로 박았다 — 좌표표 01·03·04 행이 그대로 대응한다.
    it('추가한 3종도 판독 픽셀과 일치한다', () => {
        expectAnchorMatchesPixels('PALACE', 836, 126);      // 궁전 · 최상단 중앙
        expectAnchorMatchesPixels('ACADEMY', 1153, 259);    // 태학 · 궁전 오른쪽
        expectAnchorMatchesPixels('BLACKSMITH', 405, 423);  // 대장간 · 좌측 중단
    });

    // [2026-10-03] 예전엔 '사원'·'주막'·'주택' 이 이 세 자리를 빌려 쓰고 있었다.
    //   좌표는 정확했으나 배지 이름이 다른 건물을 말해, "교역소 위인데 주막이라
    //   써 있다" 고 읽혔다. 이제 그림 이름을 그대로 쓴다.
    it('그림에 동명이었던 3종도 판독 픽셀과 일치한다', () => {
        expectAnchorMatchesPixels('SEOUN', 958, 275);           // 서원 · 학원 별관
        expectAnchorMatchesPixels('TRADING_HOUSE', 1331, 407);  // 교역소 · 우측 중단
        expectAnchorMatchesPixels('STABLE', 540, 650);         // 마구간 · 병영 오른쪽
    });

    it('12개 앵커가 좌표표 12행과 이름까지 1:1 로 일치한다 — 배지가 다른 건물을 말하지 않는다', () => {
        // [2026-10-03] 이게 이번 변경의 요지다. 예전엔 좌표는 맞는데 이름이
        // 달랐다(교역소 자리에 '주막'). 좌표·이름을 한 표로 묶어 1:1 을 강제한다.
        const ROWS: ReadonlyArray<readonly [string, number, number]> = [
            ['궁전', 836, 126], ['관청', 536, 250], ['태학', 1153, 259],
            ['대장간', 405, 423], ['서원', 958, 275], ['공방', 1090, 418],
            ['시장', 1040, 590], ['교역소', 1331, 407], ['농장', 1370, 637],
            ['병영', 370, 590], ['마구간', 540, 650], ['성문', 836, 755],
        ];
        const buildings = new City3DRenderer().generateCityLayout('city_1', 5, 'SPRING');
        const usedTypes = new Set<string>();
        for (const [name, px, py] of ROWS) {
            // (1) 이 좌표에 있는 배지가 정확히 하나여야 한다.
            // 비교는 **픽셀** 으로 한다. 앵커는 소수점 1자리 % 로 저장되므로 1672px 폭에서
            // 반올림 오차만으로 0.06%p(≈1px) 를 넘긴다. % 로 비교하면 정상 좌표가 실패한다.
            const hitPx = buildings.filter((b) => {
                const a = CITY_SCENE_ART_ANCHORS[b.type];
                return Math.abs((a.x / 100) * ART_PX_W - px) <= 1
                    && Math.abs((a.y / 100) * ART_PX_H - py) <= 1;
            });
            expect(hitPx.length, `${name}(px ${px},${py}) 자리에 배지가 ${hitPx.length} 개다 (1이어야 한다)`).toBe(1);
            // (2) 그 배지의 **이름**이 그림 이름과 같아야 한다.
            expect(hitPx[0].label, `px(${px},${py}) 의 배지 이름이 그림의 '${name}' 과 다르다`).toBe(name);
            usedTypes.add(hitPx[0].type);
        }
        // (3) 모든 타입이 정확히 한 행씩을 차지 — 숨은 배치가 없어야 한다.
        expect(usedTypes.size, `${usedTypes.size} 타입만 좌표표에 대응된다`).toBe(ROWS.length);
    });

it('그림에 없는 이름(사원·주막·주택·농지)이 배지로 남지 않는다', () => {
        // 회귀 방지. 예전 이름이 살아 있으면 배지가 다른 건물을 가리킨다.
        const labels = new City3DRenderer().generateCityLayout('city_1', 5, 'SPRING')
            .map((b) => b.label);
        for (const gone of ['사원', '주막', '주택', '농지', '성벽']) {
            expect(labels, `배지에 '${gone}' 이 남아 있다`).not.toContain(gone);
        }
    });

    it('추가한 3종은 그림의 빈자리를 채웠다 — 이전 추정치로 되돌아가지 않는다', () => {
        // [2026-10-03] 이 셋은 이전엔 앵커 자체가 없었다. 타입만 늘리고 좌표를
        //   옛 추정치(예컨대 관청 자리)로 되돌려도 테스트가 잡아낸다.
        const palace = CITY_SCENE_ART_ANCHORS.PALACE;
        expect(palace.y, '궁전이 최상단 중앙이 아니다').toBeLessThan(20);
        expect(Math.abs(palace.x - 50), '궁전이 좌우 중앙이 아니다').toBeLessThan(3);
        // 태학은 관청의 정반대편(우측)이다 — 좌우로 뒤집히면 잡힌다.
        expect(CITY_SCENE_ART_ANCHORS.ACADEMY.x, '태학이 좌측으로 돌아갔다')
            .toBeGreaterThan(CITY_SCENE_ART_ANCHORS.GOVERNMENT.x);
        // 대장간은 병영보다 위(중단)다 — 병영 자리에 겹쳐 놓으면 잡힌다.
        expect(CITY_SCENE_ART_ANCHORS.BLACKSMITH.y, '대장간이 병영 자리로 내려갔다')
            .toBeLessThan(CITY_SCENE_ART_ANCHORS.BARRACKS.y);
    });

    it('이전 추정치가 되살아나지 않는다 — 성문은 하단 중앙이다', () => {
        // 2026-10-03 이전 값. 성벽 위 망루(75,27)를 가리키고 있었다.
        // 이 테스트가 없으면 "그림 보고 고친다" 는 취지가 조용히 사라진다.
        const wall = CITY_SCENE_ART_ANCHORS.WALL;
        expect(wall.x, '성문이 중앙에서 벗어나 있다').toBeLessThan(60);
        expect(wall.y, '성문이 상단 망루 자리로 돌아갔다').toBeGreaterThan(70);
    });

    it('농지는 우측이다 — 이전에는 좌측이었다(좌우 반전)', () => {
        // 2026-10-03 이전 값 (24,75). 실제 그림의 농장은 우측 하단이다.
        const farm = CITY_SCENE_ART_ANCHORS.FARM;
        expect(farm.x, '농지가 좌측으로 돌아갔다(실제로는 우측 하단)').toBeGreaterThan(70);
    });

    it('공방은 하단 중앙이 아니라 우측 중단이다', () => {
        // 2026-10-03 이전 값 (45,75).
        const w = CITY_SCENE_ART_ANCHORS.WORKSHOP;
        expect(w.x, '공방이 좌측으로 돌아갔다(실제로는 우측 중단)').toBeGreaterThan(65);
        expect(w.y, '공방이 하단으로 돌아갔다(실제로는 중단)').toBeLessThan(55);
    });

    it('병영은 하단이다 — 이전에는 중단이었다', () => {
        // 2026-10-03 이전 값 (22,40). x 는 그대로인데 y 가 23% 어긋나 있었다.
        expect(CITY_SCENE_ART_ANCHORS.BARRACKS.y, '병영이 상단으로 돌아갔다').toBeGreaterThan(55);
    });

    it('교역소는 시장 옆이 아니라 우측 상단이다 — 사용자 실측을 따른 변경', () => {
        // [2026-10-03 사용자 실측] 이 테스트는 예전엔 "교역소는 시장 옆" 이라는 요구를
        // 고정했다. 그런데 사용자가 그림을 직접 재서 넘긴 좌표는 px(1331,407) 이다 —
        // 시장 px(1040,590) 과는 y 가 183px(19.5%p) 나고, 같은 줄이 아니다.
        // 그림이 시장 옆 배치를 보여주지 않으므로 테스트가 그림을 따르도록 고친다.
        // 좌표표가 아니라 **실측**이 기준이다.
        const m = CITY_SCENE_ART_ANCHORS.MARKET;
        const t = CITY_SCENE_ART_ANCHORS.TRADING_HOUSE;
        expect(t.x, '교역소가 시장보다 왼쪽이다 — 실측은 오른쪽이다').toBeGreaterThan(m.x);
        expect(t.y, '교역소가 시장보다 아래다 — 실측은 위쪽이다').toBeLessThan(m.y);
        // 공방·교역소가 같은 줄에 있지 않으면, 그 줄의 라벨이 서로를 가리지 않는다.
        expect(Math.abs(t.x - CITY_SCENE_ART_ANCHORS.WORKSHOP.x),
            '교역소가 공방과 같은 x 다 — 두 라벨이 겹친다').toBeGreaterThan(8);
    });

    it('모든 앵커가 HUD 안전영역 안에 있다 — 1672×940 실측', () => {
        // style.css 기준으로 1672×940 창에서 헤더/좌·우 레일/하단 시설줄이 덮는 영역을
        // 대략 envelop 으로 잡았다. 좌 16.2% · 우 83.8% · 상 6.5% · 하 93%.
        // resolveVisibleAnchor 가 밀어내긴 하지만, *원본* 이 그 안에 있으면
        // 밀어내는 동작 없이 제자리에 선다 — 이게 상태다.
        const SAFE = { left: 16.2, right: 83.8, top: 6.5, bottom: 93 };
        for (const [type, a] of Object.entries(CITY_SCENE_ART_ANCHORS)) {
            expect(a.x, `${type} 이 좌측 HUD 아래에 있다`).toBeGreaterThanOrEqual(SAFE.left);
            expect(a.x, `${type} 이 우측 HUD 아래에 있다`).toBeLessThanOrEqual(SAFE.right);
            expect(a.y, `${type} 이 상단 HUD 아래에 있다`).toBeGreaterThanOrEqual(SAFE.top);
            expect(a.y, `${type} 이 하단 HUD 아래에 있다`).toBeLessThanOrEqual(SAFE.bottom);
        }
    });
});

describe('라벨 앵커', () => {
    it('건물 12종 모두 앵커가 있다', () => {
        expect(CITY_BUILDING_TYPES.every(k => CITY_SCENE_ART_ANCHORS[k] !== undefined)).toBe(true);
        // [2026-10-03] 8 → 9 → 12.
        //   9까지: 주막(TAVERN) 추가. 원인은 좌표가 아니라 타입 부재였다 —
        //   FacilityType.TAVERN 은 있는데 CityBuildingType 에 없어서
        //   시장 앞 건물에 배지가 나올 수 없었다.
        //   12까지: 배경 그림의 12개 건물을 타입으로 모두 표현한다.
        //   앵커와 BUILDING_DEFS 는 Record<> 라서 타입만 늘리면 컴파일이 깨진다 —
        //   "빠뜨리지 않게" 를 강제하는 것이 이 표의 존재 이유다.
        expect(CITY_BUILDING_TYPES).toHaveLength(12);
    });

    it('추가한 3종이 실제 배치에 나온다 — 앵커만 있어도 배지는 안 뜬다', () => {
        // [2026-10-03] 회귀 방지. generateCityLayout 의 typePool 에 새 3종을
        //   넣지 않으면 타입·앵커는 있어도 배지가 영영 안 떠 화면엔 9개만 보인다.
        // developmentLevel 은 게임에서 Math.min(5, development/20) 로 5 가 상한이다.
        //   예전 값(2) 을 쓰면 최대로 아무리 커도 10채여서 대장간이 11번에 걸려
        //   제외됐다 — 그래서 이전에는 lv=12 로 값을 넘겨 통과시켜 보였다.
        //   **실제 상한 5 로 검사한다.**
        const renderer = new City3DRenderer();
        const buildings = renderer.generateCityLayout('city_1', 5, 'SPRING');
        const drawn = new Set(buildings.map(b => b.type));
        for (const t of CITY_BUILDING_TYPES) {
            expect(drawn.has(t), `${t} 이 최대 도시(${buildings.length}채)에 나오지 않는다`).toBe(true);
        }
    });

    it('건물 수가 유형 수를 넘지 않는다 — 인덱스가 풀 밖으로 새지 않는다', () => {
        // [2026-10-03] 15칸 풀에 15채를 뽑으면 i % poolLength 가 0 으로 돌아와
        //   첫 건물이 두 번 나온다. 유형 수(=12) 상한은 이 중복을 막는 안전장치다.
        const renderer = new City3DRenderer();
        for (const lv of [1, 2, 3, 4, 5, 10, 40]) {
            const buildings = renderer.generateCityLayout('city_1', lv, 'SPRING');
            expect(new Set(buildings.map(b => b.id)).size, `lv=${lv} 에 id 가 겹친다`).toBe(buildings.length);
            expect(new Set(buildings.map(b => b.type)).size, `lv=${lv} 에 유형이 반복된다`).toBe(buildings.length);
        }
    });

    it('저장 키 cityId:i 의 유형이 이전과 같게 유지된다 — 저장이 건물로 전이되면 안 된다', () => {
        // [2026-10-03] 유형을 늘릴 때 가장 쉬운 사고. 풀 맨 앞에 새 유형을 끼워 넣으면
        //   인덱스 8 이후의 저장이 전부 엉뚱한 건물로 옮겨 간다(예: 주택에 투자한
        //   500金 이 궁전에 붙는다). 앞 8칸은 건드리지 않았다는 것을 고정한다.
        //   [이름 변경] 4번은 TEMPLE→SEOUN, 7번은 TAVERN→TRADING_HOUSE 로 이름만
        //   바뀌었다. 좌표(그림 위치)가 그대로라 저장은 같은 자리에 붙는다.
        const renderer = new City3DRenderer();
        const types = renderer.generateCityLayout('city_1', 5, 'SPRING').map(b => b.type);
        expect(types.slice(0, 8)).toEqual([
            'GOVERNMENT', 'BARRACKS', 'MARKET', 'FARM',
            'SEOUN', 'WORKSHOP', 'WALL', 'TRADING_HOUSE',
        ]);
    });

    it('추가한 3종의 라벨이 그림 이름과 같다', () => {
        // 라벨이 어긋나면 플레이어는 "태학" 이라는 이름을 화면에서 처음 보게 된다.
        const byType = (t: string): string | undefined =>
            new City3DRenderer().generateCityLayout('city_1', 5, 'SPRING')
                .find(b => b.type === t)?.label;
        expect(byType('PALACE')).toBe('궁전');
        expect(byType('ACADEMY')).toBe('태학');
        expect(byType('BLACKSMITH')).toBe('대장간');
    });

    // [2026-10-03] 사용자 지적 "성벽은 성문으로 이름을 표시 해줘".
    it('WALL 배지는 "성벽" 이 아니라 "성문" 이다 — 배지가 가리키는 그림이 정문이다', () => {
        // 앵커는 하단 중앙 아치 정문(px 836,755) 을 가리킨다. 라벨만 성벽이면
        // 플레이어는 위쪽 성벽을 가리키는 것으로 읽고 앵커를 의심한다.
        const renderer = new City3DRenderer();
        const buildings = renderer.generateCityLayout('city_1', 5, 'SPRING');
        const wall = buildings.find((b) => b.type === 'WALL');
        expect(wall, 'WALL 이 배치되지 않았다').toBeTruthy();
        expect(wall!.label).toBe('성문');
    });

    it('배지 라벨 12개가 모두 좌표표의 이름과 일치한다', () => {
        // 라벨이 '성벽' 처럼 그림과 다른 이름이면 앵커(그림 좌표)와 어긋나 보인다.
        // type → 그 앵커가 가리키는 그림 건물의 이름을 한 표로 고정한다.
        const EXPECTED: ReadonlyArray<readonly [string, string]> = [
            ['GOVERNMENT', '관청'], ['BARRACKS', '병영'], ['MARKET', '시장'],
            ['FARM', '농장'], ['WORKSHOP', '공방'], ['WALL', '성문'],
            ['PALACE', '궁전'], ['ACADEMY', '태학'], ['BLACKSMITH', '대장간'],
            ['SEOUN', '서원'], ['TRADING_HOUSE', '교역소'], ['STABLE', '마구간'],
        ];
        const byType = new Map(CITY_BUILDING_TYPES.map(t => [
            t,
            new City3DRenderer().generateCityLayout('city_1', 5, 'SPRING')
                .find(b => b.type === t)?.label,
        ]));
        for (const [type, label] of EXPECTED) {
            expect(byType.get(type), `${type} 라벨`).toBe(label);
        }
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

describe('clampAnchorToCover — 잘린 그림의 배지가 엉뚱한 건물을 가리키지 않게 한다', () => {
    // [2026-10-03] 실측으로 발견한 재현.
    // 900x1200 창에서 cover 는 그림을 가운데 483.5..1188.5px 로 자른다. 병영(370)은
    // 그 왼쪽이라 화면에 없다. 그런데 clampToStage 는 그것을 2%(≈497.6px)로 당겨
    // **다른 건물 위**를 가리켰다. 이 테스트는 그 숫자를 그대로 고정한다.
    it('잘린 앵커를 크롭 경계에 붙인다 — 엉뚱한 건물 위가 아니라', () => {
        const croppedLeft = mapAnchorToStage({ x: 370 / ART_PX_W * 100, y: 590 / ART_PX_H * 100 },
            ART_PX_W, ART_PX_H, 900, 1200);
        expect(croppedLeft.x, '병영이 잘리지 않았다 — 전제 자체가 바뀌었다').toBeLessThan(0);
        const fixed = clampAnchorToCover(croppedLeft);
        // 크롭 경계에서 ANCHOR_MARGIN(2.5%) 만큼 안쪽이다. 좌표계는 무대 % 다.
        expect(fixed.x).toBeCloseTo(2.5, 6);
        expect(fixed.y, 'y 는 밀리지 않는다').toBeCloseTo(croppedLeft.y, 6);
    });

    it('오른쪽으로 잘린 앵커도 오른쪽 경계에 붙는다', () => {
        // 농지(1270) 는 900x1200 에서 오른쪽으로 잘린다.
        const cropped = mapAnchorToStage({ x: 1270 / ART_PX_W * 100, y: 680 / ART_PX_H * 100 },
            ART_PX_W, ART_PX_H, 900, 1200);
        expect(cropped.x).toBeGreaterThan(100);
        expect(clampAnchorToCover(cropped).x).toBeCloseTo(97.5, 6);
    });

    it('안 잘린 앵커는 한 치도 안 움직인다 — 16:9 창 회귀 없음', () => {
        // 가로 창에서는 아무것도 잘리지 않는다. 이 경로를 건드리면 멀쩡한 배치가 깨진다.
        for (const [type, anchor] of Object.entries(CITY_SCENE_ART_ANCHORS)) {
            const onStage = mapAnchorToStage(anchor, ART_PX_W, ART_PX_H, 1600, 900);
            expect(clampAnchorToCover(onStage), `${type} 이 움직였다`).toEqual(onStage);
        }
    });

    it('두 경계 밖을 동시에 벗어나면 더 먼 쪽으로 가지 않는다 — 한 창에서 한 점만 나온다', () => {
        // 극단 창에서 앵커 하나가 좌우로 다 튀어나올 수 없어 방향 판정이 항상 하나로 끝난다.
        const fixed = clampAnchorToCover({ x: -500, y: 50 });
        expect(fixed.x).toBeGreaterThanOrEqual(0);
        expect(fixed.x).toBeLessThanOrEqual(100);
        expect(clampAnchorToCover({ x: 500, y: 50 }).x).toBeCloseTo(97.5, 6);
    });

    it('y 만 튀어나온 경우에도 x 를 건드리지 않는다', () => {
        // 세로 창에서 위아래가 잘리면 y 가 범위를 벗어나는데, x 는 멀쩡하다.
        // 이때 x 를 경계로 당기면 멀쩡한 좌우 위치가 망가진다.
        const tall = { x: 50, y: 130 };
        const fixed = clampAnchorToCover(tall);
        expect(fixed.x).toBe(50);
        expect(fixed.y, 'y 는 그대로 둔다 — 세로 크롭은 이 함수 몫이 아니다').toBe(130);
    });

    it('입력이 이미 화면 안이면 원본과 동일한 객체를 돌려준다 (재계산 비용·참조 보존)', () => {
        const anchor = { x: 50, y: 40 };
        expect(clampAnchorToCover(anchor)).toBe(anchor);
    });

    // [2026-10-03 되돌린 시도] "배지 반폭을 크롭 마진에 더해 배지를 화면 안에 넣자" 는 안 된다.
    //   배지를 안쪽으로 밀면 그림이 실제로 그만큼 잘렸는데도 배지가 보이는 쪽에 서서
    //   그 자리의 다른 건물을 가리킨다. 실측 768x1024 창 교역소: 크롭 경계 1162.6,
    //   밀고 나서 실측 1143.4 = 19px 안쪽 → E2E 의 "경계 45px 이내면 정상" 계약이 깨진다.
    //   배지 반쪽이 잘리는 것은 "이 창에서는 저쪽 편" 이라는 대가로 치러는 편이 낫다.
    //   아래는 그 계약이 지켜진다는 것을 고정한다.
    it('잘린 배지는 크롭 경계에 붙는다 — 다른 건물을 가리키지 않는다', () => {
        // 오른쪽으로 잘린 앵커는 오른쪽 경계(97.5%)에, 왼쪽은 왼쪽 경계(2.5%)에 붙는다.
        expect(clampAnchorToCover({ x: 130, y: 50 }).x).toBeCloseTo(97.5, 6);
        expect(clampAnchorToCover({ x: -30, y: 50 }).x).toBeCloseTo(2.5, 6);
        // 배지 폭만큼 안쪽으로 밀지 않는다 — 밀면 크롭 경계 뒤의 다른 건물 위가 된다.
        expect(clampAnchorToCover({ x: 130, y: 50 }).x).toBeGreaterThan(90);
    });
});

describe('배지 배선 순서 — 커롭 보정이 HUD 회피보다 먼저다', () => {
    it('main.ts 가 clampAnchorToCover 를 실제로 호출한다 (죽은 코드 방지)', () => {
        const src = readFileSync(resolve(REPO_ROOT, 'src', 'main.ts'), 'utf8');
        expect(src).toMatch(/import \{[^}]*clampAnchorToCover[^}]*\} from '\.\/core\/city_scene_art\.js'/);
        const body = src.slice(src.indexOf('function applyCitySceneBadgePositions'));
        expect(body, 'applyCitySceneBadgePositions 를 찾지 못했다').toBeTruthy();
        const coverAt = body.indexOf('clampAnchorToCover');
        const hudAt = body.indexOf('resolveVisibleAnchor');
        expect(coverAt, 'clampAnchorToCover 가 없다').toBeGreaterThan(-1);
        expect(hudAt, 'resolveVisibleAnchor 가 없다').toBeGreaterThan(-1);
        expect(coverAt, 'HUD 회피가 커롭 보정보다 먼저다 — 순서를 뒤집으면 배지가 엉뚱한 건물 위를 가리킨다')
            .toBeLessThan(hudAt);
    });

    it('크롭 보정에는 배지 반폭을 섞지 않는다 — 잘린 배지는 경계에 붙어야 한다', () => {
        // [2026-10-03 되돌린 시도] 배지 반폭을 크롭 마진에 더하면 배지가 안쪽으로 밀려
        // 그림이 실제로 그만큼 잘렸는데도 보이는 쪽에 서서 다른 건물을 가리킨다
        // (768x1024 교역소: 경계 1162.6 → 실측 1143.4). E2E 의 경계 45px 계약도 깨진다.
        const src = readFileSync(resolve(REPO_ROOT, 'src', 'main.ts'), 'utf8');
        const body = src.slice(src.indexOf('function applyCitySceneBadgePositions'));
        expect(body, 'clampAnchorToCover 에 두 번째 인자를 넘긴다 — 경계 계약을 깨뜨린다')
            .toMatch(/clampAnchorToCover\(\s*\w+\s*\)/);
        expect(body, 'separateOverlaps 뒤에 배지를 다시 안쪽으로 당긴다 — 같은 이유로 되돌린다')
            .not.toMatch(/Math\.max\(\s*halfW\s*,\s*Math\.min\(\s*100\s*-\s*halfW/);
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
            for (const type of ['WALL', 'STABLE'] as const) {
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
