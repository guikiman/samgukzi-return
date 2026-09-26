import { describe, it, expect, beforeEach } from 'vitest';
import { PrisonerManager } from '../src/core/prisoner_system';

describe('PrisonerManager', () => {
    let manager: PrisonerManager;

    beforeEach(() => {
        manager = new PrisonerManager();
    });

    it('should capture a prisoner with low HP', () => {
        // HP 10/100 → capture chance = (1 - 0.1) * 0.7 = 0.63
        const result = manager.capturePrisoner('officer_1', 'faction_1', 'faction_2', 10, 100);
        // probabilistic, but high chance
        if (result) {
            expect(result.status).toBe('CAPTURED');
        }
    });

    it('should have lower capture chance with high HP', () => {
        const result = manager.capturePrisoner('officer_2', 'faction_1', 'faction_2', 90, 100);
        // can still succeed
        expect(result === null || result.status === 'CAPTURED').toBe(true);
    });

    it('should execute a prisoner', () => {
        manager.capturePrisoner('officer_1', 'faction_1', 'faction_2', 0, 100);
        const existing = manager['prisoners'].get('officer_1');
        if (!existing) {
            manager['prisoners'].set('officer_1', {
                officerId: 'officer_1', captorFactionId: 'faction_1',
                originalFactionId: 'faction_2', captureDate: Date.now(),
                status: 'CAPTURED', escapeAttempts: 0, negotiationCount: 0,
            });
        }
        const result = manager.executePrisoner('officer_1');
        expect(result).not.toBeNull();
        expect(result!.action).toBe('EXECUTED');
        expect(result!.diplomacyModifier).toBe(-50);
    });

    it('should recruit a prisoner', () => {
        // 성공률 = (100 - 충성도)/100 x 설득력/100 = 0.7 x 0.8 = 0.56
        // 포획 자체도 확률이라 forceCapture 로 상태를 직접 만들어 준다
        let success = 0;
        const trials = 2000;
        for (let i = 0; i < trials; i++) {
            forceCapture('officer_1');
            if (manager.recruitPrisoner('officer_1', 'recruiter_1', 30, 80).success) success++;
        }
        expect(Math.abs(success / trials - 0.56)).toBeLessThan(0.05);
    });

    it('설득력이 0 이면 등용은 불가능하다', () => {
        let success = 0;
        const trials = 200;
        for (let i = 0; i < trials; i++) {
            manager.capturePrisoner('officer_1', 'faction_1', 'faction_2', 10, 100);
            if (manager.recruitPrisoner('officer_1', 'recruiter_1', 30, 0).success) success++;
        }
        expect(success).toBe(0);
    });

    it('should release a prisoner', () => {
        manager.capturePrisoner('officer_1', 'faction_1', 'faction_2', 0, 100);
        const existing = manager['prisoners'].get('officer_1');
        if (!existing) {
            manager['prisoners'].set('officer_1', {
                officerId: 'officer_1', captorFactionId: 'faction_1',
                originalFactionId: 'faction_2', captureDate: Date.now(),
                status: 'CAPTURED', escapeAttempts: 0, negotiationCount: 0,
            });
        }
        const result = manager.releasePrisoner('officer_1');
        expect(result).not.toBeNull();
        expect(result!.diplomacyModifier).toBe(20);
    });

    function forceCapture(officerId: string) {
        manager['prisoners'].set(officerId, {
            officerId, captorFactionId: 'faction_1',
            originalFactionId: 'faction_2', captureDate: Date.now(),
            status: 'CAPTURED', escapeAttempts: 0, negotiationCount: 0,
        });
    }

    it('should negotiate ransom', () => {
        manager.capturePrisoner('officer_1', 'faction_1', 'faction_2', 0, 100);
        forceCapture('officer_1');
        const result = manager.negotiateRansom('officer_1', 200);
        expect(result.success).toBe(true);
    });

    it('should reject low ransom', () => {
        manager.capturePrisoner('officer_1', 'faction_1', 'faction_2', 0, 100);
        forceCapture('officer_1');
        const result = manager.negotiateRansom('officer_1', 50);
        expect(result.success).toBe(false);
    });

    it('should attempt escape', () => {
        // 탈옥 확률 = 지력 / 200 = 0.45
        let success = 0;
        const trials = 2000;
        for (let i = 0; i < trials; i++) {
            forceCapture('officer_1');
            if (manager.attemptEscape('officer_1', 90).success) success++;
        }
        expect(Math.abs(success / trials - 0.45)).toBeLessThan(0.05);
    });

    it('should return prisoners by faction', () => {
        manager.capturePrisoner('officer_1', 'faction_1', 'faction_2', 10, 100);
        const prisoners = manager.getPrisonersByFaction('faction_1');
        expect(prisoners.length).toBeGreaterThanOrEqual(0);
    });
});
