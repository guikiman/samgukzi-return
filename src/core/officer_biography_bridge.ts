/**
 * [A2-bridge] 정적 도장 데이터 ↔ OfficerBiographyStore 연결층.
 *
 * 왜 이 파일이 필요한가
 * --------------------
 * `officer_biography_store.ts` 의 `OfficerBio.biography` 는 57개 소비자가 읽는 필드인데
 * 지금까지 채우는 코드가 없다. `officer_dossier.ts` 는 1,200명 전원의 한국어 도장을
 * 만들 수 있는데 둘이 연결된 적이 없다. 이 모듈이 그 사이를 잇는다.
 *
 * 이 모듈은 `officer_biography_store.ts` / `officer_dossier.ts` /
 * `officer_profile_schema.ts` 를 수정하지 않는다. 저장소를 채우는 일만 한다.
 *
 * ID 전략 — `off_NNNN` 을 정본으로 쓴다 (이름 추측 금지)
 * -----------------------------------------------------
 * 정적 데이터셋의 id 규칙은 `off_NNNN` = 정리표 1,200행의 행 순서이고,
 * 시뮬레이션 계층의 id 는 `liu_bei` / `cao_pi` 같은 자유 입력 문자열이다.
 * 둘 사이에 신뢰할 수 있는 공통 키가 없다. 이름으로 매핑하려 하면 동명이인 73그룹
 * (예: 순욱 = 荀攸 off_0393 / 荀彧 off_0397)을 만나게 되고, 임의로 하나를 고르는
 * 것은 조용한 오답이다.
 *
 * 그래서 이 브리지는:
 *   1. 저장소 키로 언제나 `off_NNNN` 을 쓴다. (데이터셋 id = 정본)
 *   2. 이름 조회는 `resolveOfficerIdByName()` 한 곳으로만 가고, 동명이인이면
 *      `ambiguous` 결과를 돌려주며 아무것도 고르지 않는다.
 *   3. `BRIDGE_ID_STRATEGY` 상수로 전략을 코드에 남겨 호출자가 읽게 한다.
 *
 * 필드 매핑 — 없는 값은 없는 대로
 * ------------------------------
 * | OfficerBio  | 출처                                          |
 * |-------------|-----------------------------------------------|
 * | id          | `profile.id` (off_NNNN)                        |
 * | name        | `profile.name`                                 |
 * | chineseName | `nameEn` → `pinyin` → `name` (한자 데이터 없음) |
 * | aliases     | `profile.aliases`                              |
 * | birthYear   | `profile.birthYear`, 0 = 미상                   |
 * | deathYear   | `profile.deathYear`, 0 이면 생존                |
 * | biography   | 도장 문단 (손글씨면 원문 그대로)                 |
 * | personality | `personality` → 첫 성향 trait → 'UNSPECIFIED'   |
 * | skills      | `tactics` → `traits` → `[]`                     |
 * | portrait    | 매핑하지 않음 (`portraitPrompt` 는 경로가 아님)  |
 *
 * 생존 정규화 (저장소 규약 보존)
 * ----------------------------
 * `OfficerBiographyStore` 는 `deathYear === 0` 을 "아직 살아 있다"로 읽는다.
 * 데이터셋은 값이 없으면 `null` 로 주기도 하고 `0` 으로 주기도 하므로,
 * 들어오는 값이 `null` / `0` / 음수 / 비유한수면 모두 `0` 으로 접는다.
 * 그러면 `isAlive` / `getOfficersAliveInYear` / `checkNaturalDeaths` 가
 * 저장소가 원래 의도한 대로 동작한다. 저장소 코드는 건드리지 않는다.
 *
 * 결정론
 * ------
 * `Math.random()` 을 쓰지 않는다. 순회는 `OFFICER_PROFILES.all()` 의 순서
 * (= 데이터셋 행 순서)를 그대로 따르고, 성향·전법 배열도 입력 순서를 보존한다.
 *
 * 손으로 쓴 bio
 * --------------
 * `dossier.isHandwritten` 면 `biography` 는 원문 bio 를 한 글자도 바꾸지 않고
 * 그대로 넣는다. 도장 생성기가 `summary` 에 이미 보장하는 것을 다시 정리하지 않는다.
 * 나머지 세 줄(trait/relation/career)은 `getBridgeDossierParagraphs()` 로 따로 열람한다.
 */

// [부팅 수정] 이 모듈은 src/main.ts 를 통해 브라우저 모듈 그래프에 포함된다.
// 브라우저는 확장자 자동 해석(extension resolution)을 하지 않으므로 상대 경로에는
// 반드시 '.js' 를 붙여야 한다. tsc 는 스펙리파터를 재작성하지 않으므로
// './foo' 로 쓰면 dist 에도 './foo' 가 그대로 남아 404 로 부팅이 실패한다.
// 규약: 브라우저에 노출되는 모듈의 모든 상대 import 에 '.js' 를 명시한다.
import { OfficerBiographyStore } from './officer_biography_store.js';
import type { OfficerBio } from './officer_biography_store.js';
import { buildOfficerDossierFromProfile, dossierParagraphs } from './officer_dossier.js';
import type { OfficerDossier } from './officer_dossier.js';
import { OFFICER_PROFILES } from './officer_profile_schema.js';
import type { OfficerProfile } from './officer_profile_schema.js';
import type { OfficerID } from './types.js';

// ---------------------------------------------------------------- 공개 타입

/** 저장소 키로 쓰는 id 규칙. 문자열 상수라서 호출자가 그대로 읽을 수 있다. */
export const BRIDGE_ID_STRATEGY =
    'dataset-off_nnnn' as const;

/** `personality` 칸이 비어 있고 성향 trait 도 없을 때 들어가는 값. */
export const UNSPECIFIED_PERSONALITY = 'UNSPECIFIED';

/** 저장소가 `deathYear === 0` 을 "생존"으로 읽는다는 사실의 이름. */
export const ALIVE_SENTINEL_YEAR = 0;

export interface BridgeAmbiguousName {
    readonly name: string;
    /** 2개 이상. 순서는 데이터셋 등장 순서. */
    readonly candidateIds: readonly OfficerID[];
    /** 동명이인 판정 근거 — 후보가 몇 명인지. */
    readonly reason: 'duplicate-name';
}

export type NameResolution =
    | { readonly status: 'resolved'; readonly name: string; readonly id: OfficerID }
    | { readonly status: 'ambiguous'; readonly name: string; readonly candidates: readonly OfficerID[] }
    | { readonly status: 'not-found'; readonly name: string; readonly candidates: readonly OfficerID[] };

export interface BridgeReport {
    /** 저장소에 들어간 총 인원. */
    readonly bridged: number;
    /** 도장 문단이 하나라도 비어 건너뛴 인원. */
    readonly skipped: number;
    readonly skippedIds: readonly OfficerID[];
    /** 원문 bio 를 그대로 실은 인원 (bio 가 있는 프로필 수와 같다). */
    readonly handwritten: number;
    /** 도장 생성기가 합성한 문단을 실은 인원. */
    readonly generated: number;
    /** 데이터셋이 스스로 동명이인이라고 밝힌 이름 그룹 수. */
    readonly ambiguousNameGroups: number;
    /** 이름으로 단일 조회가 막힌 이름 목록. */
    readonly ambiguousNames: readonly BridgeAmbiguousName[];
    /** 관계 대상 id 가 데이터셋에서 안 풀린 건수. */
    readonly unresolvedRelationTargets: number;
    readonly idStrategy: typeof BRIDGE_ID_STRATEGY;
}

export interface BridgeOptions {
    /** 기존 저장소를 이어 채울지, 새 저장소를 만들지. 기본 false. */
    readonly reuse?: boolean;
}

// ---------------------------------------------------------------- 정규화

function isUsableString(raw: unknown): raw is string {
    return typeof raw === 'string' && raw.trim() !== '';
}

/** 유한한 양수 연도만 통과시킨다. 그 외(0/음수/null/NaN)는 0 = '없음'. */
function normalizeYear(raw: number | null | undefined): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
    const t = Math.trunc(raw);
    return t > 0 ? t : 0;
}

/** 사망 연도를 저장소 규약(0 = 생존)으로 접는다. */
export function normalizeDeathYear(raw: number | null | undefined): number {
    return normalizeYear(raw);
}

/** 출생 연도를 저장소 규약(0 = 미상)으로 접는다. */
export function normalizeBirthYear(raw: number | null | undefined): number {
    return normalizeYear(raw);
}

/** 중복 없이, 입력 순서를 보존한다. */
function uniqueStrings(raw: readonly string[] | undefined | null): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const s of raw) {
        if (isUsableString(s) && !out.includes(s.trim())) out.push(s.trim());
    }
    return out;
}

/**
 * 한자 이름. 데이터셋에 한자·번역자·병음이 모두 비어 있어(1,200명 전원)
 * 최후 수단으로 한국어 이름을 넣는다. 없는 값을 지어내지 않는다.
 */
function resolveChineseName(p: OfficerProfile): string {
    if (isUsableString(p.nameEn)) return p.nameEn.trim();
    if (isUsableString(p.pinyin)) return p.pinyin.trim();
    return p.name;
}

/** 성향 문자열. `personality` 칸이 전원 비어 있어 trait 으로 대신한다. */
function resolvePersonality(p: OfficerProfile): string {
    if (isUsableString(p.personality)) return p.personality.trim();
    const traits = uniqueStrings(p.traits);
    return traits.length > 0 ? traits[0] : UNSPECIFIED_PERSONALITY;
}

/** 전법을 우선, 없으면 성향을 기술 목록으로 쓴다. */
function resolveSkills(p: OfficerProfile): string[] {
    const tactics = uniqueStrings(p.tactics);
    if (tactics.length > 0) return tactics;
    return uniqueStrings(p.traits);
}

// ---------------------------------------------------------------- 도장 → 열전

/**
 * 도장 문단을 하나의 열전 문자열로 잇는다.
 *
 * 손글씨 bio 면 원문을 **한 글자도 바꾸지 않고** 그대로 쓴다. 도장 생성기가
 * `summary` 에 이미 보장하므로 여기서 다시 정리하거나 덧붙이지 않는다.
 * 나머지 세 줄(trait/relation/career)은 `getBridgeDossierParagraphs()` 로 따로 본다.
 *
 * 생성 문단은 받은 `dossier` 의 네 줄을 그대로 잇는다. 레지스트리를 다시 조회를
 * 하지 않으므로, 레지스트리에 없는 시험용 프로필에도 빈 문자열이 나오지 않는다.
 */
export function buildBiographyText(dossier: OfficerDossier, profile: OfficerProfile): string {
    if (dossier.isHandwritten) {
        const raw = profile.bio;
        if (isUsableString(raw)) return raw;
        return dossier.summary;
    }
    return [dossier.summary, dossier.traitLine, dossier.relationLine, dossier.careerLine]
        .filter(s => s !== '')
        .join('\n\n');
}

/** 프로필 하나 → 저장소가 바로 받을 수 있는 `OfficerBio`. */
export function toOfficerBio(profile: OfficerProfile, dossier: OfficerDossier): OfficerBio {
    return {
        id: profile.id,
        name: profile.name,
        chineseName: resolveChineseName(profile),
        aliases: uniqueStrings(profile.aliases),
        birthYear: normalizeBirthYear(profile.birthYear),
        deathYear: normalizeDeathYear(profile.deathYear),
        biography: buildBiographyText(dossier, profile),
        personality: resolvePersonality(profile),
        skills: resolveSkills(profile),
    };
}

/** id 로 도장을 다시 뽑는다. 레지스트리에 없으면 undefined. */
export function getBridgeDossier(id: OfficerID): OfficerDossier | undefined {
    if (typeof id !== 'string' || id === '') return undefined;
    const p = OFFICER_PROFILES.get(id);
    return p ? buildOfficerDossierFromProfile(p) : undefined;
}

/** id 로 도장 문단 배열을 그대로 돌려준다(손글씨 bio 포함). */
export function getBridgeDossierParagraphs(id: OfficerID): string[] {
    if (typeof id !== 'string' || id === '') return [];
    return dossierParagraphs(id);
}

// ---------------------------------------------------------------- 동명이인

/**
 * 데이터셋이 스스로 밝힌 동명이인 그룹을 정규화한다.
 * 후보가 2명 이상인 이름만 남기고, 후보 id 가 실제로 존재하는지도 확인한다.
 */
export function listAmbiguousNames(): BridgeAmbiguousName[] {
    const raw = OFFICER_PROFILES.ambiguousNames;
    const out: BridgeAmbiguousName[] = [];
    for (const name of Object.keys(raw).sort()) {
        const ids = raw[name];
        if (!Array.isArray(ids) || ids.length < 2) continue;
        const candidateIds = ids.filter(id => OFFICER_PROFILES.get(id) !== undefined);
        // 후보가 줄면 1명이 되어 더 이상 모호하지 않다.
        if (candidateIds.length < 2) continue;
        out.push({ name, candidateIds, reason: 'duplicate-name' });
    }
    return out;
}

/** 특정 이름이 동명이인인지 (레지스트리 판정을 그대로 쓴다). */
export function isAmbiguousOfficerName(name: string): boolean {
    if (typeof name !== 'string' || name === '') return false;
    return OFFICER_PROFILES.isAmbiguousName(name);
}

/**
 * 이름 → 저장소 id. 동명이인이면 절대 고르지 않고 `ambiguous` 로 돌려준다.
 * 별칭도 같이 본다(레지스트리가 name + aliases 로 색인한다).
 */
export function resolveOfficerIdByName(name: string): NameResolution {
    if (typeof name !== 'string' || name.trim() === '') {
        return { status: 'not-found', name: String(name), candidates: [] };
    }
    const hits = OFFICER_PROFILES.findByName(name);
    if (hits.length === 0) {
        return { status: 'not-found', name, candidates: [] };
    }
    const ids = hits.map(p => p.id);
    if (ids.length > 1) {
        return { status: 'ambiguous', name, candidates: ids };
    }
    return { status: 'resolved', name, id: ids[0] };
}

// ---------------------------------------------------------------- 관계 검증

/**
 * 관계 대상 id 중 레지스트리에서 안 풀리는 것의 개수.
 * 도장 생성기는 못 푸는 대상을 조용히 버리므로, 데이터 품질 신호로 따로 세 둔다.
 */
export function countUnresolvedRelationTargets(profiles: readonly OfficerProfile[]): number {
    let unresolved = 0;
    for (const p of profiles) {
        const rel = p.relations;
        if (rel === undefined || rel === null) continue;
        for (const kind of ['parents', 'spouse', 'swornSiblings', 'close', 'hate'] as const) {
            const list = rel[kind];
            if (!Array.isArray(list)) continue;
            for (const target of list) {
                if (OFFICER_PROFILES.get(target) === undefined) unresolved += 1;
            }
        }
    }
    return unresolved;
}

// ---------------------------------------------------------------- 브리지

export interface BridgeResult {
    readonly store: OfficerBiographyStore;
    readonly report: BridgeReport;
}

/**
 * 정적 데이터셋 전체를 저장소에 채운다.
 *
 * 도장 문단이 비면 저장소에 넣지 않고 `skipped` 로 센다 — 빈 문자열 열전을
 * 57개 소비자에게 흘려보내지 않기 위해서다.
 *
 * @param store 기존 저장소를 이어 채우려면 넘긴다.
 * @param options.reuse true 면 저장소를 비우지 않고 위에 덮어쓴다(기본: 비운다).
 */
export function bridgeOfficerBiographies(
    store?: OfficerBiographyStore,
    options: BridgeOptions = {},
): BridgeResult {
    const target = store ?? new OfficerBiographyStore();
    if (options.reuse !== true) target.clear();

    const profiles = OFFICER_PROFILES.all();
    const skippedIds: OfficerID[] = [];
    let handwritten = 0;
    let generated = 0;

    for (const profile of profiles) {
        // id 가 비었으면 정규화 결과가 무의미하므로 건너뛴다.
        if (!isUsableString(profile.id)) {
            skippedIds.push(String(profile.id));
            continue;
        }

        const dossier = buildOfficerDossierFromProfile(profile);
        const bio = toOfficerBio(profile, dossier);

        // 열전이 비면 넣지 않는다. 공백뿐인 것도 빈 것으로 본다.
        if (bio.biography.trim() === '') {
            skippedIds.push(bio.id);
            continue;
        }

        target.addOfficer(bio);
        if (dossier.isHandwritten) handwritten += 1;
        else generated += 1;
    }

    const ambiguousNames = listAmbiguousNames();
    return {
        store: target,
        report: {
            bridged: target.count,
            skipped: skippedIds.length,
            skippedIds,
            handwritten,
            generated,
            ambiguousNameGroups: ambiguousNames.length,
            ambiguousNames,
            unresolvedRelationTargets: countUnresolvedRelationTargets(profiles),
            idStrategy: BRIDGE_ID_STRATEGY,
        },
    };
}

export interface BridgeResult {
    readonly store: OfficerBiographyStore;
    readonly report: BridgeReport;
}

/** 저장소를 새로 만들어 채운다. */
export function buildBridgedBiographyStore(): BridgeResult {
    return bridgeOfficerBiographies();
}

// ---------------------------------------------------------------- 모듈 단일 인스턴스

const SINGLETON = buildBridgedBiographyStore();

/** 읽기 전용 조회를 위한 모듈 레벨 저장소(한 번만 구축한다). */
export const BRIDGED_BIOGRAPHY_STORE: OfficerBiographyStore = SINGLETON.store;

/** 모듈 레벨 구축 집계. */
export const BRIDGE_REPORT: BridgeReport = SINGLETON.report;

/** id 로 채워진 열전 한 건을 꺼낸다. id 가 없으면 null. */
export function getBridgeOfficer(id: OfficerID): OfficerBio | null {
    if (typeof id !== 'string' || id === '') return null;
    return BRIDGED_BIOGRAPHY_STORE.getOfficer(id);
}

/** 저장소가 아니라 도장 텍스트만 필요할 때. id 가 없으면 null. */
export function bridgeBiographyText(id: OfficerID): string | null {
    const bio = getBridgeOfficer(id);
    return bio === null ? null : bio.biography;
}
