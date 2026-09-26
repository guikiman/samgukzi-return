import { describe, it, expect, beforeEach } from 'vitest';
import { DeathSuccessionManager } from '../src/core/death_succession_system';

describe('DeathSuccessionManager', () => {
    let manager: DeathSuccessionManager;

    const rate = (roll: () => boolean, trials = 2000): number => {
        let hits = 0;
        for (let i = 0; i < trials; i++) if (roll()) hits++;
        return hits / trials;
    };

    beforeEach(() => {
        manager = new DeathSuccessionManager();
        manager.setCurrentDate(200);
    });

    it('should process death', () => {
        const event = manager.processDeath('off_1', 'faction_1', 'BATTLE', 45);
        expect(event.officerId).toBe('off_1');
        expect(event.cause).toBe('BATTLE');
        expect(event.date).toBe(200);
    });

    it('should select heir by priority', () => {
        const candidates = [
            { officerId: 'son', relation: 'SON' as const, priority: 1 },
            { officerId: 'brother', relation: 'SIBLING' as const, priority: 3 },
            { officerId: 'officer', relation: 'OFFICER' as const, priority: 5 },
        ];
        const heir = manager.selectHeir('faction_1', candidates);
        expect(heir).not.toBeNull();
        expect(heir!.officerId).toBe('son');
    });

    it('should return null when no candidates', () => {
        const heir = manager.selectHeir('faction_1', []);
        expect(heir).toBeNull();
    });

    it('should trigger succession with loyalty shifts', () => {
        const officers = [
            { id: 'successor', loyalty: 80 },
            { id: 'loyal', loyalty: 90 },
            { id: 'neutral', loyalty: 60 },
            { id: 'disloyal', loyalty: 30 },
        ];
        const event = manager.triggerSuccession('faction_1', 'off_1', 'successor', officers, 'NATURAL');
        expect(event.successorId).toBe('successor');
        expect(event.loyaltyShifts.get('successor')).toBe(20);
        expect(event.loyaltyShifts.get('disloyal')).toBe(-30);
    });

    it('should calculate natural death probability increasing with age', () => {
        const young = manager.calculateNaturalDeathProbability(20);
        const old = manager.calculateNaturalDeathProbability(80);
        expect(old).toBeGreaterThan(young);
    });

    it('should roll battle death with low HP', () => {
        let deaths = 0;
        const trials = 2000;
        for (let i = 0; i < trials; i++) {
            if (manager.rollBattleDeath(0, 100)) deaths++;
        }
        expect(deaths / trials).toBeCloseTo(0.5, 1);
    });

    it('HP 가 높으면 전사 확률이 낮아진다', () => {
        const lowHp = rate(() => manager.rollBattleDeath(0, 100));
        const halfHp = rate(() => manager.rollBattleDeath(50, 100));
        expect(halfHp).toBeLessThan(lowHp);
        expect(halfHp).toBeCloseTo(0.25, 1);
    });

    it('should track death events', () => {
        manager.processDeath('off_1', 'faction_1', 'NATURAL', 60);
        expect(manager.getDeathEvents().length).toBe(1);
    });

    it('should track succession events', () => {
        manager.triggerSuccession('faction_1', 'off_1', 'successor', [{ id: 'successor', loyalty: 80 }], 'NATURAL');
        expect(manager.getSuccessionEvents().length).toBe(1);
    });

    it('should clear all events', () => {
        manager.processDeath('off_1', 'faction_1', 'NATURAL', 60);
        manager.clear();
        expect(manager.getDeathEvents().length).toBe(0);
    });
});
