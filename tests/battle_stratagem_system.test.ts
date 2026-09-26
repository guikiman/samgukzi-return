import { describe, it, expect, beforeEach } from 'vitest';
import { BattleStratagemManager, STRATAGEMS } from '../src/core/battle_stratagem_system';

describe('BattleStratagemManager', () => {
    let manager: BattleStratagemManager;

    beforeEach(() => {
        manager = new BattleStratagemManager();
    });

    it('should return stratagem by type', () => {
        const s = manager.getStratagem('ROCKFALL');
        expect(s.name).toBe('낙석');
        expect(s.spiritCost).toBe(1);
    });

    it('should return all stratagems', () => {
        expect(manager.getAllStratagems().length).toBe(7);
    });

    it('should list available stratagems based on intelligence and spirit', () => {
        const available = manager.getAvailableStratagems('off_1', 70, 3);
        expect(available.length).toBeGreaterThan(0);
        expect(available.every(s => s.spiritCost <= 3)).toBe(true);
    });

    it('should restrict high-level stratagems by intelligence', () => {
        const low = manager.getAvailableStratagems('off_1', 30, 3);
        const high = manager.getAvailableStratagems('off_1', 85, 3);
        expect(low.length).toBeLessThanOrEqual(high.length);
    });

    it('should calculate success rate based on intelligence', () => {
        const high = manager.calculateSuccessRate('ROCKFALL', 90, 'SUNNY');
        const low = manager.calculateSuccessRate('ROCKFALL', 20, 'SUNNY');
        expect(high).toBeGreaterThan(low);
    });

    it('should execute stratagem', () => {
        let success = 0;
        const trials = 2000;
        for (let i = 0; i < trials; i++) {
            if (manager.executeStratagem('ROCKFALL', 'off_1', { q: 0, r: 0 }, 80, 'SUNNY', 100).success) {
                success++;
            }
        }
        const rate = manager.calculateSuccessRate('ROCKFALL', 80, 'SUNNY');
        // 2000회 표본의 표준오차는 약 0.009 이므로 허용차를 0.05 로 잡는다
        expect(Math.abs(success / trials - rate)).toBeLessThan(0.05);
    });

    it('실패하면 피해를 입히지 않는다', () => {
        const damaged = [];
        for (let i = 0; i < 200; i++) {
            const e = manager.executeStratagem('ROCKFALL', 'off_1', { q: 0, r: 0 }, 0, 'STORM', 100);
            if (!e.success) damaged.push(e.damageApplied);
        }
        expect(damaged.length).toBeGreaterThan(50);
        expect(damaged.every(d => d === 0)).toBe(true);
    });

    it('성공하면 계략 수치를 그대로 피해를 입힌다', () => {
        let checked = 0;
        for (let i = 0; i < 400 && checked < 20; i++) {
            const e = manager.executeStratagem('ROCKFALL', 'off_1', { q: 0, r: 0 }, 100, 'SUNNY', 100);
            if (!e.success) continue;
            checked++;
            expect(e.damageApplied).toBe(STRATAGEMS.ROCKFALL.damage);
            expect(e.stratagem.type).toBe('ROCKFALL');
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('should process active effects over time', () => {
        manager.executeStratagem('FIRE_ATTACK', 'off_1', { q: 0, r: 0 }, 80, 'SUNNY', 100);
        const effects = manager.processActiveEffects(new Map());
        expect(effects.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect encirclement', () => {
        const enemyTiles = [
            { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 },
        ];
        const encircled = manager.checkEncircled({ q: 0, r: 0 }, enemyTiles);
        expect(encircled).toBe(false); // 3/6 < 4, so not encircled
    });

    it('should detect full encirclement', () => {
        const enemyTiles = [
            { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 },
            { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 },
        ];
        const encircled = manager.checkEncircled({ q: 0, r: 0 }, enemyTiles);
        expect(encircled).toBe(true);
    });

    it('should clear all effects', () => {
        manager.executeStratagem('TRAP', 'off_1', { q: 0, r: 0 }, 80, 'SUNNY', 100);
        manager.clear();
        expect(manager.getActiveEffects().length).toBe(0);
    });
});
