import { describe, it, expect, beforeEach } from 'vitest';
import { WandererArmyManager } from '../src/core/wanderer_army_system';

describe('WandererArmyManager', () => {
    let manager: WandererArmyManager;

    beforeEach(() => {
        manager = new WandererArmyManager();
    });

    it('should form a wanderer army', () => {
        const state = manager.formWandererArmy('officer_1', 1000, 500);
        expect(state.leaderId).toBe('officer_1');
        expect(state.soldiers).toBe(500);
        expect(state.gold).toBe(1000);
        expect(state.isActive).toBe(true);
    });

    it('should cap soldiers at 5000', () => {
        const state = manager.formWandererArmy('officer_1', 1000, 10000);
        expect(state.soldiers).toBe(5000);
    });

    it('should disband an active army', () => {
        manager.formWandererArmy('officer_1', 1000, 500);
        const result = manager.disband();
        expect(result).toBe(true);
        const state = manager.getState();
        expect(state?.isActive).toBe(false);
        expect(state?.soldiers).toBe(0);
    });

    it('should fail to disband inactive army', () => {
        const result = manager.disband();
        expect(result).toBe(false);
    });

    it('should move to a city', () => {
        manager.formWandererArmy('officer_1', 1000, 500);
        const result = manager.moveTo('city_1');
        expect(result).toBe(true);
        expect(manager.getState()?.location).toBe('city_1');
    });

    it('should fail to move without active army', () => {
        const result = manager.moveTo('city_1');
        expect(result).toBe(false);
    });

    it('should add officer to army', () => {
        manager.formWandererArmy('officer_1', 1000, 500);
        const result = manager.addOfficer('officer_2');
        expect(result).toBe(true);
        expect(manager.getState()?.officerIds).toContain('officer_2');
    });

    it('should not add duplicate officer', () => {
        manager.formWandererArmy('officer_1', 1000, 500);
        manager.addOfficer('officer_1');
        expect(manager.getState()?.officerIds.length).toBe(1);
    });

    it('should succeed uprising with favorable conditions', () => {
        // 성공률 = 병력비 x 통솔 x (1 - 충성도) = 3 x 0.95 x 0.9 = 2.565
        // 1 을 넘어서므로 Math.random() 과 비교하면 언제나 성공한다
        let success = 0;
        const trials = 200;
        for (let i = 0; i < trials; i++) {
            // uprise 는 성공 여부와 무관하게 방랑군을 해산시키므로 매번 새로 편성한다
            manager.formWandererArmy('officer_1', 1000, 3000);
            if (manager.uprise('city_1', 1000, 10, 95).success) success++;
        }
        expect(success).toBe(trials);
    });

    it('불리한 조건에서는 거병이 거의 실패한다', () => {
        // 성공률 = 0.33 x 0.2 x 0.1 = 0.0067
        let success = 0;
        const trials = 200;
        for (let i = 0; i < trials; i++) {
            manager.formWandererArmy('officer_1', 1000, 3000);
            manager.addOfficer('officer_1');
            if (manager.uprise('city_1', 3000, 90, 20).success) success++;
        }
        expect(success / trials).toBeLessThan(0.2);
    });

    it('should fail uprising with unfavorable conditions', () => {
        // 불리한 조건: 병력 100 vs 방어군 5000, 충성도 90, 통솔 30
        // 성공률 = 0.02 x 0.3 x 0.1 = 0.0006 이라 2000회에 1~2회만 성공한다
        let success = 0;
        const trials = 2000;
        for (let i = 0; i < trials; i++) {
            manager.formWandererArmy('officer_1', 1000, 100);
            if (manager.uprise('city_1', 5000, 90, 30).success) success++;
        }
        expect(success).toBeLessThan(trials * 0.01);
    });

    it('should fail uprising without soldiers', () => {
        manager.formWandererArmy('officer_1', 1000, 0);
        const result = manager.uprise('city_1', 5000, 95, 30);
        expect(result.success).toBe(false);
    });

    it('should reset state', () => {
        manager.formWandererArmy('officer_1', 1000, 500);
        manager.reset();
        expect(manager.getState()).toBeNull();
    });
});
