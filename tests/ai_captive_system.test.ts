import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { GameStore } from '../src/core/game_store.js';
import { buildWorld } from '../src/core/scenario_system.js';
import scenarioIndex from '../src/data/scenarios/index.json';
import { OfficerStatus } from '../src/core/types.js';
import {
    isCruelLeader,
    judgeExecution,
    judgeCaptiveRecruit,
    processCaptives,
} from '../src/core/ai_captive_system.js';
import { isCaptive } from '../src/core/captive_escape_system.js';

describe('AI 포로 후처리 [121-130][131-145]', () => {
    let store: GameStore;
    let engine: GameEngine;
    let world: ReturnType<typeof buildWorld>;

    beforeEach(() => {
        store = new GameStore();
        engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
        world = buildWorld(scenario as never, 2);
        engine.initWorld(world.officers, world.factions, world.cities, []);
    });

    it('무력 > 지력이면 잔혹형(처형 성향) 군주다', () => {
        expect(isCruelLeader(96, 58)).toBe(true);   // 무장형
        expect(isCruelLeader(30, 95)).toBe(false);  // 지장형
        expect(isCruelLeader(70, 70)).toBe(false);  // 동률은 온건
    });

    it('처형 판정: 잔혹형 80% vs 온건형 10%', () => {
        expect(judgeExecution(true, 0.79)).toBe(true);
        expect(judgeExecution(true, 0.81)).toBe(false);
        expect(judgeExecution(false, 0.09)).toBe(true);
        expect(judgeExecution(false, 0.11)).toBe(false);
    });

    it('포로 등용 판정: 카리스마 보정 반영', () => {
        expect(judgeCaptiveRecruit(100, 0.65)).toBe(true);   // +0.2 보정 → 70%
        expect(judgeCaptiveRecruit(100, 0.75)).toBe(false);
        expect(judgeCaptiveRecruit(60, 0.49)).toBe(true);    // 기본 50%
        expect(judgeCaptiveRecruit(60, 0.51)).toBe(false);
        expect(judgeCaptiveRecruit(20, 0.96)).toBe(false);   // 최대 95% 클램프
    });

    it('포획된 무장(FREE+충성도0)이 등용/처형/석방으로 처리된다', () => {
        const faction = world.factions[0];
        // 가상 포로 상태 구성: 무장 1명을 FREE + 충성도 0 + 무소속으로 설정
        const officer = store.getAllOfficers().find(o => o.factionId !== null)!;
        store.updateOfficer(officer.id, { factionId: null, status: OfficerStatus.FREE, loyalty: 0, cityId: null });

        const report = processCaptives(store, faction.id, [officer.id]);
        expect(report.outcomes).toHaveLength(1);
        const decision = report.outcomes[0].decision;
        expect(['RECRUIT', 'EXECUTE', 'RELEASE']).toContain(decision);

        if (decision === 'EXECUTE') {
            expect(store.getOfficer(officer.id)).toBeNull();
        } else if (decision === 'RECRUIT') {
            expect(store.getOfficer(officer.id)!.factionId).toBe(faction.id);
            expect(store.getOfficer(officer.id)!.status).toBe(OfficerStatus.OFFICER);
        } else {
            // 석방: 재야 유지
            expect(store.getOfficer(officer.id)!.factionId).toBeNull();
            expect(store.getOfficer(officer.id)!.status).toBe(OfficerStatus.FREE);
        }
    });

    it('석방 결정을 받으면 포로 마커를 해제해 다시 탈출 판정을 받지 않는다', () => {
        const faction = world.factions[0];
        const officer = store.getAllOfficers().find(o => o.factionId !== null)!;
        store.updateOfficer(officer.id, { factionId: null, status: OfficerStatus.FREE, loyalty: 0, cityId: null });

        const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
        try {
            const report = processCaptives(store, faction.id, [officer.id]);
            expect(report.outcomes[0]?.decision).toBe('RELEASE');
            expect(isCaptive(store, officer.id)).toBe(false);
            expect(store.getOfficer(officer.id)!.status).toBe(OfficerStatus.FREE);
        } finally {
            random.mockRestore();
        }
    });

    it('유효하지 않은 포로(충성도 > 0)는 처리하지 않는다', () => {
        const faction = world.factions[0];
        const officer = store.getAllOfficers().find(o => o.factionId !== null)!;
        store.updateOfficer(officer.id, { factionId: null, status: OfficerStatus.FREE, loyalty: 50 });
        const report = processCaptives(store, faction.id, [officer.id]);
        expect(report.outcomes).toHaveLength(0);
    });

    it('빈 포로 목록은 빈 보고서를 반환한다', () => {
        const report = processCaptives(store, world.factions[0].id, []);
        expect(report.outcomes).toHaveLength(0);
        expect(report.messages).toHaveLength(0);
    });

    it('존재하지 않는 세력은 안전하게 빈 보고서를 반환한다', () => {
        const officer = store.getAllOfficers()[0];
        store.updateOfficer(officer.id, { factionId: null, status: OfficerStatus.FREE, loyalty: 0 });
        const report = processCaptives(store, 'fac_nonexistent', [officer.id]);
        expect(report.outcomes).toHaveLength(0);
    });
});
