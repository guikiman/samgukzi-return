import { describe, it, expect } from 'vitest';
import { OFFICER_PROFILES } from '../src/core/officer_profile_schema';
import {
    DIFFERENTIATION_AXES,
    accumulateTraits,
    allTendencies,
    describeTendency,
    getOfficerTendency,
    mappedTraitNames,
    normalizeTendency,
    unmappedTraitsInUse,
    type TendencyVector,
} from '../src/core/officer_differentiation';

function isZeroVector(v: TendencyVector): boolean {
    return DIFFERENTIATION_AXES.every(axis => v[axis] === 0);
}

function allTendenciesInRange(v: TendencyVector): boolean {
    return DIFFERENTIATION_AXES.every(axis => Number.isInteger(v[axis]) && v[axis] >= 0 && v[axis] <= 100);
}

describe('장수 개성 → 행동 축 매핑 (삼국지14PK 158종)', () => {
    it('장수가 실제로 쓰는 개성은 모두 매핑되어 있다', () => {
        expect(unmappedTraitsInUse()).toEqual([]);
    });

    it('매핑 사전에 중복 키가 없다', () => {
        const names = mappedTraitNames();
        expect(new Set(names).size).toBe(names.length);
    });

    it('어떤 장수도 쓰지 않는 개성은 매핑에서 빠진다', () => {
        const names = mappedTraitNames();
        for (const unused of ['살상', '수납', '함정']) {
            expect(names).not.toContain(unused);
        }
    });

    it('개성이 있는 장수는 전부 0이 아닌 성향을 얻는다', () => {
        const withTraits = OFFICER_PROFILES.all().filter(p => p.traits.length > 0);
        expect(withTraits.length).toBeGreaterThan(0);
        const zeroed = withTraits.filter(p => isZeroVector(accumulateTraits(p.traits)));
        expect(zeroed.map(p => `${p.id}:${p.name}`)).toEqual([]);
    });

    it('전 장수의 정규화 성향이 0..100 범위를 벗어나지 않는다', () => {
        const outOfRange = allTendencies()
            .filter(t => !allTendenciesInRange(t.normalized))
            .map(t => `${t.id}:${t.name}`);
        expect(outOfRange).toEqual([]);
    });

    it('0 벡터는 정규화해도 전부 0 이다', () => {
        expect(normalizeTendency(accumulateTraits([]))).toEqual(accumulateTraits([]));
    });

    it('대표 개성이 의도한 축을 올린다', () => {
        // 적에게 물러설 수 없어 그대로 돌진한다
        const reckless = accumulateTraits(['저돌']);
        expect(reckless.aggression).toBeGreaterThan(0);
        expect(reckless.recklessness).toBeGreaterThan(0);

        // 양측 사상을 아끼며 공격 성향은 낮춘다
        const merciful = accumulateTraits(['자비']);
        expect(merciful.mercy).toBeGreaterThan(0);
        expect(merciful.aggression).toBeLessThan(0);

        // 계략에 능하다
        expect(accumulateTraits(['책사']).cunning).toBeGreaterThan(0);

        // 병참이 끊겨도 사기가 무너지지 않는다
        expect(accumulateTraits(['불굴']).resolve).toBeGreaterThan(0);
    });

    it('개성이 겹쳐도 축 합산은 순수하게 결정적이다', () => {
        const a = accumulateTraits(['저돌', '자비', '책사']);
        const b = accumulateTraits(['저돌', '자비', '책사']);
        expect(a).toEqual(b);
        expect(a).toEqual(accumulateTraits(['저돌', '자비', '책사']));
    });

    it('장수별 성향 조회가 프로필과 어긋나지 않는다', () => {
        const sample = OFFICER_PROFILES.all().filter(p => p.traits.length > 0).slice(0, 50);
        for (const p of sample) {
            const t = getOfficerTendency(p.id);
            expect(t).toBeDefined();
            expect(t?.name).toBe(p.name);
            expect(t?.raw).toEqual(accumulateTraits(p.traits));
            expect(isZeroVector(t!.raw)).toBe(false);
            expect(describeTendency(t!)).toContain(p.name);
        }
    });
});
