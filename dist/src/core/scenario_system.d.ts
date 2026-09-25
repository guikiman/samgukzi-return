/**
 * 시나리오 시스템 — 로더 + 월드 빌더
 *
 * src/data/scenarios/index.json의 시나리오 목록을 불러와 선택 화면에 제공하고,
 * 선택된 시나리오를 GameStore에 넣을 Officer/Faction/City 배열로 변환한다.
 * 부분 [9] 시나리오 선택, [114] 시나리오 데이터 로딩
 */
import type { Officer, Faction, City, RelationshipEdge } from './types.js';
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
    start_date: string;
    description: string;
    difficulty: number;
    factions: ScenarioFaction[];
    /** 수도 외 도시 데이터 [5][49] */
    cities?: ScenarioCityData[];
    special_conditions: {
        victory: string;
        historical_mode: boolean;
    };
    status: string;
}
export declare function loadScenarios(): Promise<ScenarioData[]>;
export declare function getCachedScenarios(): ScenarioData[];
/** 무장 아이디 → 한글 이름 (사전에 없으면 아이디 그대로) */
export declare function getKnownOfficerName(id: string): string;
export declare function parseStartDate(start: string): {
    year: number;
    month: number;
};
/**
 * 도시 이름 → 중국 전도 좌표 (정규화 0~1)
 * x: 서쪽 0 → 동쪽 1 / y: 북쪽 0 → 남쪽 1 (대략 중국 본토)
 */
export declare const CITY_MAP_COORDS: Record<string, {
    x: number;
    y: number;
}>;
/**
 * [지도][1:1] 제공 全国地图 이미지의 실제 도시 성 아이콘 중심 좌표.
 * 원본 이미지 1536×1024 기준 픽셀이며, 실행 시 contain 영역과 DPR에 맞춰 변환된다.
 * mapX/mapY(전술 좌표)와 분리해 이미지 아이콘 클릭 좌표를 보존한다.
 */
export declare const CITY_IMAGE_ANCHORS: Record<string, {
    x: number;
    y: number;
}>;
/** [지도][1:1] 전략 관문·전장·요충지 앵커. 도시 생성이 활성화될 때 동일한 방식으로 사용한다. */
export declare const MAP_FEATURE_ANCHORS: Record<string, {
    x: number;
    y: number;
    kind: 'PASS' | 'BATTLEFIELD' | 'PORT';
}>;
/** 외부 관계 데이터의 잘못된 엣지를 걸러내는 fail-safe 검증기 [269][301] */
export declare function getScenarioRelationships(scenarioId: string, validOfficerIds: ReadonlySet<string>): RelationshipEdge[];
export interface BuiltWorld {
    officers: Officer[];
    factions: Faction[];
    cities: City[];
    playerFactionId: string;
    /** 시나리오 난이도 (1~5) — GlobalState.difficulty로 주입 [X-난이도] */
    scenario?: {
        id: string;
        difficulty: number;
    };
    /** 시나리오 시작 연월 — GlobalState.time 주입용 [300] (누락 시 이벤트 연도 조건이 전부 어긋남) */
    startYear: number;
    startMonth: number;
    /** 시나리오별 초기 인맥 — 관계망 시각화/AI social graph 초기화 [269][33] */
    relationships: RelationshipEdge[];
}
export declare function buildWorld(scenario: ScenarioData, playerFactionIndex: number): BuiltWorld;
//# sourceMappingURL=scenario_system.d.ts.map