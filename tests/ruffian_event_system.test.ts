import { describe, it, expect } from 'vitest';
import {
  shouldTriggerRuffian,
  buildThugStats,
  applyRuffianDuelOutcome,
  applyRuffianBribe,
  hashSeedString,
  RUFFIAN_BRIBE_COST,
  RUFFIAN_ORDER_REWARD,
  RUFFIAN_MIGHT_REWARD,
} from '../src/core/ruffian_event_system.js';
import { GameStore } from '../src/core/game_store.js';
import type { Officer, Faction, City } from '../src/core/types.js';

function createWorld(store: GameStore, tag: string): void {
  const faction = {
    id: `fac_${tag}`,
    name: `세력${tag}`,
    leaderId: `off_${tag}`,
    color: '#ffffff',
    capitalCityId: `city_${tag}`,
    cities: [`city_${tag}`],
    officers: [`off_${tag}`],
    armies: [],
    gold: 1000,
    food: 1000,
    reputation: 0,
    policy: { recruitmentFocus: 0, militaryFocus: 0, economyFocus: 0, diplomacyFocus: 0, cultureFocus: 0 },
    diplomacy: {},
    isPlayerControlled: false,
    techLevel: 0,
  } as Faction;
  store.addFaction(faction);

  const city = {
    id: `city_${tag}`,
    name: `도시${tag}`,
    population: 10000,
    defense: 50,
    maxDefense: 100,
    goldIncome: 100,
    foodIncome: 100,
    funds: 1000,
    facilities: [],
    officerIds: [`off_${tag}`],
    ownerId: `fac_${tag}`,
    isCapital: true,
    development: 1000,
    developmentStats: {
      commerce: 50, maxCommerce: 100,
      farming: 50, maxFarming: 100,
      technology: 50, maxTechnology: 100,
      publicOrder: 50, maxPublicOrder: 100,
    },
    loyalty: 70,
    danger: 30,
  } as City;
  store.addCity(city);

  store.addOfficer({
    id: `off_${tag}`,
    name: `무장${tag}`,
    chineseName: `武将${tag}`,
    personality: 'LOYAL',
    stats: { leadership: 80, might: 80, intelligence: 80, politics: 80, charisma: 80 },
    factionId: `fac_${tag}`,
    cityId: `city_${tag}`,
    actionPoints: 10,
    status: 'ACTIVE',
    hasActedThisTurn: false,
    hp: 100,
    maxHp: 100,
    merit: 0,
    fame: 0,
    infamy: 0,
  } as Officer);
}

describe('불량배 조우 판정', () => {
  it('비플레이어 도시는 발생하지 않는다', () => {
    expect(shouldTriggerRuffian({ publicOrder: 5, isPlayerCity: false, seed: 'a' })).toBe(false);
  });

  it('치안 30 미만은 확정 발생한다', () => {
    expect(shouldTriggerRuffian({ publicOrder: 8, isPlayerCity: true, seed: 'any' })).toBe(true);
    expect(shouldTriggerRuffian({ publicOrder: 29, isPlayerCity: true, seed: 'any' })).toBe(true);
  });

  it('같은 시드는 같은 판정이다 (E2E 결정성)', () => {
    const a = shouldTriggerRuffian({ publicOrder: 80, isPlayerCity: true, seed: 'city_x|207|1|ruffian' });
    const b = shouldTriggerRuffian({ publicOrder: 80, isPlayerCity: true, seed: 'city_x|207|1|ruffian' });
    expect(a).toBe(b);
  });

  it('해시는 0~1 범위에 균등 분포한다', () => {
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      const v = hashSeedString(`seed-${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v < 0.25) hits++;
    }
    expect(hits).toBeGreaterThan(20);
    expect(hits).toBeLessThan(90);
  });
});

describe('불량배 스펙', () => {
  it('위험도에 비례한 무력을 가진다', () => {
    const weak = buildThugStats(0);
    const strong = buildThugStats(80);
    expect(weak.might).toBe(50);
    expect(strong.might).toBeGreaterThan(weak.might);
    expect(strong.might).toBeLessThanOrEqual(75);
  });
});

describe('일기토 보상', () => {
  it('승리하면 치안 +8, 무력 +2가 적용된다', () => {
    const store = GameStore.getInstance();
    createWorld(store, 'win');
    const result = applyRuffianDuelOutcome(store, 'city_win', 'off_win', true);

    expect(result.success).toBe(true);
    expect(store.getCity('city_win')?.developmentStats.publicOrder).toBe(50 + RUFFIAN_ORDER_REWARD);
    expect(store.getOfficer('off_win')?.stats.might).toBe(80 + RUFFIAN_MIGHT_REWARD);
  });

  it('치안·무력은 상한을 넘지 않는다', () => {
    const store = GameStore.getInstance();
    createWorld(store, 'cap');
    store.updateCity('city_cap', {
      developmentStats: { commerce: 50, maxCommerce: 100, farming: 50, maxFarming: 100, technology: 50, maxTechnology: 100, publicOrder: 99, maxPublicOrder: 100 },
    });
    store.updateOfficer('off_cap', { stats: { leadership: 80, might: 99, intelligence: 80, politics: 80, charisma: 80 } });

    applyRuffianDuelOutcome(store, 'city_cap', 'off_cap', true);

    expect(store.getCity('city_cap')?.developmentStats.publicOrder).toBe(100);
    expect(store.getOfficer('off_cap')?.stats.might).toBe(100);
  });

  it('패배하면 HP -15, 치안 -3이 적용된다', () => {
    const store = GameStore.getInstance();
    createWorld(store, 'lose');
    const result = applyRuffianDuelOutcome(store, 'city_lose', 'off_lose', false);

    expect(result.success).toBe(false);
    expect(store.getOfficer('off_lose')?.hp).toBe(85);
    expect(store.getCity('city_lose')?.developmentStats.publicOrder).toBe(47);
  });
});

describe('뇌물 해결', () => {
  it('자금이 있으면 차감하고 치안 +2를 적용한다', () => {
    const store = GameStore.getInstance();
    createWorld(store, 'bribe');
    const result = applyRuffianBribe(store, 'city_bribe');

    expect(result.success).toBe(true);
    expect(store.getCity('city_bribe')?.funds).toBe(1000 - RUFFIAN_BRIBE_COST);
    expect(store.getCity('city_bribe')?.developmentStats.publicOrder).toBe(52);
  });

  it('자금이 부족하면 실패하고 차감하지 않는다', () => {
    const store = GameStore.getInstance();
    createWorld(store, 'poor2');
    store.updateCity('city_poor2', { funds: 50 });
    const result = applyRuffianBribe(store, 'city_poor2');

    expect(result.success).toBe(false);
    expect(store.getCity('city_poor2')?.funds).toBe(50);
  });
});
