/**
 * 삼국지14PK 174개 전법의 효과 해석 레이어 (ADDITIVE ONLY)
 * 파일: src/core/tactics.json → src/core/tactic_effects.ts
 *
 * 목적: 기준 데이터(tactics.json)의 한국어 효과 문자열을 "구조화된 수치 변경자"로
 * 해석해, 전투 로직이 *언젠가* 소비할 수 있는 typed 해석층을 제공한다.
 *
 * ⚠️ 이 모듈은 아직 어떤 기존 모듈에서도 import 되지 않는다.
 *    전투 동작을 바꾸지 않기 위한 의도적 고립이며, 기존 테스트에 영향을 주지 않는다.
 *    실제 전투 반영은 후속 태스크에서 호출부를 선택적으로 연결할 때 수행한다.
 *
 * [tactics-link] data-only interpretation layer
 */

import {
    TACTICS,
    UNDEFINED_TACTICS,
    TACTIC_NAME_COLLISIONS,
    type TacticDef,
} from './rtk14_reference_data';
import { OFFICER_PROFILES } from './officer_profile_schema';
import type { OfficerID } from './types';

// ============================================================
// 1. 공개 타입
// ============================================================

/**
 * 전법 계통(tactics.json 의 category).
 * 원본에 기재가 없던 42개 전법은 '미지정' 으로 정규화한다.
 */
export type TacticCategory =
    | '공격' | '원거리' | '방어' | '제압' | '계략' | '지원' | '병기' | '배' | '미지정';

/** 계통 문자열 → 정규화된 TacticCategory (미기재 = '미지정') */
export const TACTIC_CATEGORIES: readonly TacticCategory[] = [
    '공격', '원거리', '방어', '제압', '계략', '지원', '병기', '배', '미지정',
];

/**
 * 효과가 개입하는 능력 지표.
 *
 * - 사기/방어/공성/기동/파성/전능력 : 전투 시스템이 이미 보유한 전투 지표
 * - 내구/부상병/상태이상           : 상태이상 계통에서 다루는 지표
 * - MIGHT/INTELLIGENCE            : 본문이 지표를 특정하지 않을 때 requiresStat 로 유도
 * - NONE                         : 지표를 특정할 근거가 없음 (효과 자체는 명확)
 */
export type TacticStat =
    | 'MORALE' | 'DEFENSE' | 'SIEGE' | 'MOBILITY' | 'CHARGE' | 'ALL_STATS'
    | 'ENDURANCE' | 'WOUNDS' | 'STATUS' | 'MIGHT' | 'INTELLIGENCE' | 'NONE';

/** 효과가 적용되는 상대군. */
export type TacticTarget = 'ALLY' | 'ENEMY' | 'SELF' | 'NONE';

/** 효과가 개입하는 성격. */
export type TacticEffectKind =
    | 'DAMAGE'      // 피해
    | 'BUFF'        // 아군 지표 상승
    | 'DEBUFF'      // 적 지표 저하
    | 'STATUS_APPLY' // 상태이상 부여
    | 'HEAL'        // 회복
    | 'CLEANSE';    // 상태이상 해소

/**
 * 개별 효과 1건.
 *
 * `amount` 는 항상 **양수 크기**이며 부호는 `kind` 가 결정한다.
 *   - BUFF         → 지표 +amount
 *   - DEBUFF       → 지표 -amount
 *   - DAMAGE       → 대상 피해량 amount
 *   - HEAL/CLEANSE → 회복량 amount
 *
 * ⚠️ power1/power2 가 null 인 전법(예: '상태이상 해소')은 amount=0 으로 해석된다.
 *    효과의 "종류"는 확실하지만 "크기"가 기준 데이터에 없기 때문이다.
 *    소비 측에서 별도 처리가 필요하며, 이 사실을 흐리지 않기 위해 0 으로 남긴다.
 */
export interface TacticModifier {
    /** 효과를 적용할 상대군 */
    readonly target: TacticTarget;
    /** 개입 지표 */
    readonly stat: TacticStat;
    /** 위력(power1/power2). 음수 아님. */
    readonly amount: number;
    /** 효과 성격 */
    readonly kind: TacticEffectKind;
}

/** 전법 해석 상태 — 정의 있음 / 장수가 참조하나 정의 없음 / 전혀 모름 */
export type TacticDefinitionStatus = 'DEFINED' | 'UNDEFINED_REFERENCED' | 'UNKNOWN';

/** 효과 슬롯 1건 (raw + 해석 결과 병기) */
export interface TacticEffectSlot {
    /** 원본 효과 문자열 (없으면 null) */
    readonly raw: string | null;
    /** 사거리 (원본 유지) */
    readonly range: number | null;
    /** 위력 (원본 유지) */
    readonly power: number | null;
    /** 지속 (원본 유지) */
    readonly duration: number | null;
    /** 해석된 변경자 (파싱 실패 시 빈 배열) */
    readonly modifiers: readonly TacticModifier[];
}


/**
 * 해석된 전법 1건.
 *
 * 정의가 없는 전법도 이 형태로 표현한다(`status='UNDEFINED_REFERENCED'`).
 * 장수 데이터가 참조하지만 기준 데이터에 정의가 없는 2종
 * (오와지변, 충요의열) 을 조용히 버리지 않기 위한 장치다.
 */
export interface ResolvedTactic {
    readonly name: string;
    /** 정의 존재 여부 — UNDEFINED_REFERENCED / UNKNOWN 모두 false */
    readonly defined: boolean;
    readonly status: TacticDefinitionStatus;
    /** 정규화된 계통 */
    readonly category: TacticCategory;
    /** 의존 능력치 (원본 유지: 무력 / 지력 / null) */
    readonly requiresStat: string | null;
    /** 재사용 대기일. "18일" → 18, 파싱 불가·미기재 시 null */
    readonly cooldownDays: number | null;
    /** effect1/effect2 해석 결과 (2슬롯 고정) */
    readonly effects: readonly [TacticEffectSlot, TacticEffectSlot];
    /** effect1+effect2 를 합친 변경자 목록 */
    readonly modifiers: readonly TacticModifier[];
    /** 신뢰할 수 있게 파싱되지 않은 효과 문자열 목록 */
    readonly unparsedEffects: readonly string[];
    /** 출처 시트 (공용전법 / 고유전법). 미정 정의면 null */
    readonly sheet: string | null;
    /** 거점공격 (X / O / null) */
    readonly baseAttack: string | null;
    /** 교역전법 보유 세력. 공용 항목과 명칭이 겹칠 수 있다. */
    readonly tradeHolders: readonly string[];
    /** 동명이 전법 시트 목록 (공용전법 ↔ PK교역전법 충돌 기록) */
    readonly nameCollisions: readonly string[];
    /** 원본 레코드. 정의가 없으면 null */
    readonly raw: Readonly<TacticDef> | null;
}

// ============================================================
// 2. 효과 문자열 파싱 사전
// ============================================================

/**
 * 정규화: 모든 공백을 제거한다.
 * 기준 데이터에는 '아군 사기 상승' 과 '아군사기상승' 이 같은 효과로
 * 두 가지 표기가 공존하므로, 비교 전에 반드시 정규화한다.
 */
function normalizeEffect(text: string): string {
    return text.replace(/\s+/g, '');
}

/** 파싱 사전 항목 */
interface EffectRule {
    /** 본문이 특정한 지표 (deriveFromRequiresStat 이 true 면 무시된다) */
    readonly stat: TacticStat;
    readonly target: TacticTarget;
    readonly kind: TacticEffectKind;
    /** 본문이 지표를 특정하지 않아 requiresStat 로 유도해야 하는가 */
    readonly deriveFromRequiresStat: boolean;
    /** 파싱 근거 (문서용) */
    readonly rationale: string;
}

/**
 * 정규화된 효과 문자열 → 해석 규칙.
 *
 * 해석 규칙 요약:
 *  - '아군' 접두 → 아군 버프, '적' 접두 → 적 디버프
 *  - 본문에 지표 명사가 있으면 그 지표를 쓴다
 *  - '공군' 은 기준 데이터 표기이며 '공성'(攻城)의 준표기로 함께 SIEGE 로 본다
 *  - '저지' 는 기동(移動) 정지를 뜻하므로 MOBILITY 로 본다
 *  - '혼란'/'도발'/'발화'/'전상태이상' 은 수치 지표가 아니라 상태이상 적용이다
 *  - '피해' 는 지표를 특정하지 않으므로 requiresStat 로 유도한다
 *  - 사전에 없는 문자열은 파싱하지 않고 unparsedEffects 로 노출한다 (추측 금지)
 */
const EFFECT_PARSING_TABLE: Readonly<Record<string, EffectRule>> = {
    // ── 피해 ──
    '피해': {
        stat: 'NONE', target: 'ENEMY', kind: 'DAMAGE', deriveFromRequiresStat: true,
        rationale: '지표 미특정 — requiresStat(무력/지력)로 피해 근거 능력 유도',
    },
    '내구피해': {
        stat: 'ENDURANCE', target: 'ENEMY', kind: 'DAMAGE', deriveFromRequiresStat: false,
        rationale: '내구(耐久)를 직접 깎는 피해',
    },

    // ── 아군 버프 ──
    '아군사기상승': { stat: 'MORALE', target: 'ALLY', kind: 'BUFF', deriveFromRequiresStat: false, rationale: '사기 상승' },
    '아군방어상승': { stat: 'DEFENSE', target: 'ALLY', kind: 'BUFF', deriveFromRequiresStat: false, rationale: '방어 상승' },
    '아군공군상승': { stat: 'SIEGE', target: 'ALLY', kind: 'BUFF', deriveFromRequiresStat: false, rationale: '공성(攻城) 상승 — 기준 데이터의 "공군" 표기' },
    '아군공성상승': { stat: 'SIEGE', target: 'ALLY', kind: 'BUFF', deriveFromRequiresStat: false, rationale: '공성(攻城) 상승' },
    '아군기동상승': { stat: 'MOBILITY', target: 'ALLY', kind: 'BUFF', deriveFromRequiresStat: false, rationale: '기동 상승' },
    '아군파성상승': { stat: 'CHARGE', target: 'ALLY', kind: 'BUFF', deriveFromRequiresStat: false, rationale: '파성 상승' },
    '아군전능력상승': { stat: 'ALL_STATS', target: 'ALLY', kind: 'BUFF', deriveFromRequiresStat: false, rationale: '전 능력치 상승' },

    // ── 적 디버프 ──
    '적사기저하': { stat: 'MORALE', target: 'ENEMY', kind: 'DEBUFF', deriveFromRequiresStat: false, rationale: '사기 저하' },
    '적방어저하': { stat: 'DEFENSE', target: 'ENEMY', kind: 'DEBUFF', deriveFromRequiresStat: false, rationale: '방어 저하' },
    '적공군저하': { stat: 'SIEGE', target: 'ENEMY', kind: 'DEBUFF', deriveFromRequiresStat: false, rationale: '공성(攻城) 저하 — 기준 데이터의 "공군" 표기' },
    '적공성저하': { stat: 'SIEGE', target: 'ENEMY', kind: 'DEBUFF', deriveFromRequiresStat: false, rationale: '공성(攻城) 저하' },
    '적기동저하': { stat: 'MOBILITY', target: 'ENEMY', kind: 'DEBUFF', deriveFromRequiresStat: false, rationale: '기동 저하' },
    '적파성저하': { stat: 'CHARGE', target: 'ENEMY', kind: 'DEBUFF', deriveFromRequiresStat: false, rationale: '파성 저하' },
    '적전능력저하': { stat: 'ALL_STATS', target: 'ENEMY', kind: 'DEBUFF', deriveFromRequiresStat: false, rationale: '전 능력치 저하' },

    // ── 상태이상 부여 ──
    '혼란부여': { stat: 'STATUS', target: 'ENEMY', kind: 'STATUS_APPLY', deriveFromRequiresStat: false, rationale: '혼란(混亂) 부여 — 수치 지표가 아닌 상태이상' },
    '저지부여': { stat: 'MOBILITY', target: 'ENEMY', kind: 'STATUS_APPLY', deriveFromRequiresStat: false, rationale: '저지 = 기동 정지이므로 MOBILITY 로 본다' },
    '도발부여': { stat: 'STATUS', target: 'ENEMY', kind: 'STATUS_APPLY', deriveFromRequiresStat: false, rationale: '도발 부여 — 수치 지표가 아닌 상태이상' },
    '발화': { stat: 'STATUS', target: 'ENEMY', kind: 'STATUS_APPLY', deriveFromRequiresStat: false, rationale: '발화(發火) — 화상 등 상태이상' },
    '전상태이상부여': { stat: 'STATUS', target: 'ENEMY', kind: 'STATUS_APPLY', deriveFromRequiresStat: false, rationale: '전체 상태이상 부여' },

    // ── 회복 / 해제 ──
    '부상병회복': { stat: 'WOUNDS', target: 'ALLY', kind: 'HEAL', deriveFromRequiresStat: false, rationale: '부상병 회복' },
    '상태이상해소': { stat: 'STATUS', target: 'ALLY', kind: 'CLEANSE', deriveFromRequiresStat: false, rationale: '상태이상 해제' },
};

/** requiresStat(무력/지력) → 해당 효과의 근거 능력 지표 */
const REQUIRES_STAT_TO_STAT: Readonly<Record<string, TacticStat>> = {
    '무력': 'MIGHT',
    '지력': 'INTELLIGENCE',
};

/** 계통 문자열 정규화 */
const CATEGORY_NORMALIZATION: Readonly<Record<string, TacticCategory>> = {
    '공격': '공격', '원거리': '원거리', '방어': '방어', '제압': '제압',
    '계략': '계략', '지원': '지원', '병기': '병기', '배': '배',
};

/** "18일" → 18. 그 외 형태는 null (조용히 추정하지 않는다) */
function parseCooldownDays(cooldown: string | null): number | null {
    if (cooldown === null) return null;
    const match = /^(\d+)일$/.exec(normalizeEffect(cooldown));
    if (!match) return null;
    const days = Number(match[1]);
    return Number.isFinite(days) ? days : null;
}


// ============================================================
// 3. 파싱 코어
// ============================================================

/** 효과 문자열 1개를 규칙 사전에 조회해 변경자 규격을 만든다. */
function parseEffectRule(effect: string, requiresStat: string | null): EffectRule | null {
    const rule = EFFECT_PARSING_TABLE[normalizeEffect(effect)];
    if (!rule) return null;

    if (!rule.deriveFromRequiresStat) return rule;

    // 본문이 지표를 특정하지 않는 경우 — requiresStat 로 근거 능력을 유도한다.
    const derived = requiresStat !== null ? REQUIRES_STAT_TO_STAT[requiresStat] : undefined;
    if (derived === undefined) return null; // 의존 능력치도 없으면 추측하지 않는다.
    return { ...rule, stat: derived };
}

/** 효과 슬롯 1개를 해석한다. range/power/duration 은 원본 그대로 보존한다. */
function resolveEffectSlot(
    raw: string | null,
    range: number | null,
    power: number | null,
    duration: number | null,
    requiresStat: string | null,
): TacticEffectSlot {
    if (raw === null) {
        return { raw: null, range, power, duration, modifiers: [] };
    }

    const rule = parseEffectRule(raw, requiresStat);
    if (!rule) {
        // 파싱 실패 — 원문은 슬롯에 그대로 남고 변경자는 내지 않는다.
        return { raw, range, power, duration, modifiers: [] };
    }

    return {
        raw,
        range,
        power,
        duration,
        modifiers: [{
            target: rule.target,
            stat: rule.stat,
            // 위력이 기준 데이터에 없으면 효과의 "크기"를 알 수 없다 → 0 으로 남긴다.
            amount: power !== null && Number.isFinite(power) ? Math.max(0, power) : 0,
            kind: rule.kind,
        }],
    };
}

/** 정의 없음 전법의 placeholder 를 만든다. */
function unresolvedTactic(name: string, status: TacticDefinitionStatus): ResolvedTactic {
    return {
        name,
        defined: false,
        status,
        category: '미지정',
        requiresStat: null,
        cooldownDays: null,
        effects: [
            { raw: null, range: null, power: null, duration: null, modifiers: [] },
            { raw: null, range: null, power: null, duration: null, modifiers: [] },
        ],
        modifiers: [],
        unparsedEffects: [],
        sheet: null,
        baseAttack: null,
        tradeHolders: [],
        nameCollisions: TACTIC_NAME_COLLISIONS[name] ?? [],
        raw: null,
    };
}


// ============================================================
// 4. 공개 조회 API
// ============================================================

/** 장수가 참조하나 정의가 없는 전법명 집합 (오와지변, 충요의열) */
const UNDEFINED_SET: ReadonlySet<string> = new Set(UNDEFINED_TACTICS);

/** resolveTactic 결과를 재사용하는 결정론적 캐시 */
const RESOLVED_CACHE: Map<string, ResolvedTactic> = new Map();

/** 이름 정렬 — locale 의존 정렬을 피하기 위한 명시적 비교 */
function byName(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 전법명을 해석한다. 정의가 없는 전법도 예외 없이 반환한다.
 * - 정의 있음             → status='DEFINED'
 * - 장수 참조 / 정의 없음 → status='UNDEFINED_REFERENCED' (오와지변, 충요의열)
 * - 완전 미지의 이름       → status='UNKNOWN'
 */
export function resolveTactic(name: string): ResolvedTactic {
    const cached = RESOLVED_CACHE.get(name);
    if (cached) return cached;

    const def = TACTICS.get(name);
    const resolved = def ? resolveDefinedTactic(name, def) : unresolvedTactic(
        name,
        UNDEFINED_SET.has(name) ? 'UNDEFINED_REFERENCED' : 'UNKNOWN',
    );

    RESOLVED_CACHE.set(name, resolved);
    return resolved;
}

function resolveDefinedTactic(name: string, def: TacticDef): ResolvedTactic {
    const requiresStat = def.requiresStat;
    const slot1 = resolveEffectSlot(def.effect1, def.range1, def.power1, def.duration1, requiresStat);
    const slot2 = resolveEffectSlot(def.effect2, def.range2, def.power2, def.duration2, requiresStat);

    const modifiers = [...slot1.modifiers, ...slot2.modifiers];
    const unparsedEffects: string[] = [];
    for (const slot of [slot1, slot2]) {
        if (slot.raw === null) continue;
        if (slot.modifiers.length === 0 && parseEffectRule(slot.raw, requiresStat) === null) {
            unparsedEffects.push(slot.raw);
        }
    }

    return {
        name,
        defined: true,
        status: 'DEFINED',
        category: (def.category !== null ? CATEGORY_NORMALIZATION[def.category] : undefined) ?? '미지정',
        requiresStat,
        cooldownDays: parseCooldownDays(def.cooldown),
        effects: [slot1, slot2],
        modifiers,
        unparsedEffects,
        sheet: def.sheet,
        baseAttack: def.baseAttack,
        tradeHolders: [...def.tradeHolders],
        nameCollisions: TACTIC_NAME_COLLISIONS[name] ?? [],
        raw: def,
    };
}


/** 전법명의 변경자 목록. 정의가 없거나 효과 문구가 없어도 빈 배열로 안전하다. */
export function getTacticModifiers(name: string): TacticModifier[] {
    return resolveTactic(name).modifiers.map((m) => ({ ...m }));
}

/** 전법이 실제로 정의되어 있는가. 참조만 되고 정의가 없는 것은 false 다. */
export function isTacticDefined(name: string): boolean {
    return TACTICS.has(name);
}

/** 계통별 전법명 목록 (결정론적 이름순) */
export function listTacticsByCategory(category: TacticCategory): string[] {
    const out: string[] = [];
    for (const name of TACTICS.keys()) {
        if (resolveTactic(name).category === category) out.push(name);
    }
    return out.sort(byName);
}

/**
 * 장수가 보유한 전법 목록.
 * 참조만 되고 정의가 없는 전법도 포함되며 defined=false 로 표기된다.
 * 장수 ID 가 존재하지 않으면 빈 배열.
 */
export function tacticsAvailableTo(officerId: OfficerID): ResolvedTactic[] {
    const profile = OFFICER_PROFILES.get(officerId);
    if (!profile) return [];
    return profile.tactics.map((t) => resolveTactic(t));
}

/** 정의된 전법 전체를 해석한다 (결정론적 이름순). */
export function allResolvedTactics(): ResolvedTactic[] {
    return [...TACTICS.keys()].sort(byName).map(resolveTactic);
}

/**
 * 신뢰할 수 있게 파싱되지 않은 효과 문자열의 목록 (중복 제거, 정렬).
 * 파싱 커버리지가 어디까지인지 눈으로 확인할 수 있는 갭 목록이다.
 */
export function unparsedEffectStrings(): string[] {
    const out = new Set<string>();
    for (const t of allResolvedTactics()) {
        for (const e of t.unparsedEffects) out.add(e);
    }
    return [...out].sort(byName);
}

/** 교역전법(공용전법과 명칭이 겹치는 4종)의 보유 세력 맵. 중립 세력 보유를 보존한다. */
export function tradeHoldersByTactic(): ReadonlyMap<string, readonly string[]> {
    const out = new Map<string, readonly string[]>();
    for (const t of allResolvedTactics()) {
        if (t.tradeHolders.length > 0) out.set(t.name, t.tradeHolders);
    }
    return out;
}

