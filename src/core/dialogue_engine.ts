/**
 * 무장별 특화 대화 AI 시스템
 *
 * 무장의 성향, 능력치, 관계, 상황에 따라 다른 대화를 생성한다.
 * 등장인물별 특화된 무장별 특화 대화를 목표로 한다.
 *
 * 사용 예시:
 *   const engine = new DialogueEngine(store);
 *   const dialogue = engine.generateDialogue({
 *     officerId: 'cao_cao',
 *     situation: 'battle',
 *     relationship: 'ally',
 *   });
 */

import type { GameStore } from './game_store.js';
import type { Officer, Faction } from './types.js';

// ============================================================
// 타입 정의
// ============================================================

export interface DialogueContext {
  readonly officerId: string;
  readonly situation: 'battle' | 'diplomacy' | 'domestic' | 'personal' | 'event';
  readonly relationship: 'ally' | 'enemy' | 'neutral' | 'sworn' | 'family';
  readonly affinity: number;
  readonly topic?: string;
}

export interface DialogueLine {
  readonly speaker: string;
  readonly text: string;
  readonly emotion: 'neutral' | 'happy' | 'angry' | 'sad' | 'surprised';
  readonly choices: readonly DialogueChoice[];
}

export interface DialogueChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly affinityDelta: number;
  readonly statRequirement?: {
    readonly stat: 'leadership' | 'might' | 'intelligence' | 'politics' | 'charisma';
    readonly value: number;
  };
}

// ============================================================
// 대화 템플릿
// ============================================================

const PERSONALITY_TEMPLATES: Record<string, {
  readonly greeting: string;
  readonly battle: string;
  readonly diplomacy: string;
  readonly domestic: string;
  readonly personal: string;
}> = {
  AGGRESSIVE: {
    greeting: '전쟁을 준비합시다!',
    battle: '적을 물리치는 것이 최선입니다!',
    diplomacy: '강한 태도로 임해야 합니다.',
    domestic: '군사력을 우선해야 합니다.',
    personal: '함께 전쟁을 준비합시다.',
  },
  CALM: {
    greeting: '차분히 상황을 파악합시다.',
    battle: '신중하게 전략을 세워야 합니다.',
    diplomacy: '평화적으로 해결합시다.',
    domestic: '안정을 최우선으로 합시다.',
    personal: '서로 이해를 나눕시다.',
  },
  CAUTIOUS: {
    greeting: '위험을 피해야 합니다.',
    battle: '방어를 우선해야 합니다.',
    diplomacy: '신중하게 접근해야 합니다.',
    domestic: '안전을 확보해야 합니다.',
    personal: '조심스럽게 접근합시다.',
  },
  TIMID: {
    greeting: '두렵습니다...',
    battle: '도망치는 것이 나을 수도 있습니다.',
    diplomacy: '약한 태도로 임해야 합니다.',
    domestic: '위험을 피해야 합니다.',
    personal: '겁이 납니다...',
  },
  LOYAL: {
    greeting: '주공을 위해!',
    battle: '주공의 명령을 따릅니다!',
    diplomacy: '주공의 의지를 관철합니다.',
    domestic: '주공의 정책을 지지합니다.',
    personal: '주공과 함께합니다.',
  },
  AMBITIOUS: {
    greeting: '더 높은 목표를 향해!',
    battle: '승리하여 더 큰 것을 얻읍시다!',
    diplomacy: '이용할 수 있는 것을 찾읍시다.',
    domestic: '더 큰 계획을 세워야 합니다.',
    personal: '함께 더 큰 것을 이루읍시다.',
  },
} as const;

const STAT_TEMPLATES = {
  leadership: {
    high: '뛰어난 지휘력으로 이끌어갑니다.',
    low: '지휘력이 부족해 보입니다.',
  },
  might: {
    high: '강한 무력으로 적을 압도합니다.',
    low: '무력이 부족해 보입니다.',
  },
  intelligence: {
    high: '뛰어난 지략으로 상대를 읽습니다.',
    low: '지략이 부족해 보입니다.',
  },
  politics: {
    high: '뛰어난 정치력으로 백성을 다스립니다.',
    low: '정치력이 부족해 보입니다.',
  },
  charisma: {
    high: '뛰어난 매력으로 사람을 모읍니다.',
    low: '매력이 부족해 보입니다.',
  },
} as const;

const RELATIONSHIP_TEMPLATES = {
  ally: {
    greeting: '우리의 우호를 지킵시다.',
    battle: '함께 싸워 이깁시다!',
    diplomacy: '우리의 동맹을 강화합시다.',
    domestic: '함께 나라를 다스립시다.',
    personal: '우리의 인연을 소중히 합시다.',
  },
  enemy: {
    greeting: '적과 대면합니다.',
    battle: '전투를 준비합니다!',
    diplomacy: '적대적으로 접근합니다.',
    domestic: '경계를 늦추지 않습니다.',
    personal: '적대감을 드러냅니다.',
  },
  neutral: {
    greeting: '중립적으로 접근합니다.',
    battle: '신중하게 대응합니다.',
    diplomacy: '중립을 유지합니다.',
    domestic: '관찰합니다.',
    personal: '거리를 둡니다.',
  },
  sworn: {
    greeting: '의형제로서!',
    battle: '함께 싸워 이깁시다!',
    diplomacy: '함께 동맹을 맺읍시다.',
    domestic: '함께 나라를 세웁시다.',
    personal: '의형제의 인연을 나눕시다.',
  },
  family: {
    greeting: '가족으로서!',
    battle: '함께 싸워 이깁시다!',
    diplomacy: '함께 동맹을 맺읍시다.',
    domestic: '함께 나라를 세웁시다.',
    personal: '가족의 인연을 나눕시다.',
  },
} as const;

const SITUATION_TEMPLATES = {
  battle: {
    title: '전투 회의',
    options: [
      { id: 'attack', label: '적극 공격', description: '적을 공격합니다', affinityDelta: 3 },
      { id: 'defend', label: '방어', description: '방어를 강화합니다', affinityDelta: 2 },
      { id: 'retreat', label: '후퇴', description: '후퇴합니다', affinityDelta: -1 },
    ],
  },
  diplomacy: {
    title: '외교 회의',
    options: [
      { id: 'ally', label: '동맹 제안', description: '동맹을 제안합니다', affinityDelta: 4 },
      { id: 'trade', label: '교역', description: '교역을 제안합니다', affinityDelta: 3 },
      { id: 'threaten', label: '협박', description: '협박합니다', affinityDelta: -2 },
    ],
  },
  domestic: {
    title: '내정 회의',
    options: [
      { id: 'develop', label: '개발', description: '도시를 개발합니다', affinityDelta: 3 },
      { id: 'train', label: '훈련', description: '병사를 훈련합니다', affinityDelta: 2 },
      { id: 'tax', label: '세금 인상', description: '세금을 인상합니다', affinityDelta: -1 },
    ],
  },
  personal: {
    title: '개인 대화',
    options: [
      { id: 'listen', label: '경청', description: '상대의 말을 듣습니다', affinityDelta: 5 },
      { id: 'advice', label: '조언', description: '조언을 구합니다', affinityDelta: 3 },
      { id: 'gift', label: '선물', description: '선물을 줍니다', affinityDelta: 4 },
    ],
  },
  event: {
    title: '이벤트',
    options: [
      { id: 'accept', label: '수락', description: '이벤트를 수락합니다', affinityDelta: 3 },
      { id: 'reject', label: '거절', description: '이벤트를 거절합니다', affinityDelta: -1 },
    ],
  },
} as const;

// ============================================================
// 대화 엔진
// ============================================================

export class DialogueEngine {
  private store: GameStore;

  constructor(store: GameStore) {
    this.store = store;
  }

  /**
   * 무장별 특화 대화 생성
   */
  generateDialogue(context: DialogueContext): DialogueLine {
    const officer = this.store.getOfficer(context.officerId);
    if (!officer) {
      return this.createFallbackDialogue(context);
    }

    const personality = officer.personality ?? 'CALM';
    const stats = officer.stats;
    const relationship = context.relationship;
    const situation = context.situation;

    // 성향 기반 대화 스타일
    const personalityStyle = PERSONALITY_TEMPLATES[personality] ?? PERSONALITY_TEMPLATES.CALM;

    // 능력치 기반 대화 내용
    const statLines = this.generateStatLines(stats);

    // 관계 기반 대화 태도
    const relationshipStyle = RELATIONSHIP_TEMPLATES[relationship] ?? RELATIONSHIP_TEMPLATES.neutral;

    // 상황 기반 대화 맥락
    const situationStyle = SITUATION_TEMPLATES[situation] ?? SITUATION_TEMPLATES.personal;

    // 대화 생성
    const text = this.composeDialogueText({
      officerName: officer.name,
      personalityStyle,
      statLines,
      relationshipStyle,
      situationStyle,
      affinity: context.affinity,
    });

    return {
      speaker: officer.name,
      text,
      emotion: this.determineEmotion(context.affinity, personality),
      choices: situationStyle.options,
    };
  }

  private generateStatLines(stats: Officer['stats']): string[] {
    const lines: string[] = [];

    if (stats.leadership >= 90) lines.push(STAT_TEMPLATES.leadership.high);
    else if (stats.leadership <= 30) lines.push(STAT_TEMPLATES.leadership.low);

    if (stats.might >= 90) lines.push(STAT_TEMPLATES.might.high);
    else if (stats.might <= 30) lines.push(STAT_TEMPLATES.might.low);

    if (stats.intelligence >= 90) lines.push(STAT_TEMPLATES.intelligence.high);
    else if (stats.intelligence <= 30) lines.push(STAT_TEMPLATES.intelligence.low);

    if (stats.politics >= 90) lines.push(STAT_TEMPLATES.politics.high);
    else if (stats.politics <= 30) lines.push(STAT_TEMPLATES.politics.low);

    if (stats.charisma >= 90) lines.push(STAT_TEMPLATES.charisma.high);
    else if (stats.charisma <= 30) lines.push(STAT_TEMPLATES.charisma.low);

    return lines;
  }

  private composeDialogueText(params: {
    readonly officerName: string;
    readonly personalityStyle: { readonly greeting: string; readonly battle: string; readonly diplomacy: string; readonly domestic: string; readonly personal: string };
    readonly statLines: readonly string[];
    readonly relationshipStyle: { readonly greeting: string; readonly battle: string; readonly diplomacy: string; readonly domestic: string; readonly personal: string };
    readonly situationStyle: { readonly title: string; readonly options: readonly { readonly id: string; readonly label: string; readonly description: string; readonly affinityDelta: number }[] };
    readonly affinity: number;
  }): string {
    const { officerName, personalityStyle, statLines, relationshipStyle, situationStyle, affinity } = params;

    const parts: string[] = [];

    // 인사
    if (affinity >= 50) {
      parts.push(relationshipStyle.greeting);
    } else if (affinity <= -30) {
      parts.push('...');
    } else {
      parts.push(personalityStyle.greeting);
    }

    // 상황별 대화
    const situationKey = situationStyle.title.includes('전투') ? 'battle'
      : situationStyle.title.includes('외교') ? 'diplomacy'
      : situationStyle.title.includes('내정') ? 'domestic'
      : 'personal';
    parts.push(personalityStyle[situationKey]);

    // 능력치 코멘트
    if (statLines.length > 0) {
      parts.push(statLines[0]);
    }

    return `${officerName}: ${parts.join(' ')}`;
  }

  private determineEmotion(affinity: number, personality: string): DialogueLine['emotion'] {
    if (affinity >= 70) return 'happy';
    if (affinity <= -50) return 'angry';
    if (personality === 'TIMID') return 'sad';
    if (personality === 'AMBITIOUS') return 'surprised';
    return 'neutral';
  }

  private createFallbackDialogue(context: DialogueContext): DialogueLine {
    return {
      speaker: '???',
      text: '...',
      emotion: 'neutral',
      choices: [],
    };
  }

  /**
   * 무장 간 대화 생성
   */
  generateOfficerDialogue(officerAId: string, officerBId: string, situation: DialogueContext['situation']): DialogueLine {
    const officerA = this.store.getOfficer(officerAId);
    const officerB = this.store.getOfficer(officerBId);

    if (!officerA || !officerB) {
      return this.createFallbackDialogue({ officerId: officerAId, situation, relationship: 'neutral', affinity: 0 });
    }

    // 관계 판정
    const relationship = this.determineRelationship(officerA, officerB);
    const affinity = this.calculateAffinity(officerA, officerB);

    return this.generateDialogue({
      officerId: officerAId,
      situation,
      relationship,
      affinity,
    });
  }

  private determineRelationship(officerA: Officer, officerB: Officer): DialogueContext['relationship'] {
    if (officerA.factionId === officerB.factionId) return 'ally';
    // 의형제 관계 확인 로직 추가 필요
    return 'neutral';
  }

  private calculateAffinity(officerA: Officer, officerB: Officer): number {
    // 기본 우호도 계산
    let affinity = 0;

    // 성향 호환성
    if (officerA.personality === officerB.personality) affinity += 20;

    // 능력치 차이
    const statDiff = Math.abs(officerA.stats.charisma - officerB.stats.charisma);
    if (statDiff < 20) affinity += 10;

    return Math.max(-100, Math.min(100, affinity));
  }
}
