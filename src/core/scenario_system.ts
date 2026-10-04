/**
 * 시나리오 시스템 — 로더 + 월드 빌더
 *
 * src/data/scenarios/index.json의 시나리오 목록을 불러와 선택 화면에 제공하고,
 * 선택된 시나리오를 GameStore에 넣을 Officer/Faction/City 배열로 변환한다.
 * 부분 [9] 시나리오 선택, [114] 시나리오 데이터 로딩
 */

import type { Officer, Faction, City, Personality, OfficerStats, RelationshipEdge, MapFeature } from './types.js';
import { OfficerStatus } from './types.js';
import scenario07OfficerProfiles from '../data/scenarios/07_officers.json' with { type: 'json' };
import scenarioRelationships from '../data/scenarios/relationships.json' with { type: 'json' };

// ============================================================
// 시나리오 데이터 구조
// ============================================================

export interface ScenarioCityProfile {
    population?: number;
    defense?: number;
    gold_income?: number;
    food_income?: number;
    funds?: number;
    development?: number;
    commerce?: number;
    farming?: number;
    technology?: number;
    public_order?: number;
    loyalty?: number;
    danger?: number;
}

export interface ScenarioFaction {
    name: string;
    capital: string;
    leader_id: string;
    color: string;
    /** 중국 전도 상의 도시 위치 (정규화 0~1, x: 서→동, y: 북→남) */
    map_x?: number;
    map_y?: number;
    /** 시나리오별 수도 도시의 내정/회복 프로필 [5][49] */
    city_profile?: ScenarioCityProfile;
}

export interface ScenarioCityData {
    name: string;
    faction_index: number;
    map_x?: number;
    map_y?: number;
    profile?: ScenarioCityProfile;
}

export interface ScenarioData {
    id: string;
    title_kr: string;
    title_en: string;
    start_date: string;         // "184-01"
    description: string;
    difficulty: number;         // 1~5
    factions: ScenarioFaction[];
    /** 수도 외 도시 데이터 [5][49] */
    cities?: ScenarioCityData[];
    special_conditions: {
        victory: string;
        historical_mode: boolean;
    };
    status: string;
}

// ============================================================
// 시나리오 로더
// ============================================================

let cachedScenarios: ScenarioData[] | null = null;

export async function loadScenarios(): Promise<ScenarioData[]> {
    if (cachedScenarios) return cachedScenarios;
    const res = await fetch('./src/data/scenarios/index.json');
    if (!res.ok) throw new Error(`시나리오 데이터 로드 실패: ${res.status}`);
    const data = (await res.json()) as ScenarioData[];
    cachedScenarios = data;
    return data;
}

export function getCachedScenarios(): ScenarioData[] {
    return cachedScenarios ?? [];
}

/**
 * 도시 방어력 상한.
 *
 * [왜 상수로 모았는가 — 실제로 고친 버그]
 * 초기 방어력은 `35 + cityIndex * 5` 로 인덱스가 커질수록 오르는데 maxDefense 는
 * 100 으로 하드코딩돼 있었다. 인덱스 14 를 넘으면 defense(105) > maxDefense(100) 가 되어
 * 31개 도시 중 12개가 상한을 넘은 상태로 시작했다(최대 160).
 * 그리고 방어력 보전이 `Math.min(maxDefense, defense + n)` 이라, 상한을 넘은 도시에
 * 보전을 투자하면 160 → 100 으로 오히려 떨어졌다(보수 1회에 -60).
 * 상한을 한 곳에서 정의해야 공식과 상한이 어긋날 수 없다.
 */
export const CITY_MAX_DEFENSE = 100;

/**
 * [결함 수정] 도시 초기 병력 규모를 정한다.
 *
 * City.development 은 값이 병력 수(명)다 — 예전엔 "개발도 0~100" 으로
 * 문서화돼 있었지만 실제 소비자가 전부 병력으로 쓰고 있었다:
 *   징병 200 미만이면 +600 / 약탈 25% / 세력 전력 합산 / 출진 300 이상.
 *
 * 0~100 으로 시작하면 전원이 한 달 만에 "병력 600" 으로 평준화돼
 * 출진 열세 조건(공격력 ≥ 방어력 × 1.2)이 영영 성립하지 않는다.
 * 실제로 24개월 시뮬레이션에서 공격/방어력 비율이 1.01 에 머물렀다.
 *
 * 그래서 인구를 기준으로 3~12% 를 병력으로 둔다. 인구 8만이면 6,400명 —
 * 실전 규모에 가깝고 도시마다 차이가 나므로 열세 판정이 의미를 갖는다.
 * 서도는 1.15배, 2차도시는 방어력 보정 0.8 배를 곱한다.
 */
export function initialTroops(population: number, isCapital: boolean, defense: number): number {
    const base = Math.max(400, Math.round(population * 0.075));
    const capitalFactor = isCapital ? 1.15 : 0.8;
    // 방어력이 높은 도시일수록 평시 주둔 병력이 많다 (defense 35~86 → 0.85~1.15)
    const defenseFactor = 0.85 + (Math.max(0, Math.min(100, defense)) / 100) * 0.3;
    return Math.round(base * capitalFactor * defenseFactor);}

/** 무장 아이디 → 한글 이름 (사전에 없으면 아이디 그대로) */
export function getKnownOfficerName(id: string): string {
    return OFFICER_NAME_TABLE[id]?.name ?? ESCORT_NAME_FIXES[id] ?? id;
}

export function parseStartDate(start: string): { year: number; month: number } {
    const [y, m] = start.split('-').map(Number);
    return { year: y, month: m };
}

// ============================================================
// 무장 이름표 (간이 사전 — 확장 가능)
// ============================================================

/**
 * 도시 이름 → 중국 전도 좌표 (정규화 0~1)
 * x: 서쪽 0 → 동쪽 1 / y: 북쪽 0 → 남쪽 1 (대략 중국 본토)
 */
export const CITY_MAP_COORDS: Record<string, { x: number; y: number }> = {
    '낙양': { x: 0.55, y: 0.34 },
    '장안': { x: 0.38, y: 0.36 },
    '허창': { x: 0.60, y: 0.40 },
    '업':    { x: 0.60, y: 0.24 },
    '거록': { x: 0.55, y: 0.24 },
    '진류': { x: 0.56, y: 0.42 },
    '연주': { x: 0.55, y: 0.44 },
    '서주': { x: 0.70, y: 0.46 },
    '하비': { x: 0.71, y: 0.40 },
    '여남': { x: 0.60, y: 0.50 },
    '여강': { x: 0.66, y: 0.58 },
    '수춘': { x: 0.66, y: 0.50 },
    '오':    { x: 0.76, y: 0.60 },
    '건업': { x: 0.76, y: 0.55 },
    '장사': { x: 0.62, y: 0.70 },
    '신야': { x: 0.56, y: 0.54 },
    '한중': { x: 0.36, y: 0.44 },
    '성도': { x: 0.28, y: 0.56 },
    '북평': { x: 0.68, y: 0.10 },
    '남양': { x: 0.53, y: 0.48 },
    '청두': { x: 0.30, y: 0.57 },
    '부경': { x: 0.77, y: 0.62 },
    '진주': { x: 0.64, y: 0.68 },
    '항양': { x: 0.62, y: 0.48 },
    '강릉': { x: 0.47, y: 0.55 },
    '동정': { x: 0.73, y: 0.60 },
    // 05 삼분천하 확충 도시 (207년 배치 기준, 인접 도시와 0.16 임계 내외)
    '진양': { x: 0.50, y: 0.22 },
    '단양': { x: 0.73, y: 0.58 },
    '무창': { x: 0.68, y: 0.57 },
    '교지': { x: 0.50, y: 0.78 },
    '양양': { x: 0.54, y: 0.52 },
    '강하': { x: 0.61, y: 0.56 },
    '계양': { x: 0.60, y: 0.76 },
    '영릉': { x: 0.56, y: 0.72 },
    '남중': { x: 0.28, y: 0.68 },
    '광한': { x: 0.31, y: 0.51 },
    '상용': { x: 0.44, y: 0.46 },
    '파동': { x: 0.42, y: 0.53 },
    '무위': { x: 0.430, y: 0.251 },
    '천수': { x: 0.476, y: 0.399 },
    '무도': { x: 0.464, y: 0.458 },
    '자동': { x: 0.455, y: 0.419 },
    '영안': { x: 0.489, y: 0.547 },
    '건녕': { x: 0.446, y: 0.675 },
    '홍농': { x: 0.553, y: 0.394 },
    '청주': { x: 0.664, y: 0.308 },
    '제남': { x: 0.642, y: 0.310 },
    '소패': { x: 0.642, y: 0.411 },
    '초': { x: 0.654, y: 0.510 },
    '상당': { x: 0.583, y: 0.335 },
    '남피': { x: 0.637, y: 0.245 },
    '평원': { x: 0.612, y: 0.382 },
    '광릉': { x: 0.677, y: 0.482 },
    '평양': { x: 0.7709, y: 0.1961 },
    '선안': { x: 0.7332, y: 0.0843 },
    '지안': { x: 0.7773, y: 0.0858 },
    '낙랑': { x: 0.7700, y: 0.2230 },
    '사비': { x: 0.7948, y: 0.3240 },
    '한산': { x: 0.7818, y: 0.3037 },
    '웅진': { x: 0.7906, y: 0.3128 },
    '경주': { x: 0.8219, y: 0.3457 },
    '대야성': { x: 0.7700, y: 0.2426 },
    '가락': { x: 0.8113, y: 0.3610 },
    '안동': { x: 0.8146, y: 0.3142 },
    '야마토': { x: 0.9149, y: 0.3950 },
    '구주': { x: 0.8393, y: 0.4384 },
    '오키나와': { x: 0.7991, y: 0.6600 },
    '대만': { x: 0.7091, y: 0.6841 },
};

/**
 * [지도][1:1] 비트맵 위 도시 아이콘 중심 좌표 (0~1 정규화).
 *
 * assets/map-china-ai-4096.webp 의 실제 픽셀 좌표를 4096으로 나눈 값이다.
 * 위경도 정방향 아핀 피팅으로 계산한다 (x = 60.3619*lon - 4433.6, y 2차식).
 * 전술 좌표(mapX/mapY)와 섞지 않는다 — 전투 격자 좌표는 별도다.
 */
export const CITY_IMAGE_ANCHORS: Record<string, { x: number; y: number }> = {
    '장안': { x: 0.5230, y: 0.4089 },
    '낙양': { x: 0.5748, y: 0.3977 },
    '허창': { x: 0.5954, y: 0.4211 },
    '업': { x: 0.6067, y: 0.2358 },
    '진양': { x: 0.5762, y: 0.2537 },
    '한중': { x: 0.4948, y: 0.4581 },
    '성도': { x: 0.4512, y: 0.5411 },
    '건업': { x: 0.6683, y: 0.4944 },
    '강릉': { x: 0.5710, y: 0.5513 },
    '남양': { x: 0.5759, y: 0.4604 },
    '여남': { x: 0.6029, y: 0.4613 },
    '서주': { x: 0.6460, y: 0.4143 },
    '양양': { x: 0.5699, y: 0.4961 },
    '신야': { x: 0.5733, y: 0.4780 },
    '장사': { x: 0.5819, y: 0.6116 },
    '계양': { x: 0.6325, y: 0.7099 },
    '남중': { x: 0.4313, y: 0.6840 },
    '광한': { x: 0.4544, y: 0.5302 },
    '단양': { x: 0.6776, y: 0.4965 },
    '오': { x: 0.6946, y: 0.5203 },
    '상용': { x: 0.5489, y: 0.5136 },
    '무창': { x: 0.6021, y: 0.5431 },
    '강하': { x: 0.6005, y: 0.5507 },
    '파동': { x: 0.5445, y: 0.5285 },
    '영릉': { x: 0.5622, y: 0.6559 },
    '교지': { x: 0.4775, y: 0.7425 },
    '무위': { x: 0.4301, y: 0.2509 },
    '천수': { x: 0.4756, y: 0.3994 },
    '무도': { x: 0.4639, y: 0.4579 },
    '자동': { x: 0.4553, y: 0.4190 },
    '영안': { x: 0.4890, y: 0.5474 },
    '건녕': { x: 0.4460, y: 0.6749 },
    '홍농': { x: 0.5532, y: 0.3944 },
    '청주': { x: 0.6636, y: 0.3083 },
    '제남': { x: 0.6418, y: 0.3105 },
    '소패': { x: 0.640576, y: 0.39375 },
    '초': { x: 0.6536, y: 0.5102 },
    '상당': { x: 0.584497, y: 0.335107 },
    '남피': { x: 0.6374, y: 0.2450 },
    '광릉': { x: 0.6771, y: 0.4824 },
    '평양': { x: 0.7709, y: 0.1961 },
    '선안': { x: 0.7332, y: 0.0843 },
    '지안': { x: 0.7773, y: 0.0858 },
    '낙랑': { x: 0.7700, y: 0.2230 },
    '북평': { x: 0.6330, y: 0.1515 },
    '사비': { x: 0.7948, y: 0.3240 },
    '한산': { x: 0.7818, y: 0.3037 },
    '웅진': { x: 0.7906, y: 0.3128 },
    '경주': { x: 0.8219, y: 0.3457 },
    '대야성': { x: 0.7700, y: 0.2426 },
    '가락': { x: 0.8113, y: 0.3610 },
    '안동': { x: 0.8146, y: 0.3142 },
    '야마토': { x: 0.9149, y: 0.3950 },
    '구주': { x: 0.8393, y: 0.4383 },
    '오키나와': { x: 0.7992, y: 0.6600 },
    '대만': { x: 0.7091, y: 0.6841 },
    '거록': { x: 0.6128, y: 0.2783 },
    '연주': { x: 0.6359, y: 0.3568 },
    '하비': { x: 0.6558, y: 0.4185 },
    '여강': { x: 0.6680, y: 0.4947 },
    '수춘': { x: 0.6385, y: 0.4759 },
    '진류': { x: 0.6020, y: 0.3903 },
    '청두': { x: 0.4512, y: 0.5407 },
    '항양': { x: 0.5699, y: 0.4947 },
    '부경': { x: 0.6875, y: 0.5538 },
    '동정': { x: 0.6459, y: 0.5013 },
    '진주': { x: 0.6446, y: 0.4122 },
    '복양': { x: 0.6167, y: 0.3481 },
    '평원': { x: 0.633374, y: 0.286426 },
};


/**
 * [지도][1:1] 전략 관문·전장·항구 앵커 (0~1 정규화).
 *
 * assets/map-china-4096.webp 와 같은 위도경도 표에서 나온 실제 픽셀 좌표다.
 * scripts/generate_map.py 가 지형 이미지와 이 표를 함께 만든다.
 */
export const MAP_FEATURE_ANCHORS: Record<string, { x: number; y: number; kind: 'PASS' | 'BATTLEFIELD' | 'PORT' }> = {
    '호로관': { x: 0.5401, y: 0.3351, kind: 'PASS' },
    '함곡관': { x: 0.5518, y: 0.4016, kind: 'PASS' },
    '양관': { x: 0.3668, y: 0.1503, kind: 'PASS' },
    '정관': { x: 0.6005, y: 0.2426, kind: 'PASS' },
    '산관': { x: 0.5106, y: 0.4264, kind: 'PASS' },
    '진관': { x: 0.4753, y: 0.4895, kind: 'PASS' },
    '대방곡': { x: 0.4929, y: 0.4106, kind: 'PASS' },
    '적벽': { x: 0.5958, y: 0.5699, kind: 'BATTLEFIELD' },
    '한강': { x: 0.6005, y: 0.5492, kind: 'PORT' },
    '창오': { x: 0.5578, y: 0.7107, kind: 'PASS' },
    '한중협곡': { x: 0.4929, y: 0.4569, kind: 'PASS' },
};

/** 요충지 수비 병력(명) — 점령 전투의 방어측 전력이 된다. */
const FEATURE_GARRISON = 3000;

/**
 * 요충지 공급 반경(정규화). 이 안에 아군 요충지가 있으면 인접 도시의 포위 수성이
 * 1개월 → 3개월로 늘어난다. 도시 간격(필요 간격 0.02~0.04)보다 훨씬 넓게 잡아야
 * "인접한 도시" 라는 규칙이 성립한다.
 */
const FEATURE_SUPPLY_RADIUS = 0.09;

/**
 * 정적 앵커 표(MAP_FEATURE_ANCHORS)를 소유권 있는 엔티티로 승격한다.
 *
 * [왜 필요한가]
 * 앵커 표는 좌표만 있고 소유권이 없다. 그래서 점령도 보급도 불가능했다. 이 함수가
 * 좌표 + 중립 소유권 + 수비 병력을 갖춘 엔티티를 만들어 세이브/로드 대상이 되게 한다.
 *
 * [초기 소유권]
 * 중립(null)으로 시작한다 — "도시를 먼저 잡고 인접 요충지를 붙인다" 는 순서를 만들되,
 * 어느 세력도 시작 시 복리 없이 요충지를 갖지 않게 한다.
 */
export function buildMapFeatures(): MapFeature[] {
    return Object.entries(MAP_FEATURE_ANCHORS).map(([name, f]) => ({
        id: `feature_${name}`,
        name,
        kind: f.kind,
        // 도시와 같은 격자 환산식을 쓴다 — 서로 다른 스케일을 쓰면 반경 판정이 어긋난다.
        hexCoord: { q: Math.round(f.x * 8) - 4, r: Math.round(f.y * 8) - 4 },
        mapX: f.x,
        mapY: f.y,
        ownerId: null,
        garrison: FEATURE_GARRISON,
        maxGarrison: FEATURE_GARRISON,
        supplyRadius: FEATURE_SUPPLY_RADIUS,
        siegeMonthsRemaining: 0,
        besiegedByFactionId: null,
        besiegedCityIds: [],
    }));
}


/** 무장 이름표 (간이 사전 — 확장 가능) */
interface ScenarioOfficerProfile {
    name: string;
    courtesy: string;
    stats: OfficerStats;
    personality: Personality;
}

/** 외부 콘텐츠 데이터 우선 적용 — 07 시나리오의 확장 능력치/성향 [5][11][27] */
const OFFICER_PROFILE_OVERRIDES = scenario07OfficerProfiles as Record<string, ScenarioOfficerProfile>;

interface ScenarioRelationshipFile {
    version: number;
    scenarios: Record<string, RelationshipEdge[]>;
}

const RELATIONSHIP_FILE = scenarioRelationships as ScenarioRelationshipFile;
const VALID_RELATIONSHIP_TYPES = new Set<RelationshipEdge['type']>([
    'FRIEND', 'RIVAL', 'SWORN_BROTHER', 'NEMESIS', 'FAMILY', 'SPOUSE', 'SUBORDINATE',
]);

const SCENARIO_EXTRA_RELATIONSHIPS: Record<string, RelationshipEdge[]> = {
    '05': [
        { source: 'xun_yu', target: 'cao_cao', type: 'FRIEND', affinity: 60, history: [{ year: 207, month: 1, event: '허창 모신', delta: 60 }] },
        { source: 'xiahou_yuan', target: 'xiahou_dun', type: 'FAMILY', affinity: 70, history: [{ year: 207, month: 1, event: '하후 일족', delta: 70 }] },
        { source: 'zhang_he', target: 'zhang_liao', type: 'FRIEND', affinity: 30, history: [{ year: 207, month: 1, event: '위나라 동료', delta: 30 }] },
        { source: 'pang_tong', target: 'zhuge_liang', type: 'FRIEND', affinity: 60, history: [{ year: 207, month: 1, event: '와룡봉추', delta: 60 }] },
        { source: 'gan_ning', target: 'zhou_yu', type: 'FRIEND', affinity: 40, history: [{ year: 207, month: 1, event: '강동 투신', delta: 40 }] },
        { source: 'cheng_pu_esc', target: 'huang_gai', type: 'FRIEND', affinity: 50, history: [{ year: 207, month: 1, event: '강동 원로', delta: 50 }] },
        { source: 'liu_biao', target: 'huang_zu', type: 'SUBORDINATE', affinity: 40, history: [{ year: 207, month: 1, event: '형주 주종', delta: 40 }] },
        { source: 'fa_zheng', target: 'liu_zhang', type: 'SUBORDINATE', affinity: 45, history: [{ year: 207, month: 1, event: '익주 모신', delta: 45 }] },
    ],
};

/** 외부 관계 데이터의 잘못된 엣지를 걸러내는 fail-safe 검증기 [269][301] */
export function getScenarioRelationships(scenarioId: string, validOfficerIds: ReadonlySet<string>): RelationshipEdge[] {
    const fileEdges = (RELATIONSHIP_FILE.version === 1 && Array.isArray(RELATIONSHIP_FILE.scenarios?.[scenarioId]))
        ? RELATIONSHIP_FILE.scenarios[scenarioId]
        : [];
    const seen = new Set<string>();
    return [...fileEdges, ...(SCENARIO_EXTRA_RELATIONSHIPS[scenarioId] ?? [])].filter((edge): edge is RelationshipEdge => {
        const key = `${edge.source}:${edge.target}:${edge.type}`;
        const valid = edge.source !== edge.target
            && validOfficerIds.has(edge.source)
            && validOfficerIds.has(edge.target)
            && VALID_RELATIONSHIP_TYPES.has(edge.type)
            && Number.isFinite(edge.affinity)
            && edge.affinity >= -100
            && edge.affinity <= 100
            && !seen.has(key);
        if (valid) seen.add(key);
        return valid;
    }).map(edge => ({
        ...edge,
        history: Array.isArray(edge.history) ? edge.history.map(item => ({ ...item })) : [],
    }));
}

const OFFICER_NAME_TABLE: Record<string, { name: string; courtesy: string; stats: Partial<OfficerStats>; personality: Personality }> = {
    liu_bei:    { name: '유비',   courtesy: '현덕', stats: { leadership: 82, might: 74, intelligence: 76, politics: 80, charisma: 99 }, personality: 'RIGHTEOUS' },
    guan_yu:    { name: '관우',   courtesy: '운장', stats: { leadership: 96, might: 97, intelligence: 75, politics: 63, charisma: 93 }, personality: 'RIGHTEOUS' },
    zhang_fei:  { name: '장비',   courtesy: '익덕', stats: { leadership: 86, might: 98, intelligence: 45, politics: 35, charisma: 55 }, personality: 'AGGRESSIVE' },
    zhuge_liang:{ name: '제갈량', courtesy: '공명', stats: { leadership: 94, might: 40, intelligence: 100, politics: 97, charisma: 94 }, personality: 'CAUTIOUS' },
    cao_cao:    { name: '조조',   courtesy: '맹덕', stats: { leadership: 96, might: 78, intelligence: 94, politics: 96, charisma: 92 }, personality: 'AMBITIOUS' },
    sun_quan:   { name: '손권',   courtesy: '중모', stats: { leadership: 92, might: 70, intelligence: 82, politics: 88, charisma: 90 }, personality: 'CALM' },
    sun_jian:   { name: '손견',   courtesy: '문대', stats: { leadership: 92, might: 94, intelligence: 74, politics: 70, charisma: 85 }, personality: 'AGGRESSIVE' },
    sun_ce:     { name: '손책',   courtesy: '박부', stats: { leadership: 92, might: 94, intelligence: 76, politics: 66, charisma: 92 }, personality: 'AGGRESSIVE' },
    yuan_shao:  { name: '원소',   courtesy: '본초', stats: { leadership: 82, might: 66, intelligence: 62, politics: 76, charisma: 88 }, personality: 'TIMID' },
    yuan_shu:   { name: '원술',   courtesy: '공로', stats: { leadership: 62, might: 56, intelligence: 52, politics: 62, charisma: 60 }, personality: 'GREEDY' },
    dong_zhuo:  { name: '동탁',   courtesy: '중영', stats: { leadership: 84, might: 82, intelligence: 58, politics: 52, charisma: 40 }, personality: 'GREEDY' },
    lv_bu:      { name: '여포',   courtesy: '봉선', stats: { leadership: 92, might: 100, intelligence: 32, politics: 30, charisma: 58 }, personality: 'GREEDY' },
    he_jin:     { name: '하진',   courtesy: '수고', stats: { leadership: 66, might: 58, intelligence: 42, politics: 52, charisma: 60 }, personality: 'CAUTIOUS' },
    huang_fu_song:{ name: '황보숭', courtesy: '의진', stats: { leadership: 88, might: 80, intelligence: 84, politics: 78, charisma: 82 }, personality: 'RIGHTEOUS' },
    zhang_jiao: { name: '장각',   courtesy: '',     stats: { leadership: 86, might: 52, intelligence: 88, politics: 66, charisma: 96 }, personality: 'AMBITIOUS' },
    zhao_yun:   { name: '조운',   courtesy: '자룡', stats: { leadership: 92, might: 96, intelligence: 80, politics: 72, charisma: 88 }, personality: 'LOYAL' },
    xun_yu:     { name: '순욱',   courtesy: '문약', stats: { leadership: 44, might: 22, intelligence: 96, politics: 98, charisma: 88 }, personality: 'LOYAL' },
    zhou_yu:    { name: '주유',   courtesy: '공근', stats: { leadership: 94, might: 76, intelligence: 97, politics: 82, charisma: 96 }, personality: 'LOYAL' },
    sima_yi:    { name: '사마의', courtesy: '중달', stats: { leadership: 90, might: 60, intelligence: 98, politics: 94, charisma: 78 }, personality: 'CAUTIOUS' },
    cao_pi:     { name: '사오필', courtesy: '종무', stats: { leadership: 78, might: 66, intelligence: 76, politics: 72, charisma: 82 }, personality: 'CALM' },
    liu_shan:   { name: '유찬', courtesy: '공명', stats: { leadership: 58, might: 32, intelligence: 66, politics: 58, charisma: 76 }, personality: 'CALM' },
    sun_hao:    { name: '손호', courtesy: '원종', stats: { leadership: 72, might: 58, intelligence: 78, politics: 70, charisma: 74 }, personality: 'CAUTIOUS' },
    sima_zhao:  { name: '사마조', courtesy: '子上', stats: { leadership: 86, might: 62, intelligence: 94, politics: 88, charisma: 76 }, personality: 'CAUTIOUS' },
    zhuge_ke:   { name: '제갈격', courtesy: '원도', stats: { leadership: 84, might: 44, intelligence: 90, politics: 86, charisma: 78 }, personality: 'CAUTIOUS' },
    fei_yi:     { name: '비의', courtesy: '문상', stats: { leadership: 72, might: 40, intelligence: 88, politics: 84, charisma: 72 }, personality: 'RIGHTEOUS' },
    zhang_zhao: { name: '장조', courtesy: '홍모', stats: { leadership: 70, might: 68, intelligence: 86, politics: 72, charisma: 74 }, personality: 'LOYAL' },
    zhang_song: { name: '장송', courtesy: '문현', stats: { leadership: 82, might: 72, intelligence: 76, politics: 80, charisma: 72 }, personality: 'LOYAL' },

    // ── 위·조조 진영 ──
    xiahou_dun: { name: '하후돈', courtesy: '원양', stats: { leadership: 90, might: 92, intelligence: 64, politics: 76, charisma: 80 }, personality: 'LOYAL' },
    xiahou_yuan:{ name: '하후연', courtesy: '묘재', stats: { leadership: 88, might: 90, intelligence: 56, politics: 60, charisma: 66 }, personality: 'AGGRESSIVE' },
    zhang_liao: { name: '장료',   courtesy: '문원', stats: { leadership: 94, might: 94, intelligence: 80, politics: 66, charisma: 82 }, personality: 'LOYAL' },
    xu_chu:     { name: '허저',   courtesy: '중강', stats: { leadership: 72, might: 98, intelligence: 22, politics: 18, charisma: 48 }, personality: 'LOYAL' },
    dian_wei:   { name: '전위',   courtesy: '',     stats: { leadership: 70, might: 97, intelligence: 24, politics: 16, charisma: 46 }, personality: 'LOYAL' },
    guo_jia:    { name: '곽가',   courtesy: '봉효', stats: { leadership: 52, might: 20, intelligence: 98, politics: 84, charisma: 78 }, personality: 'CAUTIOUS' },
    xun_you:    { name: '순유',   courtesy: '공달', stats: { leadership: 58, might: 30, intelligence: 94, politics: 88, charisma: 80 }, personality: 'CAUTIOUS' },
    zhang_he:   { name: '장합',   courtesy: '준의', stats: { leadership: 88, might: 88, intelligence: 70, politics: 56, charisma: 62 }, personality: 'CALM' },
    xu_huang:   { name: '서황',   courtesy: '공명', stats: { leadership: 88, might: 90, intelligence: 68, politics: 60, charisma: 64 }, personality: 'LOYAL' },
    cao_ren:    { name: '조인',   courtesy: '자효', stats: { leadership: 88, might: 84, intelligence: 62, politics: 66, charisma: 70 }, personality: 'LOYAL' },

    // ── 촉·유비 진영 ──
    huang_zhong:{ name: '황충',   courtesy: '한승', stats: { leadership: 88, might: 96, intelligence: 58, politics: 52, charisma: 62 }, personality: 'LOYAL' },
    ma_chao:    { name: '마초',   courtesy: '맹기', stats: { leadership: 90, might: 97, intelligence: 44, politics: 30, charisma: 76 }, personality: 'AGGRESSIVE' },
    wei_yan:    { name: '위연',   courtesy: '문장', stats: { leadership: 86, might: 92, intelligence: 58, politics: 40, charisma: 50 }, personality: 'AGGRESSIVE' },
    pang_tong:  { name: '방통',   courtesy: '사원', stats: { leadership: 70, might: 34, intelligence: 98, politics: 84, charisma: 70 }, personality: 'AMBITIOUS' },
    jiang_wei:  { name: '강유',   courtesy: '백약', stats: { leadership: 90, might: 88, intelligence: 92, politics: 68, charisma: 80 }, personality: 'LOYAL' },
    fa_zheng:  { name: '법정',   courtesy: '효직', stats: { leadership: 56, might: 24, intelligence: 94, politics: 78, charisma: 66 }, personality: 'AMBITIOUS' },

    // ── 오·손씨 진영 ──
    lu_meng:    { name: '여몽',   courtesy: '자명', stats: { leadership: 90, might: 84, intelligence: 86, politics: 72, charisma: 78 }, personality: 'LOYAL' },
    lu_su:      { name: '노숙',   courtesy: '자경', stats: { leadership: 82, might: 60, intelligence: 92, politics: 88, charisma: 84 }, personality: 'CALM' },
    lu_xun:     { name: '육손',   courtesy: '백언', stats: { leadership: 92, might: 62, intelligence: 96, politics: 90, charisma: 84 }, personality: 'CAUTIOUS' },
    gan_ning:   { name: '감녕',   courtesy: '흥패', stats: { leadership: 84, might: 94, intelligence: 72, politics: 42, charisma: 68 }, personality: 'AGGRESSIVE' },
    taishi_ci:  { name: '태사자', courtesy: '자의', stats: { leadership: 86, might: 94, intelligence: 66, politics: 52, charisma: 74 }, personality: 'LOYAL' },
    zhou_tai:   { name: '주태',   courtesy: '유평', stats: { leadership: 80, might: 90, intelligence: 48, politics: 40, charisma: 60 }, personality: 'LOYAL' },
    huang_gai:  { name: '황개',   courtesy: '공복', stats: { leadership: 82, might: 90, intelligence: 58, politics: 54, charisma: 66 }, personality: 'LOYAL' },

    // ── 기타 세력 ──
    yan_liang:  { name: '안량',   courtesy: '',     stats: { leadership: 82, might: 94, intelligence: 34, politics: 26, charisma: 44 }, personality: 'AGGRESSIVE' },
    wen_chou:   { name: '문추',   courtesy: '',     stats: { leadership: 80, might: 93, intelligence: 32, politics: 24, charisma: 42 }, personality: 'AGGRESSIVE' },
    hua_xiong:  { name: '화웅',   courtesy: '',     stats: { leadership: 80, might: 92, intelligence: 36, politics: 28, charisma: 46 }, personality: 'AGGRESSIVE' },
    sun_shangxiang:{ name: '손부인', courtesy: '',   stats: { leadership: 68, might: 78, intelligence: 72, politics: 62, charisma: 88 }, personality: 'AGGRESSIVE' },
    chen_gong:  { name: '진궁',   courtesy: '공대', stats: { leadership: 62, might: 34, intelligence: 90, politics: 80, charisma: 70 }, personality: 'RIGHTEOUS' },
    gao_shun:   { name: '고순',   courtesy: '',     stats: { leadership: 86, might: 90, intelligence: 46, politics: 38, charisma: 54 }, personality: 'LOYAL' },
    zhang_xiu:  { name: '장수',   courtesy: '',     stats: { leadership: 76, might: 84, intelligence: 58, politics: 50, charisma: 56 }, personality: 'CAUTIOUS' },
    zhang_yan:  { name: '장연',   courtesy: '',     stats: { leadership: 74, might: 80, intelligence: 52, politics: 46, charisma: 52 }, personality: 'CAUTIOUS' },
    yuan_tan:   { name: '원담',   courtesy: '현사', stats: { leadership: 66, might: 62, intelligence: 48, politics: 54, charisma: 56 }, personality: 'AMBITIOUS' },
    yuan_shang: { name: '원희',   courtesy: '현보', stats: { leadership: 64, might: 66, intelligence: 44, politics: 48, charisma: 58 }, personality: 'AMBITIOUS' },
    shen_pei:   { name: '신포',   courtesy: '정도', stats: { leadership: 70, might: 58, intelligence: 78, politics: 74, charisma: 60 }, personality: 'LOYAL' },
    tian_feng:  { name: '전풍',   courtesy: '원호', stats: { leadership: 58, might: 40, intelligence: 88, politics: 82, charisma: 70 }, personality: 'RIGHTEOUS' },
    ju_shou:    { name: '저수',   courtesy: '정평', stats: { leadership: 62, might: 36, intelligence: 90, politics: 80, charisma: 68 }, personality: 'LOYAL' },
    yan_baihu:  { name: '염백호', courtesy: '',     stats: { leadership: 72, might: 82, intelligence: 40, politics: 30, charisma: 44 }, personality: 'AGGRESSIVE' },
    liu_biao:   { name: '유표',   courtesy: '경승', stats: { leadership: 68, might: 48, intelligence: 62, politics: 74, charisma: 70 }, personality: 'CALM' },
    huang_zu:   { name: '황조',   courtesy: '',     stats: { leadership: 70, might: 76, intelligence: 44, politics: 38, charisma: 46 }, personality: 'CAUTIOUS' },
    ma_teng:    { name: '마등',   courtesy: '수성', stats: { leadership: 80, might: 86, intelligence: 52, politics: 58, charisma: 72 }, personality: 'RIGHTEOUS' },
    han_sui:    { name: '한수',   courtesy: '문약', stats: { leadership: 76, might: 78, intelligence: 58, politics: 62, charisma: 64 }, personality: 'CAUTIOUS' },
    zhang_lu:   { name: '장로',   courtesy: '공기', stats: { leadership: 64, might: 42, intelligence: 70, politics: 76, charisma: 82 }, personality: 'CALM' },
    dong_cheng: { name: '동승',   courtesy: '',     stats: { leadership: 58, might: 52, intelligence: 56, politics: 66, charisma: 68 }, personality: 'RIGHTEOUS' },
    gongsun_zan:{ name: '공손찬', courtesy: '백규', stats: { leadership: 78, might: 76, intelligence: 56, politics: 58, charisma: 62 }, personality: 'AGGRESSIVE' },
    kong_rong:  { name: '공융',   courtesy: '문거', stats: { leadership: 52, might: 28, intelligence: 78, politics: 84, charisma: 90 }, personality: 'RIGHTEOUS' },
    tao_qian:   { name: '도겸',   courtesy: '공조', stats: { leadership: 60, might: 44, intelligence: 62, politics: 76, charisma: 68 }, personality: 'CALM' },
    zhang_yang: { name: '장양',   courtesy: '치손', stats: { leadership: 70, might: 74, intelligence: 48, politics: 44, charisma: 50 }, personality: 'GREEDY' },
    liu_zhang:  { name: '유장',   courtesy: '계옥', stats: { leadership: 55, might: 45, intelligence: 60, politics: 70, charisma: 65 }, personality: 'CALM' },
};
/**
 * [08] 전장태세 실명 프로파일 — officers_full.json 에서 직접 가져온 표.
 *
 * buildOfficer 는 이름표에 없는 id 면 이름=id, 능력치=60 으로 떨어진다.
 * off_XXXX 계열은 이름표에 없으므로 이 표가 없으면 화면에 "off_0521" 이 그대로 나온다.
 * 원본은 src/data/officers_full.json (PK장수목록 1,200행) 이며, 미등장·무효 행은
 * "게임에 나오지 않는" 껍데기라 제외했다(예: '오환재상').
 */
const OFFICER_FULL_PROFILES: Record<string, ScenarioOfficerProfile> = {
    off_0521: { name: '조조', courtesy: '', stats: { leadership: 98, might: 72, intelligence: 91, politics: 94, charisma: 96 }, personality: 'AMBITIOUS' as Personality },
    off_0147: { name: '관우', courtesy: '', stats: { leadership: 96, might: 97, intelligence: 75, politics: 63, charisma: 94 }, personality: 'RIGHTEOUS' as Personality },
    off_0551: { name: '손견', courtesy: '', stats: { leadership: 94, might: 90, intelligence: 77, politics: 72, charisma: 90 }, personality: 'RIGHTEOUS' as Personality },
    off_0703: { name: '정보', courtesy: '', stats: { leadership: 85, might: 79, intelligence: 79, politics: 74, charisma: 86 }, personality: 'RIGHTEOUS' as Personality },
    off_0124: { name: '하후돈', courtesy: '', stats: { leadership: 89, might: 90, intelligence: 60, politics: 74, charisma: 88 }, personality: 'AMBITIOUS' as Personality },
    off_1000: { name: '노식', courtesy: '', stats: { leadership: 86, might: 63, intelligence: 82, politics: 85, charisma: 85 }, personality: 'RIGHTEOUS' as Personality },
    off_0952: { name: '유비', courtesy: '', stats: { leadership: 76, might: 73, intelligence: 74, politics: 78, charisma: 99 }, personality: 'RIGHTEOUS' as Personality },
    off_0659: { name: '장보', courtesy: '', stats: { leadership: 83, might: 71, intelligence: 81, politics: 66, charisma: 86 }, personality: 'AGGRESSIVE' as Personality },
    off_0035: { name: '원소', courtesy: '', stats: { leadership: 81, might: 69, intelligence: 70, politics: 73, charisma: 92 }, personality: 'RIGHTEOUS' as Personality },
    off_0826: { name: '포신', courtesy: '', stats: { leadership: 77, might: 67, intelligence: 81, politics: 73, charisma: 83 }, personality: 'RIGHTEOUS' as Personality },
    off_1001: { name: '오환선우', courtesy: '', stats: { leadership: 88, might: 89, intelligence: 63, politics: 58, charisma: 83 }, personality: 'AGGRESSIVE' as Personality },
    off_1041: { name: '강족장', courtesy: '', stats: { leadership: 84, might: 90, intelligence: 65, politics: 62, charisma: 79 }, personality: 'AGGRESSIVE' as Personality },
    off_1081: { name: '남만대왕', courtesy: '', stats: { leadership: 85, might: 90, intelligence: 63, politics: 58, charisma: 83 }, personality: 'AGGRESSIVE' as Personality },
    off_0114: { name: '하후연', courtesy: '', stats: { leadership: 92, might: 91, intelligence: 55, politics: 61, charisma: 79 }, personality: 'AMBITIOUS' as Personality },
    off_0607: { name: '장각', courtesy: '', stats: { leadership: 89, might: 25, intelligence: 86, politics: 80, charisma: 98 }, personality: 'AGGRESSIVE' as Personality },
    off_0247: { name: '황개', courtesy: '', stats: { leadership: 80, might: 83, intelligence: 68, politics: 65, charisma: 81 }, personality: 'AMBITIOUS' as Personality },
    off_1021: { name: '선비대인', courtesy: '', stats: { leadership: 84, might: 89, intelligence: 67, politics: 59, charisma: 78 }, personality: 'AGGRESSIVE' as Personality },
    off_1061: { name: '산월두령', courtesy: '', stats: { leadership: 85, might: 93, intelligence: 63, politics: 58, charisma: 78 }, personality: 'AGGRESSIVE' as Personality },
    off_0618: { name: '장합', courtesy: '', stats: { leadership: 89, might: 89, intelligence: 69, politics: 57, charisma: 72 }, personality: 'AMBITIOUS' as Personality },
    off_0671: { name: '진궁', courtesy: '', stats: { leadership: 79, might: 55, intelligence: 89, politics: 83, charisma: 69 }, personality: 'CALM' as Personality },
    off_0231: { name: '엄안', courtesy: '', stats: { leadership: 79, might: 82, intelligence: 69, politics: 67, charisma: 77 }, personality: 'RIGHTEOUS' as Personality },
    off_0092: { name: '가후', courtesy: '', stats: { leadership: 86, might: 48, intelligence: 97, politics: 85, charisma: 57 }, personality: 'GREEDY' as Personality },
    off_0166: { name: '한수', courtesy: '', stats: { leadership: 82, might: 72, intelligence: 77, politics: 63, charisma: 78 }, personality: 'AGGRESSIVE' as Personality },
    off_0271: { name: '황충', courtesy: '', stats: { leadership: 87, might: 93, intelligence: 63, politics: 52, charisma: 74 }, personality: 'RIGHTEOUS' as Personality },
    off_0535: { name: '저수', courtesy: '', stats: { leadership: 79, might: 35, intelligence: 90, politics: 89, charisma: 76 }, personality: 'RIGHTEOUS' as Personality },
    off_0464: { name: '심배', courtesy: '', stats: { leadership: 82, might: 60, intelligence: 83, politics: 73, charisma: 70 }, personality: 'AGGRESSIVE' as Personality },
    off_0402: { name: '순유', courtesy: '', stats: { leadership: 73, might: 26, intelligence: 94, politics: 88, charisma: 86 }, personality: 'RIGHTEOUS' as Personality },
    off_0387: { name: '주준', courtesy: '', stats: { leadership: 84, might: 63, intelligence: 70, politics: 71, charisma: 75 }, personality: 'GREEDY' as Personality },
    off_0664: { name: '장량', courtesy: '', stats: { leadership: 78, might: 80, intelligence: 70, politics: 53, charisma: 82 }, personality: 'AMBITIOUS' as Personality },
    off_0266: { name: '공손찬', courtesy: '', stats: { leadership: 84, might: 83, intelligence: 71, politics: 46, charisma: 77 }, personality: 'AMBITIOUS' as Personality },
    off_0771: { name: '마등', courtesy: '', stats: { leadership: 82, might: 80, intelligence: 51, politics: 59, charisma: 89 }, personality: 'GREEDY' as Personality },
    off_0830: { name: '방덕', courtesy: '', stats: { leadership: 81, might: 94, intelligence: 71, politics: 44, charisma: 70 }, personality: 'GREEDY' as Personality },
    off_0159: { name: '한호', courtesy: '', stats: { leadership: 69, might: 71, intelligence: 68, politics: 87, charisma: 64 }, personality: 'GREEDY' as Personality },
    off_0985: { name: '여대', courtesy: '', stats: { leadership: 79, might: 71, intelligence: 69, politics: 74, charisma: 65 }, personality: 'RIGHTEOUS' as Personality },
    off_0956: { name: '유복', courtesy: '', stats: { leadership: 64, might: 49, intelligence: 73, politics: 87, charisma: 84 }, personality: 'RIGHTEOUS' as Personality },
    off_0393: { name: '순욱', courtesy: '', stats: { leadership: 54, might: 14, intelligence: 95, politics: 99, charisma: 94 }, personality: 'RIGHTEOUS' as Personality },
    off_0325: { name: '채모', courtesy: '', stats: { leadership: 77, might: 68, intelligence: 77, politics: 73, charisma: 59 }, personality: 'CALM' as Personality },
    off_0279: { name: '황보숭', courtesy: '', stats: { leadership: 90, might: 61, intelligence: 73, politics: 51, charisma: 75 }, personality: 'AMBITIOUS' as Personality },
    off_0713: { name: '전풍', courtesy: '', stats: { leadership: 72, might: 29, intelligence: 93, politics: 87, charisma: 68 }, personality: 'RIGHTEOUS' as Personality },
    off_0390: { name: '주치', courtesy: '', stats: { leadership: 70, might: 56, intelligence: 72, politics: 73, charisma: 76 }, personality: 'LOYAL' as Personality },
    off_0016: { name: '우금', courtesy: '', stats: { leadership: 84, might: 77, intelligence: 72, politics: 57, charisma: 56 }, personality: 'AMBITIOUS' as Personality },
    off_0512: { name: '장홍', courtesy: '', stats: { leadership: 68, might: 49, intelligence: 73, politics: 76, charisma: 80 }, personality: 'RIGHTEOUS' as Personality },
    off_0689: { name: '정욱', courtesy: '', stats: { leadership: 70, might: 49, intelligence: 90, politics: 79, charisma: 56 }, personality: 'CALM' as Personality },
    off_0281: { name: '고람', courtesy: '', stats: { leadership: 76, might: 82, intelligence: 68, politics: 55, charisma: 62 }, personality: 'AMBITIOUS' as Personality },
    off_0751: { name: '두습', courtesy: '', stats: { leadership: 73, might: 58, intelligence: 77, politics: 71, charisma: 64 }, personality: 'RIGHTEOUS' as Personality },
    off_0085: { name: '괴량', courtesy: '', stats: { leadership: 68, might: 33, intelligence: 88, politics: 82, charisma: 71 }, personality: 'CALM' as Personality },
    off_0341: { name: '사섭', courtesy: '', stats: { leadership: 53, might: 31, intelligence: 78, politics: 90, charisma: 89 }, personality: 'GREEDY' as Personality },
    off_0176: { name: '한당', courtesy: '', stats: { leadership: 76, might: 85, intelligence: 59, politics: 51, charisma: 68 }, personality: 'GREEDY' as Personality },
    off_0424: { name: '종요', courtesy: '', stats: { leadership: 70, might: 24, intelligence: 76, politics: 91, charisma: 77 }, personality: 'LOYAL' as Personality },
    off_0925: { name: '유언', courtesy: '', stats: { leadership: 54, might: 38, intelligence: 79, politics: 81, charisma: 86 }, personality: 'CALM' as Personality },
    off_0661: { name: '장양', courtesy: '', stats: { leadership: 72, might: 70, intelligence: 67, politics: 58, charisma: 70 }, personality: 'GREEDY' as Personality },
    off_0030: { name: '염행', courtesy: '', stats: { leadership: 73, might: 84, intelligence: 61, politics: 58, charisma: 60 }, personality: 'AMBITIOUS' as Personality },
    off_0696: { name: '정혼', courtesy: '', stats: { leadership: 68, might: 32, intelligence: 67, politics: 87, charisma: 82 }, personality: 'RIGHTEOUS' as Personality },
    off_0748: { name: '두기', courtesy: '', stats: { leadership: 66, might: 32, intelligence: 74, politics: 87, charisma: 76 }, personality: 'RIGHTEOUS' as Personality },
    off_0047: { name: '왕광', courtesy: '', stats: { leadership: 65, might: 57, intelligence: 61, politics: 70, charisma: 80 }, personality: 'GREEDY' as Personality },
    off_0567: { name: '손정', courtesy: '', stats: { leadership: 66, might: 52, intelligence: 72, politics: 71, charisma: 72 }, personality: 'RIGHTEOUS' as Personality },
    off_1050: { name: '강여장', courtesy: '', stats: { leadership: 77, might: 64, intelligence: 63, politics: 58, charisma: 70 }, personality: 'AGGRESSIVE' as Personality },
    off_0258: { name: '후성', courtesy: '', stats: { leadership: 75, might: 74, intelligence: 67, politics: 55, charisma: 60 }, personality: 'GREEDY' as Personality },
    off_0144: { name: '화웅', courtesy: '', stats: { leadership: 83, might: 92, intelligence: 58, politics: 40, charisma: 57 }, personality: 'AGGRESSIVE' as Personality },
    off_0525: { name: '장패', courtesy: '', stats: { leadership: 76, might: 75, intelligence: 53, politics: 56, charisma: 70 }, personality: 'AMBITIOUS' as Personality },
    off_0653: { name: '장막', courtesy: '', stats: { leadership: 53, might: 52, intelligence: 70, politics: 73, charisma: 82 }, personality: 'CALM' as Personality },
    off_1030: { name: '선비여장', courtesy: '', stats: { leadership: 77, might: 68, intelligence: 59, politics: 55, charisma: 70 }, personality: 'AGGRESSIVE' as Personality },
    off_0466: { name: '신평', courtesy: '', stats: { leadership: 69, might: 43, intelligence: 75, politics: 75, charisma: 66 }, personality: 'GREEDY' as Personality },
    off_1090: { name: '남만여장', courtesy: '', stats: { leadership: 77, might: 64, intelligence: 62, politics: 54, charisma: 71 }, personality: 'AGGRESSIVE' as Personality },
    off_0472: { name: '추정', courtesy: '', stats: { leadership: 72, might: 65, intelligence: 66, politics: 56, charisma: 68 }, personality: 'GREEDY' as Personality },
    off_0269: { name: '공손범', courtesy: '', stats: { leadership: 72, might: 68, intelligence: 63, politics: 61, charisma: 62 }, personality: 'GREEDY' as Personality },
    off_0601: { name: '장연', courtesy: '', stats: { leadership: 80, might: 81, intelligence: 54, politics: 48, charisma: 62 }, personality: 'AGGRESSIVE' as Personality },
    off_0932: { name: '유우', courtesy: '', stats: { leadership: 55, might: 33, intelligence: 69, politics: 76, charisma: 92 }, personality: 'LOYAL' as Personality },
    off_0968: { name: '요화', courtesy: '', stats: { leadership: 73, might: 76, intelligence: 62, politics: 49, charisma: 65 }, personality: 'RIGHTEOUS' as Personality },
    off_0062: { name: '응소', courtesy: '', stats: { leadership: 68, might: 46, intelligence: 73, politics: 67, charisma: 70 }, personality: 'CALM' as Personality },
    off_0364: { name: '주흔', courtesy: '', stats: { leadership: 65, might: 58, intelligence: 73, politics: 65, charisma: 62 }, personality: 'CALM' as Personality },
    off_1010: { name: '오환여장', courtesy: '', stats: { leadership: 75, might: 65, intelligence: 58, politics: 57, charisma: 68 }, personality: 'AGGRESSIVE' as Personality },
    off_1070: { name: '산월여장', courtesy: '', stats: { leadership: 75, might: 63, intelligence: 59, politics: 53, charisma: 71 }, personality: 'AGGRESSIVE' as Personality },
    off_0219: { name: '기령', courtesy: '', stats: { leadership: 78, might: 83, intelligence: 51, politics: 48, charisma: 60 }, personality: 'AMBITIOUS' as Personality },
    off_0625: { name: '장수', courtesy: '', stats: { leadership: 80, might: 73, intelligence: 62, politics: 45, charisma: 60 }, personality: 'GREEDY' as Personality },
    off_0538: { name: '조무', courtesy: '', stats: { leadership: 70, might: 71, intelligence: 62, politics: 53, charisma: 63 }, personality: 'GREEDY' as Personality },
    off_0289: { name: '오경', courtesy: '', stats: { leadership: 68, might: 65, intelligence: 54, politics: 65, charisma: 66 }, personality: 'CALM' as Personality },
    off_0367: { name: '주앙', courtesy: '', stats: { leadership: 75, might: 65, intelligence: 65, politics: 53, charisma: 60 }, personality: 'GREEDY' as Personality },
    off_0953: { name: '유표', courtesy: '', stats: { leadership: 48, might: 31, intelligence: 71, politics: 83, charisma: 85 }, personality: 'LOYAL' as Personality },
    off_0084: { name: '괴월', courtesy: '', stats: { leadership: 47, might: 27, intelligence: 82, politics: 88, charisma: 73 }, personality: 'GREEDY' as Personality },
    off_0201: { name: '구력거', courtesy: '', stats: { leadership: 80, might: 69, intelligence: 56, politics: 52, charisma: 60 }, personality: 'AMBITIOUS' as Personality },
    off_0666: { name: '장로', courtesy: '', stats: { leadership: 51, might: 26, intelligence: 73, politics: 78, charisma: 89 }, personality: 'GREEDY' as Personality },
    off_0552: { name: '손건', courtesy: '', stats: { leadership: 34, might: 33, intelligence: 78, politics: 84, charisma: 87 }, personality: 'LOYAL' as Personality },
    off_0024: { name: '원유', courtesy: '', stats: { leadership: 57, might: 39, intelligence: 73, politics: 76, charisma: 70 }, personality: 'LOYAL' as Personality },
    off_0365: { name: '주우', courtesy: '', stats: { leadership: 68, might: 51, intelligence: 77, politics: 55, charisma: 64 }, personality: 'AMBITIOUS' as Personality },
    off_0963: { name: '유요', courtesy: '', stats: { leadership: 65, might: 66, intelligence: 47, politics: 72, charisma: 64 }, personality: 'CALM' as Personality },
    off_0209: { name: '교모', courtesy: '', stats: { leadership: 56, might: 45, intelligence: 69, politics: 70, charisma: 73 }, personality: 'CALM' as Personality },
    off_0710: { name: '전해', courtesy: '', stats: { leadership: 68, might: 65, intelligence: 57, politics: 60, charisma: 63 }, personality: 'GREEDY' as Personality },
    off_0734: { name: '동승', courtesy: '', stats: { leadership: 57, might: 55, intelligence: 65, politics: 61, charisma: 74 }, personality: 'RIGHTEOUS' as Personality },
    off_0261: { name: '공손월', courtesy: '', stats: { leadership: 73, might: 71, intelligence: 48, politics: 53, charisma: 66 }, personality: 'GREEDY' as Personality },
    off_0268: { name: '공손도', courtesy: '', stats: { leadership: 67, might: 71, intelligence: 68, politics: 63, charisma: 42 }, personality: 'AGGRESSIVE' as Personality },
    off_0441: { name: '서구', courtesy: '', stats: { leadership: 68, might: 48, intelligence: 62, politics: 76, charisma: 56 }, personality: 'LOYAL' as Personality },
    off_0594: { name: '조욱', courtesy: '', stats: { leadership: 45, might: 34, intelligence: 71, politics: 81, charisma: 79 }, personality: 'LOYAL' as Personality },
    off_1026: { name: '선비군사', courtesy: '', stats: { leadership: 62, might: 53, intelligence: 70, politics: 57, charisma: 66 }, personality: 'AGGRESSIVE' as Personality },
    off_0699: { name: '정태', courtesy: '', stats: { leadership: 50, might: 31, intelligence: 80, politics: 74, charisma: 71 }, personality: 'RIGHTEOUS' as Personality },
    off_0793: { name: '미축', courtesy: '', stats: { leadership: 33, might: 29, intelligence: 77, politics: 83, charisma: 84 }, personality: 'LOYAL' as Personality },
    off_1029: { name: '선비한부', courtesy: '', stats: { leadership: 57, might: 82, intelligence: 58, politics: 47, charisma: 62 }, personality: 'AGGRESSIVE' as Personality },
    off_0638: { name: '장제', courtesy: '', stats: { leadership: 70, might: 66, intelligence: 55, politics: 53, charisma: 60 }, personality: 'AMBITIOUS' as Personality },
    off_0740: { name: '답돈', courtesy: '', stats: { leadership: 82, might: 81, intelligence: 52, politics: 34, charisma: 55 }, personality: 'AGGRESSIVE' as Personality },
    off_0543: { name: '손하', courtesy: '', stats: { leadership: 71, might: 74, intelligence: 45, politics: 53, charisma: 60 }, personality: 'AMBITIOUS' as Personality },
    off_0647: { name: '장초', courtesy: '', stats: { leadership: 65, might: 56, intelligence: 62, politics: 51, charisma: 69 }, personality: 'AMBITIOUS' as Personality },
    off_0021: { name: '위자', courtesy: '', stats: { leadership: 58, might: 38, intelligence: 62, politics: 73, charisma: 71 }, personality: 'LOYAL' as Personality },
    off_0186: { name: '안량', courtesy: '', stats: { leadership: 86, might: 93, intelligence: 40, politics: 32, charisma: 51 }, personality: 'AGGRESSIVE' as Personality },
    off_0317: { name: '최염', courtesy: '', stats: { leadership: 18, might: 55, intelligence: 70, politics: 83, charisma: 76 }, personality: 'LOYAL' as Personality },
    off_0823: { name: '방희', courtesy: '', stats: { leadership: 60, might: 38, intelligence: 68, politics: 74, charisma: 62 }, personality: 'CALM' as Personality },
    off_0287: { name: '국연', courtesy: '', stats: { leadership: 51, might: 19, intelligence: 71, politics: 86, charisma: 74 }, personality: 'LOYAL' as Personality },
    off_1006: { name: '오환군사', courtesy: '', stats: { leadership: 60, might: 51, intelligence: 70, politics: 53, charisma: 67 }, personality: 'AGGRESSIVE' as Personality },
    off_0225: { name: '우번', courtesy: '', stats: { leadership: 43, might: 47, intelligence: 86, politics: 81, charisma: 43 }, personality: 'LOYAL' as Personality },
    off_0592: { name: '단외', courtesy: '', stats: { leadership: 55, might: 48, intelligence: 54, politics: 73, charisma: 70 }, personality: 'CALM' as Personality },
    off_0694: { name: '정원', courtesy: '', stats: { leadership: 71, might: 76, intelligence: 37, politics: 42, charisma: 74 }, personality: 'RIGHTEOUS' as Personality },
    off_1086: { name: '남만군사', courtesy: '', stats: { leadership: 60, might: 48, intelligence: 70, politics: 56, charisma: 66 }, personality: 'AGGRESSIVE' as Personality },
    off_0844: { name: '모개', courtesy: '', stats: { leadership: 64, might: 39, intelligence: 60, politics: 78, charisma: 58 }, personality: 'RIGHTEOUS' as Personality },
    off_1009: { name: '오환한부', courtesy: '', stats: { leadership: 55, might: 81, intelligence: 57, politics: 48, charisma: 58 }, personality: 'AGGRESSIVE' as Personality },
    off_1066: { name: '산월군사', courtesy: '', stats: { leadership: 59, might: 52, intelligence: 70, politics: 55, charisma: 63 }, personality: 'AGGRESSIVE' as Personality },
    off_0286: { name: '오광', courtesy: '', stats: { leadership: 64, might: 75, intelligence: 45, politics: 53, charisma: 61 }, personality: 'AMBITIOUS' as Personality },
    off_0660: { name: '장만성', courtesy: '', stats: { leadership: 74, might: 81, intelligence: 47, politics: 39, charisma: 57 }, personality: 'AGGRESSIVE' as Personality },
    off_1046: { name: '강군사', courtesy: '', stats: { leadership: 58, might: 50, intelligence: 69, politics: 53, charisma: 68 }, personality: 'AGGRESSIVE' as Personality },
    off_0105: { name: '곽도', courtesy: '', stats: { leadership: 56, might: 50, intelligence: 82, politics: 68, charisma: 40 }, personality: 'CALM' as Personality },
    off_0332: { name: '사일', courtesy: '', stats: { leadership: 48, might: 36, intelligence: 67, politics: 75, charisma: 69 }, personality: 'LOYAL' as Personality },
    off_0410: { name: '장의거', courtesy: '', stats: { leadership: 71, might: 58, intelligence: 59, politics: 50, charisma: 57 }, personality: 'GREEDY' as Personality },
    off_0736: { name: '동탁', courtesy: '', stats: { leadership: 85, might: 85, intelligence: 69, politics: 19, charisma: 37 }, personality: 'AGGRESSIVE' as Personality },
    off_0816: { name: '변씨', courtesy: '', stats: { leadership: 35, might: 24, intelligence: 73, politics: 75, charisma: 88 }, personality: 'AMBITIOUS' as Personality },
    off_1049: { name: '강한부', courtesy: '', stats: { leadership: 53, might: 80, intelligence: 54, politics: 45, charisma: 63 }, personality: 'AGGRESSIVE' as Personality },
    off_1089: { name: '남만한부', courtesy: '', stats: { leadership: 55, might: 83, intelligence: 54, politics: 44, charisma: 58 }, personality: 'AGGRESSIVE' as Personality },
    off_0080: { name: '왕랑', courtesy: '', stats: { leadership: 47, might: 35, intelligence: 79, politics: 81, charisma: 50 }, personality: 'LOYAL' as Personality },
    off_0545: { name: '손관', courtesy: '', stats: { leadership: 71, might: 75, intelligence: 51, politics: 39, charisma: 56 }, personality: 'AGGRESSIVE' as Personality },
    off_1068: { name: '산월병', courtesy: '', stats: { leadership: 63, might: 72, intelligence: 51, politics: 41, charisma: 65 }, personality: 'AGGRESSIVE' as Personality },
    off_1069: { name: '산월한부', courtesy: '', stats: { leadership: 57, might: 78, intelligence: 55, politics: 43, charisma: 59 }, personality: 'AGGRESSIVE' as Personality },
    off_0211: { name: '허공', courtesy: '', stats: { leadership: 44, might: 65, intelligence: 63, politics: 63, charisma: 55 }, personality: 'AGGRESSIVE' as Personality },
    off_0907: { name: '이유', courtesy: '', stats: { leadership: 61, might: 26, intelligence: 93, politics: 75, charisma: 35 }, personality: 'CALM' as Personality },
    off_0327: { name: '채옹', courtesy: '', stats: { leadership: 22, might: 12, intelligence: 86, politics: 82, charisma: 87 }, personality: 'LOYAL' as Personality },
    off_1028: { name: '선비병', courtesy: '', stats: { leadership: 63, might: 73, intelligence: 48, politics: 42, charisma: 63 }, personality: 'AGGRESSIVE' as Personality },
    off_1048: { name: '강병', courtesy: '', stats: { leadership: 61, might: 73, intelligence: 48, politics: 42, charisma: 65 }, personality: 'AGGRESSIVE' as Personality },
    off_0724: { name: '도겸', courtesy: '', stats: { leadership: 51, might: 33, intelligence: 63, politics: 64, charisma: 77 }, personality: 'CALM' as Personality },
    off_1088: { name: '남만병', courtesy: '', stats: { leadership: 63, might: 71, intelligence: 48, politics: 43, charisma: 63 }, personality: 'AGGRESSIVE' as Personality },
    off_0196: { name: '위유', courtesy: '', stats: { leadership: 45, might: 28, intelligence: 73, politics: 73, charisma: 68 }, personality: 'LOYAL' as Personality },
    off_0973: { name: '능조', courtesy: '', stats: { leadership: 75, might: 81, intelligence: 42, politics: 35, charisma: 54 }, personality: 'AMBITIOUS' as Personality },
    off_0056: { name: '왕자복', courtesy: '', stats: { leadership: 54, might: 57, intelligence: 58, politics: 52, charisma: 65 }, personality: 'RIGHTEOUS' as Personality },
    off_0818: { name: '방열', courtesy: '', stats: { leadership: 68, might: 80, intelligence: 44, politics: 46, charisma: 48 }, personality: 'GREEDY' as Personality },
    off_0028: { name: '원환', courtesy: '', stats: { leadership: 30, might: 17, intelligence: 72, politics: 83, charisma: 83 }, personality: 'LOYAL' as Personality },
    off_1008: { name: '오환병', courtesy: '', stats: { leadership: 58, might: 69, intelligence: 52, politics: 39, charisma: 66 }, personality: 'AGGRESSIVE' as Personality },
    off_0493: { name: '선경', courtesy: '', stats: { leadership: 70, might: 66, intelligence: 44, politics: 48, charisma: 55 }, personality: 'GREEDY' as Personality },
    off_0656: { name: '장비', courtesy: '', stats: { leadership: 86, might: 98, intelligence: 33, politics: 22, charisma: 44 }, personality: 'AGGRESSIVE' as Personality },
    off_0958: { name: '유벽', courtesy: '', stats: { leadership: 70, might: 72, intelligence: 51, politics: 34, charisma: 56 }, personality: 'GREEDY' as Personality },
    off_0614: { name: '장훈', courtesy: '', stats: { leadership: 72, might: 67, intelligence: 41, politics: 40, charisma: 62 }, personality: 'AGGRESSIVE' as Personality },
    off_0628: { name: '장순', courtesy: '', stats: { leadership: 71, might: 77, intelligence: 56, politics: 43, charisma: 35 }, personality: 'AGGRESSIVE' as Personality },
    off_0474: { name: '성의', courtesy: '', stats: { leadership: 73, might: 71, intelligence: 40, politics: 45, charisma: 52 }, personality: 'GREEDY' as Personality },
    off_0233: { name: '엄강', courtesy: '', stats: { leadership: 68, might: 71, intelligence: 40, politics: 51, charisma: 50 }, personality: 'GREEDY' as Personality },
    off_0243: { name: '황완', courtesy: '', stats: { leadership: 40, might: 34, intelligence: 71, politics: 70, charisma: 65 }, personality: 'LOYAL' as Personality },
    off_0222: { name: '김상', courtesy: '', stats: { leadership: 47, might: 36, intelligence: 60, politics: 73, charisma: 63 }, personality: 'LOYAL' as Personality },
    off_0371: { name: '주창', courtesy: '', stats: { leadership: 66, might: 84, intelligence: 42, politics: 33, charisma: 54 }, personality: 'GREEDY' as Personality },
    off_0914: { name: '이부', courtesy: '', stats: { leadership: 31, might: 36, intelligence: 74, politics: 71, charisma: 67 }, personality: 'LOYAL' as Personality },
    off_0354: { name: '사무', courtesy: '', stats: { leadership: 45, might: 42, intelligence: 57, politics: 68, charisma: 66 }, personality: 'GREEDY' as Personality },
    off_0426: { name: '상림', courtesy: '', stats: { leadership: 36, might: 28, intelligence: 70, politics: 81, charisma: 63 }, personality: 'CALM' as Personality },
    off_0819: { name: '조아', courtesy: '', stats: { leadership: 44, might: 74, intelligence: 66, politics: 30, charisma: 64 }, personality: 'LOYAL' as Personality },
    off_0260: { name: '황조', courtesy: '', stats: { leadership: 76, might: 67, intelligence: 55, politics: 45, charisma: 32 }, personality: 'AGGRESSIVE' as Personality },
    off_0735: { name: '동소', courtesy: '', stats: { leadership: 24, might: 25, intelligence: 85, politics: 82, charisma: 59 }, personality: 'CALM' as Personality },
    off_1004: { name: '오환정병', courtesy: '', stats: { leadership: 81, might: 75, intelligence: 45, politics: 33, charisma: 41 }, personality: 'AGGRESSIVE' as Personality },
    off_1084: { name: '남만정병', courtesy: '', stats: { leadership: 82, might: 77, intelligence: 43, politics: 30, charisma: 43 }, personality: 'AGGRESSIVE' as Personality },
    off_0709: { name: '전위', courtesy: '', stats: { leadership: 57, might: 95, intelligence: 35, politics: 29, charisma: 58 }, personality: 'AMBITIOUS' as Personality },
    off_0335: { name: '시의', courtesy: '', stats: { leadership: 27, might: 11, intelligence: 81, politics: 80, charisma: 74 }, personality: 'RIGHTEOUS' as Personality },
    off_0409: { name: '창희', courtesy: '', stats: { leadership: 71, might: 70, intelligence: 44, politics: 35, charisma: 53 }, personality: 'AGGRESSIVE' as Personality },
    off_0598: { name: '장영', courtesy: '', stats: { leadership: 75, might: 72, intelligence: 40, politics: 35, charisma: 51 }, personality: 'GREEDY' as Personality },
    off_0401: { name: '순상', courtesy: '', stats: { leadership: 37, might: 8, intelligence: 69, politics: 76, charisma: 82 }, personality: 'LOYAL' as Personality },
    off_1044: { name: '강정병', courtesy: '', stats: { leadership: 83, might: 75, intelligence: 48, politics: 28, charisma: 38 }, personality: 'AGGRESSIVE' as Personality },
    off_0337: { name: '사흠', courtesy: '', stats: { leadership: 50, might: 38, intelligence: 55, politics: 68, charisma: 60 }, personality: 'LOYAL' as Personality },
    off_0357: { name: '사견', courtesy: '', stats: { leadership: 28, might: 34, intelligence: 66, politics: 72, charisma: 71 }, personality: 'LOYAL' as Personality },
    off_1064: { name: '산월정병', courtesy: '', stats: { leadership: 83, might: 75, intelligence: 43, politics: 31, charisma: 39 }, personality: 'AGGRESSIVE' as Personality },
    off_0185: { name: '간옹', courtesy: '', stats: { leadership: 22, might: 33, intelligence: 70, politics: 71, charisma: 74 }, personality: 'CALM' as Personality },
    off_0987: { name: '여포', courtesy: '', stats: { leadership: 95, might: 100, intelligence: 26, politics: 13, charisma: 36 }, personality: 'AGGRESSIVE' as Personality },
    off_1024: { name: '선비정병', courtesy: '', stats: { leadership: 78, might: 73, intelligence: 48, politics: 33, charisma: 38 }, personality: 'AGGRESSIVE' as Personality },
    off_0812: { name: '문추', courtesy: '', stats: { leadership: 85, might: 94, intelligence: 25, politics: 25, charisma: 40 }, personality: 'AGGRESSIVE' as Personality },
    off_0206: { name: '교유', courtesy: '', stats: { leadership: 65, might: 69, intelligence: 38, politics: 41, charisma: 55 }, personality: 'CALM' as Personality },
    off_0829: { name: '포도', courtesy: '', stats: { leadership: 57, might: 70, intelligence: 43, politics: 42, charisma: 56 }, personality: 'RIGHTEOUS' as Personality },
    off_0919: { name: '이풍', courtesy: '', stats: { leadership: 69, might: 74, intelligence: 50, politics: 22, charisma: 53 }, personality: 'AMBITIOUS' as Personality },
    off_0292: { name: '오국태', courtesy: '', stats: { leadership: 30, might: 21, intelligence: 67, politics: 74, charisma: 75 }, personality: 'RIGHTEOUS' as Personality },
    off_0693: { name: '정은', courtesy: '', stats: { leadership: 69, might: 73, intelligence: 40, politics: 35, charisma: 50 }, personality: 'AGGRESSIVE' as Personality },
    off_0098: { name: '악취', courtesy: '', stats: { leadership: 53, might: 66, intelligence: 58, politics: 39, charisma: 50 }, personality: 'GREEDY' as Personality },
    off_0399: { name: '순심', courtesy: '', stats: { leadership: 19, might: 25, intelligence: 78, politics: 77, charisma: 67 }, personality: 'LOYAL' as Personality },
    off_0572: { name: '손분', courtesy: '', stats: { leadership: 63, might: 67, intelligence: 40, politics: 47, charisma: 49 }, personality: 'AMBITIOUS' as Personality },
    off_0168: { name: '관정', courtesy: '', stats: { leadership: 36, might: 52, intelligence: 72, politics: 63, charisma: 41 }, personality: 'CALM' as Personality },
    off_0318: { name: '채염', courtesy: '', stats: { leadership: 12, might: 11, intelligence: 76, politics: 80, charisma: 85 }, personality: 'LOYAL' as Personality },
    off_1005: { name: '오환강병', courtesy: '', stats: { leadership: 75, might: 81, intelligence: 15, politics: 35, charisma: 58 }, personality: 'AGGRESSIVE' as Personality },
    off_0014: { name: '윤례', courtesy: '', stats: { leadership: 61, might: 68, intelligence: 47, politics: 44, charisma: 43 }, personality: 'AGGRESSIVE' as Personality },
    off_0762: { name: '파재', courtesy: '', stats: { leadership: 72, might: 74, intelligence: 52, politics: 25, charisma: 40 }, personality: 'AGGRESSIVE' as Personality },
    off_0334: { name: '사휘', courtesy: '', stats: { leadership: 69, might: 66, intelligence: 44, politics: 31, charisma: 52 }, personality: 'AGGRESSIVE' as Personality },
    off_1087: { name: '남만영병', courtesy: '', stats: { leadership: 78, might: 91, intelligence: 27, politics: 30, charisma: 36 }, personality: 'AGGRESSIVE' as Personality },
    off_0944: { name: '유선', courtesy: '', stats: { leadership: 37, might: 18, intelligence: 66, politics: 75, charisma: 65 }, personality: 'GREEDY' as Personality },
    off_1025: { name: '선비강병', courtesy: '', stats: { leadership: 75, might: 80, intelligence: 15, politics: 33, charisma: 58 }, personality: 'AGGRESSIVE' as Personality },
    off_1045: { name: '강강병', courtesy: '', stats: { leadership: 76, might: 80, intelligence: 13, politics: 37, charisma: 55 }, personality: 'AGGRESSIVE' as Personality },
    off_1065: { name: '산월강병', courtesy: '', stats: { leadership: 74, might: 79, intelligence: 18, politics: 33, charisma: 57 }, personality: 'AGGRESSIVE' as Personality },
    off_1085: { name: '남만강병', courtesy: '', stats: { leadership: 73, might: 80, intelligence: 17, politics: 37, charisma: 53 }, personality: 'AGGRESSIVE' as Personality },
    off_1027: { name: '선비영병', courtesy: '', stats: { leadership: 78, might: 90, intelligence: 27, politics: 29, charisma: 35 }, personality: 'AGGRESSIVE' as Personality },
    off_0129: { name: '하씨', courtesy: '', stats: { leadership: 32, might: 34, intelligence: 65, politics: 67, charisma: 60 }, personality: 'CALM' as Personality },
    off_0277: { name: '경무', courtesy: '', stats: { leadership: 32, might: 40, intelligence: 61, politics: 70, charisma: 55 }, personality: 'RIGHTEOUS' as Personality },
    off_0340: { name: '사지', courtesy: '', stats: { leadership: 63, might: 58, intelligence: 42, politics: 52, charisma: 43 }, personality: 'GREEDY' as Personality },
    off_0487: { name: '설례', courtesy: '', stats: { leadership: 63, might: 52, intelligence: 38, politics: 53, charisma: 52 }, personality: 'AMBITIOUS' as Personality },
    off_0042: { name: '왕윤', courtesy: '', stats: { leadership: 26, might: 6, intelligence: 67, politics: 80, charisma: 77 }, personality: 'CALM' as Personality },
    off_0156: { name: '한거자', courtesy: '', stats: { leadership: 51, might: 59, intelligence: 50, politics: 44, charisma: 52 }, personality: 'AGGRESSIVE' as Personality },
    off_0191: { name: '국의', courtesy: '', stats: { leadership: 82, might: 78, intelligence: 50, politics: 19, charisma: 27 }, personality: 'AGGRESSIVE' as Personality },
    off_0312: { name: '오부', courtesy: '', stats: { leadership: 42, might: 46, intelligence: 53, politics: 55, charisma: 60 }, personality: 'RIGHTEOUS' as Personality },
    off_0270: { name: '공주', courtesy: '', stats: { leadership: 26, might: 16, intelligence: 67, politics: 78, charisma: 68 }, personality: 'LOYAL' as Personality },
    off_0877: { name: '양표', courtesy: '', stats: { leadership: 22, might: 17, intelligence: 69, politics: 75, charisma: 72 }, personality: 'LOYAL' as Personality },
    off_0202: { name: '계옹', courtesy: '', stats: { leadership: 63, might: 52, intelligence: 41, politics: 40, charisma: 58 }, personality: 'GREEDY' as Personality },
    off_0008: { name: '음기', courtesy: '', stats: { leadership: 22, might: 27, intelligence: 64, politics: 75, charisma: 65 }, personality: 'CALM' as Personality },
    off_0192: { name: '희지재', courtesy: '', stats: { leadership: 33, might: 7, intelligence: 85, politics: 73, charisma: 55 }, personality: 'AMBITIOUS' as Personality },
    off_0674: { name: '진규', courtesy: '', stats: { leadership: 15, might: 5, intelligence: 82, politics: 77, charisma: 74 }, personality: 'CALM' as Personality },
    off_1007: { name: '오환영병', courtesy: '', stats: { leadership: 75, might: 91, intelligence: 23, politics: 29, charisma: 35 }, personality: 'AGGRESSIVE' as Personality },
    off_1047: { name: '강영병', courtesy: '', stats: { leadership: 73, might: 88, intelligence: 23, politics: 32, charisma: 36 }, personality: 'AGGRESSIVE' as Personality },
    off_0635: { name: '장승', courtesy: '', stats: { leadership: 23, might: 18, intelligence: 73, politics: 70, charisma: 67 }, personality: 'LOYAL' as Personality },
    off_1067: { name: '산월영병', courtesy: '', stats: { leadership: 75, might: 88, intelligence: 23, politics: 28, charisma: 37 }, personality: 'AGGRESSIVE' as Personality },
    off_0019: { name: '우미', courtesy: '', stats: { leadership: 71, might: 67, intelligence: 33, politics: 38, charisma: 41 }, personality: 'AGGRESSIVE' as Personality },
    off_0081: { name: '어부라', courtesy: '', stats: { leadership: 71, might: 68, intelligence: 22, politics: 38, charisma: 51 }, personality: 'AMBITIOUS' as Personality },
    off_0783: { name: '번능', courtesy: '', stats: { leadership: 69, might: 61, intelligence: 36, politics: 31, charisma: 53 }, personality: 'AGGRESSIVE' as Personality },
    off_0359: { name: '차주', courtesy: '', stats: { leadership: 49, might: 52, intelligence: 40, politics: 58, charisma: 50 }, personality: 'CALM' as Personality },
    off_0815: { name: '변희', courtesy: '', stats: { leadership: 56, might: 70, intelligence: 62, politics: 37, charisma: 24 }, personality: 'AGGRESSIVE' as Personality },
    off_1063: { name: '산월맹자', courtesy: '', stats: { leadership: 59, might: 87, intelligence: 23, politics: 28, charisma: 52 }, personality: 'AGGRESSIVE' as Personality },
    off_0148: { name: '환계', courtesy: '', stats: { leadership: 10, might: 25, intelligence: 67, politics: 78, charisma: 68 }, personality: 'CALM' as Personality },
    off_0193: { name: '위속', courtesy: '', stats: { leadership: 67, might: 78, intelligence: 31, politics: 32, charisma: 40 }, personality: 'GREEDY' as Personality },
    off_0280: { name: '공융', courtesy: '', stats: { leadership: 30, might: 5, intelligence: 72, politics: 76, charisma: 65 }, personality: 'LOYAL' as Personality },
    off_0763: { name: '마일제', courtesy: '', stats: { leadership: 43, might: 25, intelligence: 70, politics: 58, charisma: 52 }, personality: 'RIGHTEOUS' as Personality },
    off_0947: { name: '유대', courtesy: '', stats: { leadership: 53, might: 65, intelligence: 34, politics: 54, charisma: 42 }, personality: 'CALM' as Personality },
    off_1043: { name: '강맹자', courtesy: '', stats: { leadership: 63, might: 88, intelligence: 22, politics: 26, charisma: 49 }, personality: 'AGGRESSIVE' as Personality },
    off_0207: { name: '강단', courtesy: '', stats: { leadership: 60, might: 77, intelligence: 26, politics: 43, charisma: 41 }, personality: 'GREEDY' as Personality },
    off_0822: { name: '봉기', courtesy: '', stats: { leadership: 32, might: 21, intelligence: 84, politics: 70, charisma: 39 }, personality: 'CALM' as Personality },
    off_0160: { name: '한형', courtesy: '', stats: { leadership: 26, might: 18, intelligence: 60, politics: 70, charisma: 71 }, personality: 'LOYAL' as Personality },
    off_0167: { name: '한숭', courtesy: '', stats: { leadership: 25, might: 15, intelligence: 70, politics: 75, charisma: 60 }, personality: 'LOYAL' as Personality },
    off_0539: { name: '소유', courtesy: '', stats: { leadership: 51, might: 59, intelligence: 48, politics: 40, charisma: 47 }, personality: 'CALM' as Personality },
    off_0670: { name: '진기', courtesy: '', stats: { leadership: 58, might: 65, intelligence: 43, politics: 48, charisma: 31 }, personality: 'AMBITIOUS' as Personality },
    off_0798: { name: '무안국', courtesy: '', stats: { leadership: 68, might: 83, intelligence: 34, politics: 33, charisma: 27 }, personality: 'GREEDY' as Personality },
    off_1003: { name: '오환맹자', courtesy: '', stats: { leadership: 61, might: 88, intelligence: 20, politics: 23, charisma: 53 }, personality: 'AGGRESSIVE' as Personality },
    off_0065: { name: '구성', courtesy: '', stats: { leadership: 56, might: 68, intelligence: 38, politics: 29, charisma: 53 }, personality: 'AGGRESSIVE' as Personality },
    off_0184: { name: '한맹', courtesy: '', stats: { leadership: 55, might: 65, intelligence: 43, politics: 40, charisma: 41 }, personality: 'AGGRESSIVE' as Personality },
    off_0880: { name: '양봉', courtesy: '', stats: { leadership: 67, might: 65, intelligence: 34, politics: 20, charisma: 58 }, personality: 'AGGRESSIVE' as Personality },
    off_0285: { name: '오거', courtesy: '', stats: { leadership: 49, might: 62, intelligence: 26, politics: 51, charisma: 55 }, personality: 'GREEDY' as Personality },
    off_0469: { name: '수원진', courtesy: '', stats: { leadership: 53, might: 67, intelligence: 45, politics: 31, charisma: 47 }, personality: 'GREEDY' as Personality },
    off_0507: { name: '송헌', courtesy: '', stats: { leadership: 68, might: 77, intelligence: 37, politics: 28, charisma: 33 }, personality: 'AGGRESSIVE' as Personality },
    off_0970: { name: '양강', courtesy: '', stats: { leadership: 61, might: 69, intelligence: 42, politics: 22, charisma: 49 }, personality: 'GREEDY' as Personality },
    off_1083: { name: '남만맹자', courtesy: '', stats: { leadership: 59, might: 88, intelligence: 19, politics: 24, charisma: 53 }, personality: 'AGGRESSIVE' as Personality },
    off_0177: { name: '관통', courtesy: '', stats: { leadership: 64, might: 68, intelligence: 32, politics: 25, charisma: 53 }, personality: 'RIGHTEOUS' as Personality },
    off_0343: { name: '사손서', courtesy: '', stats: { leadership: 24, might: 13, intelligence: 65, politics: 73, charisma: 67 }, personality: 'LOYAL' as Personality },
    off_0688: { name: '진림', courtesy: '', stats: { leadership: 9, might: 9, intelligence: 74, politics: 78, charisma: 72 }, personality: 'CALM' as Personality },
    off_0331: { name: '좌령', courtesy: '', stats: { leadership: 47, might: 42, intelligence: 49, politics: 62, charisma: 41 }, personality: 'CALM' as Personality },
    off_0416: { name: '초촉', courtesy: '', stats: { leadership: 65, might: 72, intelligence: 33, politics: 32, charisma: 39 }, personality: 'AMBITIOUS' as Personality },
    off_0612: { name: '장거', courtesy: '', stats: { leadership: 63, might: 62, intelligence: 41, politics: 25, charisma: 50 }, personality: 'AGGRESSIVE' as Personality },
    off_1023: { name: '선비맹자', courtesy: '', stats: { leadership: 62, might: 86, intelligence: 19, politics: 24, charisma: 50 }, personality: 'AGGRESSIVE' as Personality },
    off_1062: { name: '산월장수', courtesy: '', stats: { leadership: 68, might: 77, intelligence: 34, politics: 16, charisma: 46 }, personality: 'AGGRESSIVE' as Personality },
    off_1042: { name: '강장수', courtesy: '', stats: { leadership: 63, might: 76, intelligence: 36, politics: 17, charisma: 48 }, personality: 'AGGRESSIVE' as Personality },
    off_0108: { name: '학맹', courtesy: '', stats: { leadership: 60, might: 66, intelligence: 41, politics: 34, charisma: 38 }, personality: 'AGGRESSIVE' as Personality },
    off_0874: { name: '양정', courtesy: '', stats: { leadership: 62, might: 60, intelligence: 46, politics: 33, charisma: 37 }, personality: 'CALM' as Personality },
    off_0927: { name: '유화', courtesy: '', stats: { leadership: 21, might: 16, intelligence: 59, politics: 68, charisma: 74 }, personality: 'LOYAL' as Personality },
    off_1002: { name: '오환장수', courtesy: '', stats: { leadership: 68, might: 73, intelligence: 34, politics: 17, charisma: 46 }, personality: 'AGGRESSIVE' as Personality },
    off_0091: { name: '화흠', courtesy: '', stats: { leadership: 25, might: 33, intelligence: 82, politics: 83, charisma: 14 }, personality: 'CALM' as Personality },
    off_0169: { name: '한섬', courtesy: '', stats: { leadership: 69, might: 66, intelligence: 35, politics: 18, charisma: 49 }, personality: 'AGGRESSIVE' as Personality },
    off_0687: { name: '진란', courtesy: '', stats: { leadership: 66, might: 69, intelligence: 41, politics: 24, charisma: 36 }, personality: 'AGGRESSIVE' as Personality },
    off_0103: { name: '곽석', courtesy: '', stats: { leadership: 58, might: 62, intelligence: 43, politics: 32, charisma: 40 }, personality: 'AGGRESSIVE' as Personality },
    off_0473: { name: '추단', courtesy: '', stats: { leadership: 61, might: 64, intelligence: 34, politics: 37, charisma: 39 }, personality: 'AMBITIOUS' as Personality },
    off_1082: { name: '남만장수', courtesy: '', stats: { leadership: 66, might: 74, intelligence: 37, politics: 13, charisma: 45 }, personality: 'AGGRESSIVE' as Personality },
    off_0032: { name: '원술', courtesy: '', stats: { leadership: 44, might: 65, intelligence: 68, politics: 15, charisma: 42 }, personality: 'CALM' as Personality },
    off_0782: { name: '번조', courtesy: '', stats: { leadership: 67, might: 74, intelligence: 31, politics: 24, charisma: 38 }, personality: 'AGGRESSIVE' as Personality },
    off_0882: { name: '양밀', courtesy: '', stats: { leadership: 45, might: 33, intelligence: 51, politics: 53, charisma: 50 }, personality: 'LOYAL' as Personality },
    off_0908: { name: '이숙', courtesy: '', stats: { leadership: 47, might: 67, intelligence: 60, politics: 30, charisma: 28 }, personality: 'CALM' as Personality },
    off_0395: { name: '순우경', courtesy: '', stats: { leadership: 74, might: 67, intelligence: 29, politics: 28, charisma: 33 }, personality: 'AGGRESSIVE' as Personality },
    off_0655: { name: '장범', courtesy: '', stats: { leadership: 10, might: 7, intelligence: 64, politics: 72, charisma: 78 }, personality: 'LOYAL' as Personality },
    off_0931: { name: '유의', courtesy: '', stats: { leadership: 62, might: 55, intelligence: 21, politics: 48, charisma: 45 }, personality: 'GREEDY' as Personality },
    off_0240: { name: '엄여', courtesy: '', stats: { leadership: 62, might: 78, intelligence: 48, politics: 19, charisma: 23 }, personality: 'AGGRESSIVE' as Personality },
    off_0667: { name: '진횡', courtesy: '', stats: { leadership: 63, might: 64, intelligence: 26, politics: 35, charisma: 42 }, personality: 'GREEDY' as Personality },
    off_0321: { name: '채씨', courtesy: '', stats: { leadership: 11, might: 22, intelligence: 70, politics: 58, charisma: 68 }, personality: 'CALM' as Personality },
    off_0627: { name: '장숙', courtesy: '', stats: { leadership: 13, might: 26, intelligence: 58, politics: 64, charisma: 68 }, personality: 'CALM' as Personality },
    off_0888: { name: '내민', courtesy: '', stats: { leadership: 38, might: 34, intelligence: 66, politics: 60, charisma: 31 }, personality: 'CALM' as Personality },
    off_0936: { name: '유씨', courtesy: '', stats: { leadership: 18, might: 17, intelligence: 67, politics: 59, charisma: 68 }, personality: 'AGGRESSIVE' as Personality },
    off_1022: { name: '선비장수', courtesy: '', stats: { leadership: 66, might: 73, intelligence: 33, politics: 14, charisma: 43 }, personality: 'AGGRESSIVE' as Personality },
    off_0524: { name: '송충', courtesy: '', stats: { leadership: 29, might: 30, intelligence: 64, politics: 53, charisma: 52 }, personality: 'LOYAL' as Personality },
    off_0784: { name: '범방', courtesy: '', stats: { leadership: 54, might: 58, intelligence: 38, politics: 33, charisma: 45 }, personality: 'GREEDY' as Personality },
    off_0519: { name: '조성', courtesy: '', stats: { leadership: 54, might: 74, intelligence: 38, politics: 27, charisma: 34 }, personality: 'GREEDY' as Personality },
    off_0813: { name: '문칙', courtesy: '', stats: { leadership: 59, might: 53, intelligence: 32, politics: 35, charisma: 47 }, personality: 'CALM' as Personality },
    off_0994: { name: '누규', courtesy: '', stats: { leadership: 52, might: 13, intelligence: 83, politics: 67, charisma: 11 }, personality: 'CALM' as Personality },
    off_0239: { name: '엄백호', courtesy: '', stats: { leadership: 67, might: 70, intelligence: 23, politics: 21, charisma: 43 }, personality: 'AGGRESSIVE' as Personality },
    off_0256: { name: '고승', courtesy: '', stats: { leadership: 67, might: 73, intelligence: 40, politics: 21, charisma: 23 }, personality: 'AGGRESSIVE' as Personality },
    off_0961: { name: '유모', courtesy: '', stats: { leadership: 51, might: 40, intelligence: 47, politics: 44, charisma: 42 }, personality: 'CALM' as Personality },
    off_0982: { name: '여공', courtesy: '', stats: { leadership: 51, might: 60, intelligence: 48, politics: 23, charisma: 42 }, personality: 'CALM' as Personality },
    off_0146: { name: '한윤', courtesy: '', stats: { leadership: 26, might: 29, intelligence: 64, politics: 54, charisma: 50 }, personality: 'CALM' as Personality },
    off_0375: { name: '주조', courtesy: '', stats: { leadership: 53, might: 68, intelligence: 29, politics: 26, charisma: 47 }, personality: 'AGGRESSIVE' as Personality },
    off_0214: { name: '허정', courtesy: '', stats: { leadership: 3, might: 5, intelligence: 67, politics: 79, charisma: 68 }, personality: 'CALM' as Personality },
    off_0861: { name: '양홍', courtesy: '', stats: { leadership: 23, might: 15, intelligence: 76, politics: 60, charisma: 48 }, personality: 'GREEDY' as Personality },
    off_0297: { name: '오습', courtesy: '', stats: { leadership: 53, might: 64, intelligence: 42, politics: 28, charisma: 32 }, personality: 'AMBITIOUS' as Personality },
    off_0150: { name: '한기', courtesy: '', stats: { leadership: 9, might: 6, intelligence: 62, politics: 75, charisma: 66 }, personality: 'LOYAL' as Personality },
    off_0217: { name: '허유', courtesy: '', stats: { leadership: 36, might: 21, intelligence: 81, politics: 56, charisma: 24 }, personality: 'CALM' as Personality },
    off_0746: { name: '등무', courtesy: '', stats: { leadership: 61, might: 76, intelligence: 29, politics: 17, charisma: 35 }, personality: 'AGGRESSIVE' as Personality },
    off_0853: { name: '유섭', courtesy: '', stats: { leadership: 62, might: 79, intelligence: 24, politics: 23, charisma: 30 }, personality: 'AGGRESSIVE' as Personality },
    off_0074: { name: '왕방', courtesy: '', stats: { leadership: 63, might: 68, intelligence: 28, politics: 22, charisma: 35 }, personality: 'AGGRESSIVE' as Personality },
    off_0922: { name: '이몽', courtesy: '', stats: { leadership: 67, might: 66, intelligence: 33, politics: 16, charisma: 34 }, personality: 'AGGRESSIVE' as Personality },
    off_0690: { name: '정원지', courtesy: '', stats: { leadership: 69, might: 74, intelligence: 18, politics: 25, charisma: 29 }, personality: 'AGGRESSIVE' as Personality },
    off_0366: { name: '주군', courtesy: '', stats: { leadership: 15, might: 18, intelligence: 67, politics: 52, charisma: 61 }, personality: 'LOYAL' as Personality },
    off_0018: { name: '우독', courtesy: '', stats: { leadership: 58, might: 72, intelligence: 44, politics: 10, charisma: 28 }, personality: 'AGGRESSIVE' as Personality },
    off_0885: { name: '뇌서', courtesy: '', stats: { leadership: 60, might: 63, intelligence: 34, politics: 24, charisma: 31 }, personality: 'AGGRESSIVE' as Personality },
    off_0208: { name: '공도', courtesy: '', stats: { leadership: 57, might: 70, intelligence: 23, politics: 22, charisma: 37 }, personality: 'AGGRESSIVE' as Personality },
    off_0786: { name: '반림', courtesy: '', stats: { leadership: 63, might: 76, intelligence: 28, politics: 17, charisma: 25 }, personality: 'GREEDY' as Personality },
    off_0807: { name: '부손', courtesy: '', stats: { leadership: 14, might: 10, intelligence: 69, politics: 71, charisma: 45 }, personality: 'LOYAL' as Personality },
    off_0223: { name: '김선', courtesy: '', stats: { leadership: 52, might: 68, intelligence: 13, politics: 29, charisma: 45 }, personality: 'GREEDY' as Personality },
    off_0754: { name: '배원소', courtesy: '', stats: { leadership: 49, might: 65, intelligence: 25, politics: 27, charisma: 41 }, personality: 'AGGRESSIVE' as Personality },
    off_0252: { name: '후씨', courtesy: '', stats: { leadership: 23, might: 22, intelligence: 47, politics: 54, charisma: 60 }, personality: 'LOYAL' as Personality },
    off_0470: { name: '수고', courtesy: '', stats: { leadership: 63, might: 71, intelligence: 38, politics: 7, charisma: 27 }, personality: 'AGGRESSIVE' as Personality },
    off_0330: { name: '착융', courtesy: '', stats: { leadership: 61, might: 68, intelligence: 40, politics: 21, charisma: 14 }, personality: 'AGGRESSIVE' as Personality },
    off_0527: { name: '조표', courtesy: '', stats: { leadership: 55, might: 69, intelligence: 32, politics: 21, charisma: 26 }, personality: 'CALM' as Personality },
    off_0865: { name: '양추', courtesy: '', stats: { leadership: 52, might: 65, intelligence: 42, politics: 20, charisma: 23 }, personality: 'AGGRESSIVE' as Personality },
    off_0620: { name: '조홍', courtesy: '', stats: { leadership: 66, might: 72, intelligence: 28, politics: 22, charisma: 13 }, personality: 'AGGRESSIVE' as Personality },
    off_0744: { name: '동부', courtesy: '', stats: { leadership: 5, might: 4, intelligence: 67, politics: 56, charisma: 68 }, personality: 'LOYAL' as Personality },
    off_0165: { name: '관승', courtesy: '', stats: { leadership: 63, might: 71, intelligence: 24, politics: 16, charisma: 25 }, personality: 'AGGRESSIVE' as Personality },
    off_0234: { name: '엄씨', courtesy: '', stats: { leadership: 16, might: 20, intelligence: 56, politics: 45, charisma: 62 }, personality: 'LOYAL' as Personality },
    off_0132: { name: '하진', courtesy: '', stats: { leadership: 40, might: 39, intelligence: 6, politics: 41, charisma: 71 }, personality: 'RIGHTEOUS' as Personality },
    off_0933: { name: '유훈', courtesy: '', stats: { leadership: 50, might: 63, intelligence: 35, politics: 16, charisma: 32 }, personality: 'AGGRESSIVE' as Personality },
    off_0326: { name: '최용', courtesy: '', stats: { leadership: 51, might: 63, intelligence: 31, politics: 19, charisma: 30 }, personality: 'GREEDY' as Personality },
    off_0894: { name: '이악', courtesy: '', stats: { leadership: 57, might: 70, intelligence: 36, politics: 13, charisma: 17 }, personality: 'AGGRESSIVE' as Personality },
    off_0471: { name: '추씨', courtesy: '', stats: { leadership: 4, might: 6, intelligence: 54, politics: 55, charisma: 72 }, personality: 'AGGRESSIVE' as Personality },
    off_0887: { name: '뇌박', courtesy: '', stats: { leadership: 63, might: 71, intelligence: 36, politics: 8, charisma: 13 }, personality: 'AGGRESSIVE' as Personality },
    off_0149: { name: '관해', courtesy: '', stats: { leadership: 70, might: 80, intelligence: 10, politics: 5, charisma: 25 }, personality: 'AGGRESSIVE' as Personality },
    off_0172: { name: '한단순', courtesy: '', stats: { leadership: 5, might: 3, intelligence: 66, politics: 52, charisma: 64 }, personality: 'LOYAL' as Personality },
    off_0568: { name: '손중', courtesy: '', stats: { leadership: 64, might: 71, intelligence: 36, politics: 6, charisma: 11 }, personality: 'AGGRESSIVE' as Personality },
    off_0237: { name: '엄정', courtesy: '', stats: { leadership: 50, might: 56, intelligence: 38, politics: 36, charisma: 7 }, personality: 'AGGRESSIVE' as Personality },
    off_0213: { name: '허자', courtesy: '', stats: { leadership: 5, might: 4, intelligence: 62, politics: 70, charisma: 45 }, personality: 'LOYAL' as Personality },
    off_0090: { name: '하의', courtesy: '', stats: { leadership: 55, might: 69, intelligence: 36, politics: 10, charisma: 15 }, personality: 'AGGRESSIVE' as Personality },
    off_0142: { name: '하묘', courtesy: '', stats: { leadership: 35, might: 46, intelligence: 34, politics: 37, charisma: 32 }, personality: 'CALM' as Personality },
    off_0835: { name: '목순', courtesy: '', stats: { leadership: 52, might: 77, intelligence: 11, politics: 21, charisma: 22 }, personality: 'GREEDY' as Personality },
    off_0097: { name: '곽사', courtesy: '', stats: { leadership: 65, might: 76, intelligence: 13, politics: 14, charisma: 13 }, personality: 'AGGRESSIVE' as Personality },
    off_0893: { name: '이각', courtesy: '', stats: { leadership: 69, might: 72, intelligence: 23, politics: 1, charisma: 16 }, personality: 'AGGRESSIVE' as Personality },
    off_0983: { name: '여광', courtesy: '', stats: { leadership: 56, might: 68, intelligence: 13, politics: 22, charisma: 21 }, personality: 'AGGRESSIVE' as Personality },
    off_0984: { name: '여상', courtesy: '', stats: { leadership: 55, might: 69, intelligence: 12, politics: 19, charisma: 25 }, personality: 'AGGRESSIVE' as Personality },
    off_0173: { name: '한충', courtesy: '', stats: { leadership: 64, might: 67, intelligence: 18, politics: 12, charisma: 18 }, personality: 'AGGRESSIVE' as Personality },
    off_0199: { name: '우보', courtesy: '', stats: { leadership: 41, might: 60, intelligence: 18, politics: 21, charisma: 37 }, personality: 'AGGRESSIVE' as Personality },
    off_0785: { name: '반봉', courtesy: '', stats: { leadership: 56, might: 77, intelligence: 4, politics: 14, charisma: 25 }, personality: 'AGGRESSIVE' as Personality },
    off_0182: { name: '한복', courtesy: '', stats: { leadership: 18, might: 3, intelligence: 27, politics: 63, charisma: 59 }, personality: 'LOYAL' as Personality },
    off_0743: { name: '동민', courtesy: '', stats: { leadership: 49, might: 60, intelligence: 24, politics: 10, charisma: 20 }, personality: 'AGGRESSIVE' as Personality },
    off_0025: { name: '원윤', courtesy: '', stats: { leadership: 24, might: 14, intelligence: 39, politics: 41, charisma: 43 }, personality: 'CALM' as Personality },
    off_0938: { name: '유장', courtesy: '', stats: { leadership: 18, might: 5, intelligence: 9, politics: 38, charisma: 70 }, personality: 'LOYAL' as Personality },
    off_0606: { name: '장개', courtesy: '', stats: { leadership: 35, might: 66, intelligence: 8, politics: 1, charisma: 10 }, personality: 'AGGRESSIVE' as Personality },
    off_0158: { name: '한현', courtesy: '', stats: { leadership: 22, might: 33, intelligence: 7, politics: 4, charisma: 1 }, personality: 'AGGRESSIVE' as Personality },
};


// 이름표에 없는 무장은 기본 스탯으로 생성
function buildOfficer(id: string, cityId: string, factionId: string | null, year: number, isLeader: boolean): Officer {
    const known = OFFICER_NAME_TABLE[id];
    const external = OFFICER_PROFILE_OVERRIDES[id] ?? OFFICER_FULL_PROFILES[id];
    const name = external?.name ?? known?.name ?? ESCORT_NAME_FIXES[id] ?? id;
    return {
        id,
        name,
        courtesyName: external?.courtesy ?? known?.courtesy ?? '',
        gender: 'M',
        birthYear: year - 30,
        deathYear: null,
        stats: {
            leadership: external?.stats.leadership ?? known?.stats.leadership ?? 60,
            might: external?.stats.might ?? known?.stats.might ?? 60,
            intelligence: external?.stats.intelligence ?? known?.stats.intelligence ?? 60,
            politics: external?.stats.politics ?? known?.stats.politics ?? 60,
            charisma: external?.stats.charisma ?? known?.stats.charisma ?? 60,
        },
        exp: { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 },
        rank: isLeader ? 9 : 0,
        status: (isLeader ? 'LORD' : 'OFFICER') as Officer['status'],
        factionId,
        cityId,
        personality: external?.personality ?? known?.personality ?? 'CALM',
        loyalty: isLeader ? 100 : 75 + (name.length % 20),
        ambition: 50,
        morality: 50,
        greed: 50,
        actionPoints: 100,
        maxActionPoints: 100,
        stamina: 100,
        maxStamina: 100,
        fame: isLeader ? 500 : 100,
        infamy: 0,
        merit: 0,
        salary: 50,
        skills: [],
        specialty: null,
        inventory: { weapons: [], mounts: [], treasures: [], books: [] },
        isFemaleBattleEnabled: false,
        hasActedThisTurn: false,
        hp: 100,
        maxHp: 100,
        injuries: 0,
        runtime: {
            isAlive: true,
            factionId: factionId,
            locationId: cityId,
            loyalty: isLeader ? 100 : 75,
        },
    };
}

// ============================================================
// 월드 빌더 — 시나리오 → Officer/Faction/City 배열
// ============================================================

export interface BuiltWorld {
    officers: Officer[];
    factions: Faction[];
    cities: City[];
    playerFactionId: string;
    /** 시나리오 난이도 (1~5) — GlobalState.difficulty로 주입 [X-난이도] */
    scenario?: { id: string; difficulty: number };
    /** 시나리오 시작 연월 — GlobalState.time 주입용 [300] (누락 시 이벤트 연도 조건이 전부 어긋남) */
    startYear: number;
    startMonth: number;
    /** 시나리오별 초기 인맥 — 관계망 시각화/AI social graph 초기화 [269][33] */
    relationships: RelationshipEdge[];
    /** 전략 요충지 — 정적 앵커 표(MAP_FEATURE_ANCHORS)를 소유권 있는 엔티티로 승격 */
    mapFeatures: MapFeature[];
}

/**
 * 시나리오별 세력 무장 명단 — 역사적 배치.
 * key: `${시나리오ID}:${세력내인덱스}` → 그 시나리오에서 해당 세력이 보유한 무장들.
 * 첫 번째는 반드시 군주. 나머지는 수도에 배치된 장수들.
 */
const SCENARIO_ROSTERS: Record<string, string[]> = {
    // 01 황건적의 난 (184년)
    '01:0': ['he_jin', 'huang_fu_song', 'cao_cao', 'sun_jian', 'yuan_shu', 'liu_bei', 'gongsun_zan', 'tao_qian', 'kong_rong', 'ma_teng'], // 하진 (토벌 제장)
    '01:1': ['zhang_jiao', 'zhang_bao_esc', 'zhang_liang_esc', 'zhang_yan', 'han_sui'], // 장각 (3형제 + 흑산적·서량 반란)

    // 02 반동탁 연합 (190년)
    '02:0': ['dong_zhuo', 'lv_bu', 'hua_xiong', 'li_jue_esc', 'guo_si_esc', 'zhang_liao'], // 동탁
    '02:1': ['yuan_shao', 'yan_liang', 'wen_chou', 'tian_feng', 'ju_shou', 'shen_pei', 'yuan_tan'], // 원소 (연합 맹주)
    '02:2': ['cao_cao', 'xiahou_dun', 'xiahou_yuan', 'cao_ren', 'xun_yu'],     // 조조
    '02:3': ['sun_jian', 'huang_gai', 'cheng_pu_esc', 'han_dang_esc'],          // 손견

    // 03 군웅할거 (194년)
    '03:0': ['cao_cao', 'xiahou_dun', 'xiahou_yuan', 'dian_wei', 'xun_yu', 'guo_jia', 'xun_you'], // 조조
    '03:1': ['liu_bei', 'guan_yu', 'zhang_fei', 'zhao_yun'],                    // 유비 (서주)
    '03:2': ['lv_bu', 'chen_gong', 'gao_shun', 'zhang_liao'],                     // 여포 (하비)
    '03:3': ['sun_ce', 'zhou_yu', 'taishi_ci', 'zhou_tai'],                     // 손책 (여강)
    '03:4': ['yuan_shu', 'ji_ling_esc'],                                        // 원술 (수춘)

    // 04 관도 대전 (200년)
    '04:0': ['cao_cao', 'zhang_liao', 'xu_chu', 'xun_you', 'guo_jia', 'xu_huang', 'zhang_he', 'xun_yu'], // 조조 (허창)
    '04:1': ['yuan_shao', 'yan_liang', 'wen_chou', 'tian_feng', 'ju_shou', 'yuan_tan', 'yuan_shang'], // 원소 (업)
    '04:2': ['sun_ce', 'zhou_yu', 'lu_su', 'gan_ning', 'taishi_ci'],             // 손씨 (오)
    '04:3': ['liu_bei', 'guan_yu', 'zhang_fei', 'zhao_yun'],                    // 유비 (여남)

    // 05 삼분천하 (207년)
    '05:0': ['cao_cao', 'zhang_liao', 'xu_chu', 'xiahou_dun', 'sima_yi', 'xu_huang', 'cao_ren', 'xun_yu', 'xiahou_yuan', 'zhang_he'], // 조조 (허창)
    '05:1': ['sun_quan', 'zhou_yu', 'lu_su', 'lu_meng', 'huang_gai', 'taishi_ci', 'gan_ning', 'cheng_pu_esc', 'han_dang_esc'], // 손권 (건업)
    '05:2': ['liu_bei', 'guan_yu', 'zhang_fei', 'zhao_yun', 'zhuge_liang'],     // 유비 (신야)

    // 06 출사표 (234년)
    '06:0': ['liu_bei', 'zhuge_liang', 'jiang_wei', 'wei_yan', 'zhao_yun', 'fa_zheng'], // 촉 (한중) — 대관례상 유비 생존 가정 (게임적 배려)
    '06:1': ['cao_cao', 'sima_yi', 'zhang_he', 'xu_huang', 'cao_ren', 'sima_zhao'], // 위 (낙양) — 게임적 배려로 조조 생존
    '06:2': ['sun_quan', 'lu_xun', 'lu_meng', 'gan_ning', 'sun_shangxiang', 'zhuge_ke'], // 오 (건업)

    // 05 유장 (익주) — 추가 세력은 SCENARIO_EXTRA_FACTIONS 참조
    '05:3': ['liu_zhang', 'fa_zheng', 'zhang_song'],

    // [08] 전장태세 — 네임드 무장 전원 동시 등장. 역사적 시기와 무관하게 모든 무장이
    // 살아 있다. 세력별로 고르게 나눠 준다(한 세력에 몰리면 도시당 수백 명).
    '08:0': ['off_0521', 'off_0147', 'off_0551', 'off_0703', 'off_0124', 'off_1000', 'off_0952', 'off_0659', 'off_0035', 'off_0826', 'off_1001', 'off_1041', 'off_1081', 'off_0114', 'off_0607', 'off_0247', 'off_1021', 'off_1061', 'off_0618', 'off_0671', 'off_0231', 'off_0092', 'off_0166', 'off_0271', 'off_0535', 'off_0464', 'off_0402', 'off_0387', 'off_0664', 'off_0266', 'off_0771', 'off_0830', 'off_0159', 'off_0985', 'off_0956', 'off_0393', 'off_0325'],
    '08:1': ['off_0279', 'off_0713', 'off_0390', 'off_0016', 'off_0512', 'off_0689', 'off_0281', 'off_0751', 'off_0085', 'off_0341', 'off_0176', 'off_0424', 'off_0925', 'off_0661', 'off_0030', 'off_0696', 'off_0748', 'off_0047', 'off_0567', 'off_1050', 'off_0258', 'off_0144', 'off_0525', 'off_0653', 'off_1030', 'off_0466', 'off_1090', 'off_0472', 'off_0269', 'off_0601', 'off_0932', 'off_0968', 'off_0062', 'off_0364', 'off_1010', 'off_1070', 'off_0219'],
    '08:2': ['off_0625', 'off_0538', 'off_0289', 'off_0367', 'off_0953', 'off_0084', 'off_0201', 'off_0666', 'off_0552', 'off_0024', 'off_0365', 'off_0963', 'off_0209', 'off_0710', 'off_0734', 'off_0261', 'off_0268', 'off_0441', 'off_0594', 'off_1026', 'off_0699', 'off_0793', 'off_1029', 'off_0638', 'off_0740', 'off_0543', 'off_0647', 'off_0021', 'off_0186', 'off_0317', 'off_0823', 'off_0287', 'off_1006', 'off_0225', 'off_0592', 'off_0694', 'off_1086'],
    '08:3': ['off_0844', 'off_1009', 'off_1066', 'off_0286', 'off_0660', 'off_1046', 'off_0105', 'off_0332', 'off_0410', 'off_0736', 'off_0816', 'off_1049', 'off_1089', 'off_0080', 'off_0545', 'off_1068', 'off_1069', 'off_0211', 'off_0907', 'off_0327', 'off_1028', 'off_1048', 'off_0724', 'off_1088', 'off_0196', 'off_0973', 'off_0056', 'off_0818', 'off_0028', 'off_1008', 'off_0493', 'off_0656', 'off_0958', 'off_0614', 'off_0628', 'off_0474', 'off_0233'],
    '08:4': ['off_0243', 'off_0222', 'off_0371', 'off_0914', 'off_0354', 'off_0426', 'off_0819', 'off_0260', 'off_0735', 'off_1004', 'off_1084', 'off_0709', 'off_0335', 'off_0409', 'off_0598', 'off_0401', 'off_1044', 'off_0337', 'off_0357', 'off_1064', 'off_0185', 'off_0987', 'off_1024', 'off_0812', 'off_0206', 'off_0829', 'off_0919', 'off_0292', 'off_0693', 'off_0098', 'off_0399', 'off_0572', 'off_0168', 'off_0318', 'off_1005', 'off_0014', 'off_0762'],
    '08:5': ['off_0334', 'off_1087', 'off_0944', 'off_1025', 'off_1045', 'off_1065', 'off_1085', 'off_1027', 'off_0129', 'off_0277', 'off_0340', 'off_0487', 'off_0042', 'off_0156', 'off_0191', 'off_0312', 'off_0270', 'off_0877', 'off_0202', 'off_0008', 'off_0192', 'off_0674', 'off_1007', 'off_1047', 'off_0635', 'off_1067', 'off_0019', 'off_0081', 'off_0783', 'off_0359', 'off_0815', 'off_1063', 'off_0148', 'off_0193', 'off_0280', 'off_0763', 'off_0947'],
    '08:6': ['off_1043', 'off_0207', 'off_0822', 'off_0160', 'off_0167', 'off_0539', 'off_0670', 'off_0798', 'off_1003', 'off_0065', 'off_0184', 'off_0880', 'off_0285', 'off_0469', 'off_0507', 'off_0970', 'off_1083', 'off_0177', 'off_0343', 'off_0688', 'off_0331', 'off_0416', 'off_0612', 'off_1023', 'off_1062', 'off_1042', 'off_0108', 'off_0874', 'off_0927', 'off_1002', 'off_0091', 'off_0169', 'off_0687', 'off_0103', 'off_0473', 'off_1082', 'off_0032'],
    '08:7': ['off_0782', 'off_0882', 'off_0908', 'off_0395', 'off_0655', 'off_0931', 'off_0240', 'off_0667', 'off_0321', 'off_0627', 'off_0888', 'off_0936', 'off_1022', 'off_0524', 'off_0784', 'off_0519', 'off_0813', 'off_0994', 'off_0239', 'off_0256', 'off_0961', 'off_0982', 'off_0146', 'off_0375', 'off_0214', 'off_0861', 'off_0297', 'off_0150', 'off_0217', 'off_0746', 'off_0853', 'off_0074', 'off_0922', 'off_0690', 'off_0366', 'off_0018', 'off_0885'],
    '08:8': ['off_0208', 'off_0786', 'off_0807', 'off_0223', 'off_0754', 'off_0252', 'off_0470', 'off_0330', 'off_0527', 'off_0865', 'off_0620', 'off_0744', 'off_0165', 'off_0234', 'off_0132', 'off_0933', 'off_0326', 'off_0894', 'off_0471', 'off_0887', 'off_0149', 'off_0172', 'off_0568', 'off_0237', 'off_0213', 'off_0090', 'off_0142', 'off_0835', 'off_0097', 'off_0893', 'off_0983', 'off_0984', 'off_0173', 'off_0199', 'off_0785', 'off_0182', 'off_0743', 'off_0025', 'off_0938', 'off_0606', 'off_0158'],
    // 07 삼국鼎峙 (220년) — 유비·손권 사후의 안정화 탐색 시나리오 [5][106-114]
    '07:0': ['cao_pi', 'sima_zhao', 'zhang_song', 'xiahou_dun', 'cao_ren'],       // 위 (낙양)
    '07:1': ['liu_shan', 'jiang_wei', 'zhuge_ke', 'fei_yi', 'fa_zheng'],          //촉 (청두)
    '07:2': ['sun_hao', 'lu_xun', 'zhang_zhao', 'gan_ning', 'sun_shangxiang'],   // 오 (부경)
};

/** 보조 무장들의 이름표 (이름표에 없으면 아이디 그대로 노출 방지) */
const ESCORT_NAME_FIXES: Record<string, string> = {
    zhang_bao_esc: '장보',
    zhang_liang_esc: '장량',
    li_jue_esc: '이각',
    guo_si_esc: '곽사',
    cheng_pu_esc: '정보',
    han_dang_esc: '한당',
    ji_ling_esc: '기령',
};

/**
 * 시나리오별 재야 무장 — 어느 세력에도 속하지 않은 채 특정 도시에 배치된다 [24].
 * 등용(Recruit) 시스템의 대상 풀이며, SCENARIO_ROSTERS와 ID가 절대 겹치지 않아야 한다.
 */
const SCENARIO_FREE_OFFICERS: Record<string, Array<{ id: string; city: string }>> = {
    // 184년: 관우·장비·조운은 아직 백수 (역사적 배치)
    '01': [{ id: 'guan_yu', city: '낙양' }, { id: 'zhang_fei', city: '낙양' }, { id: 'zhao_yun', city: '낙양' }, { id: 'dong_cheng', city: '낙양' }],
    // 190년: 유비 세력이 없으므로 관우·장비·조운 재야
    '02': [{ id: 'guan_yu', city: '업' }, { id: 'zhang_fei', city: '업' }, { id: 'zhao_yun', city: '업' }, { id: 'liu_bei', city: '업' }],
    // 194년: 황충·마초은 아직 각지에 재야
    '03': [{ id: 'huang_zhong', city: '수춘' }, { id: 'ma_chao', city: '연주' }, { id: 'zhang_he', city: '업' }],
    // 200년: 제갈량(미출사)·황충·방통 재야
    '04': [{ id: 'zhuge_liang', city: '여남' }, { id: 'huang_zhong', city: '여남' }, { id: 'pang_tong', city: '여남' }, { id: 'sima_yi', city: '업' }],
    // 207년: 황충·방통·위연 재야 (유비가 신야에서 영입한 시기) + 형주·남양의 재야 명사
    '05': [{ id: 'huang_zhong', city: '신야' }, { id: 'pang_tong', city: '신야' }, { id: 'wei_yan', city: '신야' }, { id: 'liu_biao', city: '강릉' }, { id: 'huang_zu', city: '강릉' }, { id: 'ma_chao', city: '남양' }, { id: 'zhang_yan', city: '하비' }],
    // 234년: 황충·마초·방통이 촉 휘하가 아닌 가정 (등용 풀 확보)
    '06': [{ id: 'huang_zhong', city: '한중' }, { id: 'ma_chao', city: '한중' }, { id: 'pang_tong', city: '한중' }],
};

const SCENARIO_EXTRA_FACTIONS: Record<string, ScenarioFaction[]> = {
    '05': [
        { name: '유장', capital: '성도', leader_id: 'liu_zhang', color: '#7a4a9a' },
    ],
};

const SCENARIO_EXTRA_CITIES: Record<string, ScenarioCityData[]> = {
    '01': [
        { name: '허창', faction_index: 0 },
        { name: '장안', faction_index: 0 },
        { name: '서주', faction_index: 0 },
        { name: '여강', faction_index: 0 },
        { name: '수춘', faction_index: 0 },
        { name: '오', faction_index: 0 },
        { name: '단양', faction_index: 0 },
        { name: '무창', faction_index: 0 },
        { name: '교지', faction_index: 0 },
        { name: '장사', faction_index: 0 },
        { name: '계양', faction_index: 0 },
        { name: '영릉', faction_index: 0 },
        { name: '성도', faction_index: 0 },
        { name: '한중', faction_index: 0 },
        { name: '남중', faction_index: 0 },
        { name: '광한', faction_index: 0 },
        { name: '상용', faction_index: 0 },
        { name: '파동', faction_index: 0 },
        { name: '건업', faction_index: 0 },
        { name: '신야', faction_index: 1 },
        { name: '남양', faction_index: 1 },
        { name: '양양', faction_index: 1 },
        { name: '강하', faction_index: 1 },
        { name: '연주', faction_index: 1 },
        { name: '하비', faction_index: 1 },
        { name: '여남', faction_index: 1 },
        { name: '진양', faction_index: 1 },
        { name: '무위', faction_index: 0 },
        { name: '천수', faction_index: 0 },
        { name: '홍농', faction_index: 0 },
        { name: '소패', faction_index: 0 },
        { name: '상당', faction_index: 0 },
        { name: '남피', faction_index: 0 },
        { name: '평원', faction_index: 0 },
        { name: '청주', faction_index: 0 },
        { name: '제남', faction_index: 0 },
        { name: '무도', faction_index: 0 },
        { name: '자동', faction_index: 0 },
        { name: '영안', faction_index: 0 },
        { name: '건녕', faction_index: 0 },
        { name: '초', faction_index: 0 },
        { name: '광릉', faction_index: 0 },
    ],
    '02': [
        { name: '허창', faction_index: 2 },
        { name: '수춘', faction_index: 2 },
        { name: '신야', faction_index: 1 },
        { name: '양양', faction_index: 1 },
        { name: '거록', faction_index: 1 },
        { name: '장안', faction_index: 0 },
        { name: '한중', faction_index: 0 },
        { name: '성도', faction_index: 0 },
        { name: '남중', faction_index: 0 },
        { name: '광한', faction_index: 0 },
        { name: '상용', faction_index: 0 },
        { name: '파동', faction_index: 0 },
        { name: '오', faction_index: 3 },
        { name: '건업', faction_index: 3 },
        { name: '단양', faction_index: 3 },
        { name: '무창', faction_index: 3 },
        { name: '교지', faction_index: 3 },
        { name: '강하', faction_index: 3 },
        { name: '계양', faction_index: 3 },
        { name: '영릉', faction_index: 3 },
        { name: '진양', faction_index: 1 },
        { name: '무위', faction_index: 0 },
        { name: '천수', faction_index: 0 },
        { name: '홍농', faction_index: 2 },
        { name: '소패', faction_index: 2 },
        { name: '상당', faction_index: 0 },
        { name: '남피', faction_index: 1 },
        { name: '평원', faction_index: 1 },
        { name: '청주', faction_index: 1 },
        { name: '제남', faction_index: 1 },
        { name: '무도', faction_index: 0 },
        { name: '자동', faction_index: 0 },
        { name: '영안', faction_index: 0 },
        { name: '건녕', faction_index: 0 },
        { name: '초', faction_index: 3 },
        { name: '광릉', faction_index: 3 },
    ],
    '03': [
        { name: '허창', faction_index: 0 },
        { name: '낙양', faction_index: 0 },
        { name: '장안', faction_index: 0 },
        { name: '진양', faction_index: 0 },
        { name: '신야', faction_index: 0 },
        { name: '남양', faction_index: 0 },
        { name: '성도', faction_index: 0 },
        { name: '한중', faction_index: 0 },
        { name: '남중', faction_index: 0 },
        { name: '광한', faction_index: 0 },
        { name: '상용', faction_index: 0 },
        { name: '파동', faction_index: 0 },
        { name: '양양', faction_index: 1 },
        { name: '강하', faction_index: 1 },
        { name: '건업', faction_index: 3 },
        { name: '단양', faction_index: 3 },
        { name: '무창', faction_index: 3 },
        { name: '교지', faction_index: 3 },
        { name: '장사', faction_index: 4 },
        { name: '계양', faction_index: 4 },
        { name: '영릉', faction_index: 4 },
        { name: '무위', faction_index: 0 },
        { name: '천수', faction_index: 0 },
        { name: '홍농', faction_index: 0 },
        { name: '소패', faction_index: 0 },
        { name: '상당', faction_index: 0 },
        { name: '남피', faction_index: 0 },
        { name: '평원', faction_index: 0 },
        { name: '청주', faction_index: 0 },
        { name: '제남', faction_index: 0 },
        { name: '무도', faction_index: 0 },
        { name: '자동', faction_index: 0 },
        { name: '영안', faction_index: 0 },
        { name: '건녕', faction_index: 0 },
        { name: '초', faction_index: 3 },
        { name: '광릉', faction_index: 3 },
    ],
    '04': [
        { name: '낙양', faction_index: 0 },
        { name: '장안', faction_index: 0 },
        { name: '서주', faction_index: 0 },
        { name: '수춘', faction_index: 0 },
        { name: '성도', faction_index: 0 },
        { name: '한중', faction_index: 0 },
        { name: '남중', faction_index: 0 },
        { name: '광한', faction_index: 0 },
        { name: '상용', faction_index: 0 },
        { name: '파동', faction_index: 0 },
        { name: '진양', faction_index: 1 },
        { name: '건업', faction_index: 2 },
        { name: '단양', faction_index: 2 },
        { name: '무창', faction_index: 2 },
        { name: '남양', faction_index: 3 },
        { name: '양양', faction_index: 3 },
        { name: '강하', faction_index: 3 },
        { name: '계양', faction_index: 2 },
        { name: '영릉', faction_index: 3 },
        { name: '교지', faction_index: 3 },
        { name: '무위', faction_index: 0 },
        { name: '천수', faction_index: 0 },
        { name: '홍농', faction_index: 0 },
        { name: '소패', faction_index: 0 },
        { name: '상당', faction_index: 0 },
        { name: '남피', faction_index: 0 },
        { name: '평원', faction_index: 0 },
        { name: '청주', faction_index: 0 },
        { name: '제남', faction_index: 0 },
        { name: '무도', faction_index: 0 },
        { name: '자동', faction_index: 0 },
        { name: '영안', faction_index: 0 },
        { name: '건녕', faction_index: 0 },
        { name: '초', faction_index: 2 },
        { name: '광릉', faction_index: 2 },
    ],
    '06': [
        { name: '남중', faction_index: 0 },
        { name: '광한', faction_index: 0 },
        { name: '상용', faction_index: 0 },
        { name: '파동', faction_index: 0 },
        { name: '연주', faction_index: 1 },
        { name: '하비', faction_index: 1 },
        { name: '업', faction_index: 1 },
        { name: '서주', faction_index: 1 },
        { name: '진양', faction_index: 1 },
        { name: '수춘', faction_index: 1 },
        { name: '여남', faction_index: 1 },
        { name: '남양', faction_index: 1 },
        { name: '신야', faction_index: 1 },
        { name: '여강', faction_index: 2 },
        { name: '단양', faction_index: 2 },
        { name: '무창', faction_index: 2 },
        { name: '교지', faction_index: 2 },
        { name: '강하', faction_index: 2 },
        { name: '장사', faction_index: 2 },
        { name: '계양', faction_index: 2 },
        { name: '영릉', faction_index: 2 },
        { name: '양양', faction_index: 2 },
        { name: '무위', faction_index: 1 },
        { name: '천수', faction_index: 1 },
        { name: '홍농', faction_index: 1 },
        { name: '소패', faction_index: 1 },
        { name: '상당', faction_index: 1 },
        { name: '남피', faction_index: 1 },
        { name: '평원', faction_index: 1 },
        { name: '청주', faction_index: 1 },
        { name: '제남', faction_index: 1 },
        { name: '무도', faction_index: 0 },
        { name: '자동', faction_index: 0 },
        { name: '영안', faction_index: 0 },
        { name: '건녕', faction_index: 0 },
        { name: '초', faction_index: 2 },
        { name: '광릉', faction_index: 2 },
    ],
    '07': [
        { name: '무위', faction_index: 0 },
        { name: '천수', faction_index: 0 },
        { name: '홍농', faction_index: 0 },
        { name: '소패', faction_index: 0 },
        { name: '상당', faction_index: 0 },
        { name: '남피', faction_index: 0 },
        { name: '평원', faction_index: 0 },
        { name: '청주', faction_index: 0 },
        { name: '제남', faction_index: 0 },
        { name: '무도', faction_index: 1 },
        { name: '자동', faction_index: 1 },
        { name: '영안', faction_index: 1 },
        { name: '건녕', faction_index: 1 },
        { name: '초', faction_index: 2 },
        { name: '광릉', faction_index: 2 },
    ],
    '05': [
        { name: '업', faction_index: 0 },
        { name: '낙양', faction_index: 0 },
        { name: '장안', faction_index: 0 },
        { name: '서주', faction_index: 0 },
        { name: '진양', faction_index: 0 },
        { name: '여강', faction_index: 0 },
        { name: '단양', faction_index: 1 },
        { name: '무창', faction_index: 1 },
        { name: '교지', faction_index: 1 },
        { name: '양양', faction_index: 2 },
        { name: '강하', faction_index: 2 },
        { name: '장사', faction_index: 2 },
        { name: '계양', faction_index: 2 },
        { name: '영릉', faction_index: 2 },
        { name: '한중', faction_index: 3 },
        { name: '남중', faction_index: 3 },
        { name: '광한', faction_index: 3 },
        { name: '상용', faction_index: 3 },
        { name: '파동', faction_index: 3 },
        { name: '무위', faction_index: 0 },
        { name: '천수', faction_index: 0 },
        { name: '무도', faction_index: 3 },
        { name: '자동', faction_index: 3 },
        { name: '영안', faction_index: 3 },
        { name: '건녕', faction_index: 3 },
        { name: '홍농', faction_index: 0 },
        { name: '청주', faction_index: 0 },
        { name: '제남', faction_index: 0 },
        { name: '소패', faction_index: 0 },
        { name: '초', faction_index: 1 },
        { name: '상당', faction_index: 0 },
        { name: '남피', faction_index: 0 },
        { name: '평원', faction_index: 0 },
        { name: '광릉', faction_index: 1 },
    ],
};

export function countWorldFactions(scenario: ScenarioData): number {
    return scenario.factions.length + (SCENARIO_EXTRA_FACTIONS[scenario.id]?.length ?? 0);
}

/** 주인공 무장 확정 — 고른 무장이 플레이 세력 소속이면 그대로, 아니면 군주로 폴백한다. */
export function resolveProtagonistId(world: BuiltWorld, officerId: string | null | undefined): string {
    const faction = world.factions.find(f => f.id === world.playerFactionId);
    if (officerId && faction?.officers.includes(officerId)) return officerId;
    return faction?.leaderId ?? faction?.officers[0] ?? '';
}

export function buildWorld(scenario: ScenarioData, playerFactionIndex: number): BuiltWorld {
    const { year } = parseStartDate(scenario.start_date);
    const officers: Officer[] = [];
    const factions: Faction[] = [];
    const cities: City[] = [];
    const usedCityIds = new Set<string>();

    const allFactions = [...scenario.factions, ...(SCENARIO_EXTRA_FACTIONS[scenario.id] ?? [])];
    const allSecondaryCities = [...(scenario.cities ?? []), ...(SCENARIO_EXTRA_CITIES[scenario.id] ?? [])];

    allFactions.forEach((sf, idx) => {
        const factionId = `fac_${idx}`;
        const leaderId = sf.leader_id;

        // 수도 도시 — 이름 충돌 시 뒤에 번호를 붙여 고유화
        let cityId = `city_${sf.capital}`;
        if (usedCityIds.has(cityId)) cityId = `${cityId}_${idx}`;
        usedCityIds.add(cityId);

        // 역사적 무장 명단 (없으면 군주+부장 3으로 폴백)
        const roster = SCENARIO_ROSTERS[`${scenario.id}:${idx}`]
            ?? [leaderId, `${leaderId}_gen1`, `${leaderId}_gen2`, `${leaderId}_gen3`];

        officers.push(buildOfficer(roster[0], cityId, factionId, year, true));
        for (let i = 1; i < roster.length; i++) {
            officers.push(buildOfficer(roster[i], cityId, factionId, year, false));
        }
        const officerIds = [...roster];

        factions.push({
            id: factionId,
            name: sf.name,
            leaderId,
            color: sf.color,
            capitalCityId: cityId,
            cities: [cityId],
            officers: officerIds,
            armies: [],
            gold: 1200 + idx * 100,
            food: 6000 + idx * 500,
            reputation: 50,
            policy: { recruitmentFocus: 3, militaryFocus: 3, economyFocus: 3, diplomacyFocus: 2, cultureFocus: 2 },
            diplomacy: {},
            isPlayerControlled: idx === playerFactionIndex,
            techLevel: 0,
        });

        const mapCoord = sf.map_x !== undefined && sf.map_y !== undefined
            ? { x: sf.map_x, y: sf.map_y }
            : CITY_MAP_COORDS[sf.capital] ?? { x: 0.3 + (idx % 4) * 0.15, y: 0.3 + Math.floor(idx / 4) * 0.25 };
        // [수정] 앵커가 없으면 전술 좌표를 그대로 쓰면 안 된다.
        // 두 표는 스케일이 다르다(예: 낙양 전술 0.55,0.34 / 이미지 0.39,0.40).
        // 조용히 엉뚱한 자리에 그려지므로 개발 중에 눈에 띄게 경고한다.
        const imageCoord = CITY_IMAGE_ANCHORS[sf.capital] ?? mapCoord;
        if (!CITY_IMAGE_ANCHORS[sf.capital]) {
            console.warn(`[scenario] '${sf.capital}' 에 이미지 앵커가 없다 — 전술 좌표로 그린다 (${mapCoord.x}, ${mapCoord.y})`);
        }
        const cityProfile = sf.city_profile ?? {};
        const population = cityProfile.population ?? 40000 + idx * 5000;
        // [결함 수정] profile.development 은 이제 "개발도 0~100" 이 아니라 병력 수다.
        // 옛 값(30~100) 을 그대로 넣으면 전 도시가 "병력 700" 으로 평준화된다.
        const defense = cityProfile.defense ?? 45 + (idx % 3) * 10;
        const development = cityProfile.development ?? initialTroops(population, true, defense);
        const commerce = cityProfile.commerce ?? 40 + (idx % 3) * 8;
        const farming = cityProfile.farming ?? 42 + (idx % 4) * 6;
        const technology = cityProfile.technology ?? 28 + (idx % 3) * 7;
        const publicOrder = cityProfile.public_order ?? 60 + (idx % 2) * 8;

        cities.push({
            id: cityId,
            name: sf.capital,
            hexCoord: { q: Math.round(mapCoord.x * 8) - 4, r: Math.round(mapCoord.y * 8) - 4 },
            mapX: mapCoord.x,
            mapY: mapCoord.y,
            mapImageX: imageCoord.x,
            mapImageY: imageCoord.y,
            mapIconType: 'CAPITAL',
            population,
            defense,
            maxDefense: CITY_MAX_DEFENSE,
            goldIncome: cityProfile.gold_income ?? 110 + idx * 10,
            foodIncome: cityProfile.food_income ?? 280 + idx * 15,
            funds: cityProfile.funds ?? 600 + idx * 80,
            facilities: [],
            officerIds,
            ownerId: factionId,
            isCapital: true,
            development,
            developmentStats: {
                commerce, maxCommerce: 100,
                farming, maxFarming: 100,
                technology, maxTechnology: 100,
                publicOrder, maxPublicOrder: 100,
            },
            loyalty: cityProfile.loyalty ?? 78,
            danger: cityProfile.danger ?? 12,
            weather: 'SUNNY',
        });
    });

    // 이차 도시 — 수도 외 도시를 정규화된 월드에 추가 [5][49]
    for (const [cityIndex, cityData] of allSecondaryCities.entries()) {
        const faction = factions[cityData.faction_index];
        if (!faction) continue; // 잘못된 세력 인덱스는 fail-safe로 건너뛴다.
        let cityId = `city_${cityData.name}`;
        if (usedCityIds.has(cityId)) cityId = `${cityId}_${cityIndex}`;
        usedCityIds.add(cityId);
        const mapCoord = cityData.map_x !== undefined && cityData.map_y !== undefined
            ? { x: cityData.map_x, y: cityData.map_y }
            : CITY_MAP_COORDS[cityData.name] ?? { x: 0.4 + (cityIndex % 3) * 0.12, y: 0.45 + Math.floor(cityIndex / 3) * 0.1 };
        // 수도와 같은 이유로 앵커 누락을 조용히 넘기지 않는다.
        const imageCoord = CITY_IMAGE_ANCHORS[cityData.name] ?? mapCoord;
        if (!CITY_IMAGE_ANCHORS[cityData.name]) {
            console.warn(`[scenario] 2차도시 '${cityData.name}' 에 이미지 앵커가 없다 — 전술 좌표로 그린다 (${mapCoord.x}, ${mapCoord.y})`);
        }
        const profile = cityData.profile ?? {};
        // [결함 수정] 수도와 같은 이유로 0~100 개발도를 병력으로 쓰지 않는다.
        const population = profile.population ?? 36000 + cityIndex * 4500;
        // 초기 방어력은 인덱스에 비례해 오르므로 상한으로 자른다 — 상한을 넘으면
        // 보전(Math.min(maxDefense, ...))이 방어도를 떨어뜨리는 역효과가 난다.
        const defense = Math.min(
            CITY_MAX_DEFENSE,
            profile.defense ?? 35 + cityIndex * 5,
        );
        const development = profile.development ?? initialTroops(population, false, defense);
        cities.push({
            id: cityId,
            name: cityData.name,
            hexCoord: { q: Math.round(mapCoord.x * 8) - 4, r: Math.round(mapCoord.y * 8) - 4 },
            mapX: mapCoord.x,
            mapY: mapCoord.y,
            mapImageX: imageCoord.x,
            mapImageY: imageCoord.y,
            mapIconType: 'CITY',
            population,
            defense,
            maxDefense: CITY_MAX_DEFENSE,
            goldIncome: profile.gold_income ?? 85 + cityIndex * 8,
            foodIncome: profile.food_income ?? 220 + cityIndex * 15,
            funds: profile.funds ?? 420 + cityIndex * 70,
            facilities: [],
            officerIds: [],
            ownerId: faction.id,
            isCapital: false,
            development,
            developmentStats: {
                commerce: profile.commerce ?? 35 + cityIndex * 5, maxCommerce: 100,
                farming: profile.farming ?? 38 + cityIndex * 4, maxFarming: 100,
                technology: profile.technology ?? 25 + cityIndex * 5, maxTechnology: 100,
                publicOrder: profile.public_order ?? 55 + cityIndex * 3, maxPublicOrder: 100,
            },
            loyalty: profile.loyalty ?? 68 + cityIndex * 2,
            danger: profile.danger ?? 16 + cityIndex * 3,
            weather: 'SUNNY',
        });
        faction.cities.push(cityId);
    }

    // (역사적 무장은 SCENARIO_ROSTERS로 배치되므로 추가 편성 불필요)
    const companionMap: Record<string, string[]> = {};

    for (const [leaderId, companions] of Object.entries(companionMap)) {
        const leader = officers.find(o => o.id === leaderId);
        if (!leader) continue;
        const faction = factions.find(f => f.id === leader.factionId);
        const city = cities.find(c => c.id === leader.cityId);
        const factionIdOfLeader = leader.factionId ?? '';
        const cityIdOfLeader = leader.cityId ?? '';
        for (const compId of companions) {
            if (officers.some(o => o.id === compId)) continue;
            officers.push(buildOfficer(compId, cityIdOfLeader, factionIdOfLeader, year, false));
            faction?.officers.push(compId);
            city?.officerIds.push(compId);
        }
    }

    // 재야 무장 배치 — 등용 풀 [24]
    for (const fo of SCENARIO_FREE_OFFICERS[scenario.id] ?? []) {
        if (officers.some(o => o.id === fo.id)) continue; // 이중 배치 방지
        const targetCity = cities.find(c => c.name === fo.city) ?? cities[0];
        const freeOfficer = buildOfficer(fo.id, targetCity.id, null, year, false);
        freeOfficer.status = OfficerStatus.FREE;
        freeOfficer.runtime.factionId = null;
        officers.push(freeOfficer);
    }

    const validOfficerIds = new Set(officers.map(officer => officer.id));
    return {
        officers,
        factions,
        cities,
        playerFactionId: `fac_${playerFactionIndex}`,
        scenario: { id: scenario.id, difficulty: scenario.difficulty },
        startYear: year,
        startMonth: parseStartDate(scenario.start_date).month,
        relationships: getScenarioRelationships(scenario.id, validOfficerIds),
        mapFeatures: buildMapFeatures(),
    };
}
