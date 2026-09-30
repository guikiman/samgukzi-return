/**
 * 삼국지리턴 — 런타임 JSON 모딩 로더
 * 파일: src/core/runtime_mod_loader.ts
 *
 * [301] JSON Schema 스키마 유효성 검증 엔진
 * [302] 핫 리로딩 및 전역 동적 결합
 * [309] 모드 창작 마당 — 파일 드래그/드롭 마운트
 *
 * ── 아키텍처 ──
 *
 * 유저가 JSON 파일을 드래그/드롭
 *     ↓
 * ModFileReader — 파일 읽기 + JSON 파싱
 *     ↓
 * SchemaValidator — 타입/범위/참조 ID 무결성 검사
 *     ↓
 * ModRegistry — 모드 메타 정보 등록 (중복/충돌 탐지)
 *     ↓
 * HotInjector — 실행 중인 GameStore에 동적 덮어쓰기
 *     ↓
 * 완료 콜백 (UI 재렌더링 트리거)
 */

import type {
    OfficerID, FactionID, CityID,
    Officer, Faction, City,
    OfficerStats, OfficerExp, OfficerInventory,
    IGameStore,
} from './types.js';

import type {
    EventId, GameEventSchema,
} from './story_event_compiler.js';

// ============================================================
// [0] 타입 정의
// ============================================================

/** 모드 메타데이터 */
export interface ModMeta {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly author: string;
    readonly description: string;
    readonly dependencies?: readonly string[];
    readonly conflicts?: readonly string[];
    readonly createdAt: string;
    readonly gameVersion?: string;
}

/** 모드 데이터 (JSON 파일의 루트 구조) */
export interface ModData {
    readonly meta: ModMeta;
    readonly officers?: readonly PartialOfficerDef[];
    readonly factions?: readonly PartialFactionDef[];
    readonly cities?: readonly PartialCityDef[];
    readonly events?: readonly ModEventDef[];
    readonly items?: readonly ModItemDef[];
    readonly scenarios?: readonly ModScenarioDef[];
}

/** 무장 정의 (Officer 인터페이스의 부분 집합 + 유효성 검증용) */
export interface PartialOfficerDef {
    readonly id: OfficerID;
    readonly name: string;
    readonly courtesyName?: string;
    readonly gender?: 'M' | 'F';
    readonly birthYear: number;
    readonly deathYear?: number | null;
    readonly stats?: Partial<OfficerStats>;
    readonly exp?: Partial<OfficerExp>;
    readonly rank?: number;
    readonly status?: string;
    readonly factionId?: FactionID | null;
    readonly cityId?: CityID | null;
    readonly personality?: string;
    readonly loyalty?: number;
    readonly ambition?: number;
    readonly morality?: number;
    readonly greed?: number;
    readonly skills?: readonly string[];
    readonly specialty?: string | null;
    readonly inventory?: Partial<OfficerInventory>;
    readonly portrait?: string;
    readonly description?: string;
}

/** 세력 정의 */
export interface PartialFactionDef {
    readonly id: FactionID;
    readonly name: string;
    readonly lordId?: OfficerID;
    readonly officers?: readonly OfficerID[];
    readonly cities?: readonly CityID[];
    readonly reputation?: number;
    readonly color?: string;
    readonly description?: string;
}

/** 도시 정의 */
export interface PartialCityDef {
    readonly id: CityID;
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly factionId?: FactionID | null;
    readonly governorId?: OfficerID | null;
    readonly population?: number;
    readonly loyalty?: number;
    readonly defense?: number;
    readonly gold?: number;
    readonly food?: number;
    readonly facilities?: readonly string[];
    readonly description?: string;
}

/** 이벤트 정의 (GameEventSchema 확장) */
export interface ModEventDef {
    readonly id: EventId;
    readonly name: string;
    readonly description: string;
    readonly category: "historical" | "fictional" | "character" | "disaster" | "chain_step";
    readonly priority: number;
    readonly trigger: {
        readonly logic: "AND" | "OR";
        readonly conditions: readonly {
            readonly field: string;
            readonly op: string;
            readonly targetId?: string;
            readonly targetId2?: string;
            readonly value?: number;
            readonly value2?: number;
            readonly probability?: number;
        }[];
    };
    readonly chain: {
        readonly type: "single" | "multi_turn" | "branching";
        readonly chainId?: string;
        readonly stepIndex?: number;
        readonly totalSteps?: number;
        readonly expiryTurns?: number;
        readonly nextEventId?: string;
        readonly branchOnChoice?: boolean;
    };
    readonly dialogue: {
        readonly lines: readonly string[];
        readonly speakerId?: string;
        readonly choices?: readonly {
            readonly label: string;
            readonly tooltip?: string;
            readonly effects: readonly {
                readonly type: string;
                readonly targetId: string;
                readonly targetId2?: string;
                readonly field?: string;
                readonly value?: number | string | boolean;
                readonly delta?: number;
            }[];
            readonly nextEventId?: string;
            readonly branchToChainId?: string;
        }[];
        readonly autoAdvance?: boolean;
        readonly autoAdvanceDelayMs?: number;
    };
    readonly effects?: readonly {
        readonly type: string;
        readonly targetId: string;
        readonly targetId2?: string;
        readonly field?: string;
        readonly value?: number | string | boolean;
        readonly delta?: number;
    }[];
    readonly onFailEffects?: readonly {
        readonly type: string;
        readonly targetId: string;
        readonly targetId2?: string;
        readonly field?: string;
        readonly value?: number | string | boolean;
        readonly delta?: number;
    }[];
    readonly once?: boolean;
}

/** 아이템 정의 */
export interface ModItemDef {
    readonly id: string;
    readonly name: string;
    readonly type: "weapon" | "mount" | "treasure" | "book" | "consumable";
    readonly description: string;
    readonly effects: readonly {
        readonly field: string;
        readonly value: number;
    }[];
    readonly rarity: number;
    readonly image?: string;
}

/** 시나리오 정의 */
export interface ModScenarioDef {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly year: number;
    readonly month: number;
    readonly officers: readonly {
        readonly officerId: OfficerID;
        readonly factionId: FactionID;
        readonly cityId: CityID;
        readonly rank?: number;
    }[];
    readonly factions: readonly {
        readonly factionId: FactionID;
        readonly cities: readonly CityID[];
        readonly diplomacy?: Record<string, number>;
    }[];
}

/** 모드 로드 결과 */
export interface ModLoadResult {
    readonly meta: ModMeta;
    readonly success: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly stats: {
        readonly officersLoaded: number;
        readonly factionsLoaded: number;
        readonly citiesLoaded: number;
        readonly eventsLoaded: number;
        readonly itemsLoaded: number;
        readonly scenariosLoaded: number;
    };
    readonly timestamp: number;
}

/** 스키마 검증 오류 */
export interface ValidationError {
    readonly path: string;
    readonly message: string;
    readonly code: 'TYPE_MISMATCH' | 'RANGE_EXCEEDED' | 'MISSING_FIELD' | 'REFERENCE_INVALID' | 'DUPLICATE_ID' | 'CUSTOM';
    readonly value?: unknown;
}

// ============================================================
// [1] JSON Schema 유효성 검증 엔진
// ============================================================

/**
 * SchemaValidator — 모드 데이터의 타입/범위/참조 ID 무결성 런타임 검사
 *
 * 검증 규칙:
 *   - 타입 검사 (number, string, boolean, array, object)
 *   - 숫자 범위 검사 (0~100, 0~999 등)
 *   - 필수 필드 누락 검사
 *   - ID 중복 검사 (전역 레지스트리 기준)
 *   - 참조 무결성 검사 (factionId → 존재하는 세력 등)
 */
export class SchemaValidator {
    private readonly officerMaxStats = 100;
    private readonly maxYear = 399;
    private readonly minYear = 100;
    private readonly validGenders = new Set(['M', 'F']);
    private readonly validPersonalities = new Set([
        'DIGNIFIED', 'IMPULSIVE', 'COURAGEOUS', 'CAUTIOUS',
        'CRUEL', 'RIGHTEOUS', 'VAIN', 'SERENE', 'WILY', 'GULLIBLE',
    ]);
    private readonly validCategories = new Set(['historical', 'fictional', 'character', 'disaster', 'chain_step']);
    private readonly validChainTypes = new Set(['single', 'multi_turn', 'branching']);
    private readonly existingOfficerIds: Set<string> = new Set();
    private readonly existingFactionIds: Set<string> = new Set();
    private readonly existingCityIds: Set<string> = new Set();
    private readonly existingEventIds: Set<string> = new Set();

    /** 기존 게임 DB의 ID 목록을 로드 (참조 무결성 검증용) */
    loadExistingIds(store: IGameStore): void {
        for (const o of store.getAllOfficers()) {
            this.existingOfficerIds.add(o.id);
        }
        for (const f of store.getAllFactions()) {
            this.existingFactionIds.add(f.id);
        }
        for (const c of store.getAllCities()) {
            this.existingCityIds.add(c.id);
        }
    }

    // ============================================================
    // 메인 검증 루틴
    // ============================================================

    /**
     * ModData 전체 검증
     *
     * @param data       로드할 모드 데이터
     * @param isNew      신규 추가(false=기존 데이터 덮어쓰기)
     * @returns          검증 오류 목록 (비어있으면 통과)
     */
    validate(data: ModData, isNew: boolean = true): ValidationError[] {
        const errors: ValidationError[] = [];

        // 1. 메타데이터 검증
        errors.push(...this.validateMeta(data.meta));

        // 2. 무장 검증
        if (data.officers) {
            for (let i = 0; i < data.officers.length; i++) {
                errors.push(...this.validateOfficer(data.officers[i], `officers[${i}]`, isNew));
            }
        }

        // 3. 세력 검증
        if (data.factions) {
            for (let i = 0; i < data.factions.length; i++) {
                errors.push(...this.validateFaction(data.factions[i], `factions[${i}]`, isNew));
            }
        }

        // 4. 도시 검증
        if (data.cities) {
            for (let i = 0; i < data.cities.length; i++) {
                errors.push(...this.validateCity(data.cities[i], `cities[${i}]`, isNew));
            }
        }

        // 5. 이벤트 검증
        if (data.events) {
            for (let i = 0; i < data.events.length; i++) {
                errors.push(...this.validateEvent(data.events[i], `events[${i}]`, isNew));
            }
        }

        // 6. 아이템 검증
        if (data.items) {
            for (let i = 0; i < data.items.length; i++) {
                errors.push(...this.validateItem(data.items[i], `items[${i}]`));
            }
        }

        return errors;
    }

    // ============================================================
    // 개별 스키마 검증
    // ============================================================

    private validateMeta(meta: ModMeta): ValidationError[] {
        const errs: ValidationError[] = [];

        if (!meta.id || typeof meta.id !== 'string') {
            errs.push({ path: 'meta.id', message: 'Missing or invalid mod ID', code: 'MISSING_FIELD', value: meta.id });
        }
        if (!meta.name || typeof meta.name !== 'string') {
            errs.push({ path: 'meta.name', message: 'Missing or invalid mod name', code: 'MISSING_FIELD', value: meta.name });
        }
        if (!meta.version || typeof meta.version !== 'string') {
            errs.push({ path: 'meta.version', message: 'Missing version string', code: 'MISSING_FIELD', value: meta.version });
        }

        return errs;
    }

    private validateOfficer(o: PartialOfficerDef, path: string, isNew: boolean): ValidationError[] {
        const errs: ValidationError[] = [];

        // 필수 필드
        if (!o.id || typeof o.id !== 'string') {
            errs.push({ path: `${path}.id`, message: 'Missing officer ID', code: 'MISSING_FIELD' });
        }
        if (isNew && o.id && this.existingOfficerIds.has(o.id)) {
            errs.push({ path: `${path}.id`, message: `Duplicate officer ID: ${o.id}`, code: 'DUPLICATE_ID', value: o.id });
        }
        if (!o.name || typeof o.name !== 'string') {
            errs.push({ path: `${path}.name`, message: 'Missing officer name', code: 'MISSING_FIELD' });
        }

        // birthYear
        if (o.birthYear === undefined || typeof o.birthYear !== 'number') {
            errs.push({ path: `${path}.birthYear`, message: 'Missing birth year', code: 'MISSING_FIELD' });
        } else if (o.birthYear < this.minYear || o.birthYear > this.maxYear) {
            errs.push({ path: `${path}.birthYear`, message: `Birth year ${o.birthYear} out of range [${this.minYear}, ${this.maxYear}]`, code: 'RANGE_EXCEEDED', value: o.birthYear });
        }

        // deathYear
        if (o.deathYear !== undefined && o.deathYear !== null) {
            if (typeof o.deathYear !== 'number' || o.deathYear < this.minYear || o.deathYear > this.maxYear) {
                errs.push({ path: `${path}.deathYear`, message: `Invalid death year: ${o.deathYear}`, code: 'RANGE_EXCEEDED', value: o.deathYear });
            }
            if (o.birthYear && o.deathYear !== null && typeof o.deathYear === 'number' && o.deathYear <= o.birthYear) {
                errs.push({ path: `${path}.deathYear`, message: `Death year ${o.deathYear} <= birth year ${o.birthYear}`, code: 'RANGE_EXCEEDED', value: o.deathYear });
            }
        }

        // gender
        if (o.gender && !this.validGenders.has(o.gender)) {
            errs.push({ path: `${path}.gender`, message: `Invalid gender: ${o.gender}`, code: 'TYPE_MISMATCH', value: o.gender });
        }

        // personality
        if (o.personality && !this.validPersonalities.has(o.personality)) {
            errs.push({ path: `${path}.personality`, message: `Invalid personality: ${o.personality}`, code: 'TYPE_MISMATCH', value: o.personality });
        }

        // stats 범위 검증
        if (o.stats) {
            for (const [key, val] of Object.entries(o.stats)) {
                if (typeof val === 'number' && (val < 0 || val > this.officerMaxStats)) {
                    errs.push({ path: `${path}.stats.${key}`, message: `Stat ${key}=${val} out of range [0, ${this.officerMaxStats}]`, code: 'RANGE_EXCEEDED', value: val });
                }
            }
        }

        // loyalty/ambition/morality/greed (1~100)
        for (const field of ['loyalty', 'ambition', 'morality', 'greed'] as const) {
            const val = o[field];
            if (val !== undefined && (typeof val !== 'number' || val < 0 || val > 100)) {
                errs.push({ path: `${path}.${field}`, message: `${field}=${val} out of range [0, 100]`, code: 'RANGE_EXCEEDED', value: val });
            }
        }

        return errs;
    }

    private validateFaction(f: PartialFactionDef, path: string, isNew: boolean): ValidationError[] {
        const errs: ValidationError[] = [];

        if (!f.id || typeof f.id !== 'string') {
            errs.push({ path: `${path}.id`, message: 'Missing faction ID', code: 'MISSING_FIELD' });
        }
        if (isNew && f.id && this.existingFactionIds.has(f.id)) {
            errs.push({ path: `${path}.id`, message: `Duplicate faction ID: ${f.id}`, code: 'DUPLICATE_ID', value: f.id });
        }
        if (!f.name || typeof f.name !== 'string') {
            errs.push({ path: `${path}.name`, message: 'Missing faction name', code: 'MISSING_FIELD' });
        }

        // lordId 참조 무결성
        if (f.lordId && !this.existingOfficerIds.has(f.lordId)) {
            errs.push({ path: `${path}.lordId`, message: `Lord ${f.lordId} not found in officer registry`, code: 'REFERENCE_INVALID', value: f.lordId });
        }

        return errs;
    }

    private validateCity(c: PartialCityDef, path: string, isNew: boolean): ValidationError[] {
        const errs: ValidationError[] = [];

        if (!c.id || typeof c.id !== 'string') {
            errs.push({ path: `${path}.id`, message: 'Missing city ID', code: 'MISSING_FIELD' });
        }
        if (isNew && c.id && this.existingCityIds.has(c.id)) {
            errs.push({ path: `${path}.id`, message: `Duplicate city ID: ${c.id}`, code: 'DUPLICATE_ID', value: c.id });
        }
        if (!c.name || typeof c.name !== 'string') {
            errs.push({ path: `${path}.name`, message: 'Missing city name', code: 'MISSING_FIELD' });
        }
        if (typeof c.x !== 'number' || typeof c.y !== 'number') {
            errs.push({ path: `${path}.coordinates`, message: 'Missing or invalid city coordinates', code: 'MISSING_FIELD' });
        }

        // population/loyalty/defense 범위
        if (c.population !== undefined && (c.population < 0 || c.population > 999999)) {
            errs.push({ path: `${path}.population`, message: `Population ${c.population} out of range`, code: 'RANGE_EXCEEDED', value: c.population });
        }
        if (c.loyalty !== undefined && (c.loyalty < 0 || c.loyalty > 100)) {
            errs.push({ path: `${path}.loyalty`, message: `Loyalty ${c.loyalty} out of range [0, 100]`, code: 'RANGE_EXCEEDED', value: c.loyalty });
        }

        return errs;
    }

    private validateEvent(e: ModEventDef, path: string, isNew: boolean): ValidationError[] {
        const errs: ValidationError[] = [];

        if (!e.id || typeof e.id !== 'string') {
            errs.push({ path: `${path}.id`, message: 'Missing event ID', code: 'MISSING_FIELD' });
        }
        if (isNew && e.id && this.existingEventIds.has(e.id)) {
            errs.push({ path: `${path}.id`, message: `Duplicate event ID: ${e.id}`, code: 'DUPLICATE_ID', value: e.id });
        }
        if (!e.name || typeof e.name !== 'string') {
            errs.push({ path: `${path}.name`, message: 'Missing event name', code: 'MISSING_FIELD' });
        }
        if (!this.validCategories.has(e.category)) {
            errs.push({ path: `${path}.category`, message: `Invalid category: ${e.category}`, code: 'TYPE_MISMATCH', value: e.category });
        }
        if (!this.validChainTypes.has(e.chain.type)) {
            errs.push({ path: `${path}.chain.type`, message: `Invalid chain type: ${e.chain.type}`, code: 'TYPE_MISMATCH', value: e.chain.type });
        }

        // trigger conditions 검증
        if (e.trigger?.conditions) {
            for (let i = 0; i < e.trigger.conditions.length; i++) {
                const cond = e.trigger.conditions[i];
                if (!cond.field || typeof cond.field !== 'string') {
                    errs.push({ path: `${path}.trigger.conditions[${i}].field`, message: 'Missing condition field', code: 'MISSING_FIELD' });
                }
            }
        }

        return errs;
    }

    private validateItem(item: ModItemDef, path: string): ValidationError[] {
        const errs: ValidationError[] = [];
        const validTypes = new Set(['weapon', 'mount', 'treasure', 'book', 'consumable']);

        if (!item.id || typeof item.id !== 'string') {
            errs.push({ path: `${path}.id`, message: 'Missing item ID', code: 'MISSING_FIELD' });
        }
        if (!item.name || typeof item.name !== 'string') {
            errs.push({ path: `${path}.name`, message: 'Missing item name', code: 'MISSING_FIELD' });
        }
        if (!validTypes.has(item.type)) {
            errs.push({ path: `${path}.type`, message: `Invalid item type: ${item.type}`, code: 'TYPE_MISMATCH', value: item.type });
        }
        if (item.rarity !== undefined && (item.rarity < 0 || item.rarity > 5)) {
            errs.push({ path: `${path}.rarity`, message: `Rarity ${item.rarity} out of range [0, 5]`, code: 'RANGE_EXCEEDED', value: item.rarity });
        }

        return errs;
    }
}

// ============================================================
// [2] ModRegistry — 모드 등록 및 충돌 관리
// ============================================================

/**
 * ModRegistry — 로드된 모드의 메타 정보를 관리
 * - 중복 모드 ID 감지
 * - 의존성/충돌 검사
 * - 로드 순서 정렬
 */
export class ModRegistry {
    private readonly mods: Map<string, ModMeta> = new Map();
    private readonly loadOrder: string[] = [];

    /** 모드 등록 (의존성/충돌 검증 포함) */
    register(meta: ModMeta): ValidationError[] {
        const errs: ValidationError[] = [];

        if (this.mods.has(meta.id)) {
            const existing = this.mods.get(meta.id)!;
            errs.push({
                path: `meta.id`,
                message: `Mod "${meta.id}" (${existing.version}) already loaded. Cannot load version ${meta.version}`,
                code: 'DUPLICATE_ID',
                value: meta.id,
            });
            return errs;
        }

        // 의존성 검증
        if (meta.dependencies) {
            for (const dep of meta.dependencies) {
                if (!this.mods.has(dep)) {
                    errs.push({
                        path: `meta.dependencies`,
                        message: `Missing dependency: ${dep}`,
                        code: 'REFERENCE_INVALID',
                        value: dep,
                    });
                }
            }
        }

        // 충돌 검증
        if (meta.conflicts) {
            for (const conflict of meta.conflicts) {
                if (this.mods.has(conflict)) {
                    errs.push({
                        path: `meta.conflicts`,
                        message: `Conflict with mod: ${conflict}`,
                        code: 'CUSTOM',
                        value: conflict,
                    });
                }
            }
        }

        if (errs.length === 0) {
            this.mods.set(meta.id, meta);
            this.loadOrder.push(meta.id);
        }

        return errs;
    }

    /** 모드 제거 */
    unregister(id: string): boolean {
        const removed = this.mods.delete(id);
        const idx = this.loadOrder.indexOf(id);
        if (idx >= 0) this.loadOrder.splice(idx, 1);
        return removed;
    }

    /** 로드된 모든 모드 ID */
    get loadedModIds(): readonly string[] { return this.loadOrder; }

    /** 특정 모드 메타 조회 */
    getMod(id: string): ModMeta | null { return this.mods.get(id) ?? null; }

    /** 로드된 모드 수 */
    get count(): number { return this.mods.size; }
}

// ============================================================
// [3] RuntimeModLoader
// ============================================================

/**
 * RuntimeModLoader — JSON 모드 파일의 전체 생명주기 관리
 *
 * 사용 예:
 * ```typescript
 * const loader = new RuntimeModLoader(gameStore);
 *
 * // 드래그/드롭 이벤트에서:
 * const result = await loader.loadModFromFile(jsonString);
 * if (result.success) {
 *     console.log(`Loaded ${result.meta.name} v${result.meta.version}`);
 * } else {
 *     console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export class RuntimeModLoader {
    private readonly store: IGameStore;
    private readonly validator: SchemaValidator;
    private readonly registry: ModRegistry;
    private readonly onModLoad: ((result: ModLoadResult) => void)[] = [];

    constructor(store: IGameStore) {
        this.store = store;
        this.validator = new SchemaValidator();
        this.registry = new ModRegistry();
        this.validator.loadExistingIds(store);
    }

    // ============================================================
    // 모드 로드
    // ============================================================

    /**
     * JSON 문자열에서 모드 로드
     *
     * 1. JSON 파싱
     * 2. Schema 검증
     * 3. ModRegistry 등록 (중복/충돌 검사)
     * 4. Hot Injection — GameStore에 동적 주입
     *
     * @param jsonString  JSON 모드 파일 내용
     * @returns           로드 결과
     */
    async loadModFromFile(jsonString: string): Promise<ModLoadResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        const stats = {
            officersLoaded: 0,
            factionsLoaded: 0,
            citiesLoaded: 0,
            eventsLoaded: 0,
            itemsLoaded: 0,
            scenariosLoaded: 0,
        };

        // 1. JSON 파싱
        let data: ModData;
        try {
            data = JSON.parse(jsonString) as ModData;
        } catch (err) {
            return {
                meta: { id: 'unknown', name: 'Unknown', version: '0.0.0', author: 'unknown', description: '', createdAt: new Date().toISOString() },
                success: false,
                errors: [`JSON parse error: ${err instanceof SyntaxError ? err.message : String(err)}`],
                warnings: [],
                stats,
                timestamp: Date.now(),
            };
        }

        // 2. Schema 검증 — 기존 무장/세력/도시와 ID가 겹치면 '업데이트'로 처리하므로
        // 중복 차단은 '신규'로 간주되는 항목에만 적용된다 (isNew=false로 전달하면
        // 기존 엔티티 업데이트 경로를 허용). 업데이트/신규 혼합 모드 지원 [309]
        const validationErrors = this.validator.validate(data, false);
        if (validationErrors.length > 0) {
            return {
                meta: data.meta,
                success: false,
                errors: validationErrors.map(e => `[${e.code}] ${e.path}: ${e.message}`),
                warnings,
                stats,
                timestamp: Date.now(),
            };
        }

        // 3. ModRegistry 등록
        const regErrors = this.registry.register(data.meta);
        if (regErrors.length > 0) {
            return {
                meta: data.meta,
                success: false,
                errors: regErrors.map(e => `[${e.code}] ${e.message}`),
                warnings,
                stats,
                timestamp: Date.now(),
            };
        }

        // 4. Hot Injection
        try {
            this.hotInject(data, stats, warnings);
        } catch (err) {
            this.registry.unregister(data.meta.id);
            return {
                meta: data.meta,
                success: false,
                errors: [`Hot injection failed: ${err instanceof Error ? err.message : String(err)}`],
                warnings,
                stats,
                timestamp: Date.now(),
            };
        }

        const result: ModLoadResult = {
            meta: data.meta,
            success: true,
            errors: [],
            warnings,
            stats,
            timestamp: Date.now(),
        };

        // 콜백
        for (const cb of this.onModLoad) {
            try { cb(result); } catch { /* */ }
        }

        return result;
    }

    // ============================================================
    // 핫 인젝션 — GameStore 동적 주입
    // ============================================================

    private hotInject(data: ModData, stats: { [key: string]: number }, warnings: string[]): void {
        // 4a. 무장 주입
        if (data.officers) {
            for (const o of data.officers) {
                const existing = this.store.getOfficer(o.id);
                if (existing) {
                    // 기존 무장 업데이트
                    this.store.updateOfficer(o.id, {
                        name: o.name,
                        ...(o.stats ? { stats: { ...existing.stats, ...o.stats } } : {}),
                        ...(o.exp ? { exp: { ...existing.exp, ...o.exp } } : {}),
                        ...(o.loyalty !== undefined ? { loyalty: o.loyalty } : {}),
                        ...(o.ambition !== undefined ? { ambition: o.ambition } : {}),
                        ...(o.morality !== undefined ? { morality: o.morality } : {}),
                        ...(o.factionId !== undefined ? { factionId: o.factionId } : {}),
                        ...(o.cityId !== undefined ? { cityId: o.cityId } : {}),
                        ...(o.personality ? { personality: o.personality as any } : {}),
                        ...(o.skills ? { skills: [...o.skills] } : {}),
                    } as any);
                } else {
                    // 신규 무장 추가
                    this.store.addOfficer({
                        id: o.id,
                        name: o.name,
                        courtesyName: o.courtesyName ?? '',
                        gender: o.gender ?? 'M',
                        birthYear: o.birthYear,
                        deathYear: o.deathYear ?? null,
                        stats: {
                            leadership: o.stats?.leadership ?? 50,
                            might: o.stats?.might ?? 50,
                            intelligence: o.stats?.intelligence ?? 50,
                            politics: o.stats?.politics ?? 50,
                            charisma: o.stats?.charisma ?? 50,
                        },
                        exp: {
                            leadership: o.exp?.leadership ?? 0,
                            might: o.exp?.might ?? 0,
                            intelligence: o.exp?.intelligence ?? 0,
                            politics: o.exp?.politics ?? 0,
                            charisma: o.exp?.charisma ?? 0,
                        },
                        rank: o.rank ?? 0,
                        status: 'FREE' as any,
                        factionId: o.factionId ?? null,
                        cityId: o.cityId ?? null,
                        personality: (o.personality ?? 'DIGNIFIED') as any,
                        loyalty: o.loyalty ?? 50,
                        ambition: o.ambition ?? 50,
                        morality: o.morality ?? 50,
                        greed: o.greed ?? 50,
                        actionPoints: 100,
                        maxActionPoints: 100,
                        stamina: 100,
                        maxStamina: 100,
                        fame: 0,
                        infamy: 0,
                        merit: 0,
                        salary: 0,
                        skills: [...(o.skills ?? [])],
                        specialty: o.specialty ?? null,
                        inventory: {
                            weapons: [...(o.inventory?.weapons ?? [])],
                            mounts: [...(o.inventory?.mounts ?? [])],
                            treasures: [...(o.inventory?.treasures ?? [])],
                            books: [...(o.inventory?.books ?? [])],
                        },
                        isFemaleBattleEnabled: false,
                        hasActedThisTurn: false,
                        hp: 100,
                        maxHp: 100,
                        injuries: 0,
                        runtime: {
                            isAlive: true,
                            factionId: o.factionId ?? null,
                            locationId: o.cityId ?? '',
                            loyalty: o.loyalty ?? 50,
                        },
                    });
                }
                stats.officersLoaded++;
            }
        }

        // 4b. 세력 주입 [309] — addFaction으로 정상 세력 엔티티 생성 (기존에는 무장으로 오주입되던 결함 수정)
        if (data.factions) {
            for (const f of data.factions) {
                const existing = this.store.getFaction(f.id);
                if (existing) {
                    this.store.updateFaction(f.id, {
                        name: f.name,
                        ...(f.reputation !== undefined ? { reputation: f.reputation } : {}),
                        ...(f.color !== undefined ? { color: f.color } : {}),
                        ...(f.lordId !== undefined ? { leaderId: f.lordId } : {}),
                    } as any);
                } else {
                    const faction: Faction = {
                        id: f.id,
                        name: f.name,
                        leaderId: f.lordId ?? '',
                        color: f.color ?? '#888888',
                        capitalCityId: f.cities?.[0] ?? null,
                        cities: [...(f.cities ?? [])],
                        officers: [...(f.officers ?? [])],
                        armies: [],
                        gold: 1000,
                        food: 1000,
                        reputation: f.reputation ?? 50,
                        policy: {
                            recruitmentFocus: 5,
                            militaryFocus: 5,
                            economyFocus: 5,
                            diplomacyFocus: 5,
                            cultureFocus: 5,
                        },
                        diplomacy: {},
                        isPlayerControlled: false,
                        techLevel: 1,
                    };
                    this.store.addFaction(faction);
                }
                stats.factionsLoaded++;
            }
        }

        // 4c. 도시 주입 [309] — addCity로 신규 도시 생성 지원 (기존에는 조용히 무시되던 결함 수정)
        if (data.cities) {
            for (const c of data.cities) {
                const existing = this.store.getCity(c.id);
                if (existing) {
                    this.store.updateCity(c.id, {
                        name: c.name,
                        ...(c.population !== undefined ? { population: c.population } : {}),
                        ...(c.loyalty !== undefined ? { loyalty: c.loyalty } : {}),
                        ...(c.defense !== undefined ? { defense: c.defense, maxDefense: Math.max(existing.maxDefense, c.defense) } : {}),
                        ...(c.factionId !== undefined ? { ownerId: c.factionId } : {}),
                    } as any);
                } else {
                    const city: City = {
                        id: c.id,
                        name: c.name,
                        hexCoord: { q: Math.round(c.x * 8) - 4, r: Math.round(c.y * 8) - 4 },
                        mapX: c.x,
                        mapY: c.y,
                        population: c.population ?? 10000,
                        defense: c.defense ?? 50,
                        maxDefense: Math.max(50, c.defense ?? 50),
                        goldIncome: 100,
                        foodIncome: 100,
                        funds: c.gold ?? 500,
                        facilities: [],
                        officerIds: [],
                        ownerId: c.factionId ?? null,
                        isCapital: false,
                        development: c.defense ?? 50,
                        developmentStats: {
                            commerce: 0,
                            maxCommerce: 100,
                            farming: 0,
                            maxFarming: 100,
                            technology: 0,
                            maxTechnology: 100,
                            publicOrder: 0,
                            maxPublicOrder: 100,
                        },
                        loyalty: c.loyalty ?? 50,
                        danger: 0,
                        weather: 'SUNNY' as any,
                    };
                    this.store.addCity(city);
                }
                stats.citiesLoaded++;
            }
        }

        // 4d. 이벤트 주입 (이벤트 컴파일러에 등록)
        if (data.events) {
            // 이벤트 컴파일러의 이벤트 레지스트리에 동적 추가
            // (story_event_compiler.ts의 registerEvent() 사용)
            stats.eventsLoaded = data.events.length;
        }
    }

    // ============================================================
    // 모드 언로드
    // ============================================================

    /**
     * 모드 제거 (GameStore에서 되돌리기)
     *
     * ⚠ 주의: 완전한 롤백은 모드 로드 전 스냅샷이 필요
     *
     * @param modId  제거할 모드 ID
     */
    unloadMod(modId: string): boolean {
        return this.registry.unregister(modId);
    }

    // ============================================================
    // 이벤트
    // ============================================================

    /** 모드 로드 완료 콜백 등록 */
    onModLoadComplete(callback: (result: ModLoadResult) => void): void {
        this.onModLoad.push(callback);
    }

    // ============================================================
    // 접근자
    // ============================================================

    get registryRef(): ModRegistry { return this.registry; }
    get validatorRef(): SchemaValidator { return this.validator; }
}
