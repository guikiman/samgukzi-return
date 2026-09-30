/**
 * 무장별 특화 이벤트 시스템
 *
 * 무장의 성향, 능력치, 관계에 따라 특화된 이벤트를 생성한다.
 * 코에이 삼국지 수준의 무장별 특화 이벤트를 목표로 한다.
 */

import type { GameStore } from './game_store.js';
import type { Officer } from './types.js';

export interface SpecializedEvent {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly officerId: string;
  readonly category: 'battle' | 'diplomacy' | 'domestic' | 'personal' | 'relationship';
  readonly choices: readonly EventChoice[];
  readonly conditions?: readonly string[];
}

export interface EventChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly effects: readonly string[];
  readonly affinityDelta: number;
}

const PERSONALITY_EVENTS: Record<string, ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: 'battle' | 'diplomacy' | 'domestic' | 'personal' | 'relationship';
  readonly choices: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly effects: ReadonlyArray<string>;
    readonly affinityDelta: number;
  }>;
}>> = {
  AMBITIOUS: [
    {
      id: 'aggressive_battle',
      title: '전투 욕구',
      description: '전투를 갈망하는 무장',
      category: 'battle' as const,
      choices: [
        { id: 'attack', label: '공격', description: '적을 공격합니다', effects: ['전투 발생'], affinityDelta: 3 },
        { id: 'train', label: '훈련', description: '훈련을 강화합니다', effects: ['전투력 증가'], affinityDelta: 2 },
      ],
    },
    {
      id: 'ambitious_plan',
      title: '야망 계획',
      description: '더 큰 목표를 향하는 무장',
      category: 'domestic' as const,
      choices: [
        { id: 'expand', label: '확장', description: '영토를 확장합니다', effects: ['세력 확장'], affinityDelta: 4 },
        { id: 'develop', label: '개발', description: '내정을 개발합니다', effects: ['개발도 증가'], affinityDelta: 3 },
      ],
    },
  ],
  LOYAL: [
    {
      id: 'loyal_defense',
      title: '충성 방어',
      description: '주공을 방어하려는 무장',
      category: 'battle' as const,
      choices: [
        { id: 'defend', label: '방어', description: '주공을 방어합니다', effects: ['방어력 증가'], affinityDelta: 4 },
        { id: 'counter', label: '반격', description: '반격합니다', effects: ['적 피해'], affinityDelta: 3 },
      ],
    },
  ],
  CAUTIOUS: [
    {
      id: 'cautious_strategy',
      title: '신중한 전략',
      description: '신중하게 전략을 세우는 무장',
      category: 'diplomacy' as const,
      choices: [
        { id: 'negotiate', label: '협상', description: '협상을 시도합니다', effects: ['관계 개선'], affinityDelta: 3 },
        { id: 'observe', label: '관찰', description: '상황을 관찰합니다', effects: ['정보 획득'], affinityDelta: 2 },
      ],
    },
  ],
};

export class SpecializedEventSystem {
  private store: GameStore;

  constructor(store: GameStore) {
    this.store = store;
  }

  getEventsForOfficer(officerId: string): readonly SpecializedEvent[] {
    const officer = this.store.getOfficer(officerId);
    if (!officer) return [];

    const personality = officer.personality ?? 'CALM';
    const events = PERSONALITY_EVENTS[personality] ?? [];

    return events.map((event) => ({
      ...event,
      officerId,
    }));
  }

  getAllEvents(): readonly SpecializedEvent[] {
    const officers = this.store.getAllOfficers();
    const allEvents: SpecializedEvent[] = [];

    for (const officer of officers) {
      const events = this.getEventsForOfficer(officer.id);
      allEvents.push(...events);
    }

    return allEvents;
  }

  triggerEvent(eventId: string, officerId: string): { success: boolean; message: string } {
    const events = this.getEventsForOfficer(officerId);
    const event = events.find((e) => e.id === eventId);

    if (!event) {
      return { success: false, message: '이벤트를 찾을 수 없습니다' };
    }

    return { success: true, message: `${event.title}: ${event.description}` };
  }
}
