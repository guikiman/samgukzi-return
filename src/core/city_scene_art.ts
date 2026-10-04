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
/**
 * 잘려 나간 앵커를 **화면 가장자리의 대응 지점**으로 되돌린다.
 *
 * [2026-10-03 — 실측으로 발견한 문제]
 * object-fit: cover 는 중앙 고정 크롭이다. 그래서 세로로 긴 창(900x1200 등)에서는
 * 보이는 그림이 가운데 483.5px~1188.5px 구간으로 좁아지며, **그 밖의 건물 9개가
 * 아예 화면 밖으로 잘려 나간다.** 실측 결과:
 *   · 1600x1000 → 잘린 건물 0      · 900x1200 → 병영·농지·공방·대장간·주막 등 5개
 *   · 600x1400 → 9개 중 9개
 *
 * 그 창에서 mapAnchorToStage 는 그런 앵커를 음수/100 초과로 돌려주고,
 * clampToStage 가 2..98 로 당긴다. 그런데 크롭 사각형 밖은 화면에서도 바깥이므로,
 * 당긴 자리는 **크롭 경계에 밀착한다** — 실측에서 병영이 370px 인데 497.6px 로
 * 127.6px 밀렸다. 즉 "누군가의 건물" 위를 가리키는 배지가 되어 버린다.
 *
 * 해법: 잘려 나간 앵커는 화면 밖이지만 **크롭 경계에서 가장 가까운 보이는 점**으로
 * 옮긴다. 그래야 배지가 "이 창에서는 저쪽 편에 있다" 는 사실만 알리고, 엉뚱한 건물을
 * 가리키지 않는다. 그림이 실제로 그만큼 잘렸다는 사실을 감추지도 않는다.
 *
 * @param stageAnchor mapAnchorToStage 결과를 무대 % 로 준 값
 * @param stageAnchor mapAnchorToStage 결과를 무대 % 로 준 값
 * @param stageAnchor mapAnchorToStage 결과를 무대 % 로 준 값
 */
export function clampAnchorToCover(stageAnchor: SceneAnchor): SceneAnchor {
    // 좌표계 혼동 주의: stageAnchor.x 는 **무대 %** 다. ANCHOR_MARGIN 도 % 라서
    // 두 값을 그냥 비교하면 된다. px 로 바꿀 이유가 없다 —
    // 크롭 여부는 좌표가 범위를 벗어났는지로 이미 드러나기 때문이다.
    // (이전 판본은 margin 에 무대 너비 px 를 곱해 % 자리에 px 를 넣어,
    //  멀쩡한 32.1% 앵커를 40%로 밀어버렸다.)
    //
    // [2026-10-03] 배지 반폭을 margin 에 더하는 시도를 되돌렸다. 배지를 안쪽으로
    // 밀면 그림이 실제로 그만큼 잘렸는데도 배지가 "보이는 쪽" 에 서서 그 자리의 다른
    // 건물을 가리키게 된다(768x1024 교역소: 경계 1162.6 → 1143.4). E2E 가 경계
    // 45px 이내를 정상으로 판정하는 계약(EDGE_TOL_PX)도 깨진다. 배지 반쪽이 보이는
    // 것은 "이 창에서는 저쪽 편" 이라는 사실을 알리는 대가다.
    const margin = ANCHOR_MARGIN;
    // 이미 보이는 좌표면 손대지 않는다 — 정상 경로를 바꾸지 않는다.
    if (stageAnchor.x >= margin && stageAnchor.x <= 100 - margin) {
        return stageAnchor;
    }
    return {
        x: stageAnchor.x < margin ? margin : 100 - margin,
        y: stageAnchor.y,
    };
}

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
 * ⚠ [2026-10-03 — 전면 재실측] 아래 값은 추정치가 아니라 **그림 위에 실제 좌표
 * 격자를 겹쳐 판독한 값** 이다. 근거는 두 가지다.
 *
 * 1) 판독에 쓴 원본은 1672×940 이다 — 게임 자산(city-scene-base.webp) 과 같은 규격.
 *    그래서 픽셀 → % 변환에 다른 계수가 없다. `px / 16.72`, `py / 9.4` 이 곧 % 다.
 *    이전 값들은 16:9 가정 위에 서 있어 그림과 어긋난 채 남아 있었다.
 *
 * 2) 판독 결과를 이름이 겹치는 9종에 그대로 붙였다. 남는 3종(서원·교역소·마구간)
 *    은 코드에 대응 타입이 없었는데, 지금은 그림 이름을 그대로 타입으로 삼았다
 *    (SEOUN·TRADING_HOUSE·STABLE). 그래서 **12개 앵커와 좌표표 12행이 이름까지
 *    포함해 1:1 로 일치**한다 — 배지가 다른 건물을 가리키는 일이 없다.
 *
 * ⚠ 이전 값과 크게 달라진 곳 — 이게 배지가 엉뚱한 건물을 가리키던 실제 원인이다.
 *   · WALL    (75,27) → (50, 80.3)  이전엔 우측 성벽 망루. 실제 성문은 **하단 중앙**.
 *   · WORKSHOP(45,75) → (71.2,44.7) 이전엔 하단 중앙. 실제 공방은 **우측 중단**.
 *   · FARM    (24,75) → (76.0,72.3) 이전엔 좌측. 실제 농장은 **우측 하단**(좌↔우 반전).
 *   · BARRACKS(22,40) → (22.1,62.8) x 는 같고 y 만 23% 어긋남(병영은 하단이다).
 *   · MARKET  (47,45) → (62.2,62.8) 중앙이 아니라 **우측 하단 중앙**이었다.
 *
 * [2026-10-03 이름 통일] 사원·주막·주택은 그림에 없는 이름이라 서원·교역소·마구간
 *   자리를 빌려 쓰고 있었다. 좌표는 정확했으나 배지 이름이 다른 건물을 말했다.
 *   성벽→성문(위 WALL)에 이어 서원·교역소·마구간·농장으로 이름도 그림에 맞췄다.
 *
 * 앵커가 HUD 패널 아래에 깔리는 문제는 resolveVisibleAnchor 가 처리하므로
 * 이 표는 "그림의 어디에 있는가"만 책임진다.
 */
export const CITY_SCENE_ART_ANCHORS: Record<CityBuildingType, SceneAnchor> = {
    // ── 이름이 정확히 겹치는 6종: 판독값을 그대로 적용 ──────────────────
    // [2026-10-03] 아래에 PALACE·ACADEMY·BLACKSMITH 를 추가했다. 총 12종이 되고
    //   그림의 12개 건물이 모두 자기 자리를 갖는다 — 12개 앵커가 곧 좌표표 12행이다.
    GOVERNMENT: { x: 32.1, y: 26.6 },  // 관청 — px(536,250) · 궁전 왼쪽 아래
    BARRACKS: { x: 22.1, y: 62.8 },   // 병영 — px(370,590) · 좌측 하단 연무터
    MARKET: { x: 62.2, y: 62.8 },     // 시장 — px(1040,590) · 우측 하단 중앙
    // [2026-10-03 사용자 실측] 아래 5개 앵커는 사용자가 그림 위치를 직접 재서 넘긴 픽셀이다.
    // 이전 값은 그림의 실제 위치를 잘못 읽어 어긋나 있었다 — 예컨대 공방은 px(1190,420) 이
    // 아니라 px(1090,418) 이 실제 위치였고, 100px 어긋나 있었다.
    FARM: { x: 81.9, y: 67.8 },       // 농지 — px(1370,637) · 우측 하단 밭.
    WORKSHOP: { x: 65.2, y: 44.5 },   // 공방 — px(1090,418) · 우측 중단.
    // 성문 — px(836,755) · 하단 중앙 정문.
    //   이전 값(75,27) 은 우측 성벽 위 망루였다. 성벽 상단이 아니라 **아치 있는 정문**이
    //   하단 중앙에 있으므로 여기로 옮겼다. 하단 시설줄(≈y 93%) 보다 12% 위라 안 가린다.
    WALL: { x: 50.0, y: 80.3 },

    // ── [2026-10-03] 그림에만 있던 3채 — 좌표표 01·03·04 행 ─────────────
    // 9종으로는 이 셋이 배지 자리가 없었다. 추가하니 12개 앵커와 좌표표 12행이
    // 정확히 1:1 로 맞물린다 — 아래 9종의 자리까지 합쳐 모든 건물이 하나씩 있다.
    PALACE: { x: 50.0, y: 13.4 },     // 궁전 — px(836,126) · 최상단 중앙.
    //   그림에서 가장 높은 곳에 있는 건물이자 도시의 중심이라 여기로 갔다.
    //   다만 이 y 는 안전영역 테스트의 상한(6.5%) 에서 6.9%p 지워져 있어
    //   헤더 HUD 가 겹칠 여지가 있다. resolveVisibleAnchor 가 밀어내므로
    //   배치는 유지되며, 좁은 창·줌에서 실브라우저로 재확인하는 게 좋다.
    //   [2026-10-03 사용자 실측] px(1115,253) → px(1153,259).
    ACADEMY: { x: 69.0, y: 27.6 },    // 태학 — px(1153,259) · 궁전 오른쪽.
    //   관청(32.1) 과 정반대편이라 좌우 대칭이 된다.
    BLACKSMITH: { x: 24.2, y: 45.0 }, // 대장간 — px(405,423) · 좌측 중단.
    //   병영(22.1,62.8) 과 x 가 비슷하지만 y 가 18%p 차이 나 라벨이 겹치지 않는다.

    // ── 그림 이름 그대로의 3종 — 좌표표 05·08·11 행 ─────────────────────
    // 이전엔 그림에 없는 이름(사원·주막·주택)이 이 자리를 빌려 쓰고 있었다.
    // 좌표는 정확했으나 배지 이름이 다른 건물을 말해, 플레이어가
    // "교역소 위인데 주막이라 써 있다" 고 읽게 됐다. 이제 그림 이름과 일치한다.
    //   [2026-10-03 사용자 실측] px(1008,335) → px(958,275). 50px 위·왼쪽이 실제 위치.
    SEOUN: { x: 57.3, y: 29.3 },     // 서원 — px(958,275) 학원 별관.
    //   그림의 중앙 우측 도심(기와 지붕 별관). 성문·시장과 충분히 떨어져 있어
    //   라벨이 겹치지 않는다.
    //   [2026-10-03 사용자 실측] px(1260,590) → px(1331,407). 시장 옆이 아니라 **오른쪽 위**다.
    //   시장(62.2,62.8)과 y 가 19%p 나므로 "시장 옆 교역소" 라던 개역 설명이 그림과
    //   어긋나 있었다. 좌표를 옮기며 주석도 바로잡았다.
    TRADING_HOUSE: { x: 79.6, y: 43.3 }, // 교역소 — px(1331,407) · 우측 중단.
    //   공방(65.2,44.5) 과 같은 줄이지만 x 가 14.4%p 떨어져 겹치지 않는다.
    STABLE: { x: 32.3, y: 69.1 },    // 마구간 — px(540,650) 병영 오른쪽.
    //   도성 안쪽 좌측 하단. 병영(22.1,62.8) 과 12% 이상 떨어져 겹치지 않는다.
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
