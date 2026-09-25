import { describe, it, expect } from 'vitest';
import {
    OFFICER_PROFILES,
    OFFICER_RELATION_KINDS,
    validateOfficerProfileDataset,
    type OfficerProfileDataset,
} from '../src/core/officer_profile_schema';
import rawDataset from '../src/data/officers_full.json' with { type: 'json' };

const DATASET = rawDataset as unknown as OfficerProfileDataset;

function cloneDataset(): OfficerProfileDataset {
    return JSON.parse(JSON.stringify(DATASET)) as OfficerProfileDataset;
}

describe('장수 프로필 데이터셋 무결성 (삼국지14PK)', () => {
    it('번들된 데이터셋이 스키마 검증을 통과한다', () => {
        const r = validateOfficerProfileDataset(DATASET);
        expect(r.errors).toEqual([]);
        expect(r.ok).toBe(true);
    });

    it('레지스트리 크기가 counts.total 과 일치한다', () => {
        expect(OFFICER_PROFILES.size).toBe(DATASET.counts.total);
        expect(OFFICER_PROFILES.size).toBe(1200);
    });

    it('모든 프로필 ID 가 유일하다', () => {
        const ids = OFFICER_PROFILES.all().map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('모든 관계 참조가 실제 프로필로 해석된다', () => {
        const known = new Set(OFFICER_PROFILES.all().map(p => p.id));
        const dangling: string[] = [];
        for (const p of OFFICER_PROFILES.all()) {
            for (const kind of OFFICER_RELATION_KINDS) {
                for (const t of p.relations[kind]) {
                    if (!known.has(t)) dangling.push(`${p.id}.${kind}->${t}`);
                }
            }
        }
        expect(dangling).toEqual([]);
    });

    it('관계가 자기 자신을 가리키지 않는다', () => {
        for (const p of OFFICER_PROFILES.all()) {
            for (const kind of OFFICER_RELATION_KINDS) {
                expect(p.relations[kind]).not.toContain(p.id);
            }
        }
    });

    it('모든 프로필이 5종 능력치를 갖는다', () => {
        for (const p of OFFICER_PROFILES.all()) {
            for (const k of ['leadership', 'might', 'intelligence', 'politics', 'charisma'] as const) {
                expect(Number.isFinite(p.stats[k])).toBe(true);
            }
        }
    });

    it('PK 확장분 200명이 PK_BASE 와 구분된다', () => {
        const extra = OFFICER_PROFILES.all().filter(p => p.rosterTier === 'PK_EXTRA');
        expect(extra).toHaveLength(200);
    });
});

describe('이름 조회와 동명이인 차단', () => {
    it('역사 인물은 이름으로 조회된다', () => {
        expect(OFFICER_PROFILES.findExactlyByName('유비')?.id).toBe('off_0952');
        expect(OFFICER_PROFILES.findExactlyByName('관우')?.id).toBe('off_0147');
        expect(OFFICER_PROFILES.findExactlyByName('여포')?.id).toBe('off_0987');
    });

    it('동명이인은 단일 조회를 거부하고 후보를 모두 반환한다', () => {
        expect(OFFICER_PROFILES.isAmbiguousName('우금')).toBe(true);
        expect(OFFICER_PROFILES.findExactlyByName('우금')).toBeUndefined();
        expect(OFFICER_PROFILES.findByName('우금')).toHaveLength(2);
    });

    it('荀攸/荀彧 동명인(순욱)도 단일 조회로 구분되지 않는다', () => {
        expect(OFFICER_PROFILES.isAmbiguousName('순욱')).toBe(true);
        expect(OFFICER_PROFILES.findByName('순욱')).toHaveLength(2);
    });

    it('존재하지 않는 이름은 빈 배열을 반환한다', () => {
        expect(OFFICER_PROFILES.findByName('없는인물')).toEqual([]);
    });

    it('ID 로 O(1) 조회되고 없는 ID 는 undefined 다', () => {
        expect(OFFICER_PROFILES.get('off_0952')?.name).toBe('유비');
        expect(OFFICER_PROFILES.get('off_999999')).toBeUndefined();
    });
});

describe('개성 · 전법 인덱스 (차별화 기반)', () => {
    it('개성 종류는 158종이다', () => {
        expect(OFFICER_PROFILES.distinctTraits()).toHaveLength(158);
    });

    it('장수referenced 전법은 131종이다', () => {
        expect(OFFICER_PROFILES.distinctTactics()).toHaveLength(131);
    });

    it('개성으로 장수를 역조회할 수 있다', () => {
        const holders = OFFICER_PROFILES.findByTrait('남만');
        expect(holders.length).toBeGreaterThan(0);
        for (const p of holders) expect(p.traits).toContain('남만');
    });

    it('전법으로 장수를 역조회할 수 있다', () => {
        const holders = OFFICER_PROFILES.findByTactic('돌격');
        expect(holders.length).toBeGreaterThan(0);
        for (const p of holders) expect(p.tactics).toContain('돌격');
    });

    it('장비의 관계가 실데이터로 채워져 있다', () => {
        const jangfei = OFFICER_PROFILES.get('off_0656');
        expect(jangfei?.relations.close).toHaveLength(8);
        expect(jangfei?.relations.spouse).toHaveLength(1);
        expect(jangfei?.relations.swornSiblings).toHaveLength(1);
    });

    it('해결 불가 관계는 추정으로 채우지 않고 gap 으로 남긴다', () => {
        expect(OFFICER_PROFILES.relationGaps.length).toBeGreaterThan(0);
        expect(OFFICER_PROFILES.relationGaps).toEqual(DATASET.relationGaps);
    });
});

describe('검증기 fail-safe 동작', () => {
    it('객체가 아닌 입력은 예외 대신 오류 목록을 반환한다', () => {
        for (const bad of [null, 42, '문자열', []]) {
            const r = validateOfficerProfileDataset(bad);
            expect(r.ok).toBe(false);
            expect(r.errors.length).toBeGreaterThan(0);
        }
    });

    it('profiles 누락을 감지한다', () => {
        const d = cloneDataset();
        delete (d as unknown as Record<string, unknown>).profiles;
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('profiles'))).toBe(true);
    });

    it('유효하지 않은 gender 를 감지한다', () => {
        const d = cloneDataset();
        d.profiles.off_0001.gender = 'X' as never;
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('gender'))).toBe(true);
    });

    it('유효하지 않은 rosterTier 를 감지한다', () => {
        const d = cloneDataset();
        d.profiles.off_0001.rosterTier = 'NOPE' as never;
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('rosterTier'))).toBe(true);
    });

    it('존재하지 않는 관계 대상을 감지한다', () => {
        const d = cloneDataset();
        d.profiles.off_0001.relations.hate = ['off_999999'];
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('off_999999'))).toBe(true);
    });

    it('자기 참조를 감지한다', () => {
        const d = cloneDataset();
        d.profiles.off_0001.relations.hate = ['off_0001'];
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('자기 자신'))).toBe(true);
    });

    it('ID 와 키 불일치를 감지한다', () => {
        const d = cloneDataset();
        d.profiles.off_0001.id = 'off_7777';
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('불일치'))).toBe(true);
    });

    it('stats 값이 숫자가 아니면 감지한다', () => {
        const d = cloneDataset();
        d.profiles.off_0001.stats.leadership = null as never;
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('stats.leadership'))).toBe(true);
    });

    it('counts.total 불일치를 감지한다', () => {
        const d = cloneDataset();
        d.counts.total = 9999;
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('counts.total'))).toBe(true);
    });

    it('필수 배열 필드가 깨지면 감지한다', () => {
        const d = cloneDataset();
        d.profiles.off_0001.traits = '남만' as never;
        expect(validateOfficerProfileDataset(d).errors.some(e => e.includes('traits'))).toBe(true);
    });
});
