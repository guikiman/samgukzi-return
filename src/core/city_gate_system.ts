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
}

export type GateChoiceId = 'bribe' | 'sneak' | 'leave';

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

export function gateBribeCost(strict: boolean): number {
  return strict ? 300 : 100;
}

export function gateSneakThreshold(intelligence: number, strict: boolean): number {
  return strict ? intelligence - 10 : intelligence + 20;
}

export function resolveGateChoice(
  choiceId: GateChoiceId,
  context: GateChoiceContext,
  roll: number = Math.random(),
): GateResolution {
  switch (choiceId) {
    case 'leave':
      return { entered: false, message: '성문을 등지고 돌아간다.', goldSpent: 0, infamyDelta: 0 };
    case 'bribe': {
      const cost = gateBribeCost(context.strict);
      if (context.factionGold < cost) {
        return { entered: false, message: `자금이 부족하다 (필요 ${cost}金).`, goldSpent: 0, infamyDelta: 0 };
      }
      return { entered: true, message: `문지기에게 ${cost}金을 쥐여주고 통과한다.`, goldSpent: cost, infamyDelta: 0 };
    }
    case 'sneak': {
      const threshold = gateSneakThreshold(context.officerIntelligence, context.strict);
      if (roll * 100 < threshold) {
        return { entered: true, message: '망보기를 피해 몰래 성안으로 들어간다.', goldSpent: 0, infamyDelta: 0 };
      }
      return { entered: false, message: '잠입이 발각되어 성밖으로 쫓겨난다 (악명 +3).', goldSpent: 0, infamyDelta: 3 };
    }
  }
}
