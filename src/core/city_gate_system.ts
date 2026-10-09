/**
 * 성문 검문 시스템 — 미방문·중립 도시와 적대 도시 진입 시 검문 이벤트
 *
 * 자국 도시는 항상 통과, 무주공산은 검문 없음.
 * 미방문 중립 도시는 일반 검문, 전쟁 중인 세력 도시는 엄중 검문.
 */

export type GateInspectionKind = 'none' | 'standard' | 'strict';

export interface GateInspection {
  readonly kind: GateInspectionKind;
  readonly cityName: string;
  readonly ownerName: string | null;
}

export interface GateCheckInput {
  readonly cityName: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly playerFactionId: string | null;
  readonly atWar: boolean;
  readonly visited: boolean;
}

export function shouldInspectAtGate(input: GateCheckInput): GateInspection {
  const base = { cityName: input.cityName, ownerName: input.ownerName };
  if (!input.ownerId) return { ...base, kind: 'none' };
  if (input.playerFactionId && input.ownerId === input.playerFactionId) return { ...base, kind: 'none' };
  if (input.atWar) return { ...base, kind: 'strict' };
  if (input.visited) return { ...base, kind: 'none' };
  return { ...base, kind: 'standard' };
}export type GateChoiceId = 'bribe' | 'sneak' | 'leave';
export interface GateChoiceContext {
  readonly factionGold: number;
  readonly officerIntelligence: number;
  readonly strict: boolean;
}
export interface GateResolution {
  readonly entered: boolean;
  readonly message: string;
  readonly goldSpent: number;
  readonly infamyDelta: number;
}
export interface GateEventSummary {
  readonly entered: boolean;
  readonly message: string;
  readonly goldSpent: number;
  readonly infamyDelta: number;
  /** 트랜스크립트/로그/결과줄에서 바로 쓸, 상황 설명 한 줄. */
  readonly why: string;
  /** 성문 대화에 종속된 짧은 꼬리표 — 예: 뇌물/잠입/철수 지점을 더 빠르게 읽게 한다. */
  readonly tag: string;
}
export function gateBribeCost(strict: boolean): number {
  return strict ? 300 : 100;
}
export function gateSneakThreshold(intelligence: number, strict: boolean): number {
  return strict ? intelligence - 10 : intelligence + 20;
}
export function describeGateSneak(
  intelligence: number,
  strict: boolean,
  roll: number,
): { passed: boolean; reason: string } {
  const threshold = gateSneakThreshold(intelligence, strict);
  const chance = Math.max(0, Math.min(100, threshold));
  if (roll * 100 < threshold) {
    return { passed: true, reason: strict ? '엄중한 경계 속에서도 들키지 않고 빠져나갔다.' : '빈틈을 타 들키지 않고 성안으로 스며들었다.' };
  }
  return { passed: false, reason: strict ? ' vigilant한 문지기에게 걸려 성밖으로 쫓겨났다.' : '눈치 빠른 문지기에게 들켜 성밖으로 내몰렸다.' };
}
export function resolveGateEvent(
  choiceId: GateChoiceId,
  context: GateChoiceContext,
  roll: number = Math.random(),
): GateEventSummary {
  switch (choiceId) {
    case 'leave': {
      return {
        entered: false,
        message: '성문을 등지고 돌아간다.',
        goldSpent: 0,
        infamyDelta: 0,
        why: '검문을 통과하지 않고 발길을 돌린다.',
        tag: '철수',
      };
    }
    case 'bribe': {
      const cost = gateBribeCost(context.strict);
      if (context.factionGold < cost) {
        return {
          entered: false,
          message: `자금이 부족하다 (필요 ${cost}金).`,
          goldSpent: 0,
          infamyDelta: 0,
          why: `뇌물 ${cost}金을 준비하지 못했다.`,
          tag: '뇌물 실패',
        };
      }
      return {
        entered: true,
        message: `문지기에게 ${cost}金을 쥐여주고 통과한다.`,
        goldSpent: cost,
        infamyDelta: 0,
        why: `문지기에게 ${cost}金을 건네고 무마했다.`,
        tag: '뇌물 통과',
      };
    }
    case 'sneak': {
      const { passed, reason } = describeGateSneak(context.officerIntelligence, context.strict, roll);
      if (passed) {
        return {
          entered: true,
          message: '망보기를 피해 몰래 성안으로 들어간다.',
          goldSpent: 0,
          infamyDelta: 0,
          why: reason,
          tag: '잠입 성공',
        };
      }
      return {
        entered: false,
        message: '잠입이 발각되어 성밖으로 쫓겨난다 (악명 +3).',
        goldSpent: 0,
        infamyDelta: 3,
        why: reason,
        tag: '잠입 실패',
      };
    }
  }
}
export function resolveGateChoice(
  choiceId: GateChoiceId,
  context: GateChoiceContext,
  roll: number = Math.random(),
): GateResolution {
  const ev = resolveGateEvent(choiceId, context, roll);
  return { entered: ev.entered, message: ev.message, goldSpent: ev.goldSpent, infamyDelta: ev.infamyDelta };
}
