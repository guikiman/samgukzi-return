/**
 * 삼국지리턴 — 핵심 타입 정의
 * 파일: src/core/types.ts
 *
 * 모든 도메인 엔티티, 커맨드, 상태, 이벤트 타입 정의
 * 정규화 상태 트리 구조 + 커맨드 패턴 인터페이스
 */

// ============================================================
// 공통 유틸리티 타입
// ============================================================

export type ID = string;
export type FactionID = string;
export type OfficerID = string;
export type CityID = string;
export type ArmyID = string;

export interface Vec2 { x: number; y: number; }
export interface HexCoord { q: number; r: number; }

// ============================================================
// 게임 페이즈 (유한 상태 머신)
// ============================================================

export enum GamePhase {
    TITLE = 'TITLE',
    WORLD_MAP = 'WORLD_MAP',
    COUNCIL = 'COUNCIL',
    PERSONAL_ACTION = 'PERSONAL_ACTION',
    BATTLE = 'BATTLE',
    DIALOGUE = 'DIALOGUE',
    EVENT = 'EVENT',
    GAME_OVER = 'GAME_OVER',
}

export interface PhaseTransition {
    from: GamePhase;
    to: GamePhase;
    event: string;
    timestamp: number;
}

// ============================================================
// 시간/날씨 (전역 상태)
// ============================================================

export interface GameTime {
    year: number;
    month: number;
}

export type Season = 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
export type Weather = 'SUNNY' | 'CLOUDY' | 'RAIN' | 'SNOW' | 'STORM' | 'FOG';

export function monthToSeason(month: number): Season {
    const m = ((month - 1) % 12) + 1;
    if (m >= 3 && m <= 5) return 'SPRING';
    if (m >= 6 && m <= 8) return 'SUMMER';
    if (m >= 9 && m <= 11) return 'AUTUMN';
    return 'WINTER';
}

// ============================================================
// 무장 (Officer) 도메인
// ============================================================

export enum OfficerRank {
    UNRANKED = 0, RANK9 = 9, RANK8 = 8, RANK7 = 7,
    RANK6 = 6, RANK5 = 5, RANK4 = 4, RANK3 = 3,
    RANK2 = 2, RANK1 = 1,
}

export enum OfficerStatus {
    LORD = 'LORD',
    Viceroy = 'VICEROY',
    Strategist = 'STRATEGIST',
    Governor = 'GOVERNOR',
    OFFICER = 'OFFICER',
    FREE = 'FREE',
    REBEL = 'REBEL',
}

export type Personality = 'AGGRESSIVE' | 'CALM' | 'CAUTIOUS' | 'TIMID' | 'LOYAL' | 'AMBITIOUS' | 'RIGHTEOUS' | 'GREEDY';

export interface OfficerStats {
    leadership: number;
    might: number;
    intelligence: number;
    politics: number;
    charisma: number;
}

export interface OfficerExp {
    leadership: number;
    might: number;
    intelligence: number;
    politics: number;
    charisma: number;
}

export interface OfficerInventory {
    weapons: string[];
    mounts: string[];
    treasures: string[];
    books: string[];
}

export interface Officer {
    id: OfficerID;
    name: string;
    courtesyName: string;
    gender: 'M' | 'F';
    birthYear: number;
    deathYear: number | null;
    stats: OfficerStats;
    exp: OfficerExp;
    rank: OfficerRank;
    status: OfficerStatus;
    factionId: FactionID | null;
    cityId: CityID | null;
    personality: Personality;
    loyalty: number;
    ambition: number;
    morality: number;
    greed: number;
    actionPoints: number;
    maxActionPoints: number;
    stamina: number;
    maxStamina: number;
    fame: number;
    infamy: number;
    merit: number;
    salary: number;
    skills: string[];
    specialty: string | null;
    inventory: OfficerInventory;
    isFemaleBattleEnabled: boolean;
    hasActedThisTurn: boolean;
    hp: number;
    maxHp: number;
    injuries: number;

    // 🟢 [추가] AI 및 동적 시뮬레이션을 위한 실시간 런타임 상태
    runtime: {
        isAlive: boolean;
        factionId: string | null;
        locationId: string;
        loyalty: number;
    };
    
    // 🟢 [추가] 유전 마커 및 확장 데이터
    originClanId?: string;
    appearancePoolId?: string;
}


// ============================================================
// 세력 (Faction) 도메인
// ============================================================

export interface FactionPolicy {
    recruitmentFocus: number;
    militaryFocus: number;
    economyFocus: number;
    diplomacyFocus: number;
    cultureFocus: number;
}

export interface FactionDiplomacy {
    [targetFactionId: string]: {
        relation: number;
        treaty: 'NONE' | 'CEASEFIRE' | 'ALLIANCE' | 'VASSAL' | 'WAR';
        duration: number;
    };
}

export interface Faction {
    id: FactionID;
    name: string;
    leaderId: OfficerID;
    color: string;
    capitalCityId: CityID | null;
    cities: CityID[];
    officers: OfficerID[];
    armies: ArmyID[];
    gold: number;
    food: number;
    reputation: number;
    policy: FactionPolicy;
    diplomacy: FactionDiplomacy;
    isPlayerControlled: boolean;
    techLevel: number;
}

// ============================================================
// 도시 (City) 도메인
// ============================================================

export enum FacilityType {
    PALACE = 'PALACE',
    WALL = 'WALL',
    MARKET = 'MARKET',
    FARM = 'FARM',
    TAVERN = 'TAVERN',
    BLACKSMITH = 'BLACKSMITH',
    GRANARY = 'GRANARY',
    BARRACKS = 'BARRACKS',
}

export interface Facility {
    type: FacilityType;
    level: number;
    maxLevel: number;
    investment: number;
}

export interface CityDevelopmentStats {
    commerce: number;
    maxCommerce: number;
    farming: number;
    maxFarming: number;
    technology: number;
    maxTechnology: number;
    publicOrder: number;
    maxPublicOrder: number;
}

export interface City {
    id: CityID;
    name: string;
    hexCoord: HexCoord;
    /** 중국 전도 상의 위치 (정규화 0~1). 미지정 시 hexCoord 기반으로 계산 */
    mapX?: number;
    mapY?: number;
    /** [지도][1:1] 전국지도 이미지 속 성 아이콘의 정규화 앵커 좌표 */
    mapImageX?: number;
    mapImageY?: number;
    /** [지도][1:1] 이미지에서 사용하는 도시 아이콘 유형 */
    mapIconType?: 'CAPITAL' | 'CITY' | 'PASS' | 'BATTLEFIELD' | 'PORT';
    population: number;
    defense: number;
    maxDefense: number;
    goldIncome: number;
    foodIncome: number;
    funds: number;
    facilities: Facility[];
    officerIds: OfficerID[];
    ownerId: FactionID | null;
    isCapital: boolean;
    /**
     * 도시 병력 수 (명). [결함 수정] 예전엔 "개발도 0~100" 으로 문서화돼
     * 있었지만, 실제 소비자가 10곳 넘고 병력을 뜻한다:
     *   - command_system 징병: 200 미만이면 +600
     *   - battle_spoils_system 약탈: 25% 를 빼앗아 공격측으로
     *   - faction_diplomacy_ai 전력: development + defense × 0.5 합산
     *   - faction_ai_monthly 출진: 300 이상이면 공격 후보
     *   - main.ts 출진 UI: "병력 {development}으로 출진합니다"
     * 값이 0~100 이면 전원이 "병력 700" 처럼 부풀어 올려
     * 출진 열세 조건(공격 ≥ 방어 × 1.2)이 영영 성립하지 않았다.
     * 개발도 지표는 developmentStats 를 쓴다.
     */
    development: number;
    developmentStats: CityDevelopmentStats;
    loyalty: number;
    danger: number;
    weather: Weather;
}

// ============================================================
// 관계망 (Relationship Graph)
// ============================================================

export type RelationType = 'FRIEND' | 'RIVAL' | 'SWORN_BROTHER' | 'NEMESIS' | 'FAMILY' | 'SPOUSE' | 'SUBORDINATE';

export interface RelationshipEdge {
    source: OfficerID;
    target: OfficerID;
    type: RelationType;
    affinity: number;
    history: { year: number; month: number; event: string; delta: number }[];
}

// ============================================================
// 군단 (Army) 도메인
// ============================================================

export interface Army {
    id: ArmyID;
    commanderId: OfficerID;
    officerIds: OfficerID[];
    soldiers: number;
    morale: number;
    training: number;
    supplies: number;
    originCityId: CityID;
    targetCityId: CityID | null;
    position: HexCoord | null;
    banner: string;
}

// ============================================================
// 커맨드 패턴 인터페이스
// ============================================================

export type CommandType =
    | 'DOMESTIC'
    | 'TRAINING'
    | 'RECRUITMENT'
    | 'MOVEMENT'
    | 'DIPLOMACY'
    | 'BATTLE'
    | 'REST'
    | 'SOCIAL'
    | 'SEARCH';

export interface ICommand {
    readonly id: string;
    readonly type: CommandType;
    readonly officerId: OfficerID;
    readonly turnIssued: number;
    readonly timestamp: number;

    execute(context: CommandContext): CommandResult;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
}

export interface SerializedCommand {
    id: string;
    type: CommandType;
    officerId: OfficerID;
    turnIssued: number;
    timestamp: number;
    payload: Record<string, unknown>;
}

export interface CommandResult {
    success: boolean;
    message: string;
    sideEffects: SideEffect[];
    /** 실행된 커맨드 종류 — UI 이벤트 라우팅용 [201] */
    commandType?: CommandType;
    /** 전투 후처리 로그 — 포획·약탈·포로 처분 결과를 UI에 전달 [121-130][131-145] */
    logMessages?: string[];
    /** 전투 커맨드의 포로 처분 결과 — 연대기 기록용 [121-130][131-145] */
    captiveOutcomes?: Array<{
        officerId: string;
        officerName: string;
        decision: 'RECRUIT' | 'EXECUTE' | 'RELEASE';
        success: boolean;
        message: string;
    }>;
}

export interface SideEffect {
    target: 'officer' | 'city' | 'faction' | 'army' | 'relation';
    targetId: ID;
    field: string;
    oldValue: unknown;
    newValue: unknown;
}

export interface CommandContext {
    store: IGameStore;
    logger: (msg: string) => void;
    /** [341-360] 커맨드 기반 외교 실행 컨텍스트 — 단위 테스트에서는 선택 주입 */
    diplomacy?: import('./diplomacy_engine.js').DiplomacyEngine;
    /** 전투 후처리의 연대기 기록을 undo 경계까지 포함하기 위한 선택 컨텍스트 */
    chronicle?: {
        serialize(): import('./chronicle_system.js').ChronicleEntry[];
        load(entries: import('./chronicle_system.js').ChronicleEntry[]): void;
        add(
            kind: import('./chronicle_system.js').ChronicleKind,
            text: string,
            at?: { year: number; month: number; turn: number },
            details?: { factionId?: string | null; cityId?: string | null },
        ): void;
    };
}

// ============================================================
// AI 의사결정
// ============================================================

export interface AIDecisionContext {
    officerId: OfficerID;
    officer: Officer;
    faction: Faction | null;
    city: City | null;
    nearbyCities: City[];
    enemyFactions: Faction[];
    allyFactions: Faction[];
    relationships: RelationshipEdge[];
    gameTime: GameTime;
    season: Season;
    weather: Weather;
}

export interface AIDecision {
    officerId: OfficerID;
    actionType: CommandType;
    priority: number;
    reasoning: string;
    targetId?: ID;
    payload: Record<string, unknown>;
}

// ============================================================
// 정규화 상태 트리 (Normalized State Tree)
// ============================================================

/**
 * 전략 요충지 — 관·요새·전장·항구. 도시가 아니라 "지형"이라 소유권이 도시와 별개다.
 *
 * [왜 별도 엔티티인가]
 * 예전엔 MAP_FEATURE_ANCHORS 정적 표(좌표만)로 지도에 아이콘만 그렸다. 소유권이 없어
 * 점령도, 보급도, 방어도 없었다. 역사적 근거 — 삼국지에서 관·요새는 인접 도시의
 * 포위 수성을 3개월까지 버티게 하는 보급 거점이었다(요충지 없으면 1개월).
 *
 * 순수 데이터 — 전투/포위 판정은 이 값을 읽는 별도 시스템이 담당한다.
 *   - 전투 수치 계산이 필요 없다(computeCombatPower 는 병력/사기만 본다)
 *   - 그래서 ownerId 하나만 바꾸면 점령이 성립한다(보상·후처리는 전투 시스템 몫)
 */
export interface MapFeature {
    id: string;
    name: string;
    kind: 'PASS' | 'FORTRESS' | 'BATTLEFIELD' | 'PORT';
    /** 규칙 좌표(헥스). 도시가 아니라 지형이므로 도시와 다른 격자에 놓일 수 있다. */
    hexCoord: HexCoord;
    /** 정규화 지도 좌표 — 아이콘과 반경 판정용 */
    mapX: number;
    mapY: number;
    ownerId: FactionID | null;
    /** 수비 병력(명). 점령 전투의 방어측 전력이 된다. */
    garrison: number;
    maxGarrison: number;
    /** 정규화 지도 좌표상 보급이 닿는 반경. */
    supplyRadius: number;
    /** 이 요충지를 포위 중이면 남은 개월. 0 이면 포위 중이 아니다. */
    siegeMonthsRemaining: number;
    /** 포위 중인 세력. 해제/점령 때 비교 대상이 된다. */
    besiegedByFactionId: FactionID | null;
    /** 이 요충지에 포위 중인 세력을 [도시 id] 목록. */
    besiegedCityIds: CityID[];
}

/** 요충지 출진 중(미집계) — 도시 병력을 잠시 묶어 둔다. */
export interface FeatureExpedition {
    id: string;
    factionId: FactionID;
    featureId: string;
    cityId: CityID;
    troops: number;
    startTurn: number;
}

/** 도시를 포위하는 병단 — 요충지 점령 판정의 주체. */
export interface SiegeOperation {
    id: string;
    /** 출진 세력 */
    factionId: FactionID;
    /** 목표 요충지 */
    featureId: string;
    /** 출진 병력 — 수성 중이므로 매달 자연 감소한다. */
    troops: number;
    /** 시작 회차. */
    startTurn: number;
    /** 목표 포위 개월. 끝까지 못 넘기면 자동 함락. */
    durationTurns: number;
    status: 'ACTIVE' | 'SUCCEEDED' | 'FAILED' | 'BROKEN';
}

/** 이민족(邊境部族)이 머무는 위치 — 도시 근처이거나, 넓은 지역에 흩어져 있다. */
export type TribeSettlement =
    | { kind: 'CITY'; cityId: CityID }
    | { kind: 'REGION'; region: string };

/**
 * 침략 요구 — 부족이 대신 철회시킬 수 있는 대상.
 *
 * [왜 종류를 나눴는가]
 * 세력 전체를 철회시키는 것과 도시 하나를 철회시키는 것은 비용이 다르다. 요구의
 * 무게(weight)가 클수록 교섭 난이도가 오른다.
 */
export interface InvasionDemand {
    id: string;
    /** 요구를 세운 세력 */
    issuerFactionId: FactionID;
    /** 침략 대상 도시 (도시 단위 요구면 존재) */
    targetCityId: CityID | null;
    /** 세력 전체 요구면 true */
    targetsWholeFaction: boolean;
    /** 남은 개월. 0 이하면 철회된 것으로 본다. */
    monthsRemaining: number;
    withdrawn: boolean;
}

/** 부족 하나의 상태. */
export interface TribeState {
    id: string;
    name: string;
    settlement: TribeSettlement;
    /** 현재 병력 규모. */
    strength: number;
    /** 우호도 -100(적대) ~ 100(친밀). 거래 호가와 지원 확률이 이 값에서 나온다. */
    affinity: number;
    /** 지원 가능한 糧 총량. */
    grainStock: number;
    /** 지원 가능한 병력 총량. */
    troopStock: number;
    /** 철회시킬 수 있는 침략 요구 id 목록 */
    backingDemandIds: string[];
    /** 이번 달에 이미 교섭했는지 — 중복 수령 방지. */
    negotiatedThisMonth: boolean;
}

export interface ImperialCourt {
    emperorName: string;
    /** 황제가 머무는 도시. 알현은 이 도시에서만 가능하다. */
    cityId: CityID;
    /** 현재 진행 중인 황제 임무 (최대 1개). */
    activeMissionId: string | null;
    /** 마지막으로 알현을 열었던 회차. 쿨다운 판정에 쓴다. */
    lastAudienceTurn: number | null;
    missions: Record<string, ImperialMission>;
}

/** 황제 임무 종류 — 난이도·기한·보상이 다르다. */
export type ImperialMissionKind = 'SUBDUE_BANDITS' | 'RECOVER_TRIBUTE' | 'SECURE_BORDER';

export interface ImperialMission {
    id: string;
    kind: ImperialMissionKind;
    officerId: OfficerID;
    cityId: CityID;
    /** 시작 회차 (GameTime 를 턴 단위로 환산) */
    startTurn: number;
    /** 만료 회차. 이 회차까지 목표를 못 채우면 실패한다. */
    deadlineTurn: number;
    /** 목표 수치 — 토벌 세력·회수 세금처럼 임무 종류마다 단위가 다르다. */
    targetAmount: number;
    progress: number;
    accepted: boolean;
    status: 'PENDING' | 'ACTIVE' | 'SUCCEEDED' | 'FAILED' | 'DECLINED';
    rewardRank: OfficerRank;
    rewardGold: number;
}

export interface NormalizedState {
    officers: Record<OfficerID, Officer>;
    factions: Record<FactionID, Faction>;
    cities: Record<CityID, City>;
    armies: Record<ArmyID, Army>;
    /** 전략 요충지 — 점령 가능한 지형 엔티티 */
    mapFeatures: Record<string, MapFeature>;
    /** 진행 중인 요충지 포위 — 세력별로 최대 1건. */
    sieges: Record<FactionID, SiegeOperation>;
    /** 이민족 — 주변 지역에 이주해 온 부족. 세력이 아니라 별개 주체다. */
    migrationTribes: Record<string, TribeState>;
    /** 이민족이 세운 침략 요구 — 부족이 대신 철회시킬 수 있다. */
    invasionDemands: Record<string, InvasionDemand>;
    /** 황제와 알현 임무. 황제가 머무는 도시에서만 알현이 열린다. */
    imperialCourt: ImperialCourt | null;
    relationships: Record<string, RelationshipEdge>;
    byFaction: {
        officers: Record<FactionID, OfficerID[]>;
        cities: Record<FactionID, CityID[]>;
        armies: Record<FactionID, ArmyID[]>;
        mapFeatures: Record<FactionID, string[]>;
    };
    byCity: {
        officers: Record<CityID, OfficerID[]>;
        /** 그 도시에 머무르는 이민족 */
        tribes: Record<CityID, string[]>;
    };
    byOfficer: {
        relationships: Record<OfficerID, RelationshipEdge[]>;
    };
}

/** [49][D32] 도시 건물 운영 상태 — 도시 화면의 투자·운영 설정을 세이브에 보존한다. */
export interface CityBuildingState {
    buildingId: string;
    level: number;
    investment: number;
    active: boolean;
}

export interface GlobalState {
    phase: GamePhase;
    time: GameTime;
    season: Season;
    weather: Weather;
    turnCount: number;
    selectedOfficerId: OfficerID | null;
    playerFactionId: FactionID | null;
    /** 시나리오 난이도 1~5 (구버전 세이브 호환: optional) [X-난이도] */
    difficulty?: number;
    /** [49][D32] 도시별 건물 운영 상태 — 투자·운영 상태를 세이브/로드에서 복원한다. */
    cityBuildingStates?: Record<CityID, Record<string, CityBuildingState>>;
    /** [49] 플레이어가 방문한 도시 ID — 세이브/로드 후에도 지도 발견 상태를 복원한다. */
    visitedCityIds?: CityID[];
    /**
     * [2026-10-04] 저장 시각 (Date.now, ms). 오프라인 진행용.
     *
     * optional 로 둔 이유: 구버전 세이브에 이 필드가 없다. 없으면 오프라인
     * 진행을 하지 않고 그냥 로드한다(프로젝트 관례). 저장할 때마다 갱신한다.
     *
     * [왜 globalState 에 두는가]
     * 세이브 파일에 이미 globalState 가 들어간다. 여기에 두면 저장 파이프라인
     * (prepareSave → loadFromSave) 을 건드리지 않고 로드에서 바로 읽는다.
     */
    savedAt?: number;
    /**
     * [2026-10-04] 진행 중인 이동 — 도착까지 턴이 필요하다.
     *
     * optional 로 둔 이유: 구버전 세이브에 이 필드가 없다. undefined 면 이동 중이
     * 아니라고 간주하면 로드 경로에서 분기를 만들지 않아도 된다(프로젝트 관례).
     *
     * [단위가 개월인 이유]
     * 게임의 1턴은 1개월이다(`game_store.advanceTime()` 이 month 를 1 올린다).
     * 턴 경계가 곧 월 경계이므로 소요 시간도 개월로 세는 것이 유일하게 정직하다.
     * "일" 로 세면 "5일" 표시가 실제로는 턴 5회(5개월)가 되어 어긋난다.
     *
     * [3단계로 이어지는 자리]
     * 턴 경계마다 1씩 줄이고 0 이 되면 목적지 도시를 연다. 군단(Army) 이 붙으면
     * ownerId 로 묶어 여러 부대의 이동을 한 건으로 표현할 수 있고, 이때
     * `monthsTotal` 은 그 부대들의 합집합 소요 시간이 된다.
     */
    activeTravel?: {
        fromCityId: CityID;
        toCityId: CityID;
        /** 남은 개월 수. 0 이 되면 도착 확정. 1턴 = 1개월. */
        monthsRemaining: number;
        /** 총 소요 개월 수 — "3개월 중 2개월째" 같은 안내에 쓴다. */
        monthsTotal: number;
    };
}

// ============================================================
// 게임 스토어 인터페이스
// ============================================================

export interface IGameStore {
    getState(): NormalizedState;
    getGlobalState(): GlobalState;
    dispatch(command: ICommand): CommandResult;
    subscribe(listener: (state: NormalizedState, globalState: GlobalState) => void): () => void;
    getOfficer(id: OfficerID): Officer | null;
    getFaction(id: FactionID): Faction | null;
    getCity(id: CityID): City | null;
    getArmy(id: ArmyID): Army | null;
    getRelationships(officerId: OfficerID): RelationshipEdge[];
    updateOfficer(id: OfficerID, updates: Partial<Officer>): void;
    updateFaction(id: FactionID, updates: Partial<Faction>): void;
    updateCity(id: CityID, updates: Partial<City>): void;
    updateArmy(id: ArmyID, updates: Partial<Army>): void;
    addOfficer(officer: Officer): void;
    removeOfficer(id: OfficerID): void;
    /** 세력 추가 — 모딩 핫 인젝션 [309] 및 런타임 세력 생성용 */
    addFaction(faction: Faction): void;
    /** 도시 추가 — 모딩 핫 인젝션 [309] 및 런타임 도시 생성용 */
    addCity(city: City): void;
    addRelationship(edge: RelationshipEdge): void;
    /** 전략 요충지 — 점령 가능한 지형 엔티티 */
    getMapFeature(id: string): MapFeature | null;
    getAllMapFeatures(): MapFeature[];
    getMapFeaturesByFaction(factionId: FactionID): MapFeature[];
    addMapFeature(feature: MapFeature): void;
    updateMapFeature(id: string, updates: Partial<MapFeature>): void;
    setMapFeatures(features: MapFeature[]): void;
    /** 진행 중인 요충지 포위 — 세력별로 최대 1건이므로 세력 id 로 키를 잡는다. */
    getSiege(factionId: FactionID): SiegeOperation | null;
    getAllSieges(): SiegeOperation[];
    setSiege(operation: SiegeOperation): void;
    clearSiege(factionId: FactionID): void;
    /** 이민족 — 세력이 아닌 별개 교섭 주체 */
    getMigrationTribe(id: string): TribeState | null;
    getAllMigrationTribes(): TribeState[];
    getTribesByCity(cityId: CityID): TribeState[];
    setMigrationTribes(tribes: TribeState[]): void;
    updateMigrationTribe(id: string, updates: Partial<TribeState>): void;
    getInvasionDemand(id: string): InvasionDemand | null;
    getAllInvasionDemands(): InvasionDemand[];
    updateInvasionDemand(id: string, updates: Partial<InvasionDemand>): void;
    /** 황제 알현 — 황제가 머무는 도시에서만 열리는 임무 */
    getImperialCourt(): ImperialCourt | null;
    setImperialCourt(court: ImperialCourt | null): void;
    updateImperialCourt(updates: Partial<ImperialCourt>): void;
    getAudienceMission(id: string): ImperialMission | null;
    putAudienceMission(mission: ImperialMission): void;
    updateAudienceMission(id: string, updates: Partial<ImperialMission>): void;
    setGlobalState(updates: Partial<GlobalState>): void;
    createSnapshot(): NormalizedState;
    restoreSnapshot(snapshot: NormalizedState): void;
    getAllOfficers(): Officer[];
    getAllFactions(): Faction[];
    getAllCities(): City[];
    getOfficersByFaction(factionId: FactionID): Officer[];
    getCitiesByFaction(factionId: FactionID): City[];
    getOfficersByCity(cityId: CityID): Officer[];
}

// ============================================================
// 턴 스케줄러 인터페이스
// ============================================================

export interface TurnSchedulerOptions {
    chunkSize: number;
    maxFrameTimeMs: number;
    useIdleCallback: boolean;
}

export interface SchedulerProgress {
    total: number;
    completed: number;
    currentChunk: number;
    isComplete: boolean;
}

export interface ChunkTask {
    id: string;
    officerId: OfficerID;
    execute: () => void | Promise<void>;
}

// ============================================================
// 이벤트 시스템
// ============================================================

export interface GameEvent {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    timestamp: number;
    turn: number;
}

export type EventListener = (event: GameEvent) => void;

// ============================================================
// Web Worker 메시지 프로토콜
// ============================================================

export interface WorkerRequest {
    id: string;
    type: 'AI_DECISION' | 'BATTLE_SIM' | 'PATHFIND';
    payload: Record<string, unknown>;
}

export interface WorkerResponse {
    id: string;
    success: boolean;
    result?: unknown;
    error?: string;
}

export interface AIWorkerPayload {
    officerIds: OfficerID[];
    stateSnapshot: NormalizedState;
    globalState: GlobalState;
}

export interface AIWorkerResult {
    decisions: AIDecision[];
}
