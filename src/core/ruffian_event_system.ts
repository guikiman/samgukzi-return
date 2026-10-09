/**
 * 시장 불량배 이벤트 시스템 — 시장 클릭 시 랜덤 조우, 일기토 승리 시 치안·무력 상승
 *
 * 치안이 낮은 도시에서는 확정 발생, 그 외에는 월별 시드로 25% 확률 발생한다.
 * (E2E 결정성: 같은 도시·연월은 항상 같은 판정)
 */

import type { GameStore } from './game_store.js';
import type { OfficerStats } from './types.js';

export const RUFFIAN_EVENT_CHANCE = 0.25;
export const RUFFIAN_DISORDER_THRESHOLD = 30;
export const RUFFIAN_BRIBE_COST = 100;
export const RUFFIAN_ORDER_REWARD = 8;
export const RUFFIAN_MIGHT_REWARD = 2;

export function hashSeedString(seed: string): number {
  let hash = 0x811C9DC5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xFFFFFFFF;
}

export interface RuffianTriggerInput {
  readonly publicOrder: number;
  readonly isPlayerCity: boolean;
  readonly seed: string;
}

export function shouldTriggerRuffian(input: RuffianTriggerInput): boolean {
  if (!input.isPlayerCity) return false;
  if (input.publicOrder < RUFFIAN_DISORDER_THRESHOLD) return true;
  return hashSeedString(input.seed) < RUFFIAN_EVENT_CHANCE;
}

export function buildThugStats(danger: number): OfficerStats {
  const safe = Number.isFinite(danger) ? Math.max(0, danger) : 0;
  return {
    leadership: 40,
    might: 50 + Math.min(25, Math.floor(safe * 0.4)),
    intelligence: 35,
    politics: 20,
    charisma: 30,
  };
}

export interface RuffianOutcome {
  readonly success: boolean;
  readonly message: string;
}

export function applyRuffianDuelOutcome(
  store: GameStore,
  cityId: string,
  officerId: string,
  won: boolean,
): RuffianOutcome {
  const city = store.getCity(cityId);
  const officer = store.getOfficer(officerId);
  if (!city || !officer) return { success: false, message: '대상을 찾을 수 없습니다' };
  if (won) {
    const ds = city.developmentStats;
    store.updateCity(city.id, {
      developmentStats: { ...ds, publicOrder: Math.min(ds.maxPublicOrder, ds.publicOrder + RUFFIAN_ORDER_REWARD) },
    });
    store.updateOfficer(officer.id, {
      stats: { ...officer.stats, might: Math.min(100, officer.stats.might + RUFFIAN_MIGHT_REWARD) },
    });
    return {
      success: true,
      message: `불량배 소탕 — ${city.name} 치안 +${RUFFIAN_ORDER_REWARD}, ${officer.name} 무력 +${RUFFIAN_MIGHT_REWARD}`,
    };
  }
  store.updateOfficer(officer.id, { hp: Math.max(1, officer.hp - 15) });
  const ds = city.developmentStats;
  store.updateCity(city.id, {
    developmentStats: { ...ds, publicOrder: Math.max(0, ds.publicOrder - 3) },
  });
  return { success: false, message: `${officer.name}이(가) 불량배에게 당했다 (HP -15, 치안 -3)` };
}

export function applyRuffianBribe(store: GameStore, cityId: string): RuffianOutcome {
  const city = store.getCity(cityId);
  if (!city) return { success: false, message: '도시를 찾을 수 없습니다' };
  if (city.funds < RUFFIAN_BRIBE_COST) {
    return { success: false, message: `자금 부족 (필요 ${RUFFIAN_BRIBE_COST}金)` };
  }
  const ds = city.developmentStats;
  store.updateCity(city.id, {
    funds: city.funds - RUFFIAN_BRIBE_COST,
    developmentStats: { ...ds, publicOrder: Math.min(ds.maxPublicOrder, ds.publicOrder + 2) },
  });
  return { success: true, message: `불량배에게 ${RUFFIAN_BRIBE_COST}金을 쥐여주고 돌려보냈다 (치안 +2)` };
}
