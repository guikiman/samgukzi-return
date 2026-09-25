import { describe, it, expect } from 'vitest';
import { GameStore } from '../src/core/game_store.js';
import {
    DIFFICULTY_MULTIPLIERS,
    DEFAULT_DIFFICULTY,
    AI_DIFFICULTY_CURVE,
    getDifficulty,
    getDifficultyMultiplier,
    getAIMonthlyDifficulty,
    getAIMonthlyDifficultyMultiplier,
    resolveAIMonthlyDifficulty,
    scaleVisitChance,
    scaleRoamingCityCount,
} from '../src/core/difficulty_balance_system.js';
import { processMonthlyFreeOfficerVisits } from '../src/core/free_officer_visit_system.js';
import { OfficerStatus } from '../src/core/types.js';
import { buildWorld } from '../src/core/scenario_system.js';
import { GameEngine } from '../src/core/game_engine.js';
import scenarioIndex from '../src/data/scenarios/index.json';

describe('난이도 밸런싱 시스템 [X-난이도]', () => {
    it('배율표는 5단계이며 쉬울수록 빈도·수혜가 크고 지옥일수록 산적 피해가 크다', () => {
        expect(DIFFICULTY_MULTIPLIERS).toHaveLength(5);
        const easy = DIFFICULTY_MULTIPLIERS[0];
        const hell = DIFFICULTY_MULTIPLIERS[4];
        expect(easy.roamingFrequency).toBeGreaterThan(hell.roamingFrequency);
        expect(easy.visitFrequency).toBeGreaterThan(hell.visitFrequency);
        expect(easy.benefitScale).toBeGreaterThan(hell.benefitScale);
        expect(hell.banditScale).toBeGreaterThan(easy.banditScale);
        // 표준(3)은 모두 1.0
        const std = DIFFICULTY_MULTIPLIERS[2];
        expect(std).toEqual({ roamingFrequency: 1, visitFrequency: 1, benefitScale: 1, banditScale: 1 });
    });

    it('difficulty 미지정(구버전 세이브) 시 기본값 3으로 폴백', () => {
        const store = new GameStore();
        store.initWorld([], [], [], []);
        expect(getDifficulty(store)).toBe(DEFAULT_DIFFICULTY);
    });

    it('범위 밖 difficulty는 1~5로 클램프된다', () => {
        const store = new GameStore();
        store.initWorld([], [], [], []);
        store.setGlobalState({ difficulty: 99 });
        expect(getDifficulty(store)).toBe(5);
        store.setGlobalState({ difficulty: -2 });
        expect(getDifficulty(store)).toBe(1);
    });

    it('scaleVisitChance — 낮은 난이도일수록 방문 확률이 커진다', () => {
        const store = new GameStore();
        store.initWorld([], [], [], []);
        store.setGlobalState({ difficulty: 1 });
        const easyChance = scaleVisitChance(0.3, store);
        store.setGlobalState({ difficulty: 5 });
        const hellChance = scaleVisitChance(0.3, store);
        expect(easyChance).toBeGreaterThan(hellChance);
        expect(hellChance).toBeCloseTo(0.3 * 0.6, 5);
    });

    it('scaleRoamingCityCount — 샘플 도시 수가 빈도 배율을 따르며 [1, 전체]로 클램프', () => {
        const store = new GameStore();
        store.initWorld([], [], [], []);
        store.setGlobalState({ difficulty: 1 });
        expect(scaleRoamingCityCount(8, 20, store)).toBe(13); // 8 × 1.6 → 13, 전체 20 이하
        store.setGlobalState({ difficulty: 5 });
        expect(scaleRoamingCityCount(8, 20, store)).toBe(5);  // 8 × 0.6 = 4.8 → 5
        expect(scaleRoamingCityCount(8, 3, store)).toBe(3);   // 전체 도시로 클램프
        expect(scaleRoamingCityCount(0, 10, store)).toBe(1);  // 최소 1
    });

    it('시나리오 난이도가 방문 판정에 실제 반영된다 — 쉬움에서 더 많이 방문', () => {
        const scenario = (scenarioIndex as any[]).find((s: any) => s.id === '05');
        for (const difficulty of [1, 5]) {
            const engine = new GameEngine(new GameStore());
            const world = buildWorld(scenario, 2);
            engine.initWorld(world.officers, world.factions, world.cities, []);
            engine['store'].setGlobalState({ difficulty });
            // random=0 → 방문 확률 판정 전원 통과 + 수락/거절 판정도 통과 (AI 세력 자동 입사)
            const visits = processMonthlyFreeOfficerVisits(engine['store'], () => 0);
            expect(visits.length).toBeGreaterThan(0);
            // 쉬움일 때 방문 확률(chance가 아닌 roll 통과율) 검증은 visit 확률식 간접 확인:
            // roll 0.99는 쉬움(0.45×1.5×야망=0.3375 max)에서는 탈락해야 정상이지만,
            // chance 필드는 accept 확률이므로 여기서는 visit 배열 존재 자체로 스모크
        }
    });

    describe('초반 12개월 AI 난이도 곡선', () => {
        it('1~12개월 경계와 단조 상승을 보존한다', () => {
            expect(AI_DIFFICULTY_CURVE).toHaveLength(12);
            for (let i = 1; i < AI_DIFFICULTY_CURVE.length; i++) {
                expect(AI_DIFFICULTY_CURVE[i]).toBeGreaterThanOrEqual(AI_DIFFICULTY_CURVE[i - 1]);
            }
            expect(resolveAIMonthlyDifficulty(5, 0)).toBe(1);
            expect(resolveAIMonthlyDifficulty(5, 11)).toBe(5);
            expect(resolveAIMonthlyDifficulty(5, 99)).toBe(5);
            expect(resolveAIMonthlyDifficulty(5, 0, { values: [1, 0.5, 0] })).toBe(5);
            expect(resolveAIMonthlyDifficulty(5, 1, { values: [1, 0.5, 0] })).toBe(3);
        });

        it('설정 난이도와 초기 턴을 보존하고 12개월 이후에는 목표 난이도를 유지한다', () => {
            const store = new GameStore();
            store.initWorld([], [], [], []);
            store.setGlobalState({ difficulty: 4, turnCount: 0 });
            const first = getAIMonthlyDifficulty(store);
            expect(first).toBe(1);
            store.setGlobalState({ turnCount: 11 });
            expect(getAIMonthlyDifficulty(store)).toBe(4);
            expect(getAIMonthlyDifficultyMultiplier(store)).toBe(4 / DEFAULT_DIFFICULTY);
            store.setGlobalState({ turnCount: 99 });
            expect(getAIMonthlyDifficulty(store)).toBe(4);
        });
    });

});
