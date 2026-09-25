import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { GameStore } from '../src/core/game_store.js';
import { buildWorld } from '../src/core/scenario_system.js';
import scenarioIndex from '../src/data/scenarios/index.json';
import {
    checkInteraction,
    executeInteraction,
    getAffinityBetween,
    calculateGiftAffinity,
    AFFINITY_DELTAS,
    GIFT_COST,
} from '../src/core/officer_interaction_system.js';

describe('무장 상호작용 [24][32][33]', () => {
    let store: GameStore;
    let engine: GameEngine;
    let actorId: string;
    let targetId: string;

    beforeEach(() => {
        store = new GameStore();
        engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
        const world = buildWorld(scenario as never, 2);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        const officers = store.getAllOfficers();
        actorId = officers[0].id;
        // 다른 도시 무장을 대상으로 (동일 도시 무장이 1명뿐인 경우 대비)
        targetId = officers.find(o => o.id !== actorId)!.id;
    });

    it('대화는 무료로 우호도 +4를 준다', () => {
        const before = getAffinityBetween(store, actorId, targetId);
        const result = executeInteraction(store, actorId, targetId, 'CHAT');

        expect(result.success).toBe(true);
        expect(result.goldCost).toBe(0);
        expect(result.affinityDelta).toBe(AFFINITY_DELTAS.CHAT);
        expect(getAffinityBetween(store, actorId, targetId)).toBe(before + AFFINITY_DELTAS.CHAT);
    });

    it('대화는 같은 달에 한 번만 가능하다', () => {
        expect(executeInteraction(store, actorId, targetId, 'CHAT').success).toBe(true);
        const gate = checkInteraction(store, actorId, targetId, 'CHAT');
        expect(gate.ok).toBe(false);
        expect(gate.reason).toContain('월 1회');
    });

    it('증정은 국고 200金을 소모하고 우호도 +12를 준다', () => {
        const faction = store.getFaction(store.getOfficer(actorId)!.factionId!)!;
        const goldBefore = faction.gold;
        expect(goldBefore).toBeGreaterThanOrEqual(GIFT_COST);

        const result = executeInteraction(store, actorId, targetId, 'GIFT');
        expect(result.success).toBe(true);
        expect(result.goldCost).toBe(GIFT_COST);
        expect(result.affinityDelta).toBe(AFFINITY_DELTAS.GIFT);
        expect(store.getFaction(faction.id)!.gold).toBe(goldBefore - GIFT_COST);
    });

    it('국고가 부족하면 증정이 거부된다', () => {
        const faction = store.getFaction(store.getOfficer(actorId)!.factionId!)!;
        store.updateFaction(faction.id, { gold: 10 });
        const gate = checkInteraction(store, actorId, targetId, 'GIFT');
        expect(gate.ok).toBe(false);
        expect(gate.reason).toContain('국고가 부족');
    });

    it('선물 아이템 등급과 금화 수량으로 우호도를 계산한다', () => {
        expect(calculateGiftAffinity({ itemId: 'NONE', gold: 200 })).toBe(2);
        expect(calculateGiftAffinity({ itemId: 'JADE', gold: 500 })).toBe(14);
        expect(calculateGiftAffinity({ itemId: 'TREASURE', gold: 9999 })).toBe(45);
    });

    it('선택한 아이템과 금화로 증정하면 해당 비용과 우호도가 적용된다', () => {
        const faction = store.getFaction(store.getOfficer(actorId)!.factionId!)!;
        const goldBefore = faction.gold;
        const affinityBefore = getAffinityBetween(store, actorId, targetId);

        const result = executeInteraction(store, actorId, targetId, 'GIFT', { itemId: 'JADE', gold: 500 });

        expect(result.success).toBe(true);
        expect(result.goldCost).toBe(500);
        expect(result.affinityDelta).toBe(14);
        expect(result.message).toContain('옥비(희귀)');
        expect(store.getFaction(faction.id)!.gold).toBe(goldBefore - 500);
        expect(getAffinityBetween(store, actorId, targetId)).toBe(affinityBefore + 14);
        expect(getAffinityBetween(store, targetId, actorId)).toBe(affinityBefore + 14);
    });

    it('선물 금화가 国庫보다 많으면 전송하지 않는다', () => {
        const faction = store.getFaction(store.getOfficer(actorId)!.factionId!)!;
        store.updateFaction(faction.id, { gold: 100 });
        const before = getAffinityBetween(store, actorId, targetId);
        const result = executeInteraction(store, actorId, targetId, 'GIFT', { itemId: 'SILK', gold: 200 });
        expect(result.success).toBe(false);
        expect(result.goldCost).toBe(0);
        expect(store.getFaction(faction.id)!.gold).toBe(100);
        expect(getAffinityBetween(store, actorId, targetId)).toBe(before);
    });

    it('설전은 즉시 시뮬레이션되어 우호도가 변한다 (승리 +8 / 패배 -3 / 무승부 0)', () => {
        const before = getAffinityBetween(store, actorId, targetId);
        const result = executeInteraction(store, actorId, targetId, 'DEBATE');

        expect(result.success).toBe(true);
        expect([AFFINITY_DELTAS.DEBATE_WIN, AFFINITY_DELTAS.DEBATE_LOSE, 0]).toContain(result.affinityDelta);
        expect(result.message).toContain('설전');
        expect(getAffinityBetween(store, actorId, targetId)).toBe(before + result.affinityDelta);
    });

    it('일기토는 즉시 시뮬레이션되어 우호도가 소폭 상승한다 (승리 +5 / 패배 +2)', () => {
        const before = getAffinityBetween(store, actorId, targetId);
        const result = executeInteraction(store, actorId, targetId, 'DUEL');

        expect(result.success).toBe(true);
        expect([AFFINITY_DELTAS.DUEL_WIN, AFFINITY_DELTAS.DUEL_LOSE, 0]).toContain(result.affinityDelta);
        expect(result.message).toContain('일기토');
        expect(getAffinityBetween(store, actorId, targetId)).toBe(before + result.affinityDelta);
    });

    it('우호도 변화는 양방향으로 동기화된다', () => {
        executeInteraction(store, actorId, targetId, 'GIFT');
        const forward = getAffinityBetween(store, actorId, targetId);
        const reverse = getAffinityBetween(store, targetId, actorId);
        expect(forward).toBe(reverse);
        expect(forward).toBeGreaterThan(0);
    });

    it('우호도는 ±100으로 클램프된다', () => {
        for (let i = 0; i < 30; i++) {
            // 월 1회 제한을 우회하기 위해 GIFT 사용 (국고가 바닥나면 테스트 종료)
            const faction = store.getFaction(store.getOfficer(actorId)!.factionId!)!;
            if (faction.gold < GIFT_COST) break;
            executeInteraction(store, actorId, targetId, 'GIFT');
        }
        const affinity = getAffinityBetween(store, actorId, targetId);
        expect(affinity).toBeLessThanOrEqual(100);
    });

    it('자기 자신과는 상호작용할 수 없다', () => {
        const gate = checkInteraction(store, actorId, actorId, 'CHAT');
        expect(gate.ok).toBe(false);
    });
});
