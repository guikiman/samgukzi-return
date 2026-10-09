/**
 * 무장별 특화 이벤트 시스템 테스트
 */

import { describe, it, expect } from 'vitest';
import { SpecializedEventSystem } from '../src/core/specialized_event_system.js';
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
  ];

  for (const officer of officers) {
    store.addOfficer(officer);
  }

  return store;
}

describe('SpecializedEventSystem', () => {
  it('should return events for AMBITIOUS officer', () => {
    const store = createTestStore();
    const system = new SpecializedEventSystem(store);

    const events = system.getEventsForOfficer('cao_cao');

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].officerId).toBe('cao_cao');
  });

  it('should return events for LOYAL officer', () => {
    const store = createTestStore();
    const system = new SpecializedEventSystem(store);

    const events = system.getEventsForOfficer('zhang_liao');

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].officerId).toBe('zhang_liao');
  });

  it('should return all events', () => {
    const store = createTestStore();
    const system = new SpecializedEventSystem(store);

    const events = system.getAllEvents();

    expect(events.length).toBeGreaterThan(0);
  });

  it('should trigger event successfully', () => {
    const store = createTestStore();
    const system = new SpecializedEventSystem(store);

    const result = system.triggerEvent('aggressive_battle', 'cao_cao');

    expect(result.success).toBe(true);
    expect(result.message).toContain('전투 욕구');
  });

  it('should handle unknown event gracefully', () => {
    const store = createTestStore();
    const system = new SpecializedEventSystem(store);

    const result = system.triggerEvent('unknown_event', 'cao_cao');

    expect(result.success).toBe(false);
  });
});
