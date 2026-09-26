import { describe, it, expect } from 'vitest';
import { PublicOrderSystem } from '../src/core/public_order_system';
import type { CityPublicOrder } from '../src/core/public_order_system';

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
        // checkRevolt rolls Math.random() against the risk, and risk is 2.5% at
        // order 95, so a single call asserts a coin with one side in 40.
        // The point of the test is that a well-policed city almost never
        // revolts, which is a statement about the rate.
        let revolts = 0;
        const trials = 4000;
        for (let i = 0; i < trials; i++) {
            if (order.checkRevolt(makeCity(95)).revoltOccurred) revolts++;
        }
        expect(revolts / trials).toBeCloseTo(order.getRevoltRisk(makeCity(95)), 2);
    });

    it('revolts far more often when order is low', () => {
        let highOrder = 0;
        let lowOrder = 0;
        const trials = 2000;
        for (let i = 0; i < trials; i++) {
            if (order.checkRevolt(makeCity(95)).revoltOccurred) highOrder++;
            if (order.checkRevolt(makeCity(10)).revoltOccurred) lowOrder++;
        }
        expect(lowOrder).toBeGreaterThan(highOrder * 5);
    });

    it('should apply occupation penalty', () => {
        const city = makeCity(80);
        order.applyOccupationPenalty(city);
        expect(city.orderLevel).toBeLessThan(80);
        expect(city.occupationPenalty).toBeGreaterThan(0);
    });
});
