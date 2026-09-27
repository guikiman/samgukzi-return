/**
 * 장수 정적 프로필(사전) 데이터 계층 — 삼국지14PK 정리표 기반.
 *
 * types.ts 의 Officer(hp, stamina, actionPoints 등 런타임 값)와 목적이 다르므로 분리한다.
 * 이 계층은 게임 진행 상태를 바꾸지 않는다.
 *
 * ID 규칙: off_NNNN = PK장수목록 1,200행의 행 순서.
 * 이름은 키가 될 수 없다 — distinct 1,124명 / 동명이인 73그룹 / 원본 자체가 '이풍2' 식으로
 * 접미 구분한다. 동명이인 이름은 ambiguousNames 로 노출하고 단일 조회를 거부한다.
 */

import type { FactionID, OfficerID, OfficerStats, Personality } from './types.js';
import officersFullJson from '../data/officers_full.json' with { type: 'json' };

export const OFFICER_RELATION_KINDS = [
    'parents',
    'spouse',
    'swornSiblings',
    'close',
    'hate',
] as const;
export type OfficerRelationKind = (typeof OFFICER_RELATION_KINDS)[number];
export type OfficerRelations = Record<OfficerRelationKind, OfficerID[]>;

export type OfficerRosterTier = 'PK_BASE' | 'PK_EXTRA';

export const FORMATION_KEYS = [
    '어린',
    '봉시',
    '안행',
    '방원',
    '학익',
    '장사',
    '추행',
    '정란',
    '충차',
    '투석',
] as const;
export type FormationKey = (typeof FORMATION_KEYS)[number];

export interface OfficerProfile {
    id: OfficerID;
    name: string;
    nameEn: string | null;
    pinyin: string | null;
    rosterTier: OfficerRosterTier;
    aliases: string[];
    gender: 'M' | 'F';
    birthYear: number | null;
    appearanceYear: number | null;
    serviceYear: number | null;
    deathYear: number | null;
    deathCause: number | null;
    affinity: number | null;
    stats: OfficerStats;
    grade: number | null;
    factionId: FactionID | null;
    factionLabel: string | null;
    corpsLabel: string | null;
    affiliationLabel: string | null;
    locationLabel: string | null;
    statusLabel: string | null;
    officeLabel: string | null;
    loyalty: number | null;
    illnessLabel: string | null;
    virtueLabel: string | null;
    policyLabel: string | null;
    policyGrade: number | null;
    voiceLabel: string | null;
    toneLabel: string | null;
    generation: number | null;
    personality: Personality | null;
    traits: string[];
    tactics: string[];
    formations: Partial<Record<FormationKey, boolean>>;
    relations: OfficerRelations;
    bio: string | null;
    /**
     * `bio` 에 손으로 쓴 글이 있는지. `bio` 로부터 유도되는 값이라 손으로 맞출 필요가 없다 —
     * `validateOfficerProfileDataset()` 이 둘이 어긋나면 오류로 막는다.
     * 판정식: `typeof bio === 'string' && bio.trim() !== ''`.
     */
    hasHandwrittenBio: boolean;
    portraitPrompt: string | null;
    provenance: string | null;
}

export interface OfficerProfileDataset {
    version: number;
    source: string;
    idScheme: string;
    excluded: { note: string };
    ambiguousNames: Record<string, OfficerID[]>;
    relationGaps: string[];
    counts: {
        total: number;
        pkExtra: number;
        withTraits: number;
        withTactics: number;
        withRelations: number;
        distinctNames: number;
        ambiguousNames: number;
    };
    profiles: Record<OfficerID, OfficerProfile>;
}

export class OfficerProfileRegistry {
    private readonly byId = new Map<OfficerID, OfficerProfile>();
    private readonly byName = new Map<string, OfficerID[]>();
    private readonly byTrait = new Map<string, OfficerID[]>();
    private readonly byTactic = new Map<string, OfficerID[]>();
    readonly relationGaps: readonly string[];
    readonly ambiguousNames: Readonly<Record<string, readonly OfficerID[]>>;

    constructor(dataset: OfficerProfileDataset) {
        this.relationGaps = [...dataset.relationGaps];
        this.ambiguousNames = dataset.ambiguousNames;

        for (const key of Object.keys(dataset.profiles)) {
            const p = dataset.profiles[key];
            this.byId.set(p.id, p);

            for (const n of [p.name, ...p.aliases]) {
                const b = this.byName.get(n);
                if (b) b.push(p.id);
                else this.byName.set(n, [p.id]);
            }
            for (const t of p.traits) {
                const b = this.byTrait.get(t);
                if (b) b.push(p.id);
                else this.byTrait.set(t, [p.id]);
            }
            for (const t of p.tactics) {
                const b = this.byTactic.get(t);
                if (b) b.push(p.id);
                else this.byTactic.set(t, [p.id]);
            }
        }
    }

    get size(): number {
        return this.byId.size;
    }

    all(): OfficerProfile[] {
        return [...this.byId.values()];
    }

    get(id: OfficerID): OfficerProfile | undefined {
        return this.byId.get(id);
    }

    findByName(name: string): OfficerProfile[] {
        return (this.byName.get(name) ?? []).map(id => this.byId.get(id)!).filter(Boolean);
    }

    /** 동명이인이면 undefined 를 반환해 잘못된 단일 조회를 막는다. */
    findExactlyByName(name: string): OfficerProfile | undefined {
        const hits = this.findByName(name);
        return hits.length === 1 ? hits[0] : undefined;
    }

    isAmbiguousName(name: string): boolean {
        return (this.byName.get(name)?.length ?? 0) > 1;
    }

    findByTrait(trait: string): OfficerProfile[] {
        return (this.byTrait.get(trait) ?? []).map(id => this.byId.get(id)!).filter(Boolean);
    }

    findByTactic(tactic: string): OfficerProfile[] {
        return (this.byTactic.get(tactic) ?? []).map(id => this.byId.get(id)!).filter(Boolean);
    }

    distinctTraits(): string[] {
        return [...this.byTrait.keys()];
    }

    distinctTactics(): string[] {
        return [...this.byTactic.keys()];
    }

    related(id: OfficerID, kind: OfficerRelationKind): OfficerProfile[] {
        const p = this.byId.get(id);
        if (!p) return [];
        return p.relations[kind].map(t => this.byId.get(t)).filter((x): x is OfficerProfile => !!x);
    }

    displayName(id: OfficerID): string {
        const p = this.byId.get(id);
        return p ? p.name : id;
    }
}

// ---------------------------------------------------------------- 검증 [301]

export interface DatasetValidationResult {
    ok: boolean;
    errors: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
    return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function isNullishString(v: unknown): v is string | null {
    return v === null || typeof v === 'string';
}

/** `hasHandwrittenBio` 의 유일한 진리 원천. bio 가 실제로 글자를 담고 있는가. */
export function hasUsableBioText(bio: unknown): boolean {
    return typeof bio === 'string' && bio.trim() !== '';
}

const VALID_TIERS: ReadonlySet<string> = new Set(['PK_BASE', 'PK_EXTRA']);
const STAT_KEYS = ['leadership', 'might', 'intelligence', 'politics', 'charisma'] as const;
const NULLABLE_NUM = [
    'birthYear', 'appearanceYear', 'serviceYear', 'deathYear', 'deathCause',
    'affinity', 'grade', 'loyalty', 'policyGrade', 'generation',
] as const;
const NULLABLE_STR = [
    'nameEn', 'pinyin', 'factionLabel', 'corpsLabel', 'affiliationLabel', 'locationLabel',
    'statusLabel', 'officeLabel', 'illnessLabel', 'virtueLabel', 'policyLabel',
    'voiceLabel', 'toneLabel', 'bio', 'portraitPrompt', 'provenance',
] as const;

function validateProfile(
    key: string,
    raw: unknown,
    known: ReadonlySet<string>,
    errors: string[],
): void {
    if (!isRecord(raw)) {
        errors.push(`${key}: 프로필이 객체가 아님`);
        return;
    }
    if (raw.id !== key) errors.push(`${key}: id 가 키와 불일치 (${String(raw.id)})`);
    if (typeof raw.name !== 'string' || !raw.name) errors.push(`${key}: name 없음`);
    if (raw.gender !== 'M' && raw.gender !== 'F') {
        errors.push(`${key}: gender '${String(raw.gender)}' 유효하지 않음`);
    }
    if (typeof raw.rosterTier !== 'string' || !VALID_TIERS.has(raw.rosterTier)) {
        errors.push(`${key}: rosterTier '${String(raw.rosterTier)}' 유효하지 않음`);
    }
    if (typeof raw.hasHandwrittenBio !== 'boolean') {
        errors.push(`${key}: hasHandwrittenBio 가 boolean 아님`);
    } else if (raw.hasHandwrittenBio !== hasUsableBioText(raw.bio)) {
        // 파생 필드라 조용히 어긋날 수 있다. bio 를 고쳤는데 플래그를 안 고친 상태를 여기서 막는다.
        errors.push(
            `${key}: hasHandwrittenBio(${raw.hasHandwrittenBio}) 가 bio 와 불일치 ` +
                `(bio 가 ${hasUsableBioText(raw.bio) ? '있으므로 true 여야 함' : '없으므로 false 여야 함'})`,
        );
    }
    if (!isStringArray(raw.aliases)) errors.push(`${key}: aliases 가 문자열 배열이 아님`);
    if (!isStringArray(raw.traits)) errors.push(`${key}: traits 가 문자열 배열이 아님`);
    if (!isStringArray(raw.tactics)) errors.push(`${key}: tactics 가 문자열 배열이 아님`);

    for (const f of NULLABLE_NUM) {
        const v = raw[f];
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
            errors.push(`${key}.${f}: 숫자|null 이 아님`);
        }
    }
    for (const f of NULLABLE_STR) {
        if (!isNullishString(raw[f])) errors.push(`${key}.${f}: 문자열|null 이 아님`);
    }

    if (!isRecord(raw.stats)) {
        errors.push(`${key}: stats 가 객체가 아님`);
    } else {
        for (const s of STAT_KEYS) {
            const v = raw.stats[s];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                errors.push(`${key}.stats.${s}: 숫자 아님`);
            }
        }
    }

    if (!isRecord(raw.formations)) {
        errors.push(`${key}: formations 가 객체가 아님`);
    } else {
        for (const f of FORMATION_KEYS) {
            const v = raw.formations[f];
            if (v !== undefined && typeof v !== 'boolean') {
                errors.push(`${key}.formations.${f}: boolean 아님`);
            }
        }
    }

    if (!isRecord(raw.relations)) {
        errors.push(`${key}: relations 가 객체가 아님`);
        return;
    }
    for (const kind of OFFICER_RELATION_KINDS) {
        const list = raw.relations[kind];
        if (!isStringArray(list)) {
            errors.push(`${key}.relations.${kind}: 문자열 배열이 아님`);
            continue;
        }
        for (const t of list) {
            if (t === key) errors.push(`${key}.relations.${kind}: 자기 자신 참조`);
            else if (!known.has(t)) errors.push(`${key}.relations.${kind}: '${t}' 존재하지 않음`);
        }
    }
}

export function validateOfficerProfileDataset(raw: unknown): DatasetValidationResult {
    const errors: string[] = [];
    if (!isRecord(raw)) return { ok: false, errors: ['데이터셋 루트가 객체가 아님'] };
    if (typeof raw.version !== 'number') errors.push('version 이 숫자 아님');
    if (!isStringArray(raw.relationGaps)) errors.push('relationGaps 가 문자열 배열이 아님');
    if (!isRecord(raw.ambiguousNames)) errors.push('ambiguousNames 가 객체가 아님');
    if (!isRecord(raw.counts)) errors.push('counts 가 객체가 아님');
    if (!isRecord(raw.profiles)) {
        errors.push('profiles 가 객체가 아님');
        return { ok: false, errors };
    }
    const known = new Set(Object.keys(raw.profiles));
    for (const k of known) validateProfile(k, raw.profiles[k], known, errors);
    if (isRecord(raw.counts) && typeof raw.counts.total === 'number' && raw.counts.total !== known.size) {
        errors.push(`counts.total(${raw.counts.total}) 이 profiles 크기(${known.size})와 불일치`);
    }
    return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- 싱글턴

const DATASET = officersFullJson as unknown as OfficerProfileDataset;

export const OFFICER_PROFILES = new OfficerProfileRegistry(DATASET);

export function getOfficerProfile(id: OfficerID): OfficerProfile | undefined {
    return OFFICER_PROFILES.get(id);
}
