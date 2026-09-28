import { describe, it, expect, vi } from 'vitest';
import { PublicOrderSystem } from '../src/core/public_order_system';
import type { CityPublicOrder } from '../src/core/public_order_system';

/**
 * [결함 수정] 결정론적 난수 생성기 (mulberry32).
 *
 * 확률 분포를 검증하는 테스트가 Math.random 에 기대면 실행마다 결과가
 * 달라져 간헐적으로 깨진다. 고정 시드 PRNG 를 주입하면 같은 입력에
 * 항상 같은 결과가 나와 "이 테스트는 지금 깨지는가"를 확정할 수 있다.
 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('PublicOrderSystem', () => {
    const order = new PublicOrderSystem();

    function makeCity(level: number): CityPublicOrder {
        return { cityId: 'city_1', orderLevel: level, occupationPenalty: 0, recentPatrolBonus: 0 };
    }

    it('should calculate revolt risk inversely to order level', () => {
        const highRisk = order.getRevoltRisk(makeCity(20));
        const lowRisk = order.getRevoltRisk(makeCity(80));
        expect(highRisk).toBeGreaterThan(lowRisk);
    });

    it('should improve order on patrol', () => {
        const city = makeCity(50);
        const result = order.patrol(city, 80, false);
        expect(result.orderGain).toBeGreaterThan(0);
        expect(city.orderLevel).toBeGreaterThan(50);
    });

    it('should trigger revolt when risk is high', () => {
        const city = makeCity(10);
        let revoltCount = 0;
        const trials = 100;
        for (let i = 0; i < trials; i++) {
            const c = makeCity(10);
            const result = order.checkRevolt(c);
            if (result.revoltOccurred) revoltCount++;
        }
        // Risk = (100-10)/200 = 0.45, so roughly 45% chance
        expect(revoltCount).toBeGreaterThan(0);
    });

    it('rarely triggers revolt when order is high', () => {
        // checkRevolt 는 risk(치우 95 에서 2.5%) 로 Math.random() 을 굴린다.
        //
        // [결함 수정] 원래는 4000회 무작위 시행 + toBeCloseTo(…, 2) 로
        // 검증했다. 허용오차가 ±20건(=2.03σ)이라 실패 확률이 4.6% —
        // 100번 돌리면 4~5번은 깨진다. 실제로 전체 테스트 실행 중
        // 간헐적 실패가 관측됐다.
        //
        // 해결: 난수를 고정 시드로 대체해 실행마다 같은 결과를 낸다.
        // 그래야 "통과/실패"가 확률이 아니라 결정론이 되고,
        // 4σ(±40건) 밴드면 어떤 시드에서도 사실상 안전하다.
        const rng = mulberry32(0x5eed);
        const spy = vi.spyOn(Math, 'random').mockImplementation(rng);
        try {
            let revolts = 0;
            const trials = 4000;
            for (let i = 0; i < trials; i++) {
                if (order.checkRevolt(makeCity(95)).revoltOccurred) revolts++;
            }
            const expected = order.getRevoltRisk(makeCity(95));
            const sd = Math.sqrt(trials * expected * (1 - expected));
            expect(Math.abs(revolts - trials * expected), `관측 ${revolts}건`).toBeLessThan(4 * sd);
        } finally {
            spy.mockRestore();
        }
    });

    it('revolts far more often when order is low', () => {
        // 같은 이유로 고정 시드 난수를 쓴다 (이 항목은 여유가 커서
        // 원래도 거의 깨지지 않았지만, 파일 전체를 결정론으로 통일한다).
        const rng = mulberry32(0xbeef);
        const spy = vi.spyOn(Math, 'random').mockImplementation(rng);
        try {
            let highOrder = 0;
            let lowOrder = 0;
            const trials = 2000;
            for (let i = 0; i < trials; i++) {
                if (order.checkRevolt(makeCity(95)).revoltOccurred) highOrder++;
                if (order.checkRevolt(makeCity(10)).revoltOccurred) lowOrder++;
            }
            expect(lowOrder).toBeGreaterThan(highOrder * 5);
        } finally {
            spy.mockRestore();
        }
    });

    it('should apply occupation penalty', () => {
        const city = makeCity(80);
        order.applyOccupationPenalty(city);
        expect(city.orderLevel).toBeLessThan(80);
        expect(city.occupationPenalty).toBeGreaterThan(0);
    });
});
