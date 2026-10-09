import { describe, it, expect } from 'vitest';
import {
    TACTICS,
    POLICIES,
    FORMATIONS,
    REGIONS,
    PERSONALITY_EFFECTS,
    POPULATION_BY_CITY,
    UNDEFINED_TACTICS,
    TACTIC_NAME_COLLISIONS,
    getTactic,
    getPolicy,
    getFormation,
    getRegion,
    getPersonalityEffect,
    policiesByDepartment,
    personalityEffectsByTier,
} from '../src/core/tactic_reference_data';
import { OFFICER_PROFILES } from '../src/core/officer_profile_schema';

describe('기준 데이터 규모 (삼국지14PK 13시트)', () => {
    it('전법 174종이 로드된다', () => {
        expect(TACTICS.size).toBe(174);
    });

    it('정책 33종이 로드된다', () => {
        expect(POLICIES.size).toBe(33);
    });

    it('진형 16종이 로드된다', () => {
        expect(FORMATIONS.size).toBe(16);
    });

    it('지역 57개가 로드되고 인구가 집계된다', () => {
        expect(REGIONS.size).toBe(57);
        expect(Object.keys(POPULATION_BY_CITY).length).toBeGreaterThan(0);
    });

    it('개성 효과 197종이 로드된다', () => {
        expect(PERSONALITY_EFFECTS.size).toBe(197);
    });
});

describe('전법 정의 무결성', () => {
    it('장수가 참조하는 모든 전법이 정의되어 있다 (미정의 목록 제외)', () => {
        const missing = OFFICER_PROFILES.distinctTactics().filter(t => !TACTICS.has(t));
        expect([...missing].sort()).toEqual([...UNDEFINED_TACTICS].sort());
    });

    it('미정의 전법은 원본 데이터 갭으로 명시되어 있다', () => {
        expect(UNDEFINED_TACTICS).toEqual(['오와지변', '충요의열']);
    });

    it('고유전법 148종이 모두 보존되고, 교역전법 4종은 tradeHolders 로 합쳐진다', () => {
        const unique = [...TACTICS.values()].filter(t => t.sheet === '고유전법');
        expect(unique.length).toBe(148);
        expect(Object.keys(TACTIC_NAME_COLLISIONS)).toHaveLength(4);
        for (const name of Object.keys(TACTIC_NAME_COLLISIONS)) {
            expect(TACTICS.get(name)?.tradeHolders.length).toBeGreaterThan(0);
        }
    });

    it('전법 조회는 없는 이름에 undefined 를 반환한다', () => {
        expect(getTactic('돌격')).toBeDefined();
        expect(getTactic('없는전법')).toBeUndefined();
    });
});

describe('개성 효과 무결성', () => {
    it('장수가 쓰는 개성 158종이 모두 효과를 정의하고 있다', () => {
        const missing = OFFICER_PROFILES.distinctTraits().filter(t => !PERSONALITY_EFFECTS.has(t));
        expect(missing).toEqual([]);
    });

    it('금/청/적 3단계로 분류된다', () => {
        const byTier = personalityEffectsByTier();
        expect(byTier.get('GOLD')).toHaveLength(56);
        expect(byTier.get('BLUE')).toHaveLength(121);
        expect(byTier.get('RED')).toHaveLength(20);
    });

    it('개성 효과는 설명문을 갖는다', () => {
        for (const e of PERSONALITY_EFFECTS.values()) {
            expect(typeof e.effect === 'string' && e.effect.length > 0).toBe(true);
        }
    });
});

describe('정책 · 진형 · 지역', () => {
    it('정책은 5개 부서로 분류된다', () => {
        const byDept = policiesByDepartment();
        expect([...byDept.keys()].sort()).toEqual(['내정', '모략', '인사', '전투', '지원'].sort());
    });

    it('모든 정책에 부서가 있다', () => {
        for (const p of POLICIES.values()) {
            expect(p.department).toBeTruthy();
        }
    });

    it('진형은 전투 수치를 갖는다', () => {
        for (const f of FORMATIONS.values()) {
            expect(typeof f.movement === 'number' || f.movement === null).toBe(true);
            expect(typeof f.description === 'string' || f.description === null).toBe(true);
        }
    });

    it('지역은 생산량 수치를 갖는다', () => {
        for (const r of REGIONS.values()) {
            expect(typeof r.population === 'number' || r.population === null).toBe(true);
        }
    });

    it('조회 헬퍼가 정의된 항목을 돌려준다', () => {
        expect(getPolicy('어린강화')).toBeDefined();
        expect(getFormation('어린')).toBeDefined();
        expect(getRegion('낙양')).toBeDefined();
        expect(getPersonalityEffect('간웅')).toBeDefined();
    });
});
