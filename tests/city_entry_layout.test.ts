/**
 * [49] 도시 진입 화면 배경 레이아웃 회귀 테스트
 * 파일: tests/city_entry_layout.test.ts
 *
 * ─────────────────────────────────────────────────────────────────────
 * 이 테스트가 막는 실제 사고
 * ─────────────────────────────────────────────────────────────────────
 * 사용자가 "도시 진입 화면이 상하좌우로 꽉 차지 않는다" 고 보고했다. 스크린샷엔
 * 16:9 그림이 가운데에 있고 위아래가 검정 띠로 남아 있었다.
 *
 * 두 번에 걸쳐 다른 원인이 있었다.
 *
 *   1) `@media (max-width: 1000px)` 안의
 *      `#city-detail-panel.city-entry-mode .cdp-stage-pane { grid-row: auto; ... }`
 *      가 같은 블록의 `grid-area: stage` 를 **덮어쓴다.** shorthand 를 longhand 로
 *      풀어쓴 순서 때문에 자동 배치로 빠지고, 패널 grid 의 1행(auto)에 앉는다.
 *      → 무대가 위쪽에 몰리고 아래 1fr 행이 빈칸이 되어 검정 띠가 전부 하단에 쌓인다.
 *      실측: 1000x900 창에서 stage y=12 h=549, 하단 여백 339px.
 *      960x1200 창에서는 stage y=12 h=526.5, 하단 여백 661.5px(화면의 57.4%).
 *      + `margin: 0` 이 음수 마진 풀블리드를 풀어 좌우 12px 검정 틈을 만든다.
 *
 *   2) 종횡비 고정 — `width: min(100%, calc(100vh * 16 / 9))` 와
 *      `aspect-ratio: 16 / 9`. 창이 16:9 가 아니면 그림이 남는 자리를 못 채운다.
 *      실측 검정 면적: 1600x1000 = 10.0%, 1000x900 = 40.5%, 960x1200 = 57.2%.
 *      남는 자리를 흐린 백드롭으로 덮는 해법은 2026-10-02 에 통째로 걷어냈다.
 *
 * [왜 종횡비 고정을 풀었는데 앵커는 여전히 맞는가 — 앵커 계약]
 * 앵커(CITY_SCENE_ART_ANCHORS)는 **그림의 %** 다. 무대까지 16:9 면 %가 그대로
 * 대응하지만, 무대를 창 비율로 바꾸면 `.city-scene-art` 의 `object-fit: cover` 가
 * 그림을 잘라내고 무대 % ≠ 그림 % 가 된다(실측 최대 470px 드리프트).
 * 이 테스트는 그 정합을 **CSS 가 아니라 계산**으로 옮겼음을 요구한다:
 * `city_scene_art.mapAnchorToStage()` 가 같은 cover 사각형을 한 번 더 적용하고,
 * main.ts 의 applyCitySceneBadgePositions() 가 HUD 회피 *이전에* 그걸 거친다.
 * 비율이 같으면 항등이라 16:9 창의 드리프트 0px 은 그대로 유지된다.
 *
 * 검증 축:
 *  1. 여백 0 계약: 패널·무대·섹션·스테이지 모두 창 크기 그대로, 고정 종횡비 없음
 *  2. 앵커 계약: 종횡비 대신 mapAnchorToStage() 계산으로 정렬을 지킨다
 *  3. 배지 배선 계약: .cdp-stage-hud-layer 가 무대를 덮고(inset:0),
 *     measureCitySceneInsets() 가 읽는 네 selector 가 그대로 살아 있다
 *  4. 실패해도 안전: 그림이 404 여도 art-ready 가 안 켜진다 (절차 렌더 유지)
 *  5. 비-진입 모드(일반 도시 패널) 스타일이 되돌아가지 않는다
 *
 * 소유권: 이 테스트는 tests/city_entry_layout.test.ts 단독 소유.
 *        style.css · index.html · src/main.ts 는 읽기 전용으로만 사용한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * @media 블록을 통째로 걷어낸 CSS — "기본 분기" 의 규칙을 찾을 때만 쓴다.
 *
 * [왜 필요한가]
 * `.cdp-stage-hud-left` 처럼 브레이크포인트 안에 *같은 이름* 의 규칙이 또 있다.
 * media 를 그대로 두고 첫 매치를 찾으면 좁은 분기의 폭 규칙을 "기본 규칙" 으로
 * 잘못 집어 assertion 이 조용히 아무것도 안 보는 테스트가 된다.
 */
function stripMedia(css: string): string {
    let out = css;
    for (;;) {
        const at = /@media[^{]*\{/.exec(out);
        if (!at) return out;
        let i = at.index + at[0].length;
        let depth = 1;
        while (i < out.length && depth > 0) {
            if (out[i] === '{') depth++;
            else if (out[i] === '}') depth--;
            i++;
        }
        out = out.slice(0, at.index) + out.slice(i);
    }
}
const BASE_CSS = stripMedia(CSS_NO_COMMENTS);

// --------------------------------------------------------------- 최소 CSS 파서

/**
 * 헤더(선택자 또는 @media 조건)의 선언 블록 본문을 통째로 뽑는다. 중첩 {} 를 센다.
 *
 * [왜 앞에 (^|[};]) 앵커를 두는가]
 * ".city-scene-stage" 로 검색하면 `#city-detail-panel.city-entry-mode .city-scene-stage`
 * 의 *꼬리* 가 먼저 걸린다. 그러면 진입 모드 규칙을 "기본 규칙" 으로 잘못 집어
 * position/overflow 검사(비-진입 모드 계약)가 통째로 무의미해진다.
 * 선택자가 온전히 시작하는 곳(줄 첫머리 · } 뒤 · , 뒤)에서만 매칭한다.
 */
function findBlock(css: string, header: string): string | null {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = new RegExp('(?:^|[};,])\\s*' + escaped + '\\s*\\{').exec(css);
    if (!at) return null;
    let i = at.index + at[0].length;
    let depth = 1;
    const start = i;
    while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
    }
    return css.slice(start, i - 1);
}

/**
 * TypeScript 함수 본문을 통째로 뽑는다.
 *
 * [왜 findBlock 을 못 쓰는가]
 * findBlock 은 헤더 앞에 `(^|[};,])` 를 요구하는데, 그건 CSS 규칙 앞에는
 * 항상 문자가 붙어 있다는 전제다. TS 함수는 JSDoc 주석 뒤에 오므로
 * 앵커가 안 맞아 null 이 나온다. 여기서는 공백을 허용한 앵커를 쓴다.
 * 반환 타입이 있는 선언(`function f(): void {`)도 있으므로 `{` 앞은 한 줄을 허용한다.
 */
function findTsFunction(source: string, signature: string): string | null {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const header = '(?:^|[}\\n])\\s*' + escaped + '[^\\n{]*\\{';
    const at = new RegExp(header).exec(source);
    if (!at) return null;
    let i = at.index + at[0].length;
    let depth = 1;
    const start = i;
    while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
        i++;
    }
    return source.slice(start, i - 1);
}

/** 컨테이너(예: @media 블록) 안의 평면 규칙 목록. */
function rulesInside(css: string, containerHeader: string): { selector: string; body: string }[] {
    const container = findBlock(css, containerHeader);
    if (container === null) return [];
    const out: { selector: string; body: string }[] = [];
    const re = /([^{}]+)\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(container)) !== null) {
        const selector = m[1].trim();
        let i = re.lastIndex;
        let depth = 1;
        const start = i;
        while (i < container.length && depth > 0) {
            if (container[i] === '{') depth++;
            else if (container[i] === '}') depth--;
            i++;
        }
        out.push({ selector, body: container.slice(start, i - 1) });
        re.lastIndex = i;
    }
    return out;
}

/** 선언 하나만 읽는다. 뒤쪽 선언이 앞쪽을 이기므로 마지막 등장을 취한다. */
function decl(body: string, property: string): string | null {
    let found: string | null = null;
    for (const m of body.matchAll(/(^|;)\s*([a-z-]+)\s*:\s*([^;]+)/gi)) {
        if (m[2].toLowerCase() === property.toLowerCase()) found = m[3].trim();
    }
    return found;
}

const STAGE_PANE = '#city-detail-panel.city-entry-mode .cdp-stage-pane';
const STAGE_SECTION = '#city-detail-panel.city-entry-mode .city-scene-section';
const STAGE = '#city-detail-panel.city-entry-mode .city-scene-stage';
const PANEL = '#city-detail-panel.city-entry-mode';
const NARROW = '@media (max-width: 1000px)';

/** 여백을 만드는 프로퍼티 — 진입 화면 어딘가에 이게 있으면 회귀다. */
const PADDING_PROPS = ['padding', 'margin', 'gap'];

/**
 * 진입 화면 규칙 어디에나 있는 종횡비 고정을 전부 뽑아 낸다.
 * 선택자를 나열해서 찾지 않는다 — 브레이크포인트 안에 같은 이름이 또 있어도
 * 놓치지 않으려면 블록 전체를 훑어야 한다.
 */
function findAll(css: string, property: string): string[] {
    const hits: string[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
        const value = decl(m[2], property);
        if (value !== null) hits.push(`${m[1].trim()} { ${property}: ${value} }`);
    }
    return hits;
}


// ================================================================
// [49] 1. 여백 0 계약 — 창 크기가 아니라면 다시 검정 띠가 생긴다
// ================================================================

describe('[49] 도시 진입 화면 — 상하좌우 여백이 0 이어야 한다', () => {
    const panel = findBlock(CSS_NO_COMMENTS, PANEL);
    const pane = findBlock(CSS_NO_COMMENTS, STAGE_PANE);
    const section = findBlock(CSS_NO_COMMENTS, STAGE_SECTION);
    const stage = findBlock(CSS_NO_COMMENTS, STAGE);

    it('패널 자체가 여백 0 이다 (12px 패딩이 곧 좌우 검정 틈이었다)', () => {
        expect(panel, `${PANEL} 규칙을 찾지 못했다`).not.toBeNull();
        expect(decl(panel!, 'padding')).toBe('0');
        expect(decl(panel!, 'display')).toBe('block');
        // grid 를 쓰면 헤더용 auto 행이 남아 위쪽에 빈 행이 생긴다.
        expect(decl(panel!, 'grid-template-rows')).toBeNull();
        expect(decl(panel!, 'grid-template-areas')).toBeNull();
    });

    it('무대가 창 크기 그대로다 (100% × 100%, stretch 정렬)', () => {
        expect(pane, `${STAGE_PANE} 규칙을 찾지 못했다`).not.toBeNull();
        expect(decl(pane!, 'width')).toBe('100%');
        expect(decl(pane!, 'height')).toBe('100%');
        // center 로 두면 남는 여백이 위아래로 갈려 그대로 검정 띠가 된다.
        expect(decl(pane!, 'align-items')).toBe('stretch');
        expect(decl(pane!, 'justify-content')).toBe('stretch');
        // 음수 마진 풀블리드는 더 이상 필요 없다 — 패널 여백이 0 이다.
        expect(decl(pane!, 'margin')).toBeNull();
    });

    it('섹션과 스테이지 모두 종횡비 고정 없이 높이를 채운다', () => {
        expect(section, `${STAGE_SECTION} 규칙을 찾지 못했다`).not.toBeNull();
        expect(decl(section!, 'width')).toBe('100%');
        expect(decl(section!, 'height')).toBe('100%');
        // 여백을 만들던 상한식 — 이게 돌아오면 세로 창에 검정 띠가 생긴다.
        expect(decl(section!, 'width')).not.toMatch(/16\s*\/\s*9/);
        expect(stage, `${STAGE} 규칙을 찾지 못했다`).not.toBeNull();
        expect(decl(stage!, 'width')).toBe('100%');
        expect(decl(stage!, 'height')).toBe('100%');
    });

    it('진입 화면 어딘가에도 종횡비 고정이 없다 (aspect-ratio 재도입 방지)', () => {
        const hits = findAll(CSS_NO_COMMENTS, 'aspect-ratio')
            .filter((h) => h.includes('city-entry-mode'));
        expect(hits, '진입 화면에 aspect-ratio 가 돌아왔다 — 여백이 생긴다').toEqual([]);
    });

    it('@media (max-width: 1000px) 는 여백을 다시 만들지 않는다', () => {
        // 사용자 보고의 직접 원인. 좁은 분기에 .cdp-stage-pane 규칙이 하나라도
        // 다시 생기면 아래 세부 검사들이 전부 red 로 돌아간다.
        const offenders = rulesInside(CSS_NO_COMMENTS, NARROW)
            .filter((r) => r.selector.includes('.cdp-stage-pane'));
        expect(
            offenders.map((r) => `${r.selector} { ${r.body.replace(/\s+/g, ' ').trim()} }`),
            '좁은 분기에서 .cdp-stage-pane 를 다시 다룬다 — 여백이 생긴다',
        ).toEqual([]);
    });

    it('@media (max-width: 1000px) 안에 여백 프로퍼티를 건드리는 규칙이 없다', () => {
        // 규칙이 selector 를 바꿔도 놓치지 않도록 블록 전체를 훑는다.
        for (const prop of PADDING_PROPS) {
            const hits = rulesInside(CSS_NO_COMMENTS, NARROW)
                .filter((r) => decl(r.body, prop) !== null)
                .map((r) => r.selector);
            expect(hits, `좁은 분기에서 ${prop} 를 건드린다`).toEqual([]);
        }
        const narrowBody = findBlock(CSS_NO_COMMENTS, NARROW) ?? '';
        expect(narrowBody).not.toMatch(/grid-row\s*:\s*auto/);
        expect(narrowBody).not.toMatch(/grid-column\s*:\s*auto/);
        expect(narrowBody).not.toMatch(/aspect-ratio/);
    });

    // [2026-10-03] 좌·우 레일을 걷어냈으므로 좁은 분기는 헤더 폭만 조절한다.
    //   레일 폭 규칙은 레일을 좁히던 것이므로 대상이 사라지면 함께 사라져야 한다 —
    //   남겨두면 아무 효과 없이 "좁은 화면 대응" 이라는 잘못된 인상을 준다.
    it('좁은 분기는 헤더 폭만 조절한다 (좌·우 레일은 제거됨)', () => {
        const selectors = rulesInside(CSS_NO_COMMENTS, NARROW).map((r) => r.selector);
        expect(selectors.some((s) => s.includes('.cdp-header'))).toBe(true);
        expect(selectors.some((s) => s.includes('.cdp-stage-hud-left'))).toBe(false);
        expect(selectors.some((s) => s.includes('.cdp-stage-hud-right'))).toBe(false);
    });
});


// ================================================================
// [49] 2. 앵커 계약 — 종횡비 대신 계산으로 정렬을 지킨다
// ================================================================

describe('[49] 앵커 정렬은 mapAnchorToStage() 계산으로 유지된다', () => {
    const section = findBlock(CSS_NO_COMMENTS, STAGE_SECTION);
    const art = findBlock(CSS_NO_COMMENTS, '.city-scene-art');

    it('그림은 cover 로 스테이지를 채운다', () => {
        expect(art, '.city-scene-art 규칙을 찾지 못했다').not.toBeNull();
        expect(decl(art!, 'position')).toBe('absolute');
        expect(decl(art!, 'inset')).toBe('0');
        expect(decl(art!, 'object-fit')).toBe('cover');
    });

    it('무대가 그림 위에 오고, HUD 는 그보다 위에 오른다', () => {
        expect(Number(decl(section!, 'z-index'))).toBe(1);
        expect(Number(decl(findBlock(CSS_NO_COMMENTS, '.cdp-stage-hud-layer')!, 'z-index'))).toBeGreaterThan(1);
    });

    it('mapAnchorToStage 가 main.ts 에서 실제로 쓰인다 (죽은 코드 방지)', () => {
        // 이게 없으면 종횡비를 풀어 놓은 채 앵커 정렬만 사라진다 — 배지가 엉뚱한 곳.
        expect(MAIN_TS).toMatch(/import \{[^}]*mapAnchorToStage[^}]*\} from '\.\/core\/city_scene_art\.js'/);
        expect(MAIN_TS).toMatch(/mapAnchorToStage\(/);
    });

    it('cover 보정이 HUD 회피보다 먼저 온다 (같은 좌표계여야 한다)', () => {
        // 인셋은 "무대 %" 다. 앵커를 보정하지 않고 인셋과 비교하면 서로 다른 축을
        // 비교하는 셈이라 배지가 HUD 아래에 그대로 깔린다.
        const body = findTsFunction(MAIN_TS, 'function applyCitySceneBadgePositions()');
        expect(body, 'applyCitySceneBadgePositions() 를 찾지 못했다').not.toBeNull();
        const mapped = body!.indexOf('mapAnchorToStage(');
        const insets = body!.indexOf('measureCitySceneInsets()');
        const resolved = body!.indexOf('resolveVisibleAnchor(');
        expect(mapped, 'cover 보정이 없다').toBeGreaterThanOrEqual(0);
        expect(resolved).toBeGreaterThanOrEqual(0);
        expect(mapped, 'cover 보정이 resolveVisibleAnchor 이후다').toBeLessThan(resolved);
        expect(insets, '인셋 측정이 없다').toBeGreaterThanOrEqual(0);
        expect(insets, '인셋 측정이 resolveVisibleAnchor 이후다').toBeLessThan(resolved);
    });

    it('그림 크기가 없으면 앵커를 그대로 쓴다 (패널 숨김·로드 전 안전)', () => {
        // 조건부 분기가 없으면 로드 전 naturalWidth 가 0 인 채로 나누기가 돈다.
        const body = findTsFunction(MAIN_TS, 'function applyCitySceneBadgePositions()')!;
        expect(body, 'applyCitySceneBadgePositions() 를 찾지 못했다').toBeTruthy();
        expect(body).toMatch(/citySceneArt\?\.naturalWidth/);
        expect(body).toMatch(/citySceneArtReady\s*&&/);
        expect(body).toMatch(/stageRect\.width\s*>\s*0\s*&&\s*stageRect\.height\s*>\s*0/);
    });

    it('창 크기가 바뀌면 배지를 다시 계산한다 (리사이즈 후 드리프트 방지)', () => {
        expect(MAIN_TS).toMatch(/addEventListener\('resize'[\s\S]{0,400}?applyCitySceneBadgePositions\(\)/);
    });

    it('[회귀] 창 크기가 바뀌면 도시 캔버스도 다시 그린다', () => {
        // [2026-10-03 실제 결함] 도시 캔버스의 backing-store 가 480x240 으로 고정돼
        //   있어서, 창을 키워도 CSS 만 늘어나고 내부는 그대로였다. 즉 사용자가 본
        //   "도시화면 좌우 리사이징이 안 된다" 의 정체다. 캔버스가 무대 크기를
        //   따라가는지(= 하드코딩이 사라졌는지)와, 리사이즈 때 다시 그려지는지
        //   둘 다 지켜야 이 회귀가 다시 들어오지 않는다.
        const draw = findTsFunction(MAIN_TS, 'function drawCityCanvas(');
        expect(draw, 'drawCityCanvas() 를 찾지 못했다').not.toBeNull();
        // 크기는 무대 rect 에서 얻어야 한다(= 하드코딩이 아니어야 한다).
        expect(draw!).toMatch(/getBoundingClientRect\(\)/);
        // `const width = 480;` / `const height = 240;` 같은 리터럴 할당이 있으면
        // 창 크기를 못 따라간다. BASE_H = 240 같은 기준 상수는 타일 배율용이라 허용한다.
        expect(draw!).not.toMatch(/const\s+width\s*=\s*480\b/);
        expect(draw!).not.toMatch(/const\s+height\s*=\s*240\b/);
        expect(draw!).not.toMatch(/citySceneCanvas\.width\s*=\s*480\b/);
        expect(draw!).not.toMatch(/citySceneCanvas\.height\s*=\s*240\b/);
        // 리사이즈 경로에서 캔버스를 다시 그려야 이전 크기가 남지 않는다.
        expect(MAIN_TS).toMatch(/addEventListener\('resize'[\s\S]{0,400}?redrawCitySceneCanvas\(\)/);
        // 클릭 판정도 같은 타일 크기를 써야 한다(어긋나면 엉뚱한 건물이 선택된다).
        const pick = findTsFunction(MAIN_TS, 'function selectCitySceneBuilding(');
        expect(pick, 'selectCitySceneBuilding() 을 찾지 못했다').not.toBeNull();
        expect(pick!).not.toMatch(/worldToScreen\([^)]*,\s*42\s*,\s*21\s*\)/);
    });

    it('DOM 에 백드롭 요소가 없다 — 여백이 없어서 통째로 걷어냈다', () => {
        // blur(26px) 전면을 한 장 더 그리는 층. 여백이 0 이면 렌더 비용만 남는다.
        expect(INDEX_HTML).not.toContain('cdp-stage-backdrop');
        expect(MAIN_TS).not.toContain('citySceneBackdrop');
        expect(CSS_NO_COMMENTS).not.toContain('cdp-stage-backdrop');
    });

    it('배경 경로 상수는 main.ts 한 곳에서 나온다', () => {
        expect(MAIN_TS).toMatch(/citySceneArt\.src\s*=\s*CITY_SCENE_ART_PATH/);
    });

    it('배지 라벨은 전체 건물 이름을 쓴다 (첫 글자만 자르지 않는다)', () => {
        // 2026-10-02 사용자 요청 — "시" 말고 "시장". slice 로 자르면 조용히 돌아간다.
        expect(MAIN_TS).toMatch(/<span class="city-badge-label">\$\{building\.label\}<\/span>/);
        expect(MAIN_TS, '라벨을 첫 글자로 잘라 내지 않는다').not.toMatch(/city-badge-label[^`]*slice\(/);
    });

    it('라벨 글자가 2배 크기(26px)이고 배지는 그 폭을 담는다', () => {
        // 13px → 26px. 두 글자는 52px 라 34px 원형에 담기지 않는다.
        expect(decl(findBlock(CSS_NO_COMMENTS, '.city-badge-label')!, 'font-size')).toBe('26px');
        const badge = findBlock(CSS_NO_COMMENTS, '.city-badge')!;
        expect(decl(badge, 'border-radius'), '원형이 아니라 필 모양이어야 한다').not.toBe('50%');
        expect(decl(badge, 'height'), '고정 높이가 없어야 두 줄이 담긴다').toBe('auto');
        expect(decl(badge, 'white-space')).toBe('nowrap');
    });

    it('건물 이름은 반투명 글씨다 — 그림을 가리지 않는다', () => {
        // 2026-10-02 사용자 요청 — "투명 글씨".
        const label = findBlock(CSS_NO_COMMENTS, '.city-badge-label')!;
        // 불투명한 색(예: var(--gold-bright), #fff)으로 돌아가면 회귀다.
        const color = decl(label, 'color')!;
        expect(color, '라벨 색이 없거나 rgba 가 아니다').toMatch(/^rgba\(/);
        const alpha = Number(color.match(/,\s*([\d.]+)\s*\)$/)?.[1] ?? 1);
        expect(alpha, '라벨이 불투명하다').toBeLessThan(1);
        expect(alpha, '라벨이 0 이면 안 보인다').toBeGreaterThan(0);
        // 그림 위에서도 실루엣이 읽혀야 하므로 그림자를 남긴다.
        expect(decl(label, 'text-shadow'), '라벨 그림자가 없다').not.toBeNull();
    });

    it('배지에는 이름만 쓴다 — 레벨 숫자를 되살리지 않는다', () => {
        // 2026-10-03 사용자 요청 — "건물이름 아래 수자가 써있는데 삭제 할 것".
        // 하단 시설줄이 이미 "주막 Lv.0/3" 을 보여주므로 배지에 숫자를 다시 얹으면
        // 이름 실루엣만 가린다. 여기서 배지를 되돌리면 조용히 화면이 더러워진다.
        expect(MAIN_TS, '배지에 레벨 숫자를 다시 넣었다').not.toContain('city-badge-level');
        expect(CSS_NO_COMMENTS, '레벨 숫자 CSS 가 남아 있다').not.toContain('.city-badge-level');
        // 정보는 title(hover)과 하단 시설줄에 남겨야 한다 — 사라지면 되돌릴 길이 없다.
        expect(MAIN_TS, 'hover 툴팁에 레벨이 없다').toMatch(/title="\$\{building\.label\} Lv\.\$\{building\.level\}"/);
    });

    it('배지 배경도 옅다 — 진한 판은 그림을 가린다', () => {
        const badge = findBlock(CSS_NO_COMMENTS, '.city-badge')!;
        const bg = decl(badge, 'background')!;
        expect(bg).toMatch(/^rgba\(/);
        const alpha = Number(bg.match(/,\s*([\d.]+)\s*\)$/)?.[1] ?? 1);
        expect(alpha, '배지 판이 너무 진하다').toBeLessThan(0.5);
    });

    it('hover 하면 진해진다 — 투명하지만 확인 순간엔 읽힌다', () => {
        const hoverLabel = findBlock(CSS_NO_COMMENTS, '.city-badge:hover .city-badge-label');
        expect(hoverLabel, 'hover 규칙이 없다 — 확인 순간에 이름이 안 읽힌다').not.toBeNull();
        expect(decl(hoverLabel!, 'color')).toMatch(/^rgba\(/);
    });

    it('그림 load 실패 때 art-ready 를 켜지 않는다 (절차 렌더 유지)', () => {
        expect(MAIN_TS).toMatch(/addEventListener\('load'[\s\S]{0,400}?classList\.add\('art-ready'\)/);
        expect(MAIN_TS).toMatch(/addEventListener\('error'[\s\S]{0,400}?classList\.remove\('art-ready'\)/);
    });
});


// ================================================================
// [49] 3-4. 배지 배선 계약 — measureCitySceneInsets() 가 살아 있어야 한다
// ================================================================

describe('[49] HUD 인셋 측정 계약이 유지된다 (앵커가 HUD 아래로 깔리면 안 된다)', () => {
    const layer = findBlock(CSS_NO_COMMENTS, '.cdp-stage-hud-layer');

    it('.cdp-stage-hud-layer 은 무대를 그대로 덮는다 (inset: 0)', () => {
        expect(layer, '.cdp-stage-hud-layer 규칙이 없다').not.toBeNull();
        expect(decl(layer!, 'position')).toBe('absolute');
        expect(decl(layer!, 'inset')).toBe('0');
    });

    it('.cdp-stage-hud-layer 은 pointer-events 가 꺼져 있고 HUD 만 켠다', () => {
        // 켜져 있으면 레이어가 무대 전체를 덮어 배지를 못 누른다.
        expect(decl(layer!, 'pointer-events')).toBe('none');
    });

    // [2026-10-03] 좌·우 레일을 걷어냈으므로 인셋은 셋만 읽는다:
    //   상단 바 · 하단 시설줄 · (열린 경우) 그림 위 정보 시트.
    it('measureCitySceneInsets() 가 읽는 selector 가 그대로다', () => {
        for (const sel of [
            '.cdp-header',
            '.cdp-scene-sheet:not([hidden])',
            '.cdp-stage-hud-bottom',
        ]) {
            expect(MAIN_TS, `${sel} 가 인셋 목록에서 빠졌다`).toContain(sel);
        }
        expect(MAIN_TS).toMatch(/for \(const selector of \[[^\]]*'\.cdp-header'/);
        // 레일 selector 가 되살아나면 안 된다 — 존재하지 않는 패널을 피해 배지를
        // 다시 밀어내 그림 위치가 조용히 어긋난다.
        for (const gone of ['.cdp-stage-hud-left', '.cdp-stage-hud-right']) {
            expect(MAIN_TS, `${gone} 가 인셋 목록으로 돌아왔다`).not.toContain(gone);
        }
    });

    const TRANSPARENT_HUD =
    '#city-detail-panel.city-entry-mode .cdp-stage-hud';

    it('상단·하단 바와 좌·우 사이드바는 완전 투명 — 그림이 그대로 비친다', () => {
        // 2026-10-03 사용자 요청 — "상단 하단바 좌우 사이드바 완전 투명하게".
        const rule = findBlock(CSS_NO_COMMENTS, TRANSPARENT_HUD);
        expect(rule, '투명 규칙이 없다 — 유리판이 그대로 남는다').not.toBeNull();
        expect(decl(rule!, 'background'), '판이 남아 있다').toBe('none');
        // 판만 없애면 backdrop-filter blur 가 남는다. 그건 "투명"이 아니라 "흐림"이라
        // 사용자가 원한 것과 정반대다. 이 두 줄이 없으면 회귀다.
        expect(decl(rule!, 'backdrop-filter'), 'blur 가 남아 그림을 흐리게 만든다').toBe('none');
        expect(decl(rule!, '-webkit-backdrop-filter'), 'webkit blur 가 남아 있다').toBe('none');
        expect(decl(rule!, 'box-shadow'), '판 그림자가 남아 있다').toBe('none');
        // 테두리는 `border: 0` 이어야 한다. `border-color: transparent` 로는 안 된다.
        //
        // [왜 transparent 가 안 되는가 — 실측]
        // `border-color` 는 width/style 을 리셋하지 않는다. 기본 .cdp-stage-hud 의
        // `border: 1px solid rgba(212,175,55,.28)` 위에서는 1px 선이 그대로 남고
        // 요소만 2px 커진다(실측 height 40 → 42). "완전 투명" 이 아니라 "투명한 선" 이다.
        //   border: 0         → borderTopWidth 0px, style none, height 40
        //   border-color:transparent → borderTopWidth 1px, style solid, height 42
        // 판을 걷는 목적이 테두리 *제거* 이므로 0 이 맞다.
        // (style.css 의 옛 주석이 "transparent 가 width/style 을 0 으로 떨어뜨린다"고
        //  적어 있는데, 그건 border: 0 이 한 일이었다. 인과가 뒤집힌 서술이다.)
        expect(decl(rule!, 'border')).toBe('0');
        expect(decl(rule!, 'border-color'), '테두리가 1px 선으로 남아 있다').toBeNull();
        // 판을 걷어낸 자리에는 실루엣만으로 읽히게 한다 — 이것이 없으면 배경 위에 묻힌다.
        expect(decl(rule!, 'text-shadow'), '텍스트 그림자가 없다').not.toBeNull();
    });

    // [2026-10-03] 좌·우 레일을 걷어냈으므로 이 계약의 대상이 사라졌다.
    //   예전 실측(800x600 창에서 stage 를 +2.9px 넘음)의 원인이 레일 폭의 순환 해석이었으니
    //   레일이 없는 이상 다시 생길 수 없다. 대신 *시트*가 무대 밖으로 나가지 않는지 본다.
    it('정보 시트가 무대 안에 머문다 (레일 대체분)', () => {
        const sheet = findBlock(BASE_CSS, '.cdp-scene-sheet');
        expect(sheet, '.cdp-scene-sheet 규칙이 없다').not.toBeNull();
        expect(decl(sheet!, 'position')).toBe('absolute');
        // width 가 min(..., 88%) 라 어떤 창에서도 무대보다 넓어지지 않는다.
        expect(decl(sheet!, 'width'), '시트 폭이 무대 기준으로 묶이지 않았다').toMatch(/min\(/);
        // hidden 인 동안에는 화면에 없어야 한다 — display 로 덮으면 닫혀도 보인다.
        const hidden = findBlock(CSS_NO_COMMENTS, '.cdp-scene-sheet[hidden]');
        expect(hidden, '시트가 닫혀도 표시된다 — [hidden] 규칙이 없다').not.toBeNull();
        expect(decl(hidden!, 'display')).toBe('none');
        // 레일 규칙이 되살아나면 안 된다 — 접힘·자동 접힘 계약이 돌아오면 배지가 어긋난다.
        for (const gone of ['.cdp-stage-hud-left', '.cdp-stage-hud-right', '.cdp-rail-toggle']) {
            expect(CSS_NO_COMMENTS, `${gone} 규칙이 되살아났다`).not.toContain(gone);
        }
    });

    it('날카로운 그림과 앵커 표는 그대로 16:9 전제를 유지한다', () => {
        const art = findBlock(CSS_NO_COMMENTS, '.city-scene-art');
        expect(decl(art!, 'object-fit')).toBe('cover');
        expect(MAIN_TS).toMatch(/CITY_SCENE_ART_ANCHORS|anchorFor/);
    });
});

// ================================================================
// 비-진입 모드 회귀 — 일반 도시 패널은 건드리지 않는다
// ================================================================

describe('[49] 비-진입 모드 도시 패널은 되돌아가지 않는다', () => {
    it('#city-detail-panel 기본 규칙이 그대로다 (우측 280px 사이드 패널)', () => {
        const base = findBlock(BASE_CSS, '#city-detail-panel');
        expect(base, '#city-detail-panel 기본 규칙이 없다').not.toBeNull();
        expect(decl(base!, 'position')).toBe('absolute');
        expect(decl(base!, 'width')).toBe('280px');
        expect(decl(base!, 'display')).toBe('none');
    });

    it('.city-scene-stage 기본 규칙이 그대로다 (절차 렌더 2:1 캔버스)', () => {
        const stage = findBlock(BASE_CSS, '.city-scene-stage');
        expect(stage, '.city-scene-stage 기본 규칙을 찾지 못했다').not.toBeNull();
        expect(decl(stage!, 'position')).toBe('relative');
        expect(decl(stage!, 'overflow')).toBe('hidden');
        const canvas = findBlock(BASE_CSS, '.city-scene-canvas');
        expect(decl(canvas!, 'aspect-ratio')).toBe('2 / 1');
    });

    it('.city-scene-art 는 art-ready 여야만 보인다 (로딩 전 숨김 계약)', () => {
        expect(decl(findBlock(BASE_CSS, '.city-scene-art')!, 'display')).toBe('none');
        const ready = findBlock(BASE_CSS, '.city-scene-stage.art-ready .city-scene-art');
        expect(decl(ready!, 'display')).toBe('block');
    });

    it('백드롭 규칙이 완전히 사라졌다 (일반 패널에 새 div 가 새지 않는다)', () => {
        // 16:9 여백 백드롭은 2026-10-02 에 제거됐다. CSS 에 흔적이 남으면
        // 일반 도시 패널(비-진입 모드)까지 영향을 준다.
        expect(findBlock(BASE_CSS, '.cdp-stage-backdrop')).toBeNull();
    });
});
