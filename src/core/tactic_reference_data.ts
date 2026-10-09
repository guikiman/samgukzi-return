/**
 * 삼국지14PK 정리표 기준 데이터 레지스트리 — 전법·정책·진형·지역·개성효과.
 *
 * 장수 프로필(officer_profile_schema.ts)이 참조하는 이름의 정의를 보유한다.
 * 전술/정책 시뮬레이션 로직은 이 모듈을 읽지 않는다 — 정의 조회 전용이다.
 */

import tacticsJson from '../data/tactics.json' with { type: 'json' };
import policiesJson from '../data/policies.json' with { type: 'json' };
import formationsJson from '../data/formations.json' with { type: 'json' };
import regionsJson from '../data/regions.json' with { type: 'json' };
import personalityEffectsJson from '../data/personality_effects.json' with { type: 'json' };

export interface TacticDef {
    name: string;
    sheet: string;
    category: string | null;
    requiresStat: string | null;
    baseAttack: string | null;
    effect1: string | null;
    range1: number | null;
    power1: number | null;
    duration1: number | null;
    effect2: string | null;
    range2: number | null;
    power2: number | null;
    duration2: number | null;
    cooldown: string | null;
    holders: string | null;
    /** 공용전법과 명칭이 겹치는 교역전법의 보유 세력. 공용 항목에 함께 보존된다. */
    tradeHolders: string[];
}

export interface PolicyDef {
    name: string;
    department: string | null;
    effects: string[];
}

export interface FormationDef {
    name: string;
    type: string | null;
    cost: string | null;
    ranged: string | null;
    occupyWidth3: number | null;
    occupyWidth5: number | null;
    movement: number | null;
    rangedPower: number | null;
    siege: number | null;
    morale: number | null;
    defense: number | null;
    description: string | null;
}

export interface RegionDef {
    name: string;
    gold: number | null;
    food: number | null;
    population: number | null;
    areaCode: number | null;
    totalOutput: number | null;
}

export type PersonalityTier = 'GOLD' | 'BLUE' | 'RED';

export interface PersonalityEffectDef {
    name: string;
    tier: PersonalityTier;
    effect: string | null;
    holders: string[];
}

interface Envelope<T> {
    version: number;
    count: number;
    [k: string]: unknown;
}

function index<T>(src: Record<string, T>): Map<string, T> {
    return new Map(Object.entries(src));
}

const TACTICS_RAW = tacticsJson as unknown as Envelope<TacticDef> & {
    tactics: Record<string, TacticDef>;
    undefinedReferencedByOfficers: string[];
    nameCollisions: Record<string, string[]>;
};
const POLICIES_RAW = policiesJson as unknown as Envelope<PolicyDef> & {
    policies: Record<string, PolicyDef>;
};
const FORMATIONS_RAW = formationsJson as unknown as Envelope<FormationDef> & {
    formations: Record<string, FormationDef>;
};
const REGIONS_RAW = regionsJson as unknown as Envelope<RegionDef> & {
    regions: Record<string, RegionDef>;
    populationEntryCount: number;
    populationByCity: Record<string, number>;
};
const EFFECTS_RAW = personalityEffectsJson as unknown as Envelope<PersonalityEffectDef> & {
    effects: Record<string, PersonalityEffectDef>;
};

export const TACTICS: ReadonlyMap<string, TacticDef> = index(TACTICS_RAW.tactics);
export const POLICIES: ReadonlyMap<string, PolicyDef> = index(POLICIES_RAW.policies);
export const FORMATIONS: ReadonlyMap<string, FormationDef> = index(FORMATIONS_RAW.formations);
export const REGIONS: ReadonlyMap<string, RegionDef> = index(REGIONS_RAW.regions);
export const PERSONALITY_EFFECTS: ReadonlyMap<string, PersonalityEffectDef> = index(EFFECTS_RAW.effects);

export const POPULATION_BY_CITY: Readonly<Record<string, number>> = REGIONS_RAW.populationByCity;
export const UNDEFINED_TACTICS: readonly string[] = TACTICS_RAW.undefinedReferencedByOfficers;
export const TACTIC_NAME_COLLISIONS: Readonly<Record<string, string[]>> = TACTICS_RAW.nameCollisions;

export function getTactic(name: string): TacticDef | undefined {
    return TACTICS.get(name);
}

export function getPolicy(name: string): PolicyDef | undefined {
    return POLICIES.get(name);
}

export function getFormation(name: string): FormationDef | undefined {
    return FORMATIONS.get(name);
}

export function getRegion(name: string): RegionDef | undefined {
    return REGIONS.get(name);
}

export function getPersonalityEffect(name: string): PersonalityEffectDef | undefined {
    return PERSONALITY_EFFECTS.get(name);
}

export function policiesByDepartment(): Map<string, PolicyDef[]> {
    const out = new Map<string, PolicyDef[]>();
    for (const p of POLICIES.values()) {
        const d = p.department ?? '미지정';
        const b = out.get(d);
        if (b) b.push(p);
        else out.set(d, [p]);
    }
    return out;
}

export function personalityEffectsByTier(): Map<PersonalityTier, PersonalityEffectDef[]> {
    const out = new Map<PersonalityTier, PersonalityEffectDef[]>();
    for (const e of PERSONALITY_EFFECTS.values()) {
        const b = out.get(e.tier);
        if (b) b.push(e);
        else out.set(e.tier, [e]);
    }
    return out;
}
