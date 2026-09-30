/**
 * 대화 엔진 테스트
 *
 * 무장별 특화 대화 AI 시스템의 핵심 기능을 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { DialogueEngine } from '../src/core/dialogue_engine.js';
import { GameStore } from '../src/core/game_store.js';
import type { Officer } from '../src/core/types.js';

function createTestStore(): GameStore {
  const store = GameStore.getInstance();

  const officers: Officer[] = [
    {
      id: 'cao_cao',
      name: '조조',
      chineseName: '曹操',
      personality: 'AMBITIOUS',
      stats: { leadership: 96, might: 78, intelligence: 94, politics: 96, charisma: 92 },
      factionId: 'fac_0',
      cityId: 'city_0',
      actionPoints: 10,
      status: 'ACTIVE',
      hasActedThisTurn: false,
    } as Officer,
    {
      id: 'zhang_liao',
      name: '장료',
      chineseName: '張遼',
      personality: 'LOYAL',
      stats: { leadership: 94, might: 94, intelligence: 80, politics: 66, charisma: 82 },
      factionId: 'fac_0',
      cityId: 'city_0',
      actionPoints: 10,
      status: 'ACTIVE',
      hasActedThisTurn: false,
    } as Officer,
    {
      id: 'sima_yi',
      name: '사마의',
      chineseName: '司馬懿',
      personality: 'CAUTIOUS',
      stats: { leadership: 90, might: 60, intelligence: 98, politics: 94, charisma: 78 },
      factionId: 'fac_0',
      cityId: 'city_0',
      actionPoints: 10,
      status: 'ACTIVE',
      hasActedThisTurn: false,
    } as Officer,
  ];

  for (const officer of officers) {
    store.addOfficer(officer);
  }

  return store;
}

describe('DialogueEngine', () => {
  it('should generate dialogue for AMBITIOUS officer', () => {
    const store = createTestStore();
    const engine = new DialogueEngine(store);

    const dialogue = engine.generateDialogue({
      officerId: 'cao_cao',
      situation: 'battle',
      relationship: 'ally',
      affinity: 50,
    });

    expect(dialogue.speaker).toBe('조조');
    expect(dialogue.text).toContain('조조');
    expect(dialogue.choices.length).toBeGreaterThan(0);
  });

  it('should generate different dialogue for different personalities', () => {
    const store = createTestStore();
    const engine = new DialogueEngine(store);

    const caoCao = engine.generateDialogue({
      officerId: 'cao_cao',
      situation: 'battle',
      relationship: 'ally',
      affinity: 50,
    });

    const simaYi = engine.generateDialogue({
      officerId: 'sima_yi',
      situation: 'battle',
      relationship: 'ally',
      affinity: 50,
    });

    expect(caoCao.text).not.toBe(simaYi.text);
  });

  it('should generate different dialogue for different situations', () => {
    const store = createTestStore();
    const engine = new DialogueEngine(store);

    const battle = engine.generateDialogue({
      officerId: 'cao_cao',
      situation: 'battle',
      relationship: 'ally',
      affinity: 50,
    });

    const diplomacy = engine.generateDialogue({
      officerId: 'cao_cao',
      situation: 'diplomacy',
      relationship: 'ally',
      affinity: 50,
    });

    expect(battle.text).not.toBe(diplomacy.text);
  });

  it('should generate different dialogue for different relationships', () => {
    const store = createTestStore();
    const engine = new DialogueEngine(store);

    const ally = engine.generateDialogue({
      officerId: 'cao_cao',
      situation: 'battle',
      relationship: 'ally',
      affinity: 50,
    });

    const enemy = engine.generateDialogue({
      officerId: 'cao_cao',
      situation: 'battle',
      relationship: 'enemy',
      affinity: -50,
    });

    expect(ally.text).not.toBe(enemy.text);
  });

  it('should include stat-based comments for high stats', () => {
    const store = createTestStore();
    const engine = new DialogueEngine(store);

    const dialogue = engine.generateDialogue({
      officerId: 'cao_cao',
      situation: 'battle',
      relationship: 'ally',
      affinity: 50,
    });

    // 조조는 leadership 96, intelligence 94, politics 96, charisma 92 — 모두 90 이상
    expect(dialogue.text).toContain('뛰어난');
  });

  it('should handle unknown officer gracefully', () => {
    const store = createTestStore();
    const engine = new DialogueEngine(store);

    const dialogue = engine.generateDialogue({
      officerId: 'unknown_officer',
      situation: 'battle',
      relationship: 'neutral',
      affinity: 0,
    });

    expect(dialogue.speaker).toBe('???');
    expect(dialogue.text).toBe('...');
  });

  it('should generate officer-to-officer dialogue', () => {
    const store = createTestStore();
    const engine = new DialogueEngine(store);

    const dialogue = engine.generateOfficerDialogue('cao_cao', 'zhang_liao', 'battle');

    expect(dialogue.speaker).toBe('조조');
    expect(dialogue.text.length).toBeGreaterThan(0);
  });
});
