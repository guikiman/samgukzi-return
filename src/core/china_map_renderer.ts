import { relaxCityPlacement } from './city_placement.js';
import { traceIsoContours } from './marching_squares.js';
import { planTravel, type TravelPlan } from './travel_transport.js';
import { MAP_FEATURE_ANCHORS } from './scenario_system.js';

/**
 * [Phase 3] 중국 전도 월드 렌더러 — ChinaMapRenderer
 *
 * 헥사곤 그리드 대신, 중국 본토 전도 위에 도시를 실제 지리 좌표에
 * 자유 배치하고 클릭으로 선택하는 자유 배치 전략 맵.
 * 도시: 성 아이콘 + 소속기 색 + 병력 배지. 강/해안은 장식 윤곽으로 연출.
 */

export interface MapCityView {
    id: string;
    name: string;
    x: number;              // 정규화 0~1
    y: number;              // 정규화 0~1
    /** [지도][1:1] 이미지 속 성 아이콘 앵커 좌표 */
    imageX?: number;
    imageY?: number;
    iconType?: 'CAPITAL' | 'CITY' | 'PASS' | 'BATTLEFIELD' | 'PORT';
    /** 이미지 성 아이콘의 클릭 히트반경 — CSS/배킹스케일에 맞춰 확대한다. */
    hitRadius?: number;
    ownerColor: string;
    /** 소속 세력 이름 (영토 라벨 표시용) */
    factionName?: string;
    isPlayer: boolean;
    /**
     * 도시 병력 수(명). 全国지도 에서는 더 이상 표시하지 않는다(2026-09-30) —
     * 라벨이 도시명만 남으므로 지도 혼잡도가 줄었다. 값 자체는 게임 로직에서 쓰인다.
     */
    garrison: number;
    /** 도시 인구 — 도성 아이콘 크기를 "도시 규모" 에 맞춰 정할 때 쓴다 (제곱근으로 정규화) */
    population?: number;
    isSelected?: boolean;
    /** [49][461-480] 방문했거나 플레이어 세력이 소유한 도시인지 여부 */
    isDiscovered?: boolean;
    /** [49] 방문·소유 도시와 지리적으로 인접한 미방문 도시 — 발견 모드에서 실루엣으로 표시 */
    isAdjacentToDiscovered?: boolean;
    /** [321-340] 지도 날씨 오버레이 — 도시 타일 상단 날씨 아이콘 (미지정 시 미표시) */
    weather?: string;
    /** [321-340] 수확 보정 (0.5~1.2). 1.0 미만이면 악천후 색상 표시 */
    harvestModifier?: number;
    /** [461-480] 색약 친화 무늬 — 영토 셀에 사선/점 패턴을 얹어 소유 세력을 색 외 요소로 구분 */
    factionPattern?: 'none' | 'hatch' | 'dots' | 'border';
}

export interface ChinaMapView {
    offsetX: number;
    offsetY: number;
    zoom: number;
}

// ============================================================
// 기하 헬퍼
// ============================================================

/**
 * 점이 다각형 내부에 있는지 검사 (짝수 교차법).
 * 영토 보로노이 셀을 대륙 윤곽으로 제한하는 데 사용.
 */
export function pointInPolygon(px: number, py: number, polygon: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;
        const intersects = ((yi > py) !== (yj > py))
            && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

// ============================================================
// 병력 표기 헬퍼
// ============================================================


// ============================================================
// 도시 도로망 — 세력별 최소 신장 트리
// ============================================================

/**
 * 도성 아이콘 크기 — 인구 배율 k(0.55..1.0) 에 비례하는 폭/높이 (zoom 1 기준).
 *
 * [2026-10-02] 70% 축소 — 예전 값은 w=(7+9k), h=(4.6+5.6k) 로 최소 11.95 / 최대 16.0 이었다.
 * 전국지도에는 도시가 42~57개 동시에 뜨는데 16px짜리 아이콘은 카드 한 장 면적이고, 사용자가
 * "도시 아이콘이 크다" 고 지적했다. 목표는 70~78% 였고 B 안을 골랐다.
 *
 * [왜 B인가 — A/C 를 버린 근거]
 *  - A(9.25/12.40, 77%) 는 라벨 폭을 못 따라잡는다. 도시명 라벨은 6px 폰트 × 전각이라
 *    2자("성주") = 12px 인데, 아이콘이 9.25px 면 라벨/아이콘 = 130% 다. 아이콘이 아니라
 *    라벨이 폭을 잡고 배치기를 압박한다.
 *  - C(7.68/10.20, 64%) 는 최소 도성이 7.68px 로 내려가 사다리꼴 성벽 + 병풍벽이
 *    1~2px 씩이 된다. drawCastleIcon 이 요구하는 "축소해도 형태가 읽힌다" 를 지킨다.
 *  - B(8.41/11.20, 70%) 는 최소 폭이 8.41px 라 병풍벽 3개가 아직 구분되고(각 1.8px),
 *    최대 11.20px 라 대도시와 수도의 위계가 남는다. 라벨 12px 대비 70~93% 다.
 *
 * 계수는 최소값 + 배율구간으로 분리했다 — MIN/MAX 를 코드와 테스트가 함께 참조해야
 * 크기를 한곳에서만 바꾸게 된다(아래 MIN_CASTLE_W·MAX_CASTLE_W 참조).
 */
export const CASTLE_W_MIN = 5.0;
export const CASTLE_W_SPAN = 6.2;
export const CASTLE_H_MIN = 3.4;
export const CASTLE_H_SPAN = 4.0;

/** 최소 도성 폭 (k=0.55, zoom 1) = 8.41 */
export const MIN_CASTLE_W = CASTLE_W_MIN + CASTLE_W_SPAN * 0.55;
/** 최대 도성 폭/높이 (k=1.0, 비수도 한) = 11.20 / 7.40 */
export const MAX_CASTLE_W = CASTLE_W_MIN + CASTLE_W_SPAN * 1.0;
export const MAX_CASTLE_H = CASTLE_H_MIN + CASTLE_H_SPAN * 1.0;

/**
 * 수도 배율 — 수도는 인구와 무관하게 "가장 큰 도시" 보다 항상 크다.
 *
 * [왜 배율로 하는가 — 배율 k 만으로는 불가능했다]
 * 수도임을 k 에 더하는 방식(구 코드의 boost 0.18)은 k 가 1.0 에서 잘려 버린다.
 * 인구가 최대인 도시는 원래 k=1.0 이므로 수도든 아니든 1.0 이 되고, boost 0.18 은
 * Math.min(1, ...) 에서 사라진다 — "수도" 와 "최대 인구 도시" 의 크기가 완전히 같아진다.
 * k 의 정의("인구 정규화 배율")를 깨지 않으면서 수도 우위를 만들려면 배율 k 밖에서
 * 곱해야 한다. cityIconScale 의 단언(최대 1.0)도 그대로 살아 있다.
 */
export const CAPITAL_CASTLE_MUL = 1.18;

/**
 * 실제로 그려질 수 있는 최대 도성 폭 — 수도 배율까지 포함한 값(13.22).
 * requiredCityGap() 과 그 계약 테스트가 이 상수를 공유한다.
 */
export const MAX_CASTLE_W_DRAWN = MAX_CASTLE_W * CAPITAL_CASTLE_MUL;

/**
 * 전략 요충지 아이콘 반지름 배율 — "제일 작은 도성 크기의 반 이하" 요구를 코드에서 보장한다.
 *
 * 최소 도성 폭 = MIN_CASTLE_W(8.41) 의 절반은 4.205. 여기서는 2.0 을 쓰므로 폭 4.0.
 * 아이콘 축소 전에는 최소 도성이 11.95 였고 2.6(폭 5.2) 이었다. 축소 비율을 그대로
 * 따라 낮췄다 — 아니, 조금 더 낮췄다(5.2/5.975 = 0.87 → 4.0/4.205 = 0.95).
 * 요충지가 도시와 비례해서 함께 작아지므로 눈에 띄지 않게 되지만 "도시보다 크면 안 된다"
 * 계약은 여전히 성립한다.
 */
export const FEATURE_ICON_R = 2.0;

/** 관·요충지 접도로 한 구간. 좌표는 정규화. */
export interface FeatureSpur {
    name: string;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    kind: 'PASS' | 'BATTLEFIELD' | 'PORT';
}

/**
 * 적대 세력 도시 사이의 접점선 — 점선으로 그린다.
 *
 * [왜 필요한가]
 * 세력 도로( RoadSegment )는 "같은 세력끼리"만 잇는다( MST ). 그래서 서로 맞붙은 두 세력의
 * 국경이 지도에 전혀 표시되지 않았다 — 두 성이 스무 픽셀 간격으로 나란히 있어도 사용자는
 * "여기 두 세력이 맞닿아 있구나" 를 알 수 없었다. 실선은 아군 영토의 이동로, 점선은
 * "적과 맞닿은 지점" 이므로 선의 성격이 달라 겹쳐 보여야 한다.
 */
export interface EnemyLink {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    /** 양쪽 세력 색 — 접점선의 색조에 참고한다(소유 표시가 아니다). */
    aFaction: string;
    bFaction: string;
    /** 플레이어 세력이 끝점 하나를 차지하면 더 눈에 띄게 그린다. */
    involvesPlayer: boolean;
}

/** 점 (px,py) 와 선분 (ax,ay)-(bx,by) 사이 최단거리. */
export function distanceToSegment(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    // 벡터 (a→p) 를 a→b 에 투영하고 t 를 [0,1] 로 잠근다 — 양 끝 너머로 뻗지 않게.
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * 도로가 화면상에서 휘어지는 정도(-1..1) — 끝점 좌표로부터 결정적으로 만든다.
 *
 * [왜 해시가 필요한가]
 * 무작위로 굴리면 매 프레마다 도로 모양이 달라져 지도가 "덜덜 떨린다". Pan/zoom 은 дорогу
 * 를 건드리지 않으므로, 같은 도로는 언제나 같은 모양이어야 한다.
 */
export function roadBendFactor(ax: number, ay: number, bx: number, by: number): number {
    const seed = Math.sin(ax * 12.9898 + ay * 78.233 + bx * 37.719 + by * 21.413) * 43758.5453;
    return (seed - Math.floor(seed)) * 2 - 1;
}

/**
 * 도시 인구 → 도성 아이콘 크기 배율 k (0.55..1).
 *
 * 입력은 이미 sqrt 로 뽑은 값이라 호출부가 정규화(min/max)를 책임진다.
 *
 * [왜 제곱근인가]
 * 인구 9만과 1.8만은 5배 차이가 나지만 지도에서 5배 크기로 그려지면 원 하나가 화면을
 * 지배한다. 면적이 인구에 비례해야 눈으로 보이는 크기가 맞아 sqrt 로 정규화한다.
 *
 * span 이 0(전 도시 인구가 같거나 하나뿐)이면 t=0.5 로 둔다 — 0 으로 두면 전부 최소 크기가
 * 되어 "도시가 하나뿐인 상황" 과 "아주 작은 도시만 있는 상황" 이 구분되지 않는다.
 */
export function cityIconScale(
    sqrtPop: number,
    minSqrt: number,
    maxSqrt: number,
    isCapital: boolean,
): number {
    const span = maxSqrt - minSqrt;
    const t = span > 0 ? (sqrtPop - minSqrt) / span : 0.5;
    // 수도는 도시 규모와 무관하게 최소한 한 단계 크게 — 한 세력의 눈이 가는 곳
    //
    // [2026-10-02] 이 함수는 "인구 → k" 만 다룬다. 수도 구분은 여기서 하지 않는다.
    //
    // [왜 여기가 아니라 바깥인가 — 이 함수의 구조적 한계]
    // Math.min(1, ...) 클램프 때문에 boost 를 더하는 방식은 인구가 최대인 도시에서 반드시
    // 증발한다. t=1 이면 0.55+0.45 = 1.0 이고 boost 0.18 을 더해도 min(1, 1.18) = 1.0 으로
    // 잘린다. 즉 "인구 최대 도시" 와 "수도" 의 k 가 정확히 같아진다 — boost 는 인구가 적은
    // 수도에서만 실제로 작동한다.
    //
    // 이걸 여기서 고치려면 클램프를 풀어 k 가 1.18 까지 나가게 해야 하는데, 그러면
    // k 의 정의("인구 정규화 배율, 최대 1.0") 가 깨지고 계약 테스트
    // (최대 인구 + 수도 ⇒ 1 이하) 가 깨진다. 테스트를 약하게 고치는 대신 설계를 갈았다:
    //
    //   - cityIconScale = 인구 정규화 전용. 이 안의 boost 는 그대로 두되 "약한 우위" 로
    //     취급하고(작은 도시의 수도가 같은 인구의 도시보다 크다),
    //   - 수도의 확정적 우위(어떤 비수도보다 항상 큼)는 크기를 계산하는 쪽에서
    //     CAPITAL_CASTLE_MUL 로 곱해 준다 — 그 곱셈은 클램프 밖이라 잘리지 않는다.
    //
    // 결과적으로 "수도" 와 "최대 인구 도시" 는 이제 크기가 다르다.
    const boost = isCapital ? 0.18 : 0;
    return Math.min(1, 0.55 + 0.45 * t + boost);
}

/** 도로망 입력 한 도시. 좌표는 정규화(0~1). */
export interface RoadNode {
    id: string;
    x: number;
    y: number;
    /** 세력 식별자 — 같은 세력끼리만 잇는다 */
    factionKey: string;
    color: string;
    isPlayer: boolean;
}

/** 도로 한 구간. */
export interface RoadSegment {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    factionKey: string;
    color: string;
    isPlayer: boolean;
    /**
     * 바다를 피해 우회하는 중간 지점들. 없으면 직선으로 그린다.
     *
     * 실측에서 6개 도로가 물을 0.125~0.25 만큼 가로지른다(강·만). 이 길이를 다리로
     * 잇는 것은 지도적으로 거짓말이고, 그냥 비우면 도시가 고립되어 "도로가 끊겼다" 가 된다.
     * 그래서 지형을 피해 돌아가는 경로를 미리 계산해 둔다.
     */
    via?: Array<{ x: number; y: number }>;
}

/**
 * 세력별로 도시를 최소 신장 트리(MST)로 잇는다 — Prim 알고리즘.
 *
 * [왜 MST 인가]
 * "각 도시를 가장 가까운 이웃과 잇기"는 겹치는 도로를 만든다. 세력이 일직선으로 서 있으면
 * 2-3, 3-4, 4-5 를 전부 그리며 3-4 가 두 번 생긴다. MST 는 세력당 정확히 N-1 개로
 * 모든 도시를 잇고 사이클이 없으며, 총 길이가 최소다. 도시가 늘어나도 도로가 지수적으로
 * 늘지 않는다.
 *
 * 순수 함수 — 캔버스·DOM 없이 테스트한다.
 */
export function buildRoadNetwork(nodes: readonly RoadNode[]): RoadSegment[] {
    const groups = new Map<string, RoadNode[]>();
    for (const n of nodes) {
        const g = groups.get(n.factionKey);
        if (g) g.push(n);
        else groups.set(n.factionKey, [n]);
    }

    const segments: RoadSegment[] = [];
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const inTree = new Set<number>([0]);
        for (let step = 1; step < group.length; step++) {
            // 트리에 붙은 정점 중 outsider 와 가장 가까운 간선을 고른다.
            let bestA = -1, bestB = -1, bestD = Infinity;
            for (let a = 0; a < group.length; a++) {
                if (!inTree.has(a)) continue;
                for (let b = 0; b < group.length; b++) {
                    if (inTree.has(b)) continue;
                    const dx = group[a].x - group[b].x;
                    const dy = group[a].y - group[b].y;
                    const d = dx * dx + dy * dy;
                    if (d < bestD) { bestD = d; bestA = a; bestB = b; }
                }
            }
            if (bestB < 0) break;
            inTree.add(bestB);
            const a = group[bestA], b = group[bestB];
            segments.push({
                ax: a.x, ay: a.y, bx: b.x, by: b.y,
                factionKey: b.factionKey, color: b.color, isPlayer: b.isPlayer,
            });
        }
    }
    return segments;
}

// ============================================================
// 도시 라벨 배치 — 겹침 완화
// ============================================================

/** 한 도시 라벨(도시명 + 병력 배지)의 그리기 좌표. */
export interface CityLabelSlot {
    /** 도시명 텍스트 baseline 중앙 x */
    nameX: number;
    /** 도시명 텍스트 baseline y */
    nameY: number;
    /** 병력 배지 사각형 중앙 x (showBadge=false 면 미사용) */
    badgeX: number;
    /** 병력 배지 사각형 상단 y (showBadge=false 면 미사용) */
    badgeY: number;
    /** 배지 폭 — measureText 결과 */
    badgeW: number;
    /** 점유 사각형 — 다른 라벨과 충돌 판정용 */
    rect: LabelRect;
    /** 밀려난 라벨에는 아이콘에서 라벨로 지시선을 긋는다 */
    displaced: boolean;
    /** 자리 없어 병력만 숨긴 상태 */
    showBadge: boolean;
}

export interface LabelRect { x: number; y: number; w: number; h: number }

/** 배치 입력 — 캔버스 의존을 제거해 순수 함수로 테스트한다. */
export interface CityLabelInput {
    id: string;
    name: string;
    /** 숫자로만 — 폭을 아끼기 위해 쉼표·단위를 뺀다 */
    garrisonText: string;
    /** 성 아이콘 중심 (항상 실제 좌표 — 절대 움직이지 않는다) */
    px: number;
    py: number;
    /** 성 아이콘 크기 */
    iconW: number;
    iconH: number;
    /** 클수록 먼저 자리를 차지한다 */
    priority: number;
    nameW: number;
    /** 선택/호버 도시 — 배치 실패를 감수해도 반드시 배치가 필요 */
    mustPlace: boolean;
    /**
     * 정책 게이트 — 배지를 그려도 되는가. 공간이 남아도 false 면 그리지 않는다.
     * 줌 연동 LOD 의 입력이다(기본 줌에서는 도시명만, 확대하면 병력까지).
     */
    badgeAllowed: boolean;
}

function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export interface CityLabelMetrics {
    nameFontPx: number;
    /** 이름 baseline 이 성 위쪽에서 얼마나 떨어지는가 — 기존 화면 값(14*s) 유지 */
    nameGap: number;
    /** 배지 상단이 성 아래쪽에서 얼마나 떨어지는가 (기존 화면 값 2*s) */
    badgeGap: number;
    badgeFontPx: number;
    badgeH: number;
    nameH: number;
    /** 옆으로 밀어낼 때 아이콘과 라벨 사이 간격 */
    gap: number;
    /** 이 거리 이상 밀렸을 때만 지시선을 긋는다 */
    leaderMin: number;
}

/** 후보 하나. moved=true 면 현 배치에서 밀려난 것이므로 지시선이 필요하다. */
interface LabelCandidate {
    nameX: number;
    nameY: number;
    badgeX: number;
    badgeY: number;
    rect: LabelRect;
    moved: boolean;
}

/**
 * 라벨을 밀어낼 때의 후보 순서.
 *
 * 순서가 곧 우선순위다. 첫 후보는 지금 화면에 보이는 바로 그 배치(도시명은 성 위,
 * 병력 배지는 성 아래)이므로 42개 중 33개는 전혀 안 움직인다 — 평소의 화면이 그대로
 * 남는다는 뜻이다. 겹치는 소수만 뒤 후보로 밀린다.
 */
function labelCandidates(
    c: CityLabelInput,
    m: CityLabelMetrics,
    showBadge: boolean,
): LabelCandidate[] {
    const badgeW = c.garrisonText.length * m.badgeFontPx * 0.62 + m.gap;
    const boxW = Math.max(c.nameW, showBadge ? badgeW : 0);
    const halfW = boxW / 2;
    const iconL = c.px - c.iconW / 2;
    const iconR = c.px + c.iconW / 2;
    const iconT = c.py - c.iconH / 2;
    const iconB = c.py + c.iconH / 2;
    const stackH = showBadge ? m.nameH + m.gap + m.badgeH : m.nameH;

    const out: LabelCandidate[] = [];
    // 1) 현 배치 — 이름은 성 위, 배지는 성 아래
    out.push({
        nameX: c.px,
        nameY: iconT - m.nameGap,
        badgeX: c.px,
        badgeY: iconB + m.badgeGap,
        rect: {
            x: c.px - halfW,
            y: iconT - m.nameGap - m.nameH,
            w: boxW,
            h: showBadge
                ? m.nameGap + m.nameH + c.iconH + m.badgeGap + m.badgeH
                : m.nameGap + m.nameH,
        },
        moved: false,
    });

    // 2~5) 좌/우/위/아래로 통째로 밀기 — 이름 위에 배지가 이어 붙는다
    const side = (labelX: number, labelTop: number) => {
        out.push({
            nameX: labelX,
            nameY: labelTop + m.nameH * 0.8,
            badgeX: labelX,
            badgeY: labelTop + m.nameH + m.gap,
            rect: { x: labelX - halfW, y: labelTop, w: boxW, h: stackH },
            moved: true,
        });
    };
    side(iconR + m.gap, c.py - stackH / 2);   // 동
    side(iconL - m.gap, c.py - stackH / 2);   // 서
    side(c.px, iconT - m.gap - stackH);       // 북
    side(c.px, iconB + m.gap);                // 남

    // 6~9) 대각선 — 위 후보가 전부 막혔을 때의 다음 수단
    const diag = (sx: number, sy: number, scale = 1) => {
        const labelX = c.px + sx * (c.iconW / 2 + m.gap * scale + halfW);
        const labelTop = sy < 0
            ? c.py + sy * (c.iconH / 2 + m.gap * scale) - stackH
            : c.py + sy * (c.iconH / 2 + m.gap * scale);
        side(labelX, labelTop);
    };
    diag(1, -1); diag(1, 1); diag(-1, -1); diag(-1, 1);

    // 10~17) 두 번째 고리 — 1고리가 다 막혔을 때. 화면 가장자리 도시(1920x1080 창에서
    // py=29.5 에 걸린 낙랑)가 9곳을 전부 빼앗기면 병력 숫자까지 사라지므로, 간격을
    // 벌린 자리를 더 시도한다.
    const far = m.gap * 2.4;
    side(iconR + far, c.py - stackH / 2);   // 동
    side(iconL - far, c.py - stackH / 2);   // 서
    side(c.px, iconT - far - stackH);       // 북
    side(c.px, iconB + far);                // 남
    diag(1, -1, 2.4); diag(1, 1, 2.4); diag(-1, -1, 2.4); diag(-1, 1, 2.4);
    return out;
}

/**
 * 全国지도 도시 라벨을 겹치지 않게 배치한다.
 *
 * [왜 성 아이콘을 움직이지 않는가]
 * 성 아이콘은 그 도시가 실제로 있는 자리다. 전략지도에서 아이콘을 20px 옮기면 지도가
 * 거짓말을 하고, 그 아이콘을 클릭했을 때 어느 도시인지도 모호해진다. 그러므로 아이콘은
 * 항상 실제 좌표에 두고, 겹치는 것은 이름·병력 라벨뿐이다. 밀려난 라벨은 지시선으로
 * 아이콘에 다시 묶어 둔다.
 *
 * 순수 함수다 — measureText 를 콜백으로 받아 캔버스 없이 테스트한다.
 */
export function resolveCityLabels(
    cities: readonly CityLabelInput[],
    m: CityLabelMetrics,
    bounds: { width: number; height: number },
): Map<string, CityLabelSlot> {
    const result = new Map<string, CityLabelSlot>();
    // 먼저 오는 도시가 자리를 먼저 잡는다. 같은 우선순위면 원래 순서로 안정 정렬.
    const order = cities
        .map((c, i) => ({ c, i }))
        .sort((a, b) => (b.c.priority - a.c.priority) || (a.i - b.i));

    // [2026-10-02] 아이콘 사각형도 점유물로 취급한다 — 아이콘과 라벨을 한 묶음으로 본다.
    //
    // [왜 이것이 "밀림" 의 근본 원인이었나]
    // 예전에는 점유 목록에 "라벨 사각형" 만 들어갔다. 아이콘은 어디에도登记되지 않았으므로
    // 배치기는 "이 자리에 남의 아이콘이 있다" 는 걸 전혀 몰랐다. 그 결과 밀려난 라벨이
    // 바로 옆 도시의 성벽 위에 그대로 얹혔다 — 사용자가 스크린샷으로 짚은 바로 그 화면
    // ("성주" 아이콘 위에 "성주" 글자가 겹쳐 보인다) 이었다.
    //
    // 라벨 폭이 아이콘 폭보다 넓다는 사실이 이 증상을 악화시킨다. 라벨이 옆으로 밀릴
    // 폭이 넓을수록 옆 도시의 아이콘을 더 많이 덮는다. 라벨은 최소 5px 바닥(가독성)이 있어
    // 아이콘 폭(8.41px) 아래로 줄일 수 없다 — 폰트를 줄여도 2자 = 10px 로 아이콘보다 넓다.
    // 즉 폭으로는 근본을 못 고치므로, 넓은 라벨을 안전하게 놓을 수 있는 "빈자리" 판정을
    // 아이콘까지 포함해 고치는 것이 옳다.
    //
    // [왜 "선호" 이지 "차단" 이 아닌가 — 이 구분이 핵심이다]
    // 아이콘을 하드 제약으로만 두면, 도시가 매우 밀집한 곳에서는 아홉 개 후보가 전부
    // 남의 아이콘에 막혀 도시명이 아예 사라진다. 그러면 degradation 계약이 깨진다 —
    // "병력 배지를 먼저 버리고 도시명은 끝까지 남긴다" 가 정반대로 이름부터 죽는다
    // (tests 의 'resolveCityLabels — degradation 순서' 가 이걸 잡는다).
    //
    // 그래서 2단계로 한다:
    //   1순위 — 아이콘을 피하는 자리를 찾는다(정상 화면. 사용자가 본 증상이 여기서 사라진다).
    //   2순위 — 그런 자리가 하나도 없으면 예전 규칙(라벨끼리만 회피)으로 물러난다.
    //           아이콘 위를 덮을 수는 있지만 도시명은 살아 있다. 배지→이름 순서의
    //           열화 규칙이 그대로 유지된다.
    //
    // 자기 아이콘은 언제나 제외한다 — 후보 2~5(좌/우)는 아이콘 옆에 라벨을 붙이므로 자기
    // 아이콘과 일부러 닿는다. 그걸 자기 것으로 막으면 옆 배치가 전부 탈락한다.
    const iconRects: LabelRect[] = cities.map(c => ({
        x: c.px - c.iconW / 2,
        y: c.py - c.iconH / 2,
        w: c.iconW,
        h: c.iconH,
    }));

    const occupied: LabelRect[] = [];
    /** avoidIcons=false 면 아이콘 위 배치를 허용한다(2순위 강등용). */
    const fits = (r: LabelRect, selfIdx: number, avoidIcons: boolean): boolean => {
        if (r.x < 0 || r.y < 0 || r.x + r.w > bounds.width || r.y + r.h > bounds.height) return false;
        if (occupied.some(o => rectsOverlap(r, o))) return false;
        if (!avoidIcons) return true;
        for (let i = 0; i < iconRects.length; i++) {
            if (i === selfIdx) continue;
            if (rectsOverlap(r, iconRects[i])) return false;
        }
        return true;
    };

    for (const { c, i: selfIdx } of order) {
        let chosen: CityLabelSlot | null = null;

        const toSlot = (cand: LabelCandidate, showBadge: boolean): CityLabelSlot => ({
            nameX: cand.nameX,
            nameY: cand.nameY,
            badgeX: cand.badgeX,
            badgeY: cand.badgeY,
            badgeW: c.garrisonText.length * m.badgeFontPx * 0.62 + m.gap,
            rect: cand.rect,
            displaced: cand.moved
                || Math.hypot(cand.nameX - c.px, cand.nameY - (c.py - c.iconH / 2 - m.nameGap)) >= m.leaderMin,
            showBadge,
        });

        // 정책이 배지를 막으면 도시명만 시도한다. 공간이 남아도 그리지 않는다.
        // 배지를 버리는 건 이름까지 지우는 것보다 낫다.
        // 순서: 아이콘 회피(1순위) → 아이콘 허용(2순위, 밀집 구역 강등).
        outer:
        for (const avoidIcons of [true, false]) {
            for (const showBadge of c.badgeAllowed ? [true, false] : [false]) {
                for (const cand of labelCandidates(c, m, showBadge)) {
                    if (!fits(cand.rect, selfIdx, avoidIcons)) continue;
                    chosen = toSlot(cand, showBadge);
                    break outer;
                }
            }
        }

        if (!chosen) {
            // 자리가 아예 없다(선택 도시가 아니면). 도시명조차 그리지 않는다 —
            // 어차피 남의 라벨에 덮여 읽히지 않는다. 점유 사각형도 안 넣는다.
            if (!c.mustPlace) continue;
            const cand = labelCandidates(c, m, false)[0];
            chosen = {
                nameX: cand.nameX,
                nameY: cand.nameY,
                badgeX: cand.badgeX,
                badgeY: cand.badgeY,
                badgeW: 0,
                rect: { x: -1e6, y: -1e6, w: 0, h: 0 },
                displaced: true,
                showBadge: false,
            };
        }

        occupied.push(chosen.rect);
        result.set(c.id, chosen);
    }
    return result;
}

// ============================================================
// 지형 장식 (강 흐름 — 정규화 좌표 폴리라인)
// ============================================================

const RIVERS: Array<Array<{ x: number; y: number }>> = [
    // 黃河 (상류 → 하류, 몇 자 형태로 단순화)
    [
        { x: 0.30, y: 0.30 }, { x: 0.33, y: 0.24 }, { x: 0.38, y: 0.20 },
        { x: 0.43, y: 0.22 }, { x: 0.45, y: 0.28 }, { x: 0.50, y: 0.30 },
        { x: 0.55, y: 0.28 }, { x: 0.60, y: 0.26 }, { x: 0.68, y: 0.22 },
        { x: 0.76, y: 0.20 }, { x: 0.85, y: 0.24 },
    ],
    // 장강 (상류 → 하류)
    [
        { x: 0.26, y: 0.52 }, { x: 0.32, y: 0.54 }, { x: 0.40, y: 0.52 },
        { x: 0.48, y: 0.55 }, { x: 0.55, y: 0.58 }, { x: 0.62, y: 0.60 },
        { x: 0.70, y: 0.62 }, { x: 0.78, y: 0.66 }, { x: 0.88, y: 0.70 },
    ],
    // 회수
    [
        { x: 0.55, y: 0.44 }, { x: 0.62, y: 0.48 }, { x: 0.70, y: 0.50 },
    ],
];

/** 대륙 윤곽 (간략화된 중국 본토 폴리곤, 정규화 좌표) */
const CONTINENT_OUTLINE: Array<{ x: number; y: number }> = [
    { x: 0.16, y: 0.20 }, { x: 0.30, y: 0.12 }, { x: 0.50, y: 0.08 },
    { x: 0.70, y: 0.06 }, { x: 0.88, y: 0.12 }, { x: 0.94, y: 0.24 },
    { x: 0.90, y: 0.36 }, { x: 0.94, y: 0.48 }, { x: 0.90, y: 0.62 },
    { x: 0.82, y: 0.72 }, { x: 0.70, y: 0.80 }, { x: 0.58, y: 0.84 },
    { x: 0.48, y: 0.88 }, { x: 0.38, y: 0.86 }, { x: 0.28, y: 0.80 },
    { x: 0.20, y: 0.70 }, { x: 0.14, y: 0.58 }, { x: 0.10, y: 0.44 },
    { x: 0.12, y: 0.32 },
];

// ============================================================
// ChinaMapRenderer
// ============================================================

export class ChinaMapRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private offsetX = 0;
    private offsetY = 0;
    private zoom = 1.0;
    private hoveredCityId: string | null = null;
    private cities: MapCityView[] = [];
    /** [49] 전체 도시 표시(초기) / 방문·소유 도시만 표시(발견 모드) */
    private discoveredOnly = false;

    /** [321-340] 지도 날씨 오버레이 표시 여부 (기본 on) */
    private showWeatherOverlay = true;

    /** [1057][321-340] 계절 톤 — 봄/여름/가을/겨울에 따라 대륙 색조 보정 (null=보정 없음) */
    private seasonTint: 'spring' | 'summer' | 'autumn' | 'winter' | null = null;

    /** 영토 셀 (보로노이 근사 그리드) 캐시 */
    private territoryCells: Array<{ ownerColor: string | null; cityId: string | null; isPlayer: boolean; pattern: string }> = [];
    private territoryCols = 0;
    private territoryRows = 0;
    private territoryDirty = true;

    /** 세력 라벨 (영토 무게중심 + 크기) — rebuildTerritory에서 산출 */
    private factionLabels: Array<{ name: string; color: string; cx: number; cy: number; cells: number; isPlayer: boolean }> = [];

    /** 겹침 완화까지 마친 도시 라벨 좌표 — layoutCityLabels가 한 프레임에 채운다 */
    private labelSlots = new Map<string, CityLabelSlot>();

    /** 세력별 MST 도로 — setCities 에서 다시 만든다 (좌표는 정규화) */
    private roads: RoadSegment[] = [];

    /** 세력별 reach 필드 (셀 격자, 정규화 거리 기반) — rebuildTerritory 가 채운다 */
    private factionReach = new Map<string, Float32Array>();

    /** 도시별 확정 좌표 — 바다 위 앵커를 육지로 당긴 결과 (rebuildCityPositions 가 채운다) */
    private cityPos = new Map<string, { x: number; y: number }>();

    /** [2026-10-04] 이동 경로 표시(시각 전용) — 군단 위치 모델은 3단계 대상 */
    private travelRoute: {
        from: MapCityView;
        to: MapCityView;
        /** 도로를 따라가는 정규화 좌표 꺾은선. 없으면 직선. */
        points: Array<{ x: number; y: number }>;
        /**
         * 지형별로 나눈 구간 — 말(육로) / 배(해로). 그릴 때 색을 다르게 한다.
         * setTravelRoute 가 계산해 넣는다.
         */
        legs?: Array<{ mode: 'HORSE' | 'BOAT'; ax: number; ay: number; bx: number; by: number; distance: number; days: number }>;
    } | null = null;
    private travelProgress = 0;

    /** 초기 시점을 육지에 맞췄는가 — 한 번만 적용한다 */
    private viewFramed = false;

    /** 관·요충지 접도로 — buildFeatureSpurs 가 채운다 */
    private featureSpurs: FeatureSpur[] = [];

    /** 적대 세력 도시 접점선 — drawEnemyLinks 가 그린다. */
    private enemyLinks: EnemyLink[] = [];

    /** 인구 기반 도성 아이콘 크기 — layoutCityLabels 가 채우고 drawCity 가 읽는다 */
    private iconSizes = new Map<string, { w: number; h: number }>();

    /** 오프스크린 영토/경계 레이어 (확대 보간용) */
    private territoryLayer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } | null = null;
    private borderLayer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } | null = null;
    private territoryLayerDirty = true;
    private borderLayerDirty = true;
    private borderLayerZoom = 0;

    /**
     * 영토가 도시에서 뻗을 수 있는 최대 거리 (정규화 단위).
     *
     * [왜 상한이 필요한가]
     * 보로노이를 거리 제한 없이 그리면 육지 전부가 누군가의 영토가 된다. 실제로 측정한 결과
     * 가장 먼 격자 셀이 최근접 도시에서 0.62 만큼 떨어져 있는데(격자 44칸), 그 땅은 소수의
     * 도시를 가진 세력이 사실상 "점령"한 것처럼 칠해진다.지도 위에서 거짓말이다.
     *
     * 0.05 를 고른 근거 — 도시 좌표의 최근접 거리는 중앙값 0.021, 최대 0.093 이다. 성 아이콘
     * 자체가 정규화 공간에서 약 0.025 폭이므로, 0.05 는 "아이콘 두 개 반" 크기다. 인접 도시
     *끼리(0.021) 영토가 서로 닿을 만큼은 확보하면서, 무한 확장(0.62)은 12분의 1 로 줄인다.
     */
    private static readonly TERRITORY_RADIUS = 0.05;

    /**
     * 도로의 영토 통로 반폭. 도시 반경(0.05)보다 좁다.
     *
     * 같은 세력 도시끼리 도로로 이어져 있는데 영토가 중간에서 끊기면, 도로가 있는のに
     * 영토는 떨어져 있는 모순이 생긴다. 그래서 도로 주변만은 그 세력 영토로 인정한다.
     * 좁은 이유 — 통로가 도시 원판(0.05)보다 넓으면 영토가 도시보다 더 넓어져
     * "도시가 영토를 결정한다" 는 규칙이 깨진다.
     */
    private static readonly ROAD_HALF_WIDTH = 0.022;

    private static readonly CELL_SIZE = 0.014; // 정규화 공간 격자 간격 (≈72×72 격자) [269]

    /**
     * 도시 배치 완화(relaxCityPlacement) 파라미터.
     *
     * CITY_COAST_MAX_MOVE — 도시 하나가 원래 자리에서 밀릴 수 있는 최대 거리(정규화).
     *   실측 42도시 중 23개가 0.03 안에 이웃이 있었고 최밀집 4쌍(강하-무창, 단양-건업,
     *   성도-광한, 사비-웅진)은 0.0078 까리 붙어 있었다. 사용자가 지도 정리 우선을 요청해
     *   0.07 로 올렸다 — 도시 원판(TERRITORY_RADIUS 0.05)보다 커서 영토는 서로 겹치지만,
     *   아이콘·라벨 겹침은 어느 창 크기에서도 0 이 된다.
     * CITY_COAST_BIAS — 해안 방향으로 미는 정도(0=안 민다, 1=최대). 실측 좌표 중 안쪽 깊이
     *   박힌 도시가 여럿이라 0.5 로만 민다 — 원도를 지킨다.
     *
     * 최소 간격(CITY_MIN_GAP)은 고정하지 않는다 — requiredCityGap() 으로 계산한다.
     */
    private static readonly CITY_COAST_MAX_MOVE = 0.07;
    private static readonly CITY_COAST_BIAS = 0.5;

    /**
     * 도시 아이콘이 겹치지 않기 위해 필요한 최소 정규화 거리.
     *
     * [왜 창 크기에 따라 바뀌는가]
     * 좌표는 정규화(0~1) 인데 아이콘은 픽셀(12~16px) 이다. 그래서 겹침 여부가 창 크기에
     * 따라 달라진다 — 같은 0.024 정규화 거리가 360px 창에서는 12px(겹침)지만 1920px 창에서는
     *   44px(넉넉) 다. 즉 "도시가 붙어 보인다" 는 단위 불일치에서 온 증상이다.
     *
     *   필요 거리 = 아이콘 픽셀폭 / baseScale = (7+9k)*zoom / (max(W,H)*0.96*zoom)
     *             = (7+9k) / (max(W,H)*0.96)          ← zoom 이 약분된다
     *
     * zoom 이 약분되는 덕분에 팬/줌 중에는 값이 변하지 않는다. 창 크기가 바뀔 때만 다시
     * 계산하면 되고, 그건 resize 에서 이미 cityPos 를 다시 세우는 경로와 겹친다.
     *
     * 실제 최소값이 아니라 최대 아이콘(k=1, 수도·대도시) 기준으로 잡아 가장 큰 아이콘끼리
     * 부딪히지 않게 한다. 여유분으로 CITY_GAP_SLACK 을 곱한다.
     */
    private requiredCityGap(): number {
        // [2026-10-02] 리터럴 (7 + 9 * 1.0) 대신 MAX_CASTLE_W_DRAWN 을 쓴다.
        // 이 값은 수도 배율까지 포함한 "실제로 그려질 수 있는 최대 폭" 이다. 예전처럼
        // 비수도 최대 폭만 쓰면 축소 뒤 수도끼리(13.22px)가 붙는다 — 간격은 아이콘 크기를
        // 따라가야 하는데 최대 아이콘을 계산에서 빼면 그게 바로 "도시가 붙어 보인다" 다.
        const maxIconPx = MAX_CASTLE_W_DRAWN * this.zoom;
        const base = Math.max(1, this.baseScale());
        return (maxIconPx / base) * ChinaMapRenderer.CITY_GAP_SLACK;
    }

    /** 필요 간격에 곱하는 여유분 — 라벨과 접도로까지 고려해 아이콘 폭보다 조금 띄운다. */
    private static readonly CITY_GAP_SLACK = 1.25;

    /**
     * 세력명을 붙일 최소 셀 수 — "도시 하나 분량"의 1/4.
     *
     * 이전엔 16 이 하드코딩이었는데 그건 무한 보로노이 기준값이었다. 반경을 걸자 도시 하나가
     * 30~40 셀, 해안 도시가 그보다 훨씬 적어지면서 16 이 Cutoff 를 넘어 세력명이 통째로
     * 사라졌다(단독 도시 1개 → 라벨 0개).
     *
     * 반경에서 파생하므로 TERRITORY_RADIUS を 바꾸면 같이 따라간다. πR²/CELL² 가 도시 하나
     * 의 완전한 원판이므로, 그 1/4 보다 작으면 "좁은 조각" 이라 이름 붙일 가치가 없다.
     */
    private static readonly FACTION_LABEL_MIN_CELLS = Math.max(
        4,
        Math.round(0.25 * Math.PI * ChinaMapRenderer.TERRITORY_RADIUS ** 2
            / ChinaMapRenderer.CELL_SIZE ** 2),
    );


    /** [지도][1:1] Natural Earth 실제 지형 비트맵. 미로딩이면 스케치 지도로 폴백. */
    private mapImage: HTMLImageElement | null = null;

    /** 육지 마스크 — 영토를 바다에 칠하지 않게 하는 알파 마스크. 비트맵에서 추출. */
    private landMask: HTMLCanvasElement | null = null;

    /** 육지 판정용 마스크 알파 (0=바다, 255=육지). getLandMask가 함께 채운다. */
    private landAlpha: Uint8Array | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        if (typeof Image === 'undefined') return;
        const img = new Image();
        img.addEventListener('load', () => {
            this.mapImage = img;
            this.landMask = null;
            this.landAlpha = null;
            // 육지 판정 기준이 바뀌므로 영토·경계·라벨을 다시 만든다
            this.rebuildSpatialLayers();
            this.territoryDirty = true;
            this.territoryLayerDirty = true;
            this.borderLayerDirty = true;
        });
        img.src = 'assets/map-china-ai-4096.webp';
    }

    /**
     * 비트맵의 바다색을 투명 처리해 육지만 남기는 마스크를 만든다.
     * generate_map.py 의 SEAFILL 값과 일치해야 하며, 해안선 안티에일리어싱은 여유 있게 판정한다.
     */
    private getLandMask(): HTMLCanvasElement | null {
        if (!this.mapImage) return null;
        if (this.landMask) return this.landMask;
        const S = 256;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const cx = c.getContext('2d')!;
        cx.drawImage(this.mapImage, 0, 0, S, S);
        const px = cx.getImageData(0, 0, S, S).data;
        const img = cx.createImageData(S, S);
        for (let i = 0; i < S * S; i++) {
            const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
            const isSea = Math.abs(r - 3) < 28 && Math.abs(g - 103) < 28 && Math.abs(b - 121) < 28;
            const o = i * 4;
            img.data[o] = 255;
            img.data[o + 1] = 255;
            img.data[o + 2] = 255;
            img.data[o + 3] = isSea ? 0 : 255;
        }
        cx.putImageData(img, 0, 0);
        this.landMask = c;
        this.landAlpha = new Uint8Array(S * S);
        for (let i = 0; i < S * S; i++) this.landAlpha[i] = img.data[i * 4 + 3];
        return c;
    }

    /** 정규화 좌표가 육지인지 판정. 마스크 없으면 스케치 윤곽으로 폴백. */
    private isLand(nx: number, ny: number): boolean {
        if (this.mapImage) this.getLandMask();
        if (!this.landAlpha) return pointInPolygon(nx, ny, CONTINENT_OUTLINE);
        const S = 256;
        const px = Math.min(S - 1, Math.max(0, Math.floor(nx * S)));
        const py = Math.min(S - 1, Math.max(0, Math.floor(ny * S)));
        return this.landAlpha[py * S + px] > 127;
    }

    /** 영토/경계 레이어를 육지에만 남긴다. 마스크가 없으면 아무것도 하지 않는다. */
    private clipToLand(octx: CanvasRenderingContext2D, w: number, h: number): void {
        const mask = this.getLandMask();
        if (!mask) return;
        octx.globalCompositeOperation = 'destination-in';
        octx.drawImage(mask, 0, 0, w, h);
        octx.globalCompositeOperation = 'source-over';
    }

    setView(view: Partial<ChinaMapView>): void {
        if (view.offsetX !== undefined) this.offsetX = view.offsetX;
        if (view.offsetY !== undefined) this.offsetY = view.offsetY;
        if (view.zoom !== undefined) this.zoom = view.zoom;
    }

    /** 지도 카메라 상태를 도시 화면 전환 후 복원하기 위해 반환한다. */
    getView(): ChinaMapView {
        return { offsetX: this.offsetX, offsetY: this.offsetY, zoom: this.zoom };
    }

    /**
     * 도시 좌표에 의존하는 레이어들을 올바른 순서로 다시 만든다.
     *
     * [순서가 버그다 — 순서를 바꿔야 했던 이유]
     * rebuildRoads / buildFeatureSpurs / buildEnemyLinks 는 모두 cityNorm() 즉 cityPos 캐시를
     * 읽는다. 그런데 도시 좌표는 rebuildCityPositions() 가 정한다. 순서를 잘못 두면:
     *
     *   - rebuildRoads 를 먼저 부르면 → 도로가 "완화 전" 좌표로 만들어진다
     *   - 그 다음 rebuildCityPositions 가 도시를 최대 0.07 만큼 옮긴다
     *   → 도로는 원래 자리에, 도시는 옮겨 간 자리에 그려져 **끊어 보인다**
     *
     * 이것이 "도시간 도로가 잘린 듯 보인다" 의 실제 원인이다(육지 판정 문제가 아니라).
     * 지도 이미지 로드·창 크기 변경 경로도 도시만 갱신하고 도로를 갱신하지 않아 같은 증상이
     * 남았다. 그래서 세 경로가 모두 이 한 함수만 부르게 만들었다.
     */
    private rebuildSpatialLayers(): void {
        this.rebuildCityPositions();
        this.rebuildRoads();
        this.buildFeatureSpurs();
        this.buildEnemyLinks();
    }

    setCities(cities: MapCityView[]): void {
        this.cities = cities;
        this.territoryDirty = true;
        this.territoryLayerDirty = true;
        this.borderLayerDirty = true;
        this.rebuildSpatialLayers();
    }

    /**
     * 캔버스가 바뀐 뒤 도시 배치를 다시 계산한다 — 창 크기에 따라 최소 간격이 달라지므로.
     *
     * 도시·세력 데이터는 그대로라 setCities 를 부를 필요는 없다. 좌표만 다시 잡고,
     * 좌표에 의존하는 것(도로·접도로·영토·라벨)을 모두 더럽게 표시한다.
     */
    onCanvasResized(): void {
        if (this.cities.length === 0) return;
        this.rebuildSpatialLayers();
        this.territoryDirty = true;
        this.territoryLayerDirty = true;
        this.borderLayerDirty = true;
    }

    /**
     * 두 점을 육지 위 경로로 잇는다 — 물을 만나면 우회 지점들을 돌려준다.
     *
     * [왜 A* 인가]
     * 물 표본을 하나씩 가장 가까운 육지로 옮기는 방법은 실패했다. 표본마다 "가장 가까운" 쪽이
     * 달라서 경로가 물의 위아래를 번갈아 오갔다(실측: 5번째 다리가 다시 물을 통과했다).
     * 각 표본이 자기 주변만 보기 때문이다.
     * 격자 위 최단 경로(A*)는 "두 점을 잇는 실제 이동 경로"를 찾으므로 결과가 언제나 연결되어 있다.
     *
     * [알고리즘]
     * 128×128 육지 격자에서 A*(휴리스틱 = 직선거리)로 경로를 찾고, 그 뒤 시야 기반
     * 단축(line-of-sight)으로 꺾이지 않는 중간점을 지워 다각형으로 압축한다.
     * 경로가 없으면 빈 배열을 돌려준다 — 지어내지 않는다.
     */
    private routeRoadOnLand(ax: number, ay: number, bx: number, by: number): Array<{ x: number; y: number }> {
        if (this.segmentMostlyLand(ax, ay, bx, by)) return [];
        const path = this.findLandPath(ax, ay, bx, by);
        if (!path) return [];
        return this.simplifyLandPath(path, ax, ay, bx, by);
    }

    /** 육지 격자 위 A* — 연결된 경로를 찾지 못하면 null. */
    private findLandPath(ax: number, ay: number, bx: number, by: number): Array<{ x: number; y: number }> | null {
        const S = ChinaMapRenderer.ROUTE_GRID;
        const toCol = (x: number): number => Math.min(S - 1, Math.max(0, Math.floor(x * S)));
        const toRow = (y: number): number => Math.min(S - 1, Math.max(0, Math.floor(y * S)));
        const cx = (c: number): number => (c + 0.5) / S;

        const start = toRow(ay) * S + toCol(ax);
        const goal = toRow(by) * S + toCol(bx);
        // 출발·도착이 바다면 경로가 없다(도시 스냅이 육지에 두었다는 뜻이므로 실제로는 발생 안 함).
        if (!this.isLand(cx(toCol(ax)), cx(toRow(ay)))) return null;
        if (!this.isLand(cx(toCol(bx)), cx(toRow(by)))) return null;

        const g = new Float64Array(S * S).fill(Infinity);
        const from = new Int32Array(S * S).fill(-1);
        const closed = new Uint8Array(S * S);
        g[start] = 0;
        const h = (idx: number): number => {
            const c = idx % S;
            const r = (idx / S) | 0;
            return Math.hypot(cx(c) - bx, cx(r) - by);
        };
        // 격자가 128×128 이므로 선형 탐색 우선순위 큐로 충분하다(16k 노드).
        const open: number[] = [start];
        const inOpen = new Uint8Array(S * S);
        inOpen[start] = 1;

        while (open.length) {
            let bi = 0;
            let bf = g[open[0]] + h(open[0]);
            for (let i = 1; i < open.length; i++) {
                const f = g[open[i]] + h(open[i]);
                if (f < bf) { bf = f; bi = i; }
            }
            const cur = open.splice(bi, 1)[0];
            inOpen[cur] = 0;
            if (cur === goal) break;
            closed[cur] = 1;
            const cc = cur % S;
            const cr = (cur / S) | 0;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = cr + dr;
                    const nc = cc + dc;
                    if (nr < 0 || nr >= S || nc < 0 || nc >= S) continue;
                    const ni = nr * S + nc;
                    if (closed[ni]) continue;
                    if (!this.isLand(cx(nc), cx(nr))) continue; // 바다는 못 감
                    // 대각선은 모서리만 걸치는 것을 막기 위해 양옆 모두 육지여야 한다.
                    if (dr !== 0 && dc !== 0) {
                        if (!this.isLand(cx(cc + dc), cx(cr)) || !this.isLand(cx(cc), cx(cr + dr))) continue;
                    }
                    const step = Math.hypot(cx(nc) - cx(cc), cx(nr) - cx(cr));
                    const ng = g[cur] + step;
                    if (ng < g[ni]) {
                        g[ni] = ng;
                        from[ni] = cur;
                        if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
                    }
                }
            }
        }
        if (g[goal] === Infinity) return null;
        const out: Array<{ x: number; y: number }> = [];
        for (let at = goal; at !== -1; at = from[at]) {
            out.push({ x: cx(at % S), y: cx((at / S) | 0) });
            if (at === start) break;
        }
        out.reverse();
        return out;
    }

    /** 시야 기반 단축 — 꺾이지 않는 중간점을 지워 경로를 다각형 압축한다. */
    private simplifyLandPath(
        path: Array<{ x: number; y: number }>,
        ax: number, ay: number, bx: number, by: number,
    ): Array<{ x: number; y: number }> {
        const pts: Array<{ x: number; y: number }> = [{ x: ax, y: ay }, ...path, { x: bx, y: by }];
        const keep: Array<{ x: number; y: number }> = [pts[0]];
        let i = 0;
        while (i < pts.length - 1) {
            // 지금 점에서 가장 멀리까지 육지 위에서 보이는 점을 찾는다.
            let far = i + 1;
            for (let j = pts.length - 1; j > i; j--) {
                if (this.segmentMostlyLand(pts[i].x, pts[i].y, pts[j].x, pts[j].y)) { far = j; break; }
            }
            keep.push(pts[far]);
            i = far;
        }
        // 첫 점과 마지막 점은 도로의 양 끝점이므로 via 에 넣지 않는다.
        return keep.slice(1, keep.length - 1);
    }

    /** A* 격자 해상도 — 128×128 이면 육지 마스크(256) 와 맞고 비용도 16k 노드로 충분하다. */
    private static readonly ROUTE_GRID = 128;

    /** 두 점을 잇는 선분이 (거의) 전부 육지인가 — 정확하지 않아도 된다. */
    private segmentMostlyLand(ax: number, ay: number, bx: number, by: number): boolean {
        const steps = 8;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            if (!this.isLand(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
        }
        return true;
    }

    /** 선분이 처음 지나는 수면 구간(비율 [t0,t1]) — 없으면 null. */
    private findWaterSpan(
        ax: number, ay: number, bx: number, by: number, steps: number,
    ): [number, number] | null {
        let curIsLand = this.isLand(ax, ay);
        let start = 0;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const l = this.isLand(ax + (bx - ax) * t, ay + (by - ay) * t);
            if (l !== curIsLand) {
                if (!curIsLand) return [start, t];
                start = t;
                curIsLand = l;
            }
        }
        return null;
    }

    /**
     * 세력별 MST 를 다시 만든다.
     *
     * 좌표는 정규화 그대로 둔다 — pan/zoom 은 그때그때 화면 좌표로 변환한다. px 로 미리
     * 바꾸면 줌할 때마다 도로를 다시 만들어야 한다.
     *
     * 소유권은 도시가 다시 그려질 때마다 바뀐다(주권 변경). setCities 가 그 유일한 입구이므로
     * 여기서 갱신하면 도로가 주권과 어긋나지 않는다.
     */
    private rebuildRoads(): void {
        const base = buildRoadNetwork(this.cities.map(city => {
            const n = this.cityNorm(city);
            return {
                id: city.id,
                x: n.x,
                y: n.y,
                factionKey: city.ownerColor,
                color: city.ownerColor,
                isPlayer: city.isPlayer,
            };
        }));
        // MST 는 "가장 가까운 도시끼리" 만 보기 때문에 지형을 모른다. 물을 가로지르는 도로는
        // 우회 지점을 계산해 붙인다 — 이것이 없으면 도시가 고립되어 "도로가 끊겼다" 로 보인다.
        this.roads = base.map(road => {
            const via = this.routeRoadOnLand(road.ax, road.ay, road.bx, road.by);
            return via.length > 0 ? { ...road, via } : road;
        });
    }

    /** [49] 초기에는 전체 도시, 이후 방문·소유 도시만 표시하는 필터. */
    setDiscoveredOnly(discoveredOnly: boolean): void {
        if (this.discoveredOnly === discoveredOnly) return;
        this.discoveredOnly = discoveredOnly;
        this.territoryDirty = true;
        this.territoryLayerDirty = true;
        this.borderLayerDirty = true;
    }

    isCityVisible(city: MapCityView): boolean {
        return !this.discoveredOnly
            || city.isPlayer
            || city.isDiscovered === true
            || city.isAdjacentToDiscovered === true;
    }

    /** 현재 필터에서 실제로 표시되는 도시 ID — E2E/디버그 검증용. */
    getVisibleCityIds(): string[] {
        return this.cities.filter(city => this.isCityVisible(city)).map(city => city.id);
    }

    /** 연결된 관·요충지 접도로 — E2E/디버그 검증용. 좌표는 정규화. */
    getFeatureSpurs(): ReadonlyArray<{ name: string; kind: string; length: number }> {
        return this.featureSpurs.map(s => ({
            name: s.name,
            kind: s.kind,
            length: Math.hypot(s.bx - s.ax, s.by - s.ay),
        }));
    }

    private visibleCities(): MapCityView[] {
        return this.cities.filter(city => this.isCityVisible(city));
    }

    /**
     * 영토 격자 재계산 — 도시 위치 기반 보로노이 근사.
     * 대륙 윤곽 내부의 셀만 가장 가까운 도시의 소속 색으로 채운다.
     */
    private rebuildTerritory(): void {
        const cols = Math.ceil(1.0 / ChinaMapRenderer.CELL_SIZE);
        const rows = Math.ceil(1.0 / ChinaMapRenderer.CELL_SIZE);
        this.territoryCols = cols;
        this.territoryRows = rows;

        // [49] 세력 구분선·세력명은 발견 모드와 관계없이 전국의 모든 세력을 표시한다.
        const owned = this.cities.filter(c => c.ownerColor);

        const cells: Array<{ ownerColor: string | null; cityId: string | null; isPlayer: boolean; pattern: string }> = new Array(cols * rows);

        // 세력별 reach 필드 — 국경을 "선" 으로 그리기 위한 원본 값.
        // 셀 소유격자(=계단 모양) 를 등치선으로 긋으면 계단이 그대로 살아남는다.
        // 도시까지의 거리에서 파생한 연속값을 써야 매끄러운 곡선이 나온다.
        //   reach_F = max( 도시반경 - 최근접도시거리 , 도로통로반폭 - 최근접도로거리 )
        // 양수면 그 세력 영토, 0 이 국경, 음수면 바깥이다.
        const factionReach = new Map<string, Float32Array>();
        for (const city of owned) {
            if (!factionReach.has(city.ownerColor)) {
                factionReach.set(city.ownerColor, new Float32Array(cols * rows).fill(-1));
            }
        }
        this.factionReach = factionReach;

        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                const nx = (gx + 0.5) * ChinaMapRenderer.CELL_SIZE;
                const ny = (gy + 0.5) * ChinaMapRenderer.CELL_SIZE;
                const cellIndex = gy * cols + gx;
                const isLandCell = this.isLand(nx, ny);

                // 세력별 reach 갱신 — 도시 거리와(있다면) 도로 통로를 함께 본다.
                if (isLandCell) {
                    for (const city of owned) {
                        const c = this.cityNorm(city);
                        const reach = ChinaMapRenderer.TERRITORY_RADIUS
                            - Math.hypot(c.x - nx, c.y - ny);
                        const field = factionReach.get(city.ownerColor)!;
                        if (reach > field[cellIndex]) field[cellIndex] = reach;
                    }
                    for (const road of this.roads) {
                        const reach = ChinaMapRenderer.ROAD_HALF_WIDTH
                            - distanceToSegment(nx, ny, road.ax, road.ay, road.bx, road.by);
                        const field = factionReach.get(road.factionKey);
                        if (field !== undefined && reach > field[cellIndex]) field[cellIndex] = reach;
                    }
                }

                // 육지 판정 — 비트맵 마스크 우선, 없으면 스케치 윤곽 (홀짝 교차법)
                if (!isLandCell) {
                    cells[cellIndex] = { ownerColor: null, cityId: null, isPlayer: false, pattern: 'none' };
                    continue;
                }

                // 가장 가까운 소속 도시 탐색 (제곱거리 비교)
                let bestDist = Infinity;
                let bestCity: MapCityView | null = null;
                for (const city of owned) {
                    const c = this.cityNorm(city);
                    const dx = c.x - nx;
                    const dy = c.y - ny;
                    const d = dx * dx + dy * dy;
                    if (d < bestDist) {
                        bestDist = d;
                        bestCity = city;
                    }
                }

                // 반경 밖은 아무도 차지하지 않은 땅이다. 무한 보로노이였다면 이 셀이
                // 수천 km 밖까지 뻗어 세력 영토처럼 칠해진다.
                const withinRadius = bestDist <= ChinaMapRenderer.TERRITORY_RADIUS ** 2;

                // 도시 반경 밖이더라도 같은 세력 도시를 잇는 도로의 통로 안이면 그 세력 영토다.
                // 그래야 "도로는 이어져 있는데 영토만 끊긴다" 모순이 생기지 않는다.
                let roadOwner: RoadSegment | null = null;
                if (!withinRadius || !bestCity) {
                    let nearestRoad = ChinaMapRenderer.ROAD_HALF_WIDTH;
                    for (const road of this.roads) {
                        const d = distanceToSegment(nx, ny, road.ax, road.ay, road.bx, road.by);
                        if (d < nearestRoad) { nearestRoad = d; roadOwner = road; }
                    }
                }

                const owner = bestCity && withinRadius ? bestCity : roadOwner;
                // RoadSegment 에는 id 도 color 도 없다 — MapCityView 인지로 두 출처를 갈라
                // 각각의 필드 이름이 다르다(도시=ownerColor, 도로=color).
                const ownerCity = owner && 'id' in owner ? owner : null;
                const ownerColor = owner
                    ? ('color' in owner ? owner.color : owner.ownerColor)
                    : null;
                cells[gy * cols + gx] = owner
                    ? {
                        ownerColor,
                        cityId: ownerCity ? ownerCity.id : null,
                        isPlayer: owner.isPlayer,
                        pattern: ownerCity ? (ownerCity.factionPattern ?? 'none') : 'none',
                    }
                    : { ownerColor: null, cityId: null, isPlayer: false, pattern: 'none' };
            }
        }

        this.territoryCells = cells;

        // ---- 세력 라벨 산출: 세력별 무게중심을 자기 영토 안으로 스냅 + 크기 ----
        // 순수 무게중심은 오목한 해안선에서 바다에 떨어진다 (한반도+일본 영토의 중심은 동해 한가운데).
        // BFS로 '가장 깊은 셀'을 고르면 영토가 지도 끝까지 뻔 세력이 북쪽 끝단에 라벨을 붙인다.
        // 무게중심에 가장 가까운 '내 소유 셀'을 고르면 바다가 나올 수 없고 시각적 중심도 유지된다.
        const acc = new Map<string, { name: string; color: string; sumX: number; sumY: number; n: number; isPlayer: boolean; mine: number[] }>();
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (!cell || !cell.ownerColor) continue;
            const city = owned.find(c => c.ownerColor === cell.ownerColor);
            if (!city) continue;
            const key = cell.ownerColor + '|' + (city.factionName ?? '');
            let a = acc.get(key);
            if (!a) {
                a = { name: city.factionName ?? '', color: cell.ownerColor, sumX: 0, sumY: 0, n: 0, isPlayer: city.isPlayer, mine: [] };
                acc.set(key, a);
            }
            a.sumX += ((i % cols) + 0.5) * ChinaMapRenderer.CELL_SIZE;
            a.sumY += (((i / cols) | 0) + 0.5) * ChinaMapRenderer.CELL_SIZE;
            a.n++;
            a.mine.push(i);
        }

        this.factionLabels = Array.from(acc.values())
            // 작은 세력도 전국 지도에서 세력명을 표시하고, 겹칠 때만 안티오버랩 처리로 생략한다.
            .filter(a => a.n >= ChinaMapRenderer.FACTION_LABEL_MIN_CELLS)
            .map(a => {
                const ccx = a.sumX / a.n;
                const ccy = a.sumY / a.n;
                let best = a.mine[0];
                let bestD = Infinity;
                for (const i of a.mine) {
                    const dx = ((i % cols) + 0.5) * ChinaMapRenderer.CELL_SIZE - ccx;
                    const dy = (((i / cols) | 0) + 0.5) * ChinaMapRenderer.CELL_SIZE - ccy;
                    const d = dx * dx + dy * dy;
                    if (d < bestD) { bestD = d; best = i; }
                }
                return {
                    name: a.name,
                    color: a.color,
                    cx: ((best % cols) + 0.5) * ChinaMapRenderer.CELL_SIZE,
                    cy: (((best / cols) | 0) + 0.5) * ChinaMapRenderer.CELL_SIZE,
                    cells: a.n,
                    isPlayer: a.isPlayer,
                };
            });

        this.territoryDirty = false;
        this.territoryLayerDirty = true;
        this.borderLayerDirty = true;
    }

    // 여기서 render() 를 부르지 않는다. gameLoop 가 매 프레임 renderFrame 을 돌리므로
    // 호버 변경은 다음 프레임에 자동으로 반영된다. pointermove 마다 한 번 더 그리면
    // 영토·세력라벨·42개 도시 배치를 전부 다시 계산해 마우스 움직임마다 비용이 두 배가 된다.
    setHoveredCity(id: string | null): void {
        this.hoveredCityId = id;
    }

    /**
     * 정규화 좌표(0~1) → 화면 픽셀 사각형.
     *
     * assets/map-china-4096.webp 는 4096×4096 정사각 이미지다. 화면을 가득
     * 채우도록 가로·세로 중 큰 쪽에 맞춘다(cover). 와이드 화면에서는
     * 위·아래 바깥(사막·외해)이 잘리고 중원 도시 클러스터가 화면을 채운다.
     * 잘린 영역은 드래그 팬·휠 줌으로 볼 수 있다.
     */
    private mapImageRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const baseScale = this.baseScale();
        return {
            x: width / 2 + this.offsetX - baseScale / 2,
            y: height / 2 + this.offsetY - baseScale / 2,
            width: baseScale,
            height: baseScale,
        };
    }

    private normToPixel(x: number, y: number, width: number, height: number): { px: number; py: number } {
        const rect = this.mapImageRect(width, height);
        return { px: rect.x + x * rect.width, py: rect.y + y * rect.height };
    }

    /**
     * 도시가 실제로 그려지는 정규화 좌표 — 비트맵 앵커가 있으면 그것을, 없으면 전술 좌표를 쓴다.
     *
     * 앵커가 바다 위에 있으면 육지로 끌어당긴 값을 쓴다(snapToLand). 결과는 setCities /
     * 지도 이미지 로드 때 한 번만 계산해 cityPos 에 캐시한다 — 여기서 매번 나선 탐색을
     * 돌리면 rebuildTerritory 가 셀 수만 도시 수만큼 곱해져 프레임을 통째로 먹는다.
     */
    private cityNorm(city: MapCityView): { x: number; y: number } {
        const cached = this.cityPos.get(city.id);
        if (cached) return cached;
        return { x: city.imageX ?? city.x, y: city.imageY ?? city.y };
    }

    /**
     * 도시별 확정 좌표를 계산한다 — 바다 위 앵커를 육지로 당기고, 겹치지 않게 벌린다.
     *
     * [왜 두 단계인가]
     * 1단계(snapToLand): 앵커가 바다 위이면 가장 가까운 육지로 끌어당긴다. 이것만으로는
     *   "도시가 해안에서 너무 멀리 떨어져 있고 서로 붙어 있다" 는 문제가 남는다.
     * 2단계(relaxCityPlacement): 표시 좌표만(hexCoord 는 불변) 해안 쪽으로 유연하게 밀고
     *   아이콘이 겹치지 않는 최소 간격(requiredCityGap)을 확보한다.
     */
    private rebuildCityPositions(): void {
        this.cityPos.clear();
        if (this.cities.length === 0) return;

        // 1단계 — 육지로 스냅. relax 는 "이미 육지 위" 를 전제로 하므로 순서를 지킨다.
        for (const city of this.cities) {
            const raw = { x: city.imageX ?? city.x, y: city.imageY ?? city.y };
            this.cityPos.set(city.id, this.isLand(raw.x, raw.y) ? raw : this.snapToLand(city));
        }

        if (!this.mapImage) return; // 마스크 없음(isLand 이 항상 true)면 이동시킬 이유가 없다

        // 2단계 — 겹침 완화. 실패해도 스냅된 좌표는 이미 유효하므로 그대로 쓴다.
        const seeded = this.cities.map(city => ({ id: city.id, ...this.cityPos.get(city.id)! }));
        const relaxed = relaxCityPlacement(seeded, {
            isLand: (x, y) => this.isLand(x, y),
            maxMove: ChinaMapRenderer.CITY_COAST_MAX_MOVE,
            minGap: this.requiredCityGap(),
            coastBias: ChinaMapRenderer.CITY_COAST_BIAS,
        });
        for (const city of this.cities) {
            const p = relaxed.positions.get(city.id);
            if (p) this.cityPos.set(city.id, p);
        }

        // 3단계 — 해안선에서 띄우기. coastBias 는 도시를 물가로 끌어당기는데,
        // 한계가 없어 아이콘이 바다에 반쯤 걸렸다(연주·하비·오·계양 이 수면거리 0.004).
        this.pushInlandFromShore();
    }

    /**
     * 수면과의 거리가 MIN_SHORE_MARGIN 보다 작은 도시를 안쪽으로 민다.
     *
     * [왜 필요한가]
     * 해안 배치(coastBias)는 도시를 물가로 끌어당긴다. 그게 의도였지만 한계가 없어서
     * 실제로 4개 도시(연주·하비·오·계양)가 수면에서 0.004(≈3.6px) 까지 밀렸다. 도시 아이콘은
     * 12~16px 이라 중심이 3.6px 면 바다에 걸쳐 "섬에 떠 있다" 는 인상이 된다.
     *
     * [가장 깊은 육지 방향으로 밀면 안 되는 이유]
     * 처음엔 "가장 깊은 육지 방향"을 골랐다. 그런데 탐색 반경(0.05) 안에서 여러 방향이
     * 모두 최대 깊이에 도달해 동률이 되고, 그중 첫 번째가 선택됐다. 결과적으로 도시가
     * 해안선을 따라 "옆으로" 미끄러졌다(실측: x는 그대로인데 y만 이동). 방향 선택이 탐색
     * 반경에 의존하므로 쓸 수 없다.
     *
     * 대신 가장 가까운 물을 찾아 그 반대 방향으로 이동한다 — 수면 거리가 방향과 무관하게
     * 매 스텝 증가하므로 반경에 의존하지 않는다. 섬 위의 도시는 사방이 물이라 자동으로
     * 섬 중앙을 향해 이동하고, 본토로 옮겨 가지 않는다.
     */
    private pushInlandFromShore(): void {
        const STEP = 0.002;
        const MAX_PROBE = 0.06;
        // 한 번에 필요한 만큼만 옮기면 좁은 지협(양쪽이 물)에서 반대편 바다를 넘어간다.
        // 실제로 장사가 그랬다 — 남서쪽 물에서 0.012 을 한 번에 밀었더니 반대편 해리로
        // 착지했다(측정: 목표점이 육지가 아니어서 이동을 취소했다). 그래서 한 칸씩
        // 옮기며 매번 방향을 다시 잡는다 — 지협을 따라 안쪽으로 걸어 들어간다.
        const MAX_STEPS = 24;
        for (const city of this.cities) {
            const p = this.cityPos.get(city.id);
            if (!p) continue;
            let cur = { x: p.x, y: p.y };
            for (let i = 0; i < MAX_STEPS; i++) {
                const info = this.shoreInfo(cur.x, cur.y, STEP, MAX_PROBE);
                if (!info || info.dist >= ChinaMapRenderer.MIN_SHORE_MARGIN) break;
                const stepLen = Math.min(STEP, ChinaMapRenderer.MIN_SHORE_MARGIN - info.dist);
                const nx = cur.x - info.dirX * stepLen;
                const ny = cur.y - info.dirY * stepLen;
                if (!this.isLand(nx, ny)) break; // 이 방향은 막혔다 — 다음 도시로
                cur = { x: nx, y: ny };
            }
            if (cur.x !== p.x || cur.y !== p.y) this.cityPos.set(city.id, cur);
        }
    }

    /** 가장 가까운 물의 거리와 그쪽 방향. 육지 위에서 물이 없으면 null. */
    private shoreInfo(
        x: number, y: number, step: number, maxProbe: number,
    ): { dist: number; dirX: number; dirY: number } | null {
        let best: { dist: number; dirX: number; dirY: number } | null = null;
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const dx = Math.cos(a);
            const dy = Math.sin(a);
            for (let d = step; d <= maxProbe; d += step) {
                if (!this.isLand(x + dx * d, y + dy * d)) {
                    if (!best || d < best.dist) best = { dist: d, dirX: dx, dirY: dy };
                    break;
                }
            }
        }
        return best;
    }

    /** (x,y) 에서 가장 가까운 물까지의 거리(정규화). */
    private shoreDistance(x: number, y: number): number {
        return this.shoreInfo(x, y, 0.002, 0.05)?.dist ?? 0.05;
    }

    /** 도시 아이콘이 물에 걸리지 않기 위한 최소 수면 거리(정규화). */
    private static readonly MIN_SHORE_MARGIN = 0.014;

    private cityMapToPixel(city: MapCityView, width: number, height: number): { px: number; py: number } {
        const n = this.cityNorm(city);
        return this.normToPixel(n.x, n.y, width, height);
    }

    /** 화면 픽셀 → 정규화 좌표 (역변환) */
    screenToNorm(px: number, py: number): { x: number; y: number } {
        const rect = this.mapImageRect(this.canvas.width, this.canvas.height);
        return {
            x: (px - rect.x) / rect.width,
            y: (py - rect.y) / rect.height,
        };
    }

    /**
     * 픽셀 좌표 아래의 도시를 찾는다 (없으면 null)
     */
    cityAt(px: number, py: number): MapCityView | null {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const radius = 14 * this.zoom;
        let best: MapCityView | null = null;
        let bestDist = Infinity;
        for (const city of this.visibleCities()) {
            const { px: cx, py: cy } = this.cityMapToPixel(city, width, height);
            const d = Math.hypot(px - cx, py - cy);
            const hitRadius = (city.hitRadius ?? 16) * this.zoom;
            if (d < Math.max(radius + 6, hitRadius) && d < bestDist) {
                best = city;
                bestDist = d;
            }
        }
        return best;
    }

    /** 도시의 현재 캔버스 픽셀 좌표 — 실제 입력 E2E와 접근성 검증에서 사용한다. */
    getCityScreenPosition(cityId: string): { x: number; y: number } | null {
        const city = this.cities.find(item => item.id === cityId);
        if (!city || !this.isCityVisible(city)) return null;
        const point = this.cityMapToPixel(city, this.canvas.width, this.canvas.height);
        return { x: point.px, y: point.py };
    }

    // ============================================================
    // 이동 경로 표시 [2026-10-04]
    // ============================================================

    /**
     * 이동 경로를 설정한다.
     *
     * [왜 직선이 아니라 도로를 따르는가 — 2026-10-04 사용자 지적]
     * "다른 도시 이동시 직선 코스 말고 도로길 따라 이동해야 한다" 고 지적받았다.
     * 지도는 이미 도로망을 그린다(도로는 도시를 가로지르는 대로 표시다). 그런데
     * 이동 표시가 직선으로 가면 **화면에서 보이는 도로를 무시하는** 모순이 생긴다.
     * 지도가 무엇을 말하는지(도로가 있다) 와 게임이 무엇을 하는지(직선으로 간다)가
     * 어긋나는 셈이다.
     *
     * 세기와: 이 메서드는 도시 좌표만으로는 경로를 만들지 않고, **도로 그래프를
     * 다익스트라로** 돌린다. 3단계에서 군단이 실제로 이 그래프 위를 움직이게 된다.
     */
    setTravelRoute(fromCityId: string, toCityId: string): void {
        const from = this.cities.find(c => c.id === fromCityId);
        const to = this.cities.find(c => c.id === toCityId);
        if (!from || !to) { this.travelRoute = null; return; }
        const polyline = this.routeAlongRoads(from, to);
        const plan = planTravel(polyline, (x, y) => this.isLand(x, y));
        this.travelRoute = { from, to, points: polyline, legs: plan.legs };
        this.travelProgress = 0;
    }

    /** 이동 표시를 지운다 — 애니메이션 종료·취소 시 호출. */
    clearTravelRoute(): void {
        this.travelRoute = null;
        this.travelProgress = 0;
    }

    /** 이동 진행도 0~1. 애니메이션 루프가 매 프레임 부른다. */
    setTravelProgress(t: number): void {
        this.travelProgress = Math.max(0, Math.min(1, t));
        this.render();
    }

    /** 현재 이동 표시가 있는지 — E2E 가 읽는다. */
    hasTravelRoute(): boolean { return this.travelRoute !== null; }

    /**
     * 현재 이동 경로의 정규화 좌표 — E2E/디버그 검증용.
     *
     * "도로를 따라가는가" 를 확인하려면 점 개수만 보면 된다. 직선이면 2개,
     * 도로를 거치면 3개 이상이다(우회 지점 via 까지 포함하면 더 늘어난다).
     */
    getTravelRoutePoints(): ReadonlyArray<{ x: number; y: number }> {
        return this.travelRoute?.points ?? [];
    }

    /**
     * 현재 경로의 이동 계획 — 육로/해로 구간별 소요 일수.
     *
     * 지형 판정은 이 클래스가 이미 갖고 있는 `isLand` 를 쓴다. 순수 계산은
     * `travel_transport.ts` 가 맡고 여기선 그 결과만 받아 노출한다.
     */
    getTravelPlan(): TravelPlan {
        const pts = this.travelRoute?.points ?? [];
        return planTravel(pts, (x, y) => this.isLand(x, y));
    }

    /**
     * 남은 소요 일수 → 지도 위 진행도(0~1) 를 **경로 거리 기준**으로 환산한다.
     *
     * [왜 거리 기준인가 — 이 메서드가 존재하는 이유]
     * 각 구간의 하루 이동 거리가 다르다(말 0.085, 배 0.051). 날짜 비율을 그대로
     * 진행도에 쓰면 3일짜리 말 구간을 하루 만에 통과해 버린다 — 마커가 지형을
     * 뚫고 순간이동하는 것처럼 보인다.
     *
     * 그래서 "그 날짜까지 실제로 걸려간 거리" 를 누적해서 전체 거리로 나눈다.
     * 이러면 배가 느린 구간에서 마커가 실제로 더 오래 머문다.
     *
     * @param daysLeft 남은 일수
     * @param daysTotal 총 소요 일수
     */
    progressForDays(daysLeft: number, daysTotal: number): number {
        const route = this.travelRoute;
        if (!route || daysTotal <= 0) return 0;
        const legs = route.legs ?? [];
        if (legs.length === 0) {
            // 구간 정보가 없으면 날짜 비율로 대체한다 — 선형 경로라 차이가 없다.
            return 1 - Math.max(0, Math.min(1, daysLeft / daysTotal));
        }
        const totalDays = legs.reduce((s, l) => s + l.days, 0);
        if (totalDays <= 0) return 0;
        const totalDist = legs.reduce((s, l) => s + l.distance, 0);
        if (totalDist <= 0) return 0;

        // 경과 일수 → 경과 거리. 구간을 날짜 순으로 소비한다.
        const elapsed = Math.max(0, Math.min(totalDays, totalDays - daysLeft));
        let accDays = 0;
        let accDist = 0;
        for (const leg of legs) {
            if (elapsed <= accDays) break;
            const take = Math.min(leg.days, elapsed - accDays);
            accDist += leg.distance * (take / leg.days);
            accDays += leg.days;
        }
        return Math.max(0, Math.min(1, accDist / totalDist));
    }

    /**
     * 두 도시를 잇는 경로를 **도로 그래프 위에서** 찾는다.
     *
     * [그래프 구성]
     * 정점은 도시다. 간선은 `this.roads` 의 한 구간이다. 그런데 도로는 도시끼리
     * 직접 이어 주지 않는다 — RoadSegment 에는 도시 id 가 없고 좌표만 있다.
     * 그래서 각 도로 끝점을 "가장 가까운 도시"로 매칭해 그래프를 만든다.
     *
     * [도로는 세력별로만 잇는다 — 이 함수의 중요한 한계]
     * `buildRoadNetwork` 은 MST 로 **같은 세력끼리만** 잇는다. 그래서 중립 도시나
     * 적 세력 도시로 가는 도로가 화면에 없다. 이때는 (a) 도로가 없는데 직선으로
     * 가면 "도로를 따라간다" 는 약속이 무너지고, (b) 육지 우회 경로(기존 A*)를
     * 쓰면 "도로는 없지만 지형은 따른다" 가 된다. (b) 를 택했다. 3단계에서 국경
     * 개방 규칙이 들어오면 그때 갈선을 정한다.
     */
    private routeAlongRoads(from: MapCityView, to: MapCityView): Array<{ x: number; y: number }> {
        const straight = (): Array<{ x: number; y: number }> => [
            { x: this.cityNorm(from).x, y: this.cityNorm(from).y },
            { x: this.cityNorm(to).x, y: this.cityNorm(to).y },
        ];
        if (this.roads.length === 0) return straight();

        // 각 도시의 정규화 좌표 — 도로 끝점 매칭에 쓴다.
        const posOf = new Map<string, { x: number; y: number }>();
        for (const c of this.cities) {
            const n = this.cityNorm(c);
            posOf.set(c.id, { x: n.x, y: n.y });
        }
        /** 도로 끝점에서 가장 가까운 도시 — 실측 오차 이내면 그 도시로 본다. */
        const nearestCity = (x: number, y: number): string | null => {
            let best: string | null = null;
            let bestD = Infinity;
            for (const [id, p] of posOf) {
                const d = (p.x - x) ** 2 + (p.y - y) ** 2;
                if (d < bestD) { bestD = d; best = id; }
            }
            return best;
        };

        // 인접 리스트: 도시A - (거리, 도시B)
        const adj = new Map<string, Array<{ to: string; w: number }>>();
        for (const road of this.roads) {
            const ca = nearestCity(road.ax, road.ay);
            const cb = nearestCity(road.bx, road.by);
            if (!ca || !cb || ca === cb) continue;
            // 간선 비용은 **도로가 실제로 휘는 길이** 다. 직선 거리로 재면
            // 우회한 도로가 오히려 짧아져 다익스트라가 그 도로를 먼저 고른다.
            const w = this.roadPolylineLength(road);
            if (!adj.has(ca)) adj.set(ca, []);
            if (!adj.has(cb)) adj.set(cb, []);
            adj.get(ca)!.push({ to: cb, w });
            adj.get(cb)!.push({ to: ca, w });
        }

        if (!adj.has(from.id) || !adj.has(to.id)) {
            return this.fallbackLandRoute(from, to, straight);
        }

        const dist = new Map<string, number>();
        const prev = new Map<string, string>();
        dist.set(from.id, 0);
        // 정점 수 = 도시 수(수백) 이므로 선형 탐색 우선순위 큐로 충분하다.
        const visited = new Set<string>();
        for (;;) {
            let u: string | null = null;
            let best = Infinity;
            for (const [id, d] of dist) {
                if (!visited.has(id) && d < best) { best = d; u = id; }
            }
            if (u === null || u === to.id) break;
            visited.add(u);
            for (const e of adj.get(u) ?? []) {
                const nd = best + e.w;
                if (nd < (dist.get(e.to) ?? Infinity)) {
                    dist.set(e.to, nd);
                    prev.set(e.to, u);
                }
            }
        }

        if (!prev.has(to.id) && from.id !== to.id) {
            return this.fallbackLandRoute(from, to, straight);
        }

        // 역추적 → 도시 id 사슬
        const chain: string[] = [to.id];
        let cur = to.id;
        while (cur !== from.id) {
            const p = prev.get(cur);
            if (!p) return this.fallbackLandRoute(from, to, straight);
            chain.unshift(p);
            cur = p;
        }
        return this.expandChainToPolyline(chain);
    }

    /** 도로 한 구간의 실제 길이(정규화) — via 가 있으면 꺾은선을 따라 잰다. */
    private roadPolylineLength(road: RoadSegment): number {
        const nodes: Array<{ x: number; y: number }> = road.via && road.via.length > 0
            ? [{ x: road.ax, y: road.ay }, ...road.via, { x: road.bx, y: road.by }]
            : [{ x: road.ax, y: road.ay }, { x: road.bx, y: road.by }];
        let len = 0;
        for (let i = 1; i < nodes.length; i++) {
            len += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
        }
        return len;
    }

    /**
     * 도시 id 사슬을 도로를 따라가는 좌표 꺾은선으로 펼친다.
     *
     * 사슬의 각 인접 도시 사이에 해당 도시를 잇는 도로가 있다. 그 도로의 via 를
     * 끼워 넣어야 화면의 도로 모양 그대로 경로가 된다 — 두 도시를 직선으로 이으면
     * "도로를 따른다" 는 뜻이 깨진다.
     */
    private expandChainToPolyline(chain: readonly string[]): Array<{ x: number; y: number }> {
        const out: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < chain.length; i++) {
            const city = this.cities.find(c => c.id === chain[i]);
            if (city) {
                const n = this.cityNorm(city);
                out.push({ x: n.x, y: n.y });
            }
            if (i < chain.length - 1) {
                const road = this.findRoadBetween(chain[i], chain[i + 1]);
                for (const v of road?.via ?? []) out.push({ x: v.x, y: v.y });
            }
        }
        return out;
    }

    /** 두 도시를 직접 잇는 도로 구간(없으면 null). */
    private findRoadBetween(aId: string, bId: string): RoadSegment | null {
        const match = (id: string, x: number, y: number): boolean => {
            const c = this.cities.find(item => item.id === id);
            if (!c) return false;
            const n = this.cityNorm(c);
            return Math.hypot(n.x - x, n.y - y) < 0.02;
        };
        for (const road of this.roads) {
            const forward = (match(aId, road.ax, road.ay) && match(bId, road.bx, road.by))
                || (match(aId, road.bx, road.by) && match(bId, road.ax, road.ay));
            if (forward) return road;
        }
        return null;
    }

    /** 도로 그래프에 없을 때 — 육지 우회 경로를 쓰고, 그것도 없으면 직선. */
    private fallbackLandRoute(
        from: MapCityView,
        to: MapCityView,
        straight: () => Array<{ x: number; y: number }>,
    ): Array<{ x: number; y: number }> {
        const a = this.cityNorm(from);
        const b = this.cityNorm(to);
        if (this.segmentMostlyLand(a.x, a.y, b.x, b.y)) return straight();
        const via = this.routeRoadOnLand(a.x, a.y, b.x, b.y);
        return via.length > 0
            ? [{ x: a.x, y: a.y }, ...via, { x: b.x, y: b.y }]
            : straight();
    }

    /**
     * 이동 경로를 그린다.
     *
     * [꺾은선 처리] points 는 도로를 따라 꺾이는 정규화 좌표 배열이다. 이를 픽셀로
     * 바꿔 선분별로 이어 그린다. 직선 대신 꺾은선을 쓰는 이유가 이 메서드의 존재
     * 이유다 — 화면의 도로를 따라가야 한다.
     */
    private drawTravelRoute(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const route = this.travelRoute;
        if (!route) return;
        // 정규화 → 픽셀. 도로(drawRoads)와 같은 변환을 쓴다 — 다른 변환을 쓰면
        // 이동선이 화면의 도로와 어긋난다.
        const toPx = (n: { x: number; y: number }): { px: number; py: number } =>
            this.normToPixel(n.x, n.y, width, height);

        const pts = route.points.length >= 2
            ? route.points
            : [
                { x: this.cityNorm(route.from).x, y: this.cityNorm(route.from).y },
                { x: this.cityNorm(route.to).x, y: this.cityNorm(route.to).y },
            ];

        // 경로의 총 길이(누적) — t 를 거리 비율로 환산하기 위해.
        const cum: number[] = [0];
        for (let i = 1; i < pts.length; i++) {
            cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
        }
        const total = cum[cum.length - 1] || 1;

        // t 만큼 진행한 점 — 선분을 따라 걸어야 하므로 보간한다.
        const target = total * this.travelProgress;
        const at = (dist: number): { x: number; y: number } => {
            let i = 1;
            while (i < cum.length - 1 && cum[i] < dist) i++;
            const seg = cum[i] - cum[i - 1] || 1;
            const k = (dist - cum[i - 1]) / seg;
            return {
                x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
                y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
            };
        };
        const head = at(target);

        // [2026-10-04] 육로/해로를 다른 색으로 그린다. 구간 분해는
        //   travel_transport.splitByTerrain 이, 색 결정은 여기서 한다 —
        //   순수 계산 모듈이 색(표현)을 몰라야 재사용된다.
        //   말 = 흙빛 주황, 배 = 물빛 청색.
        const HORSE_COLOR = 'rgba(255, 206, 120, 0.95)';
        const HORSE_DIM = 'rgba(220, 160, 70, 0.35)';
        const BOAT_COLOR = 'rgba(130, 200, 255, 0.95)';
        const BOAT_DIM = 'rgba(80, 150, 220, 0.35)';

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 남은 경로(점선)와 간 경로(실선)를 각각 그린다.
        // 한 번에 그리지 않고 구간별로 색을 바꿔 칠하기 위해 ���분 셈이 필요하다.
        const legInfo = this.travelRoute!.legs ?? [];
        const strokeRange = (
            from: number, to: number, done: boolean,
        ): void => {
            if (to <= from) return;
            ctx.beginPath();
            const s0 = toPx(at(from));
            ctx.moveTo(s0.px, s0.py);
            for (let i = 1; i <= legInfo.length; i++) {
                const d = cum[i] ?? total;
                if (d <= from) continue;
                if (d >= to) break;
                const p = toPx(at(d));
                ctx.lineTo(p.px, p.py);
            }
            const e0 = toPx(at(to));
            ctx.lineTo(e0.px, e0.py);
            ctx.stroke();
            void done;
        };

        // 점선(남은 경로) — 각 구간의 수송 색으로.
        ctx.lineWidth = 2.5 * this.zoom;
        for (let i = 0; i < legInfo.length; i++) {
            const from = cum[i], to = cum[i + 1] ?? total;
            if (to <= target) continue;
            const start = Math.max(from, target);
            ctx.setLineDash([6 * this.zoom, 6 * this.zoom]);
            ctx.strokeStyle = legInfo[i].mode === 'BOAT' ? BOAT_DIM : HORSE_DIM;
            strokeRange(start, to, false);
        }

        // 실선(간 경로) — 이미 지난 구간.
        ctx.setLineDash([]);
        ctx.lineWidth = 3 * this.zoom;
        for (let i = 0; i < legInfo.length; i++) {
            const from = cum[i], to = cum[i + 1] ?? total;
            if (from >= target) break;
            ctx.strokeStyle = legInfo[i].mode === 'BOAT' ? BOAT_COLOR : HORSE_COLOR;
            strokeRange(from, Math.min(to, target), true);
        }

        // 이동 마커 — 진행 중인 위치에 세운다.
        // [말/배 표식] 육로에서는 말을, 해로에서는 배를 그린다. 단순 원만 두면
        // "이동 중" 임을 알 수 있지만 무엇으로 이동하는지는 안 보인다 — 이미 색으로
        // 구분하지만 표식까지 있으면 거리에서 읽힌다.
        ctx.setLineDash([]);
        const marker = toPx(head);
        const r = 7 * this.zoom;
        // 머리 위 흰 테두기 — 어떤 지형 위에서도 눈에 띄게.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.beginPath();
        ctx.arc(marker.px, marker.py, r + 2, 0, Math.PI * 2);
        ctx.fill();
        // 현재 구간의 수송 색.
        ctx.fillStyle = BOAT_COLOR;
        // 마커가 어느 구간에 있는지 찾는다 — 지점이 속한 구간이 그 구간의 수송이다.
        for (let i = 0; i < legInfo.length; i++) {
            const from = cum[i], to = cum[i + 1] ?? total;
            if (target >= from && target <= to) {
                ctx.fillStyle = legInfo[i].mode === 'BOAT' ? BOAT_COLOR : HORSE_COLOR;
                break;
            }
        }
        ctx.beginPath();
        ctx.arc(marker.px, marker.py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(40, 28, 8, 0.95)';
        ctx.lineWidth = 1.5 * this.zoom;
        ctx.stroke();
        ctx.restore();
    }

    render(): void {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        ctx.clearRect(0, 0, width, height);

        // 첫 렌더에서 초기 시점을 육지에 맞춘다 — 빈 바다를 걷어낸다.
        if (this.mapImage) this.frameLandView(width, height);

        // ---- 배경 (바다색) ----
        ctx.fillStyle = '#0c0e1c';
        ctx.fillRect(0, 0, width, height);

        if (this.mapImage) {
            // 실제 지형 비트맵 [지도][1:1] — 양피지 multiply는 밝은 신지도에서
            // 세로 줄무늬 아티팩트를 만들므로 사용하지 않는다.
            const rect = this.mapImageRect(width, height);
            ctx.drawImage(this.mapImage, rect.x, rect.y, rect.width, rect.height);
            const tint = this.seasonTintOverlay(width, height);
            if (tint) {
                ctx.fillStyle = tint;
                ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            }
        } else {
            // ---- 대륙 윤곽 (비트맵 미로딩 시 폴백) ----
            const outline: Array<[number, number]> = CONTINENT_OUTLINE.map(p => {
                const { px, py } = this.normToPixel(p.x, p.y, width, height);
                return [px, py] as [number, number];
            });

            ctx.beginPath();
            ctx.moveTo(outline[0][0], outline[0][1]);
            for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
            ctx.closePath();

            // 육지 그라데이션 (+계절 톤 보정 [1057][321-340])
            const landGrad = ctx.createLinearGradient(0, 0, width, height);
            landGrad.addColorStop(0, '#3a4430');
            landGrad.addColorStop(0.5, '#46523a');
            landGrad.addColorStop(1, '#37402e');
            ctx.fillStyle = this.applySeasonTint(landGrad);
            ctx.fill();

            // 해안선
            ctx.strokeStyle = 'rgba(220, 210, 170, 0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // ---- 세력 영토 (도시 좌표에서 산출한 보로노이 근사) ----
        this.drawTerritory(ctx, width, height);

        // ---- [2026-10-04] 이동 경로 — 도시 아이콘보다 먼저 그린다. 도시를 가리면
        //      도시가 핵심 정보인데 경로가 위에 얹히면 정반대가 된다.
        this.drawTravelRoute(ctx, width, height);

        // ---- [321-340] 지도 날씨 오버레이 — 도시 위 날씨 아이콘 + 악천후 수확 경고 ----
        this.drawWeatherOverlay(ctx, width, height);

        if (!this.mapImage) {
            // ---- 산맥 장식 (비트맵 미로딩 시 폴백) ----
            ctx.strokeStyle = 'rgba(150, 140, 110, 0.5)';
            ctx.lineWidth = 1.2;
            for (let i = 0; i < 5; i++) {
                const bx = 0.16 + i * 0.035;
                const { px, py } = this.normToPixel(bx, 0.34 + (i % 2) * 0.05, width, height);
                const size = 8 * this.zoom;
                ctx.beginPath();
                ctx.moveTo(px - size, py + size * 0.6);
                ctx.lineTo(px, py - size * 0.7);
                ctx.lineTo(px + size, py + size * 0.6);
                ctx.stroke();
            }

            // ---- 강 (비트맵 미로딩 시 폴백 — Natural Earth에 이미 하천이 있다) ----
            for (const river of RIVERS) {
                ctx.beginPath();
                river.forEach((p, i) => {
                    const { px, py } = this.normToPixel(p.x, p.y, width, height);
                    if (i === 0) ctx.moveTo(px, py);
                    else {
                        // 부드러운 곡선
                        const prev = river[i - 1];
                        const pp = this.normToPixel(prev.x, prev.y, width, height);
                        const cpx = (pp.px + px) / 2;
                        const cpy = (pp.py + py) / 2;
                        ctx.quadraticCurveTo(pp.px, pp.py, cpx, cpy);
                    }
                });
                const last = river[river.length - 1];
                const lp = this.normToPixel(last.x, last.y, width, height);
                ctx.lineTo(lp.px, lp.py);
                ctx.strokeStyle = 'rgba(90, 140, 190, 0.75)';
                ctx.lineWidth = Math.max(2, 4 * this.zoom);
                ctx.lineCap = 'round';
                ctx.stroke();
            }
        }

        // ---- 세력 경계선·세력명 (도시 좌표에서 산출된 데이터) ----
        // 접점선은 세력 도로보다 먼저 그린다 — 실선 위에 점이 겹쳐 보이지 않도록.
        this.drawEnemyLinks(ctx, width, height);
        this.drawRoads(ctx, width, height);
        this.drawFeatureSpurs(ctx, width, height);
        this.drawTerritoryBorders(ctx, width, height);
        this.drawFactionLabels(ctx, width, height);

        // ---- 전략 요충지(관·전장·항구) — 도시보다 아래에 깔린다 ----
        this.drawFeatures(ctx, width, height);

        // ---- 도시 ----
        const visible = this.visibleCities();
        this.layoutCityLabels(ctx, visible, width, height);
        for (const city of visible) {
            this.drawCity(ctx, city, width, height, this.labelSlots.get(city.id));
        }
    }

    /**
     * 도시 간 도로 — 세력별 MST. 같은 세력 도시끼리만 잇는다.
     *
     * 국도(main)는 어두운 테두리 + 밝은 실선 이중선으로 그려 지형 위에서도 읽히게 하고,
     * playable 세력(Player)만 실선을 밝게 해 아군 영토가 한눈에 보인다.
     */
    /**
     * 관·요충지 접도로 — 각 전략 요충지를 가장 가까운 도시에 잇는다.
     *
     * [왜 필요한가]
     * 세력 도로는 "같은 세력 도시끼리"만 잇는다( MST ). 관문은 도시가 아니라 지형의
     * 성질이라 어느 세력에도 속하지 않고, 따라서 도로망에 아예 닿지 않았다 — 지도에
     * 표시되지만 아무것도 연결되지 않은 점으로 남았다. 게임적으로 "이 관문으로 어떻게
     * 가지?" 라는 질문에 답이 없던 상태였다.
     *
     * 세력이 아니라 "지형 접근로" 이므로 색을 세력색으로 두지 않는다. 회갈색으로 그려
     * "이것은 세력 영토가 아니라 접근로다" 를 구분한다.
     */
    private buildFeatureSpurs(): void {
        const spurs: FeatureSpur[] = [];
        const cities = this.cities
            .map(c => ({ id: c.id, n: this.cityNorm(c) }))
            .filter(c => Number.isFinite(c.n.x) && Number.isFinite(c.n.y));
        if (!cities.length) {
            this.featureSpurs = spurs;
            return;
        }
        for (const [name, f] of Object.entries(MAP_FEATURE_ANCHORS)) {
            let best: { x: number; y: number } | null = null;
            let bestD = Infinity;
            for (const c of cities) {
                const d = (c.n.x - f.x) ** 2 + (c.n.y - f.y) ** 2;
                if (d < bestD) { bestD = d; best = c.n; }
            }
            if (!best) continue;
            // 너무 먼 요충지는 도로로 연결하지 않는다 — 화면을 가로지르는 선이 된다.
            if (Math.sqrt(bestD) > 0.12) continue;
            // 가까운 도시도 바다를 사이에 두고 있다면 접도로가 성립하지 않는다
            let blocked = false;
            for (let i = 1; i < 6; i++) {
                const t = i / 6;
                if (!this.isLand(best!.x + (f.x - best!.x) * t, best!.y + (f.y - best!.y) * t)) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;
            spurs.push({ name, ax: best.x, ay: best.y, bx: f.x, by: f.y, kind: f.kind });
        }
        this.featureSpurs = spurs;
    }

    /**
     * 적대 세력 접점선을 만든다 — 각 도시에서 가장 가까운 "다른 세력" 도시로 잇는다.
     *
     * [왜 가장 가까운 하나뿐인가]
     * 모든 적대 쌍을 이으면 31도시 기준으로 수백 선이 생겨 지도가 읽을 수 없게 된다.
     * 세력당 하나씩만 두면 "누가 누구와 국경을 맞대고 있나" 가 읽힌다.
     *
     * [왜 거리 제한이 있는가]
     * 사용자가 화면을 가로지르는 길게 뻗은 선을 문제 삼은 적이 있다. 접점선은 "맞닿은 곳" 을
     * 알려주는 것이지 원거리 관계가 아니므로, MAX_ENEMY_LINK_DIST 를 넘으면 그리지 않는다.
     *
     * 중복 제거 — A 의 가장 가까운 적이 B 이고 B 의 가장 가까운 적도 A 면 한 번만 그린다.
     */
    private buildEnemyLinks(): void {
        const links: EnemyLink[] = [];
        const cities = this.cities
            .map(c => ({ id: c.id, faction: c.ownerColor || '', isPlayer: c.isPlayer === true, n: this.cityNorm(c) }))
            .filter(c => Number.isFinite(c.n.x) && Number.isFinite(c.n.y));
        const nearIdx: number[] = [];
        for (let i = 0; i < cities.length; i++) {
            let best = -1;
            let bestD = Infinity;
            for (let j = 0; j < cities.length; j++) {
                if (i === j) continue;
                if (cities[j].faction === cities[i].faction) continue;
                const d = Math.hypot(cities[i].n.x - cities[j].n.x, cities[i].n.y - cities[j].n.y);
                if (d < bestD) { bestD = d; best = j; }
            }
            nearIdx.push(bestD <= ChinaMapRenderer.MAX_ENEMY_LINK_DIST ? best : -1);
        }
        const seen = new Set<string>();
        for (let i = 0; i < cities.length; i++) {
            const j = nearIdx[i];
            if (j < 0) continue;
            // A↔B 와 B↔A 는 같은 접점이므로 키를 정렬해 한 번만 그린다.
            const key = i < j ? `${i}|${j}` : `${j}|${i}`;
            if (seen.has(key)) continue;
            seen.add(key);
            links.push({
                ax: cities[i].n.x, ay: cities[i].n.y,
                bx: cities[j].n.x, by: cities[j].n.y,
                aFaction: cities[i].faction,
                bFaction: cities[j].faction,
                involvesPlayer: cities[i].isPlayer || cities[j].isPlayer,
            });
        }
        this.enemyLinks = links;
    }

    /** 접점선 최대 거리(정규화) — 이보다 먼 적대는 "맞닿은 국경" 이 아니라 그냥 먼 곳이다. */
    private static readonly MAX_ENEMY_LINK_DIST = 0.09;

    /** 테스트/디버그용: 현재 적대 접점선 목록 */
    getEnemyLinks(): ReadonlyArray<{ ax: number; ay: number; bx: number; by: number; involvesPlayer: boolean }> {
        return this.enemyLinks.map(l => ({ ...l }));
    }

    /**
     * 적대 세력 접점선을 그린다 — 점선, 세력색을 쓰지 않는다.
     *
     * 실선(세력 도로)과 리듬이 달라야 겹쳐 보인다 — 점 간격을 다르게 잡는다.
     * 색을 양쪽 세력의 중간색으로 섞으면 "누구 소유" 로 읽혀서 실수이므로,
     * 무채색에 아군이 닿아 있을 때만 밝게 한다.
     */
    private drawEnemyLinks(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (!this.enemyLinks.length) return;
        const s = this.zoom;
        for (const link of this.enemyLinks) {
            const a = this.normToPixel(link.ax, link.ay, width, height);
            const b = this.normToPixel(link.bx, link.by, width, height);
            ctx.beginPath();
            ctx.moveTo(a.px, a.py);
            ctx.lineTo(b.px, b.py);
            ctx.lineCap = 'butt';
            // 실선과 다른 리듬 — 짧은 점 + 조금 긴 간격
            ctx.setLineDash([Math.max(1.5, 2.5 * s), Math.max(2.5, 4 * s)]);
            ctx.strokeStyle = link.involvesPlayer ? 'rgba(228, 196, 150, 0.5)' : 'rgba(198, 190, 170, 0.34)';
            ctx.lineWidth = Math.max(0.6, (link.involvesPlayer ? 1.15 : 0.85) * s);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    /** 관·요충지 접도로를 그린다 — 세력 도로보다 얇고 무채색으로, "접근로" 임을 드러낸다. */
    private drawFeatureSpurs(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (!this.featureSpurs.length) return;
        const s = this.zoom;
        for (const spur of this.featureSpurs) {
            const a = this.normToPixel(spur.ax, spur.ay, width, height);
            const b = this.normToPixel(spur.bx, spur.by, width, height);
            ctx.beginPath();
            ctx.moveTo(a.px, a.py);
            ctx.lineTo(b.px, b.py);
            ctx.lineCap = 'round';
            ctx.setLineDash([3 * s, 3 * s]);
            ctx.strokeStyle = 'rgba(30, 26, 18, 0.5)';
            ctx.lineWidth = Math.max(1.6, 2.6 * s);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(206, 196, 170, 0.5)';
            ctx.lineWidth = Math.max(0.6, 1.1 * s);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    /**
     * 전략 요충지 — 관(關)·전장·항구.
     *
     * [왜 이렇게 작게]
     * 사용자가 "제일 작은 도성 크기의 반 이하" 를 요구했다. 최소 도성 폭은 11.95*s 이므로
     * 상한은 5.98*s. 여기서는 5.2*s 로 더 작게 잡았다 — 요충지는 도시가 아니라 "지형의
     * 성질" 이므로 도시보다 눈에 띄면 안 된다. 도시를 찾는 사람이 먼저 도시를 보게 한다.
     *
     * 색도 일부러 죽였다. 세력색을 쓰면 도시와 같은 정보로 읽혀서 둘이 경쟁한다.
     */
    private drawFeatures(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const s = this.zoom;
        const r = FEATURE_ICON_R * s;        // 최소 도성의 절반 아래 (FEATURE_ICON_R 참고)
        const margin = 20 * s;

        for (const [name, f] of Object.entries(MAP_FEATURE_ANCHORS)) {
            const { px, py } = this.normToPixel(f.x, f.y, width, height);
            if (px < -margin || px > width + margin || py < -margin || py > height + margin) continue;

            ctx.save();
            // 어두운 테두리 + 밝은 심 — 어떤 지형 위에서도 실루엣이 남게
            ctx.strokeStyle = 'rgba(10, 10, 14, 0.75)';
            ctx.fillStyle = f.kind === 'BATTLEFIELD' ? '#c8b0a0' : '#cfc6ac';
            ctx.lineWidth = Math.max(0.5, 0.6 * s);

            if (f.kind === 'PASS') {
                // 관문 — 양 기둥 + 상인방. 3x3 격자에서 "통과 지점" 이 읽힌다.
                ctx.beginPath();
                ctx.rect(px - r, py - r * 0.7, r * 0.7, r * 1.4);
                ctx.rect(px + r * 0.3, py - r * 0.7, r * 0.7, r * 1.4);
                ctx.fill();
                ctx.stroke();
                ctx.beginPath();
                ctx.rect(px - r, py - r * 0.7, r * 2, r * 0.5);
                ctx.fill();
                ctx.stroke();
            } else if (f.kind === 'BATTLEFIELD') {
                // 전장 — 엇갈린 두 선
                ctx.beginPath();
                ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r);
                ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r);
                ctx.stroke();
            } else {
                // 항구 — 물결 두 줄
                ctx.beginPath();
                ctx.arc(px, py - r * 0.3, r * 0.75, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(px - r, py + r * 0.7); ctx.lineTo(px + r, py + r * 0.7);
                ctx.moveTo(px - r * 0.6, py + r * 1.2); ctx.lineTo(px + r * 0.6, py + r * 1.2);
                ctx.stroke();
            }

            // 이름은 줌인했을 때만 — 5px 글자에 이름을 붙이면 도시 이름과 구분되지 않는다
            if (s >= 1.4) {
                ctx.font = `${Math.max(4, 4.4 * s)}px "Malgun Gothic", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.lineWidth = Math.max(1, 1.6 * s);
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.strokeText(name, px, py + r * 1.5);
                ctx.fillStyle = 'rgba(226, 220, 200, 0.8)';
                ctx.fillText(name, px, py + r * 1.5);
            }
            ctx.restore();
        }
    }

    /**
     * 도시가 바다 위에 놓였으면 가장 가까운 육지로 끌어당긴다.
     *
     * [왜 필요한가]
     * 배경 지도가 AI 가 그린 지형이라 실제 좌표와 어긋나는 도시가 생긴다. 실측 결과 31개 중
     * 장사 1개가 바다 위에 있었다. 그대로 두면 성이 물 위에 떠 보이고, 그 도시로 가는
     * 도로도 바다를 가로지른다 — "전체적으로 이상하다" 는 인상의 큰 몫이 여기서 온다.
     */
    private snapToLand(city: MapCityView): { x: number; y: number } {
        const n = this.cityNorm(city);
        if (this.isLand(n.x, n.y)) return n;
        // 나선 탐색 — 가장 가까운 육지를 찾는다. 반경은 셀 4칸(0.056)씩 확장한다.
        const step = ChinaMapRenderer.CELL_SIZE * 4;
        for (let r = 1; r <= 8; r++) {
            const radius = r * step;
            const steps = Math.max(8, Math.round(radius * 120));
            for (let i = 0; i < steps; i++) {
                const a = (i / steps) * Math.PI * 2;
                const x = n.x + Math.cos(a) * radius;
                const y = n.y + Math.sin(a) * radius;
                if (x < 0 || x > 1 || y < 0 || y > 1) continue;
                if (this.isLand(x, y)) return { x, y };
            }
        }
        return n;
    }

    /**
     * 도로 선분을 "육지 구간" 과 "수면 구간" 으로 나눈다.
     *
     * [왜 나누는가]
     * 예전에는 도로 전체가 바다를 한 점이라도 지나면 아예 그리지 않았다
     * (roadCrossesWater → continue). 그래서 두 가지 문제가 동시에 생겼다.
     *   1) 사용자가 본 "도시간 연결선이 끊겼다" — 실제로는 존재하는 도로가 통째로 사라졌다.
     *   2) 반대로 표본 8점짜리 판정은 좁은 물길(江 같은 수로)을 못 잡아, 바다는 지나는데
     *      그려지는 도로도 생겼다.
     * 도로를 잘라서 그리는 쪽이 옳다. 물 위 구간만 짧게 "교량" 으로 잇고, 그보다 길면
     * 다리로 합치지 않고 끊는다 — 긴 구간을 다리로 그리는 것은 지도적으로 거짓말이다.
     *
     * 반환값의 onLand/onWater 는 각각 원래 선분의 비율(0~1) 구간이다.
     */
    private splitRoadByLand(
        road: RoadSegment,
        steps: number,
    ): { onLand: Array<[number, number]>; onWater: Array<[number, number]> } {
        const onLand: Array<[number, number]> = [];
        const onWater: Array<[number, number]> = [];
        const xAt = (t: number): number => road.ax + (road.bx - road.ax) * t;
        const yAt = (t: number): number => road.ay + (road.by - road.ay) * t;
        // 시작점(t=0)부터 이어야 한다 — 여기를 1/steps 로 시작하면 도로의 첫 구간이 사라진다.
        let curIsLand = this.isLand(road.ax, road.ay);
        let curStart = 0;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const isLand = this.isLand(xAt(t), yAt(t));
            if (isLand !== curIsLand) {
                // 지형이 바뀌면 이전 구간을 확정한다.
                (curIsLand ? onLand : onWater).push([curStart, t]);
                curStart = t;
                curIsLand = isLand;
            }
        }
        (curIsLand ? onLand : onWater).push([curStart, 1]);
        return { onLand, onWater };
    }

    /** 수면 구간을 다리로 그릴 만큼 짧은지 — 이보다 길면 지형 훼손이라 끊어 둔다. */
    private static readonly MAX_BRIDGE_SPAN = 0.035;

    private drawRoads(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (!this.roads.length) return;
        const s = this.zoom;
        const margin = 60 * s;

        for (const road of this.roads) {
            const a = this.normToPixel(road.ax, road.ay, width, height);
            const b = this.normToPixel(road.bx, road.by, width, height);
            if (Math.max(a.px, b.px) < -margin || Math.min(a.px, b.px) > width + margin) continue;
            if (Math.max(a.py, b.py) < -margin || Math.min(a.py, b.py) > height + margin) continue;

            // 우회 지점이 있으면 [a, ...via, b] 를 다각형으로 잇고, 없으면 a→b 한 다리.
            const nodes: Array<{ x: number; y: number }> = road.via && road.via.length > 0
                ? [{ x: road.ax, y: road.ay }, ...road.via, { x: road.bx, y: road.by }]
                : [{ x: road.ax, y: road.ay }, { x: road.bx, y: road.by }];
            for (let i = 0; i < nodes.length - 1; i++) {
                this.drawRoadLeg(ctx, road, nodes[i], nodes[i + 1], width, height);
            }
        }
    }

    /** 도로 한 다리(두 점)를 그린다 — 육지는 실선, 짧은 물길은 점선 다리. */
    private drawRoadLeg(
        ctx: CanvasRenderingContext2D,
        road: RoadSegment,
        from: { x: number; y: number },
        to: { x: number; y: number },
        width: number,
        height: number,
    ): void {
        const s = this.zoom;
        const a = this.normToPixel(from.x, from.y, width, height);
        const b = this.normToPixel(to.x, to.y, width, height);
        const leg: RoadSegment = { ...road, ax: from.x, ay: from.y, bx: to.x, by: to.y };
        const len = Math.hypot(b.px - a.px, b.py - a.py) || 1;
        const steps = Math.max(8, Math.min(64, Math.round((len / (this.baseScale() || 1)) * 160)));
        const { onLand, onWater } = this.splitRoadByLand(leg, steps);

        const pointAt = (t: number): { px: number; py: number } => ({
            px: a.px + (b.px - a.px) * t,
            py: a.py + (b.py - a.py) * t,
        });
        const strokeSeg = (p0: { px: number; py: number }, p1: { px: number; py: number }, pass: 0 | 1): void => {
            // 구간 단위 곡률 — 도로 전체의 bow 를 재사용하지 않아 접두사/접미사가 휘지 않는다.
            const mx = (p0.px + p1.px) / 2;
            const my = (p0.py + p1.py) / 2;
            const dx = p1.px - p0.px;
            const dy = p1.py - p0.py;
            const sl = Math.hypot(dx, dy) || 1;
            const bow = sl * 0.16 * roadBendFactor(leg.ax, leg.ay, leg.bx, leg.by);
            ctx.beginPath();
            ctx.moveTo(p0.px, p0.py);
            ctx.quadraticCurveTo(mx - (dy / sl) * bow, my + (dx / sl) * bow, p1.px, p1.py);
            ctx.lineCap = 'round';
            if (pass === 0) {
                ctx.strokeStyle = 'rgba(28, 22, 14, 0.55)';
                ctx.lineWidth = Math.max(2, 3.4 * s);
            } else {
                ctx.globalAlpha = road.isPlayer ? 0.9 : 0.55;
                ctx.strokeStyle = this.lightenColor(road.color || '#c8b070', road.isPlayer ? 0.45 : 0.25);
                ctx.lineWidth = Math.max(0.8, 1.3 * s);
            }
            ctx.stroke();
        };

        for (const pass of [0, 1] as const) {
            for (const [t0, t1] of onLand) {
                if (t1 - t0 < 1e-6) continue;
                strokeSeg(pointAt(t0), pointAt(t1), pass);
            }
        }
        // 짧은 물길만 다리로 잇는다 — 길면 지형 훼손이므로 비워 둔다.
        ctx.save();
        ctx.setLineDash([Math.max(2, 4 * s), Math.max(2, 3 * s)]);
        for (const [t0, t1] of onWater) {
            if (t1 - t0 > ChinaMapRenderer.MAX_BRIDGE_SPAN) continue;
            const p0 = pointAt(t0);
            const p1 = pointAt(t1);
            ctx.beginPath();
            ctx.moveTo(p0.px, p0.py);
            ctx.lineTo(p1.px, p1.py);
            ctx.strokeStyle = 'rgba(232, 226, 206, 0.5)';
            ctx.lineWidth = Math.max(0.7, 1.1 * s);
            ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    /**
     * 영토 레이어 — 저해상도 오프스크린 캔버스에 셀 색을 칠한 뒤
     * 메인 캔버스로 확대 블릿(imageSmoothing 보간). 셀 계단이
     * 자연스럽게 그라데이션처럼 블렌딩되어 부드러운 경계가 된다.
     */
    private drawTerritory(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (this.territoryDirty) this.rebuildTerritory();

        const cellPx = ChinaMapRenderer.CELL_SIZE * this.baseScale();
        if (cellPx < 4) return; // 너무 작으면 생략 (성능 보호)

        const off = this.getTerritoryLayer(width, height);
        if (!off) return;

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = 1.0;
        // 영역 전체를 확대 그리기 — 저해상도 픽셀이 부드럽게 보간됨
        const rect = this.mapImageRect(width, height);
        ctx.drawImage(off.canvas, 0, 0, off.width, off.height, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
    }

    /**
     * 영토 오프스크린 레이어 생성/갱신.
     * 해상도: 메인 해상도의 40% (경계선 번짐 방지).
     * 색은 최종 알파(플레이어 0.34 / 일반 0.22)를 미리 곱해 담는다.
     */
    private getTerritoryLayer(width: number, height: number): { canvas: HTMLCanvasElement; width: number; height: number } | null {
        const scale = 0.4; // 메인 해상도의 40%
        const lw = Math.max(1, Math.floor(width * scale));
        const lh = Math.max(1, Math.floor(height * scale));

        let off = this.territoryLayer;
        if (!off || off.width !== lw || off.height !== lh) {
            const canvas = document.createElement('canvas');
            canvas.width = lw;
            canvas.height = lh;
            off = { canvas, ctx: canvas.getContext('2d')!, width: lw, height: lh };
            this.territoryLayer = off;
            this.territoryLayerDirty = true;
        }
        if (!this.territoryDirty && !this.territoryLayerDirty) return off;

        this.rebuildTerritory();
        const octx = off.ctx;
        octx.clearRect(0, 0, lw, lh);

        const cols = this.territoryCols;
        const rows = this.territoryRows;
        // 셀 하나가 오프스크린에서 차지하는 픽셀 크기
        const cellW = lw / cols;
        const cellH = lh / rows;

        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                const cell = this.territoryCells[gy * cols + gx];
                if (!cell || !cell.ownerColor) continue;
                octx.globalAlpha = cell.isPlayer ? 0.34 : 0.22;
                octx.fillStyle = cell.ownerColor;
                octx.fillRect(gx * cellW, gy * cellH, cellW + 0.6, cellH + 0.6);
                // [461-480] 색약 무늬 — 셀 위에 사선/점 패턴을 얹어 세력 이중 부호화
                if (cell.pattern === 'hatch') {
                    octx.strokeStyle = cell.ownerColor;
                    octx.lineWidth = 1;
                    octx.beginPath();
                    octx.moveTo(gx * cellW, gy * cellH + cellH);
                    octx.lineTo(gx * cellW + cellW, gy * cellH);
                    octx.stroke();
                } else if (cell.pattern === 'dots') {
                    octx.fillStyle = cell.ownerColor;
                    octx.beginPath();
                    octx.arc(gx * cellW + cellW / 2, gy * cellH + cellH / 2, 1.4, 0, Math.PI * 2);
                    octx.fill();
                }
            }
        }
        octx.globalAlpha = 1.0;
        this.clipToLand(octx, lw, lh);

        this.territoryLayerDirty = false;
        return off;
    }

    /**
     * 세력 경계선 — 셀 가장자리 선 대신, 저해상도 경계 마스크를
     * 확대 보간해 부드러운 음영 밴드로 표현.
     * 경계 마스크: 이웃 셀과 소속이 다른 셀에 밝은 픽셀을 찍고,
     * 확대 시 곡선처럼 흐르는 어두운 띠가 된다.
     */
    /**
     * 세력선을 reach 필드의 0 등치선으로 그린다 — 계단 대신 매끄러운 곡선.
     *
     * [왜 upsampling 하는가]
     * reach 필드는 72×72 이고 등치선은 샘플 사이를 선형 보간한다. 그 보간만으로도
     * 계단보다는 훨씬 좋지만, 샘플 밀도가 낮으면 긴 직선이 조금씩 꺾여 보인다.
     * 2× 이중선형 업샘플 후 등치선을 뜨면 곡률�� 남아 실제 곡선이 된다.
     *
     * 격자 인덱스 → border 레이어 픽셀로 그리기 때문에 traceIsoContours 의 좌표계와
     * 그대로 맞는다(둘 다 정규화 공간을 cols×rows 로 나눈 격자).
     */
    private strokeFactionBorders(bctx: CanvasRenderingContext2D, lw: number, lh: number): void {
        const cols = this.territoryCols;
        const rows = this.territoryRows;
        if (!cols || !rows) return;

        const S = 2;                                  // 업샘플 배수
        const ucols = (cols - 1) * S + 1;
        const urows = (rows - 1) * S + 1;
        const cellW = lw / (cols - 1);
        const cellH = lh / (rows - 1);
        const up = new Float32Array(ucols * urows);

        bctx.lineCap = 'round';
        bctx.lineJoin = 'round';
        bctx.strokeStyle = 'rgba(20, 16, 8, 0.38)';
        bctx.lineWidth = Math.max(0.9, cellW * 0.34);

        for (const field of this.factionReach.values()) {
            // 이중선형 업샘플 — 등치선이 셀 경계에 걸리는 계단 진동을 없앤다.
            for (let uy = 0; uy < urows; uy++) {
                const fy = uy / S;
                const y0 = Math.min(rows - 1, Math.floor(fy));
                const y1 = Math.min(rows - 1, y0 + 1);
                const ty = fy - y0;
                for (let ux = 0; ux < ucols; ux++) {
                    const fx = ux / S;
                    const x0 = Math.min(cols - 1, Math.floor(fx));
                    const x1 = Math.min(cols - 1, x0 + 1);
                    const tx = fx - x0;
                    const a = field[y0 * cols + x0], bb = field[y0 * cols + x1];
                    const c = field[y1 * cols + x0], d = field[y1 * cols + x1];
                    const top = a + (bb - a) * tx;
                    const bottom = c + (d - c) * tx;
                    up[uy * ucols + ux] = top + (bottom - top) * ty;
                }
            }

            for (const seg of traceIsoContours(up, ucols, urows, 0, true)) {
                bctx.beginPath();
                bctx.moveTo(seg.x0 * cellW, seg.y0 * cellH);
                bctx.lineTo(seg.x1 * cellW, seg.y1 * cellH);
                bctx.stroke();
            }
        }
    }

    private drawTerritoryBorders(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (this.territoryDirty) this.rebuildTerritory();

        const cellPx = ChinaMapRenderer.CELL_SIZE * this.baseScale();
        if (cellPx < 4) return;

        const off = this.territoryLayer;
        if (!off) return;

        const scale = 0.25;
        const lw = off.width;
        const lh = off.height;

        // 경계 마스크 레이어 (캐시)
        let border = this.borderLayer;
        if (!border || border.width !== lw || border.height !== lh) {
            const canvas = document.createElement('canvas');
            canvas.width = lw;
            canvas.height = lh;
            border = { canvas, ctx: canvas.getContext('2d')!, width: lw, height: lh };
            this.borderLayer = border;
            this.borderLayerDirty = true;
        }
        if (this.borderLayerZoom !== this.zoom) {
            this.borderLayerDirty = true;
            this.borderLayerZoom = this.zoom;
        }
        if (!this.territoryDirty && !this.borderLayerDirty) {
            // 재사용
        } else {
            const bctx = border.ctx;
            bctx.clearRect(0, 0, lw, lh);

            const cols = this.territoryCols;
            const rows = this.territoryRows;
            const cellW = lw / cols;
            const cellH = lh / rows;
            const keyOfFaction = (cell: { ownerColor: string | null } | undefined): string => cell?.ownerColor ?? '';
            const keyOfCity = (cell: { cityId: string | null } | undefined): string => cell?.cityId ?? '';

            // 세력선은 reach 필드의 0 등치선이다 — 셀마다 fillRect 을 찍던 방식(계단)을
            // 매끄러운 선으로 바꾼다. 도시 구분선은 셀 경계에 붙어 있어야 하므로 그대로 둔다.
            this.strokeFactionBorders(bctx, lw, lh);

            const cityLineW = Math.max(0.5, cellW * 0.12);
            for (let gy = 0; gy < rows; gy++) {
                for (let gx = 0; gx < cols; gx++) {
                    const cell = this.territoryCells[gy * cols + gx];
                    if (!cell || !cell.ownerColor) continue;

                    const x = gx * cellW;
                    const y = gy * cellH;
                    const right = this.territoryCells[gy * cols + gx + 1];
                    const down = this.territoryCells[(gy + 1) * cols + gx];

                    // 도시 구분선: 같은 세력 안에서도 서로 다른 도시 영토를 얇은 금색선으로 분리한다.
                    // 도시가 많으면 경계가 빽빽해져 확대 보간 시 빛번짐이 되므로,
                    // 줌인했을 때만 그린다 (개요 화면에서는 세력선만으로 충분하다).
                    if (this.zoom >= 1.25) {
                        bctx.fillStyle = 'rgba(238, 214, 145, 0.26)';
                        if (gx + 1 < cols && keyOfFaction(right) === keyOfFaction(cell) && keyOfCity(right) !== keyOfCity(cell)) {
                            bctx.fillRect(x + cellW - cityLineW / 2, y - cellH * 0.5, cityLineW, cellH);
                        }
                        if (gy + 1 < rows && keyOfFaction(down) === keyOfFaction(cell) && keyOfCity(down) !== keyOfCity(cell)) {
                            bctx.fillRect(x - cellW * 0.5, y + cellH - cityLineW / 2, cellW, cityLineW);
                        }
                    }
                }
            }
            this.clipToLand(bctx, lw, lh);
            this.borderLayerDirty = false;
        }

        // 경계 마스크를 확대 블릿 — 저해상도 픽셀이 보간되며 부드러운 곡선 밴드가 됨
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const rect = this.mapImageRect(width, height);
        ctx.drawImage(border.canvas, 0, 0, lw, lh, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
    }

    /**
     * 세력명 라벨 — 영토 무게중심에 반투명 대형 글씨로 표기.
     * 글자 크기는 영토 셀 수(면적)에 비례. 도시 뒤, 지형 앞에 얹힌다.
     */
    private drawFactionLabels(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        // [461-480] 안티오버랩: 플레이어 라벨 최우선 → 면적 내림차순으로 배치 검사,
        // 겹치는 라벨은 생략. 실측 measureText AABB 기반 판정.
        interface Placed { x: number; y: number; w: number; h: number; }
        const placed: Placed[] = [];
        const ordered = [...this.factionLabels].sort((a, b) =>
            (b.isPlayer ? 1 : 0) - (a.isPlayer ? 1 : 0) || b.cells - a.cells,
        );
        for (const label of ordered) {
            const { px, py } = this.normToPixel(label.cx, label.cy, width, height);
            if (px < -80 || px > width + 80 || py < -60 || py > height + 60) continue;

            // 영토 면적 기반 글자 크기 (최소 18px, 최대 64px)
            const fontSize = Math.max(18, Math.min(64, Math.sqrt(label.cells / 4096) * 448 * this.zoom));
            if (!label.name) continue;

            // 실측 텍스트 AABB — 패딩 포함 겹침 판정
            ctx.save();
            ctx.font = `bold ${fontSize}px "Malgun Gothic", sans-serif`;
            const tw = ctx.measureText(label.name).width;
            ctx.restore();
            const box: Placed = { x: px - tw / 2 - 6, y: py - fontSize / 2 - 4, w: tw + 12, h: fontSize + 8 };
            const overlaps = placed.some((p) =>
                box.x < p.x + p.w && box.x + box.w > p.x &&
                box.y < p.y + p.h && box.y + box.h > p.y,
            );
            if (overlaps) continue; // 우선순위 높은 라벨에 양보
            placed.push(box);

            ctx.save();
            ctx.font = `bold ${fontSize}px "Malgun Gothic", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // 자체 세력색보다 밝은 톤으로, 반투명하게
            const alpha = label.isPlayer ? 0.5 : 0.38;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = this.lightenColor(label.color, 0.55);

            // 외곽 음영 (가독성)
            ctx.globalAlpha = Math.min(0.6, alpha + 0.15);
            ctx.strokeStyle = 'rgba(10, 8, 4, 0.8)';
            ctx.lineWidth = Math.max(2, fontSize * 0.08);
            ctx.strokeText(label.name, px, py);

            ctx.globalAlpha = alpha;
            ctx.fillText(label.name, px, py);
            ctx.restore();
        }
    }

    /** HEX 색을 밝게 섞는 헬퍼 (t: 0~1, 1에 가까울수록 흰색) */
    private lightenColor(hex: string, t: number): string {
        const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (!m) return hex;
        const r = Math.round(parseInt(m[1], 16) + (255 - parseInt(m[1], 16)) * t);
        const g = Math.round(parseInt(m[2], 16) + (255 - parseInt(m[2], 16)) * t);
        const b = Math.round(parseInt(m[3], 16) + (255 - parseInt(m[3], 16)) * t);
        return `rgb(${r}, ${g}, ${b})`;
    }

    /**
     * [321-340] 지도 날씨 오버레이 — 각 도시 위치에 날씨 아이콘을 그리고,
     * 수확 보정 0.8 미만 악천후 도시에는 경고 링을 표시한다.
     */
    private drawWeatherOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (!this.showWeatherOverlay) return;
        const icons: Record<string, string> = {
            SUNNY: '☀️', CLOUDY: '☁️', RAIN: '🌧️', STORM: '⛈️', SNOW: '❄️', FOG: '🌫️', HEATWAVE: '🔥',
        };
        const s = this.zoom;
        for (const city of this.visibleCities()) {
            // [49] 전체 모드의 미발견 도시는 위치만 흐릿한 실루엣으로 남긴다.
            if (city.isDiscovered === false) continue;
            if (!city.weather) continue;
            const { px, py } = this.cityMapToPixel(city, width, height);
            const margin = 60 * s;
            if (px < -margin || px > width + margin || py < -margin || py > height + margin) continue;
            // 도시 아이콘 좌상단에 날씨 표시 — 성 아이콘과 겹침 방지
            const wx = px - 16 * s;
            const wy = py - 16 * s;
            ctx.font = `${Math.max(10, 12 * s)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icons[city.weather] ?? '🌤️', wx, wy);
            // 악천후 경고 링 (수확 페널티 도시)
            if (city.harvestModifier !== undefined && city.harvestModifier < 0.8) {
                ctx.strokeStyle = 'rgba(224, 122, 106, 0.85)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(px, py, 15 * s, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    /** 지도 날씨 오버레이 표시 토글 [321-340] (기본 on) */
    setShowWeatherOverlay(show: boolean): void {
        this.showWeatherOverlay = show;
    }

    /**
     * [1057][321-340] 계절 톤 설정 — 대륙/바다 색조를 계절에 맞게 보정.
     * @param season 'spring'|'summer'|'autumn'|'winter' 또는 null(보정 해제)
     */
    setSeasonTint(season: 'spring' | 'summer' | 'autumn' | 'winter' | null): void {
        this.seasonTint = season;
    }

    private static readonly SEASON_TINTS: Record<'spring' | 'summer' | 'autumn' | 'winter', Array<[number, string]>> = {
        spring: [[0, 'rgba(140, 200, 120, 0.18)'], [1, 'rgba(140, 200, 120, 0.10)']],
        summer: [[0, 'rgba(90, 180, 90, 0.22)'], [1, 'rgba(60, 150, 70, 0.12)']],
        autumn: [[0, 'rgba(220, 150, 60, 0.20)'], [1, 'rgba(180, 110, 40, 0.10)']],
        winter: [[0, 'rgba(200, 220, 245, 0.22)'], [1, 'rgba(150, 180, 220, 0.12)']],
    };

    /** 비트맵 위 계절 보정 — 육지색 없이 반투명 톤만 얹는다. 스케치 경로와 그라데이션을 공유하면 지도가 가려진다. */
    private seasonTintOverlay(width: number, height: number): CanvasGradient | null {
        if (!this.seasonTint) return null;
        const grad = this.ctx.createLinearGradient(0, 0, width, height);
        for (const [stop, color] of ChinaMapRenderer.SEASON_TINTS[this.seasonTint]) {
            grad.addColorStop(stop, color);
        }
        return grad;
    }

    /** 계절별 대륙 색 보정 — 태평성세/설한/황염의 계절감 표현 */
    private applySeasonTint(grad: CanvasGradient): CanvasGradient {
        if (!this.seasonTint) return grad;
        for (const [stop, color] of ChinaMapRenderer.SEASON_TINTS[this.seasonTint]) {
            grad.addColorStop(stop, color);
        }
        return grad;
    }

    /** [49] 미발견 도시의 흐림·실루엣 표현 — 소유 색/병력/날씨는 숨긴다. */
    private drawUndiscoveredCity(ctx: CanvasRenderingContext2D, city: MapCityView, width: number, height: number): void {
        const { px, py } = this.cityMapToPixel(city, width, height);
        const s = this.zoom;
        const margin = 60 * s;
        if (px < -margin || px > width + margin || py < -margin || py > height + margin) return;

        const w = 22 * s;
        const h = 14 * s;
        ctx.save();
        ctx.strokeStyle = 'rgba(220, 220, 220, 0.42)';
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(1, 1.2 * s);
        ctx.setLineDash([4 * s, 3 * s]);
        ctx.beginPath();
        ctx.arc(px, py, 20 * s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.filter = 'grayscale(1) blur(0.7px)';
        ctx.fillStyle = '#8a8a8e';
        ctx.strokeStyle = 'rgba(20, 20, 24, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(px - w / 2, py - h / 2 + 3 * s, w, h - 3 * s);
        ctx.fill();
        ctx.stroke();
        for (const m of [-0.35, 0, 0.35]) {
            ctx.beginPath();
            ctx.rect(px + m * w - 2.5 * s, py - h / 2 - 2 * s, 5 * s, 5 * s);
            ctx.fill();
            ctx.stroke();
        }
        ctx.fillStyle = '#6d6d72';
        ctx.beginPath();
        ctx.arc(px, py - h / 2 - 6 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = `bold ${Math.max(10, 12 * s)}px "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(city.name, px, py - h / 2 - 14 * s);
        ctx.fillStyle = '#b0b0b4';
        ctx.fillText(city.name, px, py - h / 2 - 14 * s);
        ctx.restore();
    }

    /** drawCity 의 마진 컬링과 같은 판정 — 라벨 배치와 아이콘 그리기 기준을 한곳에 묶는다. */
    private isInView(px: number, py: number, width: number, height: number, s: number): boolean {
        const margin = 60 * s;
        return px >= -margin && px <= width + margin && py >= -margin && py <= height + margin;
    }

    /**
     * 도시 라벨을 겹치지 않게 미리 배치해 this.labelSlots 에 담아 둔다.
     *
     * 아이콘은 절대 안 움직이고, 이름·병력 라벨만 밀린다. 겹친 라벨은 지시선으로 아이콘에
     * 묶어 둔다. resolveCityLabels 가 순수 함수라 여기서 measureText 만 주면 된다.
     *
     * 화면 밖 도시는 미리 뺀다. 지도 정사각형이 캔버스보다 크므로(1920x859 창에서 세로가
     * -492~1351) 대부분이 밖에 있는데, 배치기는 라벨을 캔버스 안에 둘 수 없으므로 전부
     * 탈락시키며 City's 자리가 낭비된다.
     */
    private layoutCityLabels(
        ctx: CanvasRenderingContext2D,
        cities: readonly MapCityView[],
        width: number,
        height: number,
    ): void {
        const s = this.zoom;
        // [2026-09-30] 도시명 크기를 절반으로 (12*s → 6*s, 바닥 10 → 5).
        // 병력 배지가 사라진 만큼 라벨 폭이 줄고, 겹침도 함께 줄어든다.
        const nameFontPx = Math.max(5, 6 * s);
        const nameFont = `bold ${nameFontPx}px "Malgun Gothic", sans-serif`;
        const inputs: CityLabelInput[] = [];
        const iconSizes = this.iconSizeRange(cities);
        this.iconSizes = iconSizes;

        for (const city of cities) {
            const { px, py } = this.cityMapToPixel(city, width, height);
            if (!this.isInView(px, py, width, height, s)) continue;
            const focused = city.isSelected || this.hoveredCityId === city.id;
            // 선택·호버 도시를 먼저 배치해 밀려난 자리에도 항상 남는다.
            const priority = focused ? 1e9 + city.garrison : city.garrison;
            // [2026-10-02] 예전 fallback 14*s/9*s 는 삭제 전 geometries 의 값이라 새 상수와 어긋난다.
            // k=0.775(중간 인구) 기준을 상수에서 뽑아 쓴다 — 아이콘 크기 정의가 한 곳에 남는다.
            const size = iconSizes.get(city.id)
                ?? { w: (CASTLE_W_MIN + CASTLE_W_SPAN * 0.775) * s, h: (CASTLE_H_MIN + CASTLE_H_SPAN * 0.775) * s };
            ctx.font = nameFont;
            inputs.push({
                id: city.id,
                name: city.name,
                garrisonText: '',
                px,
                py,
                iconW: size.w,
                iconH: size.h,
                priority,
                nameW: ctx.measureText(city.name).width,
                mustPlace: focused,
                // 2026-09-30 — 全国지도 는 병력을 표시하지 않는다. 라벨은 도시명만.
                badgeAllowed: false,
            });
        }

        this.labelSlots = resolveCityLabels(inputs, {
            nameFontPx,
            nameGap: 1.5 * s,
            badgeGap: 2 * s,
            badgeFontPx: 9 * s,
            badgeH: 12 * s,
            nameH: nameFontPx * 1.05,
            gap: Math.max(3, 3.5 * s),
            leaderMin: 5 * s,
        }, { width, height });
    }

    /**
     * 도시 인구로 도성 아이콘 크기를 정한다 — "도시 규모" 에 맞춘 크기.
     *
     * [왜 제곱근인가]
     * 인구 9만과 1.8만은 5배 차이가 나지만 지도에서 5배 크기로 그려지면 원 하나가 화면을
     * 지배한다. 면적이 인구에 비례해야 perceptual 크기가 맞아.sqrt 로 정규화한다.
     *
     * 범위는 계단 없이 연속적이다 — 인구가 1만 단위여도 크기는 부드럽게 변한다.
     *
     * [2026-10-02] 크기 상수와 수도 배율을 이 한 곳에서만 곱한다.
     * 예전엔 리터럴 (7 + 9 * k) 를 여기서 직접 썼는데, 축소를 위해 상수(CASTLE_W_MIN 등)로
     * 뺐다. 계수가 코드·테스트·requiredCityGap 세 곳에 흩어져 있어 한 번에 안 줄면
     * 아이콘만 줄고 간격은 그대로 남는drift 가 난다.
     *
     * 수도는 k 에서도boost 를 받지만(작은 도시의 수도) 클램프 때문에 최대 인구 도시에서는
     * boost 가 잘린다. 그래서 capitals 여부를 여기서 한 번 더 곱한다 — 이 곱셈은 클램프가
     * 없는 곳이라 "수도 ≥ 모든 도시" 가 보장된다. 배율은 크기 축소와 같은 방향(1.18)으로
     * 잡아 두 계수가 서로 상쇄되지 않게 했다.
     */
    private iconSizeRange(cities: readonly MapCityView[]): Map<string, { w: number; h: number }> {
        const s = this.zoom;
        const out = new Map<string, { w: number; h: number }>();
        const pops = cities.map(c => Math.sqrt(Math.max(0, c.population ?? 0)));
        let min = Infinity;
        let max = 0;
        for (const p of pops) {
            if (p < min) min = p;
            if (p > max) max = p;
        }
        for (let i = 0; i < cities.length; i++) {
            const isCapital = cities[i].iconType === 'CAPITAL';
            const k = cityIconScale(pops[i], min, max, isCapital);
            const mul = isCapital ? CAPITAL_CASTLE_MUL : 1;
            out.set(cities[i].id, {
                w: (CASTLE_W_MIN + CASTLE_W_SPAN * k) * mul * s,
                h: (CASTLE_H_MIN + CASTLE_H_SPAN * k) * mul * s,
            });
        }
        return out;
    }

    /**
     * 지도 이미지의 육지 경계 상자 (정규화 좌표).
     *
     * 배경은 4096 정사각형인데 실제 육지는 그중 왼쪽 위 약 70%만 차지한다(오른쪽은
     * 태평양). 정사각형 전체를 화면에 맞추면 오른쪽 3분의 1이 빈 바다로 남는다 —
     * 사용자가 "우측이 많이 비어 있다" 고 지적한 그것이다.
     */
    private landBounds(): { x0: number; y0: number; x1: number; y1: number } {
        this.getLandMask();
        if (!this.landAlpha) return { x0: 0, y0: 0, x1: 1, y1: 1 };
        const S = 256;
        let x0 = S, y0 = S, x1 = -1, y1 = -1;
        for (let gy = 0; gy < S; gy++) {
            for (let gx = 0; gx < S; gx++) {
                if (this.landAlpha[gy * S + gx] <= 127) continue;
                if (gx < x0) x0 = gx;
                if (gx > x1) x1 = gx;
                if (gy < y0) y0 = gy;
                if (gy > y1) y1 = gy;
            }
        }
        if (x1 < 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
        // 도시 앵커를 완전히 포함하도록 여유를 준다 — 육지 경계 바로 옆 도시가 잘리면 안 된다
        const padX = 0.02, padY = 0.02;
        return {
            x0: Math.max(0, x0 / S - padX), y0: Math.max(0, y0 / S - padY),
            x1: Math.min(1, (x1 + 1) / S + padX), y1: Math.min(1, (y1 + 1) / S + padY),
        };
    }

    /**
     * 초기 시점을 육지에 맞춘다 — 빈 바다를 화면에서 걷어낸다.
     *
     * zoom 을 1 로 고정하면 정사각형 전체가 들어오고 오른쪽이 텅 빈다. 그래서 육지 상자에
     * 맞춰 확대하고, 그 중심이 화면 중심에 오도록 offset 을 잡는다. 한 번만 적용한다 —
     * 사용자가 팬/줌을 한 뒤에도 자기 시점을 정할 수 있어야 하므로 한 번만 적용한다.
     */
    private frameLandView(width: number, height: number): void {
        if (this.viewFramed) return;
        this.viewFramed = true;
        const b = this.landBounds();
        const spanX = Math.max(0.05, b.x1 - b.x0);
        const spanY = Math.max(0.05, b.y1 - b.y0);
        // 1.06 = 여백. 육지가 화면 끝에 딱 붙으면 답답해 보인다.
        const base = Math.max(width / spanX, height / spanY) * 1.06;
        // 육지 상자에 정확히 맞추면 zoom 1.32 까지 커지는데, 그러면 전보다 지도를 덜 보여
        // 빈 공간은 줄여도 화면에 보이는 범위(overview)를 잃는다. 원래 수준(1.0)을 넘지 않게 제한하고
        // 중심 이동만 하고 확대는 하지 않는다 — 빈 공간은 줄이되 화면 범위는 지키는 쪽.
        this.zoom = Math.max(0.6, Math.min(1.0, base / (Math.max(width, height) * 0.96)));
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        const scale = this.baseScale();
        this.offsetX = scale * (0.5 - cx);
        this.offsetY = scale * (0.5 - cy);
    }

    private drawCity(
        ctx: CanvasRenderingContext2D,
        city: MapCityView,
        width: number,
        height: number,
        slot?: CityLabelSlot,
    ): void {
        // 전체 도시 모드(기본)에서는 미발견 도시도 세력색·이름·주둔군과 함께 배치한다.
        // 실루엣은 발견 도시 모드에서만 쓴다.
        if (city.isDiscovered === false && this.discoveredOnly) {
            this.drawUndiscoveredCity(ctx, city, width, height);
            return;
        }
        const { px, py } = this.cityMapToPixel(city, width, height);
        const s = this.zoom;
        if (!this.isInView(px, py, width, height, s)) return;

        const hovered = this.hoveredCityId === city.id;
        const selected = city.isSelected;

        const slotSize = this.iconSizes.get(city.id)
            ?? { w: (CASTLE_W_MIN + CASTLE_W_SPAN * 0.775) * s, h: (CASTLE_H_MIN + CASTLE_H_SPAN * 0.775) * s };
        // 영향 범위 링과 글로우는 아이콘 크기에 비례시킨다. 예전처럼 고정 배율(20*s)이면
        // 아이콘을 절반으로 줄였을 때 링이 아이콘의 두 배가 되어 점 하나가 주황 덩어리로 보인다.
        const reach = slotSize.w * 1.15;

        // [49] 도시 구분선 — 도시 영향 범위를 나타내는 가는 원형 경계다.
        // 방문하지 않은 인접 도시는 점선으로 표시해 실루엣과 구분한다.
        ctx.save();
        ctx.strokeStyle = this.lightenColor(city.ownerColor || '#888888', 0.25);
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = Math.max(0.6, 0.9 * s);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(px, py, reach, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 도시 반경 글로우 (플레이어/호버 강조)
        // [2026-09-30] 아이콘이 절반으로 작아지면서 이 글로우가 지도에서 가장 튀는 요소가
        // 됐다 — 0.5 알파의 주황이 성 하나보다 크고 진했다. 중심을 비워 아이콘이 그대로
        // 읽히게 하고, 옅은 후광으로 밀었다. 강조 목적은 같고 시선은 아이콘에 머문다.
        if (city.isPlayer || selected || hovered) {
            const glowR = reach * (selected ? 1.3 : hovered ? 1.15 : 1.05);
            const glow = ctx.createRadialGradient(px, py, glowR * 0.45, px, py, glowR);
            glow.addColorStop(0, city.isPlayer ? 'rgba(240, 217, 140, 0.30)' : 'rgba(255, 255, 255, 0.22)');
            glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(px, py, glowR, 0, Math.PI * 2);
            ctx.fill();
        }

        // 성(城) 아이콘 — 인구 비례 크기, 세력색 몸통, 세련된 벡터.
        this.drawCastleIcon(ctx, city, px, py, slotSize, selected || hovered);

        // 라벨(도시명)은 layoutCityLabels 가 미리 겹침을 풀어 둔 좌표를 쓴다.
        if (!slot) return;

        if (slot.displaced) {
            ctx.save();
            ctx.strokeStyle = 'rgba(240, 232, 208, 0.5)';
            ctx.lineWidth = Math.max(0.6, 0.7 * s);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(slot.nameX, slot.rect.y + slot.rect.h / 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.fillStyle = selected ? '#ffff88' : '#f0e8d0';
        ctx.font = `bold ${Math.max(5, 6 * s)}px "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = Math.max(1.5, 2 * s);
        ctx.strokeText(city.name, slot.nameX, slot.nameY);
        ctx.fillText(city.name, slot.nameX, slot.nameY);
    }

    /**
     * 세련된 도성 아이콘 — 세력색 몸통 + 어두운 테두리 + 상단 하이라이트.
     *
     * [예전과 다른 점]
     * 예전엔 모든 도시가 22×14px 고정 크기였고 몸통이 탠색(#c8b070)이라 세력이 달라도
     * 모양이 같았다. 지금은 크기가 인구(제곱근)에, 색이 세력색에 묶인다 — 도시를 찍는 순간
     * "얼마나 큰 도시 / 누구의 도시" 가 한 번에 읽힌다.
     *
     * [2026-10-02] 아이콘이 최소 11.95 → 8.41px 로 줄었으므로 비율을 다시 잡았다.
     *
     * [선 두께 — 최소 선 두께 보장의 근거]
     * 예전 lineWidth = max(0.5, 0.7*s) 는 s=1 에서 0.7px 였다. 최소 아이콘에서 병풍벽 폭은
     * w*0.17 = 1.43px 인데, 테두리 0.7px 가 좌우를 0.35px씩 먹어 남는 칠영이 0.73px 다 —
     * 세 개 병풍벽이 "뭉개진 점 3개" 로 보인다. 그래서 선 두께를 아이콘 폭에 비례시키고
     * 바닥을 0.55px 로 올렸다. 이 값은 1 CSS px 아래로 내려가면 브라우저가 반올림해
     * 헤어라인으로 보이기 시작하는 경계다.
     *
     * [병풍벽 3개를 유지한 이유]
     * 개수를 2개로 줄이면 최소 아이콘에서 형태가 또렷하지만, "성벽에 병풍벽이 세 개" 라는
     * 실루엣이 사라져 큰 도시(3개)와 작은 도시(2개)가 같은 도형으로 읽힌다. 크기 단계가
     * 화면에서 유일한 크기 신호이므로 그걸 잃을 수 없다. 대신 병풍벽 폭 비율을
     * 0.17 → 0.22 로 올려(최소 1.85px) 칠영이 남게 하고, 가운데 벽의 우위(1.25배)를
     * 1.3배로 높여 셋이 서로 다른 높이로 읽히게 했다.
     *
     * [사다리꼴 테이퍼]
     * 예전 inset 은 w*0.06 = 최소 0.50px 였다. 1px 미만이라 확대 시 사다리꼴이 사라지고
     * 직사각형으로 렌더링됐다(형태 정보 손실). w*0.09 = 최소 0.76px 로 올렸다.
     *
     * 작은 크기에서 도톰해지지 않도록 모든 두께는 s 가 아니라 w 에 비례시킨다 —
     * w 에 이미 zoom 이 포함돼 있어 결과는 같지만, "축소" 라는 의도가 코드에서도 읽힌다.
     */
    private drawCastleIcon(
        ctx: CanvasRenderingContext2D,
        city: MapCityView,
        px: number,
        py: number,
        size: { w: number; h: number },
        active: boolean,
    ): void {
        // s 를 쓰지 않는다 — 모든 두께/비율을 s 가 아니라 이미 zoom 이 곱해진 w,h 에서 낸다.
        // (s 로 두면 코드가 "축소 전 값" 이 남아 있어 아이콘 크기와 선 두께가 어긋난다)
        const w = size.w;
        const h = size.h;
        const body = this.lightenColor(city.ownerColor || '#c8b070', active ? 0.34 : 0.12);
        const edge = 'rgba(12, 10, 8, 0.85)';
        const merlonW = w * 0.22;
        const merlonH = h * 0.34;
        // 아이콘 폭에 비례하되 0.55px 바닥 — 이 선 두께가 테두리+칠영의 비율을 결정한다
        const strokeW = Math.max(0.55, w * 0.085);
        // 사다리꼴 하단 인셋 — 최소 폭 8.41px 에서도 0.76px 라 형태가 남는다
        const taper = w * 0.09;

        // 성벽 몸체 — 아래로 살짝 wider 한 사다리꼴이라 각지지 않게
        ctx.beginPath();
        ctx.moveTo(px - w / 2, py - h / 2 + merlonH);
        ctx.lineTo(px + w / 2, py - h / 2 + merlonH);
        ctx.lineTo(px + w / 2 - taper, py + h / 2);
        ctx.lineTo(px - w / 2 + taper, py + h / 2);
        ctx.closePath();
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = edge;
        ctx.lineWidth = strokeW;
        ctx.stroke();

        // 병풍벽 3개 — 가운데만 살짝 높게. 셋이 서로 구분돼야 크기 단계가 읽힌다
        ctx.fillStyle = body;
        for (const m of [-0.32, 0, 0.32]) {
            const mh = m === 0 ? merlonH * 1.3 : merlonH;
            ctx.beginPath();
            ctx.rect(px + m * w - merlonW / 2, py - h / 2 + merlonH - mh, merlonW, mh);
            ctx.fill();
            ctx.stroke();
        }

        // 상단 하이라이트 — 한 줄 빛이 있어야 평면적이지 않다
        ctx.beginPath();
        ctx.moveTo(px - w / 2 + taper, py - h / 2 + merlonH + h * 0.14);
        ctx.lineTo(px + w / 2 - taper, py - h / 2 + merlonH + h * 0.14);
        ctx.strokeStyle = 'rgba(255, 252, 240, 0.32)';
        ctx.lineWidth = Math.max(0.4, w * 0.05);
        ctx.stroke();

        // 수도 — 깃발 한 개. "여긴 내 수도" 라는 정보가 아이콘 크기만으로는 안 읽힌다
        if (city.iconType === 'CAPITAL') {
            const fx = px + w / 2 + w * 0.1;
            const fy = py - h / 2 + merlonH;
            // [2026-10-02] 기둥 세로 0.5h → 0.62h. 최소 높이(h=5.6px)에서 2.8px 는
            // 깃발이 삼각형보다 점에 가깝게 나와 "수도" 신호가 사라졌다. 기둥은 아이콘
            // 폭에 비례한 최소 0.45px 두께로 그린다(옛 max(0.4, 0.5*s) 와 같은 수준).
            const fh = h * 0.62;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(fx, fy - fh);
            ctx.strokeStyle = edge;
            ctx.lineWidth = Math.max(0.4, w * 0.05);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(fx, fy - fh);
            ctx.lineTo(fx + w * 0.26, fy - fh * 0.68);
            ctx.lineTo(fx, fy - fh * 0.36);
            ctx.closePath();
            ctx.fillStyle = city.ownerColor || '#c8b070';
            ctx.fill();
            ctx.stroke();
        }
    }

    pan(dx: number, dy: number): void {
        this.offsetX += dx;
        this.offsetY += dy;
    }

    zoomAt(factor: number, centerPx: number, centerPy: number): void {
        // 커서 위치의 정규 좌표를 보존하며 줌
        const before = this.screenToNorm(centerPx, centerPy);
        this.zoom = Math.max(0.6, Math.min(2.5, this.zoom * factor));
        const after = this.screenToNorm(centerPx, centerPy);
        this.offsetX += (after.x - before.x) * this.baseScale();
        this.offsetY += (after.y - before.y) * this.baseScale();
    }

    private baseScale(): number {
        const width = this.canvas.width;
        const height = this.canvas.height;
        // 화면 가득: 큰 쪽에 맞춘다. mapImageRect·영토·히트테스트가 같은 값을 쓰므로 일관된다.
        return Math.max(width, height) * 0.96 * this.zoom;
    }

    /** 테스트/디버그용: 현재 지도에 표시되는 세력 라벨 목록 */
    getFactionLabels(): Array<{ name: string; color: string; cells: number; isPlayer: boolean }> {
        if (this.territoryDirty) this.rebuildTerritory();
        return this.factionLabels.map(label => ({ ...label }));
    }

    /** 테스트/디버그용: 현재 영토 셀 통계 */
    getTerritoryStats(): { total: number; colored: number } {
        if (this.territoryDirty) this.rebuildTerritory();
        let colored = 0;
        for (const cell of this.territoryCells) {
            if (cell.ownerColor) colored++;
        }
        return { total: this.territoryCells.length, colored };
    }

    getState(): ChinaMapView {
        return { offsetX: this.offsetX, offsetY: this.offsetY, zoom: this.zoom };
    }
}
