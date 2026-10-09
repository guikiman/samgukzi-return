import { describe, it, expect } from 'vitest';
import { GameStore } from '../src/core/game_store.js';
import { GameEngine } from '../src/core/game_engine.js';
import { buildWorld } from '../src/core/scenario_system.js';
import { computeSettlement, diffSettlement } from '../src/core/settlement_summary_system.js';
import scenarioIndex from '../src/data/scenarios/index.json';

describe('월말 정산 요약 [E1-361][461-480]', () => {
    it('시나리오 월드에서 세력별 수입·국고·병력·무장 스냅샷을 산출한다', () => {
        const scenario = (scenarioIndex as any[]).find(s => s.id === '05');
        const engine = new GameEngine(new GameStore());
        const world = buildWorld(scenario, 0);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        const report = computeSettlement(engine['store']);

        expect(report.factions).toHaveLength(4);
        for (const f of report.factions) {
            expect(f.cityCount).toBeGreaterThan(0);
            expect(f.goldIncome).toBeGreaterThan(0);
            expect(f.foodIncome).toBeGreaterThan(0);
            expect(f.officerCount).toBeGreaterThan(0);
            expect(f.avgMorale).toBeGreaterThanOrEqual(0);
        }
        // 조조(fac_0) — 허창 + 진류·연주·하비·업·낙양·장안·서주·진양·여강 = 10도시,
        // 그리고 서부 9도시(무위·천수·홍농·소패·상당·남피·평원·청주·제남) = 19도시, 군주 포함
        const caocao = report.factions.find(f => f.factionId === 'fac_0');
        expect(caocao?.factionName).toBe('조조');
        expect(caocao?.cityCount).toBe(19);
    });

    it('국고·병량이 스냅샷에 정확히 반영된다', () => {
        const engine = new GameEngine(new GameStore());
        const scenario = (scenarioIndex as any[]).find(s => s.id === '05');
        const world = buildWorld(scenario, 0);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        const store = engine['store'];
        const fac = store.getFaction('fac_0')!;
        store.updateFaction('fac_0', { gold: fac.gold + 500, food: fac.food + 2000 });

        const report = computeSettlement(store);
        const caocao = report.factions.find(f => f.factionId === 'fac_0')!;
        expect(caocao.gold).toBe(fac.gold + 500);
        expect(caocao.food).toBe(fac.food + 2000);
    });

    it('diffSettlement — 이전 스냅샷 대비 증감을 계산한다', () => {
        const prev = {
            factionId: 'fac_0', factionName: '조조', cityCount: 1,
            goldIncome: 100, foodIncome: 200, gold: 1000, food: 5000,
            troops: 8000, officerCount: 7, avgMorale: 70,
        };
        const curr = { ...prev, gold: 1200, food: 4800, troops: 7500, officerCount: 8 };
        const delta = diffSettlement(prev, curr);
        expect(delta).toEqual({ gold: 200, food: -200, troops: -500, officerCount: 1 });
    });

    it('diffSettlement — 기준 스냅샷이 없으면 증감 0 (국고 전체를 증가로 보지 않는다)', () => {
        const curr = {
            factionId: 'fac_1', factionName: '손권', cityCount: 1,
            goldIncome: 90, foodIncome: 180, gold: 600, food: 3000,
            troops: 5000, officerCount: 5, avgMorale: 65,
        };
        expect(diffSettlement(undefined, curr)).toEqual({
            gold: 0, food: 0, troops: 0, officerCount: 0,
        });
    });

    it('diffSettlement — 국고가 0인 세력도 실제 증감 0과 구분되지 않는다', () => {
        const zeroed = {
            factionId: 'fac_2', factionName: '공손', cityCount: 0,
            goldIncome: 0, foodIncome: 0, gold: 0, food: 0,
            troops: 0, officerCount: 0, avgMorale: 0,
        };
        expect(diffSettlement(zeroed, { ...zeroed })).toEqual({
            gold: 0, food: 0, troops: 0, officerCount: 0,
        });
    });
});
