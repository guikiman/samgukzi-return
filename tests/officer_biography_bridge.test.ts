/**
 * [A2-bridge] 도장 ↔ 열전 브리지 검증.
 *
 * 검증 축
 *   1. 도장 문단이 있는 무장은 전원 비어 있지 않은 열전을 갖는다.
 *   2. 열전에 `null` / `undefined` / `NaN` 리터럴이 새지 않는다.
 *   3. 손으로 쓴 bio 가 원문과 바이트 단위로 같다.
 *   4. 사망 연도가 0 / null / 실연도일 때 저장소 규약(isAlive·calculateAge·
 *      checkNaturalDeaths)이 제대로 읽는다.
 *   5. 동명이인은 고르지 않고 보고만 한다.
 *   6. 결정론 — 같은 입력에 같은 결과, `Math.random()` 없음.
 */
import { describe, it, expect } from 'vitest';
import {
    ALIVE_SENTINEL_YEAR,
    BRIDGE_ID_STRATEGY,
    BRIDGE_REPORT,
    BRIDGED_BIOGRAPHY_STORE,
    UNSPECIFIED_PERSONALITY,
    bridgeBiographyText,
    bridgeOfficerBiographies,
    buildBridgedBiographyStore,
    buildBiographyText,
    countUnresolvedRelationTargets,
    getBridgeDossier,
    getBridgeDossierParagraphs,
    getBridgeOfficer,
    isAmbiguousOfficerName,
    listAmbiguousNames,
    normalizeBirthYear,
    normalizeDeathYear,
    resolveOfficerIdByName,
    toOfficerBio,
} from '../src/core/officer_biography_bridge';
import { buildOfficerDossierFromProfile } from '../src/core/officer_dossier';
import { OFFICER_PROFILES, type OfficerProfile } from '../src/core/officer_profile_schema';
import { OfficerBiographyStore } from '../src/core/officer_biography_store';

const ALL: readonly OfficerProfile[] = OFFICER_PROFILES.all();
const ALL_IDS: readonly string[] = ALL.map(p => p.id);
const HANDWRITTEN: readonly OfficerProfile[] = ALL.filter(p => p.bio !== null && p.bio !== undefined);
const HANDWRITTEN_EXPECTED = 62;
const { store: STORE, report: REPORT } = buildBridgedBiographyStore();


/** 도장 문단이 하나라도 있는 프로필. */
function withDossierText(p: OfficerProfile): boolean {
    return getBridgeDossierParagraphs(p.id).length > 0;
}

// ---------------------------------------------------------------- 1. 커버리지

describe('bridge coverage', () => {
    it('bridges every officer whose dossier has text', () => {
        const expected = ALL.filter(withDossierText).length;
        expect(REPORT.bridged).toBe(expected);
        expect(STORE.count).toBe(expected);
    });

    it('gives every bridged officer a non-empty biography', () => {
        const empty = STORE.getAllOfficers()
            .filter(b => b.biography.trim() === '')
            .map(b => b.id);
        expect(empty).toEqual([]);
    });

    it('reports the split between hand-authored and generated bios', () => {
        expect(REPORT.handwritten).toBe(HANDWRITTEN.length);
        expect(REPORT.handwritten).toBe(HANDWRITTEN_EXPECTED);
        expect(REPORT.generated).toBe(REPORT.bridged - REPORT.handwritten);
        expect(REPORT.handwritten + REPORT.generated).toBe(REPORT.bridged);
    });

    it('skips nothing and names the id strategy explicitly', () => {
        expect(REPORT.skipped).toBe(0);
        expect(REPORT.skippedIds).toEqual([]);
        expect(REPORT.idStrategy).toBe(BRIDGE_ID_STRATEGY);
        expect(BRIDGE_ID_STRATEGY).toBe('dataset-off_nnnn');
    });

    it('keys entries by the dataset id, not by a simulation-layer name', () => {
        for (const id of ALL_IDS) {
            expect(STORE.getOfficer(id)).not.toBeNull();
        }
        // 시뮬레이션 계층의 id 규약(liu_bei 등)은 저장소 키로 쓰지 않는다.
        expect(STORE.getOfficer('liu_bei')).toBeNull();
        expect(STORE.getOfficer('')).toBeNull();
    });
});

// ---------------------------------------------------------------- 2. 텍스트 위생

describe('biography text integrity', () => {
    it('never leaks null, undefined or NaN literals', () => {
        const offenders = STORE.getAllOfficers()
            .filter(b => /\bnull\b|\bundefined\b|\bNaN\b/.test(b.biography))
            .map(b => b.id);
        expect(offenders).toEqual([]);
    });

    it('has no undefined or NaN in any other bridged field', () => {
        for (const b of STORE.getAllOfficers()) {
            expect(Number.isFinite(b.birthYear)).toBe(true);
            expect(Number.isFinite(b.deathYear)).toBe(true);
            expect(b.name).not.toBe('');
            expect(typeof b.chineseName).toBe('string');
            expect(b.chineseName).not.toBe('');
            expect(Array.isArray(b.aliases)).toBe(true);
            expect(Array.isArray(b.skills)).toBe(true);
            expect(b.personality).not.toBe('');
        }
    });

    it('keeps the dossier paragraphs for generated bios', () => {
        const p = ALL.find(x => buildOfficerDossierFromProfile(x).isHandwritten === false)!;
        const bio = getBridgeOfficer(p.id);
        expect(bio).not.toBeNull();
        const paragraphs = getBridgeDossierParagraphs(p.id);
        expect(paragraphs.length).toBeGreaterThan(0);
        expect(bio!.biography).toBe(paragraphs.join('\n\n'));
    });

    it('returns null for ids outside the dataset instead of throwing', () => {
        expect(bridgeBiographyText('off_9999')).toBeNull();
        expect(bridgeBiographyText('')).toBeNull();
        expect(getBridgeDossier('off_9999')).toBeUndefined();
        expect(getBridgeDossier('')).toBeUndefined();
        expect(getBridgeDossierParagraphs('off_9999')).toEqual([]);
    });
});

// ---------------------------------------------------------------- 3. 손글씨 17개

describe('hand-authored bios pass through verbatim', () => {
    it('finds every hand-authored profile', () => {
        expect(HANDWRITTEN.length).toBe(HANDWRITTEN_EXPECTED);
    });

    it('stores each hand-authored bio byte-identical to the source', () => {
        for (const p of HANDWRITTEN) {
            const bio = getBridgeOfficer(p.id);
            expect(bio, `missing bridged bio for ${p.id}`).not.toBeNull();
            expect(bio!.biography).toBe(p.bio);
            expect(bio!.biography.length).toBe(p.bio!.length);
        }
    });

    it('does not append or tidy the generated lines onto a hand-authored bio', () => {
        for (const p of HANDWRITTEN) {
            const bio = getBridgeOfficer(p.id);
            expect(bio!.biography).not.toContain('\n');
            expect(bio!.biography.endsWith('.')).toBe(true);
        }
    });

    it('marks exactly the hand-authored profiles as such', () => {
        const marked = ALL.filter(p => buildOfficerDossierFromProfile(p).isHandwritten);
        expect(marked.length).toBe(HANDWRITTEN_EXPECTED);
        for (const p of marked) {
            expect(getBridgeOfficer(p.id)!.biography).toBe(p.bio);
        }
    });

    it('buildBiographyText returns the raw bio for handwritten profiles', () => {
        const p = HANDWRITTEN[0];
        const dossier = buildOfficerDossierFromProfile(p);
        expect(dossier.isHandwritten).toBe(true);
        expect(buildBiographyText(dossier, p)).toBe(p.bio);
    });
});

// ---------------------------------------------------------------- 4. 사망 연도 정규화

/** 실제 무장 하나를 골라 사망 연도만 바꿔 보관소에 넣어 본다. */
function storeWithDeathYear(raw: number | null): OfficerBiographyStore {
    const base = ALL[0];
    const profile: OfficerProfile = { ...base, id: 'off_test_norm', deathYear: raw };
    const dossier = buildOfficerDossierFromProfile(profile);
    const s = new OfficerBiographyStore();
    s.addOfficer(toOfficerBio(profile, dossier));
    return s;
}

describe('death year normalization', () => {
    it('maps null, 0 and negative to the alive sentinel', () => {
        expect(normalizeDeathYear(null)).toBe(ALIVE_SENTINEL_YEAR);
        expect(normalizeDeathYear(0)).toBe(ALIVE_SENTINEL_YEAR);
        expect(normalizeDeathYear(-5)).toBe(ALIVE_SENTINEL_YEAR);
        expect(normalizeDeathYear(Number.NaN)).toBe(ALIVE_SENTINEL_YEAR);
        expect(normalizeDeathYear(undefined)).toBe(ALIVE_SENTINEL_YEAR);
    });

    it('keeps a real death year and truncates it', () => {
        expect(normalizeDeathYear(220)).toBe(220);
        expect(normalizeDeathYear(220.7)).toBe(220);
    });

    it('normalizes birth year the same way', () => {
        expect(normalizeBirthYear(null)).toBe(0);
        expect(normalizeBirthYear(0)).toBe(0);
        expect(normalizeBirthYear(190)).toBe(190);
    });

    it('treats a source deathYear of 0 as alive and never a natural death', () => {
        const s = storeWithDeathYear(0);
        const bio = s.getOfficer('off_test_norm')!;
        expect(bio.deathYear).toBe(ALIVE_SENTINEL_YEAR);
        expect(s.isAlive('off_test_norm', 300)).toBe(true);
        expect(s.checkNaturalDeaths(0)).toEqual([]);
        expect(s.checkNaturalDeaths(300)).toEqual([]);
        expect(s.getOfficersAliveInYear(300).map(b => b.id)).toEqual(['off_test_norm']);
    });

    it('treats a source deathYear of null as alive too', () => {
        const s = storeWithDeathYear(null);
        expect(s.getOfficer('off_test_norm')!.deathYear).toBe(ALIVE_SENTINEL_YEAR);
        expect(s.isAlive('off_test_norm', 300)).toBe(true);
        expect(s.checkNaturalDeaths(300)).toEqual([]);
    });

    it('reports a real death year exactly once through checkNaturalDeaths', () => {
        const s = storeWithDeathYear(250);
        const bio = s.getOfficer('off_test_norm')!;
        expect(bio.deathYear).toBe(250);
        const deaths = s.checkNaturalDeaths(250);
        expect(deaths).toHaveLength(1);
        expect(deaths[0].officerId).toBe('off_test_norm');
        expect(deaths[0].year).toBe(250);
        expect(deaths[0].age).toBe(250 - bio.birthYear);
        expect(s.checkNaturalDeaths(249)).toEqual([]);
        expect(s.isAlive('off_test_norm', 249)).toBe(true);
        expect(s.isAlive('off_test_norm', 251)).toBe(false);
    });

    it('keeps calculateAge sane for every normalized year kind', () => {
        for (const raw of [0, null, 250]) {
            const s = storeWithDeathYear(raw);
            const age = s.calculateAge('off_test_norm', 220);
            expect(Number.isFinite(age)).toBe(true);
            expect(age).toBe(220 - s.getOfficer('off_test_norm')!.birthYear);
        }
    });

    it('returns -1 and false for ids the store does not know', () => {
        const s = storeWithDeathYear(0);
        expect(s.calculateAge('off_missing', 200)).toBe(-1);
        expect(s.isAlive('off_missing', 200)).toBe(false);
    });
});

// ---------------------------------------------------------------- 5. 동명이인

describe('homonym ambiguity is surfaced, never resolved', () => {
    it('lists the dataset homonym groups', () => {
        const groups = listAmbiguousNames();
        expect(groups.length).toBeGreaterThan(0);
        expect(REPORT.ambiguousNameGroups).toBe(groups.length);
        expect(REPORT.ambiguousNames).toEqual(groups);
        for (const g of groups) {
            expect(g.candidateIds.length).toBeGreaterThanOrEqual(2);
            expect(g.reason).toBe('duplicate-name');
        }
    });

    it('reports 순욱 as two distinct people instead of picking one', () => {
        const group = listAmbiguousNames().find(g => g.name === '순욱');
        expect(group).toBeDefined();
        expect(group!.candidateIds.length).toBeGreaterThanOrEqual(2);
        expect(group!.candidateIds).toContain('off_0393');
        expect(group!.candidateIds).toContain('off_0397');
        // 두 사람 모두 저장소에는 별개 항목으로 존재한다.
        for (const id of group!.candidateIds) {
            const bio = getBridgeOfficer(id);
            expect(bio).not.toBeNull();
            expect(bio!.name).toBe('순욱');
            expect(bio!.biography).not.toBe('');
        }
    });

    it('never resolves an ambiguous name to a single id', () => {
        const res = resolveOfficerIdByName('순욱');
        expect(res.status).toBe('ambiguous');
        if (res.status !== 'ambiguous') throw new Error('expected ambiguous');
        expect(res.candidates.length).toBeGreaterThanOrEqual(2);
        expect(res).not.toHaveProperty('id');
    });

    it('resolves a unique name to exactly one dataset id', () => {
        const res = resolveOfficerIdByName('관우');
        expect(res.status).toBe('resolved');
        if (res.status !== 'resolved') throw new Error('expected resolved');
        expect(getBridgeOfficer(res.id)).not.toBeNull();
        expect(getBridgeOfficer(res.id)!.name).toBe('관우');
    });

    it('reports not-found for unknown or blank names', () => {
        expect(resolveOfficerIdByName('없는사람').status).toBe('not-found');
        expect(resolveOfficerIdByName('').status).toBe('not-found');
        expect(resolveOfficerIdByName('   ').status).toBe('not-found');
    });

    it('flags homonyms and only homonyms as ambiguous', () => {
        expect(isAmbiguousOfficerName('순욱')).toBe(true);
        expect(isAmbiguousOfficerName('관우')).toBe(false);
        expect(isAmbiguousOfficerName('')).toBe(false);
    });

    it('keeps every homonym candidate inside the store', () => {
        for (const g of listAmbiguousNames()) {
            for (const id of g.candidateIds) {
                expect(STORE.getOfficer(id), `${g.name} candidate ${id} missing`).not.toBeNull();
            }
        }
    });
});

// ---------------------------------------------------------------- 6. 결정론 / 관계 / 필드

describe('determinism and relation safety', () => {
    it('produces identical results on repeated builds', () => {
        const a = buildBridgedBiographyStore();
        const b = buildBridgedBiographyStore();
        expect(a.report).toEqual(b.report);
        expect(a.store.getAllOfficers().map(o => o.biography))
            .toEqual(b.store.getAllOfficers().map(o => o.biography));
    });

    it('matches the module-level singleton', () => {
        expect(BRIDGED_BIOGRAPHY_STORE.count).toBe(REPORT.bridged);
        expect(BRIDGE_REPORT).toEqual(REPORT);
    });

    it('clears the target store by default and preserves it on reuse', () => {
        const manual = {
            id: 'off_manual', name: '수동', chineseName: '手動', aliases: [],
            birthYear: 100, deathYear: 150, biography: '손으로 넣은 열전',
            personality: 'LOYAL', skills: [],
        };
        const s = new OfficerBiographyStore();
        s.addOfficer(manual);
        bridgeOfficerBiographies(s);
        expect(s.getOfficer('off_manual')).toBeNull();
        expect(s.count).toBe(REPORT.bridged);

        s.addOfficer(manual);
        bridgeOfficerBiographies(s, { reuse: true });
        expect(s.getOfficer('off_manual')).not.toBeNull();
    });

    it('counts relation targets that do not resolve', () => {
        const broken: OfficerProfile = {
            ...ALL[0],
            relations: { ...ALL[0].relations, hate: ['off_9999'] },
        };
        expect(countUnresolvedRelationTargets([ALL[0]])).toBe(0);
        expect(countUnresolvedRelationTargets([broken])).toBe(1);
        expect(REPORT.unresolvedRelationTargets).toBeGreaterThanOrEqual(0);
    });

    it('fills personality and skills without inventing values', () => {
        const noTraits: OfficerProfile = {
            ...ALL[0],
            id: 'off_test_empty',
            name: '무성향',
            personality: null,
            traits: [],
            tactics: [],
        };
        const bio = toOfficerBio(noTraits, buildOfficerDossierFromProfile(noTraits));
        expect(bio.personality).toBe(UNSPECIFIED_PERSONALITY);
        expect(bio.skills).toEqual([]);
        expect(bio.biography.trim()).not.toBe('');
    });

    it('prefers real tactics for skills, then traits, and de-duplicates', () => {
        const withBoth: OfficerProfile = { ...ALL[0], tactics: ['돌격', '돌격'], traits: ['명성'] };
        expect(toOfficerBio(withBoth, buildOfficerDossierFromProfile(withBoth)).skills).toEqual(['돌격']);
        const traitsOnly: OfficerProfile = { ...ALL[0], tactics: [], traits: ['명성', '명성'] };
        expect(toOfficerBio(traitsOnly, buildOfficerDossierFromProfile(traitsOnly)).skills).toEqual(['명성']);
    });

    it('leaves portrait unset because portraitPrompt is not a path', () => {
        for (const b of STORE.getAllOfficers().slice(0, 50)) {
            expect(b.portrait).toBeUndefined();
        }
    });
});
