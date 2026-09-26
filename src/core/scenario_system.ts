/**
 * 시나리오 시스템 — 로더 + 월드 빌더
 *
 * src/data/scenarios/index.json의 시나리오 목록을 불러와 선택 화면에 제공하고,
 * 선택된 시나리오를 GameStore에 넣을 Officer/Faction/City 배열로 변환한다.
 * 부분 [9] 시나리오 선택, [114] 시나리오 데이터 로딩
 */

import type { Officer, Faction, City, Personality, OfficerStats, RelationshipEdge } from './types.js';
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
};

/**
 * [지도][1:1] 비트맵 위 도시 아이콘 중심 좌표 (0~1 정규화).
 *
 * assets/map-china-4096.webp 의 실제 픽셀 좌표를 4096으로 나눈 값이다.
 * scripts/generate_map.py 가 같은 위도경도 표에서 이미지와 이 표를 함께 만든다.
 * 전술 좌표(mapX/mapY)와 섞지 않는다 — 전투 격자 좌표는 별도다.
 */
export const CITY_IMAGE_ANCHORS: Record<string, { x: number; y: number }> = {
    '장안': { x: 0.3044, y: 0.4072 },
    '낙양': { x: 0.3904, y: 0.3992 },
    '허창': { x: 0.4246, y: 0.4160 },
    '업': { x: 0.4434, y: 0.2959 },
    '진양': { x: 0.3928, y: 0.3064 },
    '한중': { x: 0.2576, y: 0.4436 },
    '성도': { x: 0.1853, y: 0.5125 },
    '건업': { x: 0.5454, y: 0.4722 },
    '강릉': { x: 0.3840, y: 0.5215 },
    '남양': { x: 0.3923, y: 0.4453 },
    '여남': { x: 0.4370, y: 0.4460 },
    '서주': { x: 0.5085, y: 0.4111 },
    '양양': { x: 0.3823, y: 0.4736 },
    '신야': { x: 0.3879, y: 0.4590 },
    '장사': { x: 0.4023, y: 0.5815 },
    '계양': { x: 0.4861, y: 0.7151 },
    '남중': { x: 0.1523, y: 0.6726 },
    '광한': { x: 0.1907, y: 0.5027 },
    '단양': { x: 0.5610, y: 0.4739 },
    '오': { x: 0.5891, y: 0.4939 },
    '상용': { x: 0.3477, y: 0.4883 },
    '무창': { x: 0.4358, y: 0.5142 },
    '강하': { x: 0.4331, y: 0.5210 },
    '파동': { x: 0.3403, y: 0.5012 },
    '영릉': { x: 0.3696, y: 0.6338 },
    '교지': { x: 0.2290, y: 0.7871 },
    '평양': { x: 0.7158, y: 0.2732 },
    '선안': { x: 0.6531, y: 0.2129 },
    '지안': { x: 0.7263, y: 0.2136 },
    '낙랑': { x: 0.7141, y: 0.2886 },
    '북평': { x: 0.4871, y: 0.2483 },
    '사비': { x: 0.7554, y: 0.3499 },
    '한산': { x: 0.7336, y: 0.3369 },
    '웅진': { x: 0.7485, y: 0.3428 },
    '경주': { x: 0.8003, y: 0.3640 },
    '대야성': { x: 0.7141, y: 0.2998 },
    '가락': { x: 0.7827, y: 0.3740 },
    '안동': { x: 0.7883, y: 0.3435 },
    '야마토': { x: 0.9546, y: 0.3975 },
    '구주': { x: 0.8291, y: 0.4287 },
    '오키나와': { x: 0.7627, y: 0.6392 },
    '대만': { x: 0.6130, y: 0.6729 },
};


/**
 * [지도][1:1] 전략 관문·전장·항구 앵커 (0~1 정규화).
 *
 * assets/map-china-4096.webp 와 같은 위도경도 표에서 나온 실제 픽셀 좌표다.
 * scripts/generate_map.py 가 지형 이미지와 이 표를 함께 만든다.
 */
export const MAP_FEATURE_ANCHORS: Record<string, { x: number; y: number; kind: 'PASS' | 'BATTLEFIELD' | 'PORT' }> = {
    '호로관': { x: 0.3330, y: 0.3569, kind: 'PASS' },
    '함곡관': { x: 0.3523, y: 0.4021, kind: 'PASS' },
    '양관': { x: 0.0454, y: 0.2478, kind: 'PASS' },
    '정관': { x: 0.4331, y: 0.2998, kind: 'PASS' },
    '산관': { x: 0.2839, y: 0.4197, kind: 'PASS' },
    '진관': { x: 0.2253, y: 0.4683, kind: 'PASS' },  // 데이터셋 표기 검문관
    '대방곡': { x: 0.2546, y: 0.4084, kind: 'PASS' },
    '적벽': { x: 0.4253, y: 0.5391, kind: 'BATTLEFIELD' },
    '한강': { x: 0.4331, y: 0.5198, kind: 'PORT' },  // 데이터셋 표기 강하수운
    '창오': { x: 0.3623, y: 0.7166, kind: 'PASS' },
    '한중협곡': { x: 0.2546, y: 0.4426, kind: 'PASS' },  // 데이터셋 표기 한중협
};


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

/** 외부 관계 데이터의 잘못된 엣지를 걸러내는 fail-safe 검증기 [269][301] */
export function getScenarioRelationships(scenarioId: string, validOfficerIds: ReadonlySet<string>): RelationshipEdge[] {
    if (RELATIONSHIP_FILE.version !== 1 || !Array.isArray(RELATIONSHIP_FILE.scenarios?.[scenarioId])) return [];
    const seen = new Set<string>();
    return RELATIONSHIP_FILE.scenarios[scenarioId].filter((edge): edge is RelationshipEdge => {
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
};

// 이름표에 없는 무장은 기본 스탯으로 생성
function buildOfficer(id: string, cityId: string, factionId: string | null, year: number, isLeader: boolean): Officer {
    const known = OFFICER_NAME_TABLE[id];
    const external = OFFICER_PROFILE_OVERRIDES[id];
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
}

/**
 * 시나리오별 세력 무장 명단 — 역사적 배치.
 * key: `${시나리오ID}:${세력내인덱스}` → 그 시나리오에서 해당 세력이 보유한 무장들.
 * 첫 번째는 반드시 군주. 나머지는 수도에 배치된 장수들.
 */
const SCENARIO_ROSTERS: Record<string, string[]> = {
    // 01 황건적의 난 (184년)
    '01:0': ['he_jin', 'huang_fu_song', 'cao_cao', 'sun_jian', 'yuan_shu'],     // 하진 (황보숭·조조·손견·원술은 그 휘하)
    '01:1': ['zhang_jiao', 'zhang_bao_esc', 'zhang_liang_esc'],                  // 장각 (3형제)

    // 02 반동탁 연합 (190년)
    '02:0': ['dong_zhuo', 'lv_bu', 'hua_xiong', 'li_jue_esc', 'guo_si_esc'],    // 동탁
    '02:1': ['yuan_shao', 'yan_liang', 'wen_chou', 'tian_feng', 'ju_shou', 'shen_pei'], // 원소 (연합 맹주)
    '02:2': ['cao_cao', 'xiahou_dun', 'xiahou_yuan', 'cao_ren', 'xun_yu'],     // 조조
    '02:3': ['sun_jian', 'huang_gai', 'cheng_pu_esc', 'han_dang_esc'],          // 손견

    // 03 군웅할거 (194년)
    '03:0': ['cao_cao', 'xiahou_dun', 'xiahou_yuan', 'dian_wei', 'xun_yu', 'guo_jia'], // 조조
    '03:1': ['liu_bei', 'guan_yu', 'zhang_fei', 'zhao_yun'],                    // 유비 (서주)
    '03:2': ['lv_bu', 'chen_gong', 'gao_shun'],                                 // 여포 (하비)
    '03:3': ['sun_ce', 'zhou_yu', 'taishi_ci', 'zhou_tai'],                     // 손책 (여강)
    '03:4': ['yuan_shu', 'ji_ling_esc'],                                        // 원술 (수춘)

    // 04 관도 대전 (200년)
    '04:0': ['cao_cao', 'zhang_liao', 'xu_chu', 'xun_you', 'guo_jia', 'xu_huang', 'zhang_he'], // 조조 (허창)
    '04:1': ['yuan_shao', 'yan_liang', 'wen_chou', 'tian_feng', 'ju_shou', 'yuan_tan', 'yuan_shang'], // 원소 (업)
    '04:2': ['sun_ce', 'zhou_yu', 'lu_su', 'gan_ning'],                         // 손씨 (오)
    '04:3': ['liu_bei', 'guan_yu', 'zhang_fei', 'zhao_yun'],                    // 유비 (여남)

    // 05 삼분천하 (207년)
    '05:0': ['cao_cao', 'zhang_liao', 'xu_chu', 'xiahou_dun', 'sima_yi', 'xu_huang', 'cao_ren'], // 조조 (허창)
    '05:1': ['sun_quan', 'zhou_yu', 'lu_su', 'lu_meng', 'huang_gai', 'taishi_ci'], // 손권 (건업)
    '05:2': ['liu_bei', 'guan_yu', 'zhang_fei', 'zhao_yun', 'zhuge_liang'],     // 유비 (신야)

    // 06 출사표 (234년)
    '06:0': ['liu_bei', 'zhuge_liang', 'jiang_wei', 'wei_yan', 'zhao_yun', 'fa_zheng'], // 촉 (한중) — 대관례상 유비 생존 가정 (게임적 배려)
    '06:1': ['cao_cao', 'sima_yi', 'zhang_he', 'xu_huang', 'cao_ren'],          // 위 (낙양) — 게임적 배려로 조조 생존
    '06:2': ['sun_quan', 'lu_xun', 'lu_meng', 'gan_ning', 'sun_shangxiang'],    // 오 (건업)

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
    '01': [{ id: 'guan_yu', city: '낙양' }, { id: 'zhang_fei', city: '낙양' }, { id: 'zhao_yun', city: '낙양' }],
    // 190년: 유비 세력이 없으므로 관우·장비·조운 재야
    '02': [{ id: 'guan_yu', city: '업' }, { id: 'zhang_fei', city: '업' }, { id: 'zhao_yun', city: '업' }],
    // 194년: 황충·마초은 아직 각지에 재야
    '03': [{ id: 'huang_zhong', city: '수춘' }, { id: 'ma_chao', city: '연주' }],
    // 200년: 제갈량(미출사)·황충·방통 재야
    '04': [{ id: 'zhuge_liang', city: '여남' }, { id: 'huang_zhong', city: '여남' }, { id: 'pang_tong', city: '여남' }],
    // 207년: 황충·방통·위연 재야 (유비가 신야에서 영입한 시기)
    '05': [{ id: 'huang_zhong', city: '신야' }, { id: 'pang_tong', city: '신야' }, { id: 'wei_yan', city: '신야' }],
    // 234년: 황충·마초·방통이 촉 휘하가 아닌 가정 (등용 풀 확보)
    '06': [{ id: 'huang_zhong', city: '한중' }, { id: 'ma_chao', city: '한중' }, { id: 'pang_tong', city: '한중' }],
};

export function buildWorld(scenario: ScenarioData, playerFactionIndex: number): BuiltWorld {
    const { year } = parseStartDate(scenario.start_date);
    const officers: Officer[] = [];
    const factions: Faction[] = [];
    const cities: City[] = [];
    const usedCityIds = new Set<string>();

    scenario.factions.forEach((sf, idx) => {
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
        const imageCoord = CITY_IMAGE_ANCHORS[sf.capital] ?? mapCoord;
        const cityProfile = sf.city_profile ?? {};
        const population = cityProfile.population ?? 40000 + idx * 5000;
        const development = cityProfile.development ?? 45 + (idx % 4) * 5;
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
            defense: cityProfile.defense ?? 45 + (idx % 3) * 10,
            maxDefense: 100,
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
    for (const [cityIndex, cityData] of (scenario.cities ?? []).entries()) {
        const faction = factions[cityData.faction_index];
        if (!faction) continue; // 잘못된 세력 인덱스는 fail-safe로 건너뛴다.
        let cityId = `city_${cityData.name}`;
        if (usedCityIds.has(cityId)) cityId = `${cityId}_${cityIndex}`;
        usedCityIds.add(cityId);
        const mapCoord = cityData.map_x !== undefined && cityData.map_y !== undefined
            ? { x: cityData.map_x, y: cityData.map_y }
            : CITY_MAP_COORDS[cityData.name] ?? { x: 0.4 + (cityIndex % 3) * 0.12, y: 0.45 + Math.floor(cityIndex / 3) * 0.1 };
        const imageCoord = CITY_IMAGE_ANCHORS[cityData.name] ?? mapCoord;
        const profile = cityData.profile ?? {};
        const development = profile.development ?? 38 + cityIndex * 4;
        cities.push({
            id: cityId,
            name: cityData.name,
            hexCoord: { q: Math.round(mapCoord.x * 8) - 4, r: Math.round(mapCoord.y * 8) - 4 },
            mapX: mapCoord.x,
            mapY: mapCoord.y,
            mapImageX: imageCoord.x,
            mapImageY: imageCoord.y,
            mapIconType: 'CITY',
            population: profile.population ?? 36000 + cityIndex * 4500,
            defense: profile.defense ?? 35 + cityIndex * 5,
            maxDefense: 100,
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
    };
}
