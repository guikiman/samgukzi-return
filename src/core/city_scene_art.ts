/**
 * 도시 진입 화면 배경 그림 — 경로와 라벨 앵커.
 *
 * [왜 앵커 표가 필요한가]
 * 배경은 회사가 그린 그림이라 코드의 등각 격자 좌표와 어긋난다. 라벨을 종전의
 * 타원 링에 두면 그림 위에서 아무 데나 떠서 "어느 건물의 라벨인지" 알 수 없다.
 * 그래서 건물 타입마다 그림 위 좌표를 하나씩 둔다.
 *
 * 좌표는 **배경 이미지의 %** 다. 이미지가 정확히 16:9 이고, 화면의 무대는 같은
 * 16:9 비율이라 %가 그대로 대응한다 — 창 크기가 달라져도 라벨이 그림에서
 * 밀리지 않는다.
 */
import type { CityBuildingType } from './city_3d_renderer';

/** 배경 그림 경로. WebP(605KB, 원본 PNG 3.3MB). */
export const CITY_SCENE_ART_PATH = 'assets/city-scene-base.webp';

export interface SceneAnchor {
    readonly x: number;
    readonly y: number;
}

/**
 * HUD 패널 하나가 그림을 덮는 영역 (무대 % 좌표).
 * `.cdp-header` · `.cdp-info-pane` · `.cdp-side-pane` 이 유리 패널이라 앵커를 가린다.
 */
export interface SceneInset {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

/** 배지 중심이 이 안쪽에 들어가면 눌린다. */
const ANCHOR_MARGIN = 2.5;

function insideInset(anchor: SceneAnchor, inset: SceneInset): boolean {
    return anchor.x > inset.left - ANCHOR_MARGIN
        && anchor.x < inset.right + ANCHOR_MARGIN
        && anchor.y > inset.top - ANCHOR_MARGIN
        && anchor.y < inset.bottom + ANCHOR_MARGIN;
}

/** 인셋 경계에서 ANCHOR_MARGIN 만큼 떨어진 탈출 후보 4개. */
function escapeCandidates(anchor: SceneAnchor, inset: SceneInset): SceneAnchor[] {
    const y = Math.max(inset.top - ANCHOR_MARGIN, Math.min(inset.bottom + ANCHOR_MARGIN, anchor.y));
    return [
        { x: inset.left - ANCHOR_MARGIN, y },
        { x: inset.right + ANCHOR_MARGIN, y },
        { x: anchor.x, y: inset.top - ANCHOR_MARGIN },
        { x: anchor.x, y: inset.bottom + ANCHOR_MARGIN },
    ];
}

function clampToStage(anchor: SceneAnchor): SceneAnchor {
    const clamp = (v: number): number => Math.max(2, Math.min(98, v));
    return { x: clamp(anchor.x), y: clamp(anchor.y) };
}

function isClear(anchor: SceneAnchor, insets: readonly SceneInset[]): boolean {
    return !insets.some(inset => insideInset(anchor, inset));
}

/**
 * 서로 겹친 배지를 아래로 밀어 벌린다.
 *
 * [왜 필요한가]
 * resolveVisibleAnchor 는 "가장 가까운 탈출구"를 고르므로, 우측 통제 열에 눌린 성벽·자택·사원이
 * 전부 같은 왼쪽 경계(57.5%)로 모인다. 그럼 HUD 는 피하지만 배지끼리 겹쳐, 하나가 가려진
 * 채 눌리지 않는다 — 패널에 가려진 것만큼이나 나쁜 결과다. 그래서 두 번째로 겹침을 푼다.
 *
 * 앞선 배지는 이미 확정된 것으로 보고 뒤쪽 배지만 내린다. 앞것을 건드리지 않는 비대칭
 * 밀기라서 원래 배치가 최대한 보존된다.
 */
export function separateOverlaps(
    anchors: readonly SceneAnchor[],
    minGapX: number,
    minGapY: number,
): SceneAnchor[] {
    const placed: SceneAnchor[] = [];
    const result: SceneAnchor[] = [];
    for (const anchor of anchors) {
        let current = anchor;
        // 밀어낼 때마다 앞선 배지 전수를 다시 본다. 한 번만 보면 세 번째 배지와의 충돌을 놓친다.
        for (let pass = 0; pass < 8; pass++) {
            const clash = placed.find(p =>
                Math.abs(p.x - current.x) < minGapX && Math.abs(p.y - current.y) < minGapY);
            if (!clash) break;
            current = { x: current.x, y: clash.y + minGapY };
        }
        const settled = clampToStage(current);
        placed.push(settled);
        result.push(settled);
    }
    return result;
}

/**
 * 앵커를 사람이 누를 수 있는 곳으로 민다.
 *
 * [왜 고정 % 자르기가 안 되는가]
 * 우측 통제 열은 360px 고정이라 그림의 몇 % 를 덮는지가 창 너비마다 다르다.
 * 1440px 창에선 74.2% 지점부터, 1001px 창에선 62.8% 지점부터 가려진다. 앵커 표에
 * "이 % 아래로는 쓰지 마라" 같은 상수를 박아두면 어느 한쪽 창에서 반드시 죽는다.
 * 그래서 살아 있는 DOM rect 를 보고 그때그때의 안쪽 경계를 계산한다.
 *
 * 이미 안 가려진 앵커는 한 치도 움직이지 않는다 — 그림 위 좌표라는 약속을 지키기 위함.
 * 밀려난 끝은 2..98 로 잠가 배지가 그림 밖으로 밀려나지 않게 한다.
 */
export function resolveVisibleAnchor(anchor: SceneAnchor, insets: readonly SceneInset[]): SceneAnchor {
    if (insets.length === 0) return anchor;

    let current = anchor;
    // 한 인셋에서 빠져나온 점이 다른 인셋에 다시 걸릴 수 있어 안정될 때까지 민다.
    // 인셋 수는 3개뿐이라 4회면 충분하지만, 정지하지 않는 함수로 남기지 않으려고 상한을 둔다.
    for (let pass = 0; pass < 4; pass++) {
        if (isClear(current, insets)) return clampToStage(current);
        const covering = insets.find(inset => insideInset(current, inset));
        if (!covering) return clampToStage(current);

        // 탈출 후보를 무대 안으로 먼저 잘라낸 뒤 거리를 잰다. 순서를 뒤집으면 그림 밖으로
        // 나간 후보가 "가장 가깝다"고 오판돼, 클램프 후 다시 인셋 안으로 되돌아온다.
        // (자택 x=90 이 오른쪽 탈출(27.5)을 왼쪽(29.7)보다 골랐다가 98 로 되돌아온 실제 사례)
        let best: SceneAnchor | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const raw of escapeCandidates(current, covering)) {
            const candidate = clampToStage(raw);
            if (!isClear(candidate, insets)) continue;
            const distance = Math.hypot(candidate.x - current.x, candidate.y - current.y);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }
        // 어느 탈출구도 없으면(인셋이 무대를 꽉 채운 극단) 여기서 멈춘다. 무한 루프보다
        // 배지 하나가 가려진 채 있는 쪽이 낫다.
        if (!best) return clampToStage(current);
        current = best;
    }
    return clampToStage(current);
}

/**
 * 건물 타입 → 그림 위 라벨 위치 (%).
 *
 * ⚠ 추정값이다 — 그림을 보고 잡은 좌표라 실제 건물과 어긋날 수 있다.
 * 어긋난 곳을 알려주면 이 표만 고치면 된다. 좌표는 여기 한 곳에만 둔다.
 * 앵커가 HUD 패널 아래에 깔리는 문제는 resolveVisibleAnchor 가 처리하므로
 * 이 표는 "그림의 어디에 있는가"만 책임진다.
 */
export const CITY_SCENE_ART_ANCHORS: Record<CityBuildingType, SceneAnchor> = {
    // [2026-10-03 — 실측 기반 재조정]
    // 병영(12)·농지(13)·주택(90) 은 좁은 창(1001px)에서 stage 기준
    // x = -10.8 / -9.2 / 114 로 계산된다. object-fit: cover 가 16:9 그림을
    // 창 비율(4:3)로 맞추며 좌우를 잘라내기 때문이다 — 앵커가 아니라 *변환 결과* 가
    // 화면 밖이다. 즉 이 세 값은 해당 창에서 존재할 수 없는 좌표였다.
    // 도달 가능한 중앙 구간으로 옮겨 잘림을 없앤다.
    GOVERNMENT: { x: 39, y: 15 },  // 궁성 — 상단 고지대
    WALL: { x: 75, y: 27 },        // 성문 — 우측 성벽
    BARRACKS: { x: 22, y: 40 },    // 둔영 — 좌측 연습장
    MARKET: { x: 47, y: 45 },      // 시장 — 중앙
    // [2026-10-02] 사원 앵커를 실측으로 옮겼다.
    //   이전 값(58,30) 은 그림 % 로 확인한 결과 성벽 위 각루/굴뚝 자리였고,
    //   원본 PNG(1672x940)에 5%/1% 좌표 격자를 겹쳐 직접 판독했다.
    //   · (58,30) → 성벽 상단 망루. 사원이 아니다.
    //   · 실제 도심 주거/상점 지옥은 (54~70, 37~48) 에 걸친다. 그 한가운데가 이 값.
    //   · 참고로 도성 정문(아치 있는 큰 문루)은 (66~70, 29~35) 로 더 위쪽이라
    //     사원 라벨과 겹치지 않는다.
    TEMPLE: { x: 62, y: 42 },      // 사원 — 도성 안쪽 도심 저택/상점가
    WORKSHOP: { x: 45, y: 75 },    // 공방 — 하단 중앙
    FARM: { x: 24, y: 75 },        // 농촌 — 하단 좌측
    // [2026-10-03] 주택(90→80) 은 1001px 에서 여전히 stage 98 로 밀려났다.
    //   4:3 창에서 도달 가능한 오른쪽 경계가 약 88% 이므로 그 안쪽으로 물린다.
    HOUSE: { x: 76, y: 42 },       // 자택 — 우측
    // [2026-10-03] 주막 — 사용자가 지목한 "시장 표기된 건물 앞 건물".
    //   시장(47,45) 바로 아래 목조 상점가.
    //   TODO(2026-10-03): 스크린샷 판독이 컨텍스트 한도에 걸려 이 값을 눈으로
    //   확정하지 못했다. 좁은 창에서 resolveVisibleAnchor 가 아래로
    //   밀어내는지 반드시 재실측할 것 — 아직 검증 안 된 숫자다.
    TAVERN: { x: 47, y: 58 },
};

export interface CoverPlacement {
    readonly sx: number;
    readonly sy: number;
    readonly sw: number;
    readonly sh: number;
    readonly scale: number;
}

/**
 * object-fit: cover 와 같은 결과를 정수 연산으로 낸다.
 * 캔버스 drawImage 에는 object-fit 가 없으므로 같은 수식을 옮겨야 어떤 렌더러에서도
 * 결과가 같아진다.
 */
export function computeCoverPlacement(
    srcWidth: number,
    srcHeight: number,
    destWidth: number,
    destHeight: number,
): CoverPlacement {
    if (srcWidth <= 0 || srcHeight <= 0 || destWidth <= 0 || destHeight <= 0) {
        throw new Error(`computeCoverPlacement: 크기가 0 이하다 (${srcWidth}x${srcHeight} → ${destWidth}x${destHeight})`);
    }
    const scale = Math.max(destWidth / srcWidth, destHeight / srcHeight);
    const sw = destWidth / scale;
    const sh = destHeight / scale;
    return { sx: (srcWidth - sw) / 2, sy: (srcHeight - sh) / 2, sw, sh, scale };
}

/**
 * "그림 위 %" 앵커 → "무대 위 %" 좌표.
 *
 * [왜 이 함수가 필요한가 — 2026-10-02]
 * 앵커 표(CITY_SCENE_ART_ANCHORS)는 **그림의 %** 다. 무대가 그림과 같은 16:9 면
 * %가 그대로 대응해서 이 함수가 필요 없었다. 하지만 진입 화면을 창 크기 그대로
 * (16:9 고정 해제) 로 바꾸면 무대가 세로 창에서 4:3 이 되고, `object-fit: cover` 가
 * 그림을 좌우로 잘라낸다. 그러면 무대 12% 는 그림의 12% 가 아니라 잘린 뒤의 다른
 * 건물을 가리킨다 — 실측(원본 1672x940, 무대 960x1200)에서 최대 470px 어긋났다.
 *
 * 해법은 앵커를 고치는 게 아니라 **같은 cover 사각형을 한 번 더 적용** 하는 것이다.
 * 표시되는 그림 사각형(sx, sy, sw, sh) 안에서 앵커 px 를 뽑아 무대 % 로 되돌린다.
 * 비율이 같으면 sx=sy=0, scale=1 이라 항등 함수로 떨어진다(회귀 없음).
 *
 * 잘려 나간 앵커는 여기서 음수/100 초과가 될 수 있다 — 그건 *옳은* 답이다(그 건물이
 * 이 창에서는 보이지 않는다). 화면 안으로 당기는 것은 separateOverlaps 의
 * clampToStage 가 마지막에 책임진다.
 *
 * 크기를 잴 수 없으면(패널 아직 숨김, 그림 미로딩) 앵커를 그대로 돌려준다 — 조용히
 * 배치를 잃지 않기 위해.
 */
export function mapAnchorToStage(
    anchor: SceneAnchor,
    artWidth: number,
    artHeight: number,
    stageWidth: number,
    stageHeight: number,
): SceneAnchor {
    if (artWidth <= 0 || artHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) return anchor;
    const cover = computeCoverPlacement(artWidth, artHeight, stageWidth, stageHeight);
    const x = (((anchor.x / 100) * artWidth - cover.sx) * cover.scale) / stageWidth * 100;
    const y = (((anchor.y / 100) * artHeight - cover.sy) * cover.scale) / stageHeight * 100;
    return { x, y };
}

/**
 * 내정치 바 한 줄 생성 — 도시 진입 화면 [49]
 *
 * [왜 순수 함수인가]
 * - 이건 '수치 → HTML 조각' 변환일 뿐인데 화면 코드에 살려 있으면
 *   계율이 깨졌는지(100% 를 넘는지) 브라우저 없이 확인할 수 없다.
 * - 여기서는 값을 안전하게 만들어 돌려준다. DOM 을 만지지 않는다.
 */
export interface StatBarInput {
    readonly label: string;
    readonly value: number;
    readonly max: number;
    readonly color: string;
}

/** 값을 0~100 으로 눌러 준다. max 가 0 이면 0 을 준다(나누기 0 방지). */
export function statBarPercent(value: number, max: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    return Math.max(0, Math.min(100, (value / max) * 100));
}

/** HTML 조각을 만들 때 값이 깨지지 않도록 이스케이프한다. */
function escapeStatText(raw: string): string {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 내정치 바 한 줄의 HTML을 만든다.
 * @returns `<div class="cdp-stat-row">` 로 시작하는 문자열 (결정론)
 */
export function renderStatBar(input: StatBarInput): string {
    const pct = statBarPercent(input.value, input.max);
    const label = escapeStatText(input.label);
    const color = escapeStatText(input.color);
    const shown = Number.isFinite(input.value) ? Math.round(input.value) : 0;
    return '<div class="cdp-stat-row">'
        + `<span class="cdp-stat-label">${label}</span>`
        + '<span class="cdp-stat-bar-track">'
        + `<span class="cdp-stat-bar-fill" style="width:${pct}%;background:${color}"></span>`
        + '</span>'
        + `<span class="cdp-stat-value">${shown}</span>`
        + '</div>';
}

/** 앵커가 없는 타입이면 종전 타원 링으로 물러난다 — 배치를 놓치지 않게. */
export function anchorFor(type: CityBuildingType, fallbackIndex = 0, fallbackTotal = 1): SceneAnchor {
    const anchor = CITY_SCENE_ART_ANCHORS[type];
    if (anchor) return anchor;
    const angle = -Math.PI / 2 + (fallbackIndex * Math.PI * 2) / Math.max(1, fallbackTotal);
    return { x: 50 + 42 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) };
}

/**
 * 픽셀 사각형 둘을 무대 % 인셋으로 바꾼다.
 *
 * [왜 순수 함수로 떼어냈는가]
 * - 이 계산은 좌표계 변환일 뿐인데 DOM 을 직접 읽으면 브라우저 없이 검증할 수 없다.
 * - rect 를 넘겨받는 순수 함수로 만들면 단위 테스트가 되고,
 *   호출부(DOM)는 "rect 를 재서 넘기는" 한 줄만 남는다.
 *
 * @param pane HUD 패널의 화면 좌표 rect
 * @param stage 무대의 화면 좌표 rect
 * @returns 무대 기준 % 인셋. 무대가 없으면 null (배치를 조용히 잃지 않기 위해)
 */
export function toStageInset(
    pane: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number },
    stage: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): SceneInset {
    return {
        left: (pane.left - stage.left) / stage.width * 100,
        top: (pane.top - stage.top) / stage.height * 100,
        right: (pane.right - stage.left) / stage.width * 100,
        bottom: (pane.bottom - stage.top) / stage.height * 100,
    };
}

/** rect 하나가 유효한 크기를 갖는지 — 0 이면 숨겨진 패널이다. */
export function isVisibleRect(rect: { readonly width: number; readonly height: number }): boolean {
    return rect.width > 0 && rect.height > 0;
}
