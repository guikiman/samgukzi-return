/**
 * 전략 선택지 시스템 테스트
 */

import { describe, it, expect } from 'vitest';
import { StrategicOptionSystem } from '../src/core/strategic_option_system.js';
import { DiplomacyEngine, FactionRelation } from '../src/core/diplomacy_engine.js';
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
      publicOrder: 80, maxPublicOrder: 100,
    },
    loyalty: 70,
    danger: 0,
  } as City;
  store.addCity(city);

  store.addOfficer({
    id: `off_${tag}`,
    name: `무장${tag}`,
    chineseName: `武将${tag}`,
    personality: 'AMBITIOUS',
    stats: { leadership: 80, might: 80, intelligence: 80, politics: 80, charisma: 80 },
    factionId: `fac_${tag}`,
    cityId: `city_${tag}`,
    actionPoints: 10,
    status: 'ACTIVE',
    hasActedThisTurn: false,
    merit: 0,
    fame: 0,
    infamy: 0,
  } as Officer);
}

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
  ];

  for (const officer of officers) {
    store.addOfficer(officer);
  }

  return store;
}

describe('StrategicOptionSystem', () => {
  it('should return diplomacy options', () => {
    const store = createTestStore();
    const system = new StrategicOptionSystem(store);

    const options = system.getOptions({
      officerId: 'cao_cao',
      category: 'diplomacy',
      turnCount: 1,
      factionStrength: 1000,
    });

    expect(options.length).toBeGreaterThan(0);
    expect(options[0].category).toBe('diplomacy');
  });

  it('should return battle options', () => {
    const store = createTestStore();
    const system = new StrategicOptionSystem(store);

    const options = system.getOptions({
      officerId: 'cao_cao',
      category: 'battle',
      turnCount: 1,
      factionStrength: 1000,
    });

    expect(options.length).toBeGreaterThan(0);
    expect(options[0].category).toBe('battle');
  });

  it('should return domestic options', () => {
    const store = createTestStore();
    const system = new StrategicOptionSystem(store);

    const options = system.getOptions({
      officerId: 'cao_cao',
      category: 'domestic',
      turnCount: 1,
      factionStrength: 1000,
    });

    expect(options.length).toBeGreaterThan(0);
    expect(options[0].category).toBe('domestic');
  });

  it('should filter options by requirements', () => {
    const store = createTestStore();
    const system = new StrategicOptionSystem(store);

    const options = system.getOptions({
      officerId: 'cao_cao',
      category: 'battle',
      turnCount: 1,
      factionStrength: 100,
    });

    const highRequirementOptions = options.filter((o) => o.requirements.length > 0);
    expect(highRequirementOptions.length).toBeLessThanOrEqual(options.length);
  });

  it('should execute option successfully', () => {
    const store = createTestStore();
    const system = new StrategicOptionSystem(store);

    const result = system.executeOption('ally_proposal', {
      officerId: 'cao_cao',
      category: 'diplomacy',
      turnCount: 1,
      factionStrength: 1000,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('동맹 제안');
  });

  it('should apply numeric effects for city_development', () => {
    const store = createTestStore();
    createWorld(store, 'dev');
    const system = new StrategicOptionSystem(store);

    const result = system.executeOption('city_development', {
      officerId: 'off_dev',
      category: 'domestic',
      turnCount: 1,
      factionStrength: 1000,
    });

    expect(result.success).toBe(true);
    const city = store.getCity('city_dev' as never);
    expect(city?.funds).toBe(500);
    expect(city?.developmentStats.commerce).toBe(60);
    expect(city?.developmentStats.farming).toBe(60);
  });

  it('should fail city_development with insufficient funds', () => {
    const store = createTestStore();
    createWorld(store, 'poor');
    store.updateCity('city_poor' as never, { funds: 100 });
    const system = new StrategicOptionSystem(store);

    const result = system.executeOption('city_development', {
      officerId: 'off_poor',
      category: 'domestic',
      turnCount: 1,
      factionStrength: 1000,
    });

    expect(result.success).toBe(false);
    expect(store.getCity('city_poor' as never)?.funds).toBe(100);
  });

  it('should apply numeric effects for tax_increase', () => {
    const store = createTestStore();
    createWorld(store, 'tax');
    const system = new StrategicOptionSystem(store);

    const result = system.executeOption('tax_increase', {
      officerId: 'off_tax',
      category: 'domestic',
      turnCount: 1,
      factionStrength: 1000,
    });

    expect(result.success).toBe(true);
    expect(store.getFaction('fac_tax' as never)?.gold).toBe(1300);
    expect(store.getCity('city_tax' as never)?.loyalty).toBe(60);
  });

  it('should hide counterpart-gated options without counterpart', () => {
    const store = createTestStore();
    createWorld(store, 'lone');
    const system = new StrategicOptionSystem(store);

    const options = system.getOptions({
      officerId: 'off_lone',
      category: 'diplomacy',
      turnCount: 1,
      factionStrength: 1000,
    });

    const ids = options.map((o) => o.id);
    expect(ids).not.toContain('ally_proposal');
    expect(ids).not.toContain('threaten');
    expect(ids).toContain('trade_agreement');
  });

  it('should form a real alliance with counterpart faction', () => {
    const store = createTestStore();
    createWorld(store, 'us');
    createWorld(store, 'them');
    const diplomacy = new DiplomacyEngine(store);
    const system = new StrategicOptionSystem(store, diplomacy);

    const options = system.getOptions({
      officerId: 'off_us',
      category: 'diplomacy',
      turnCount: 1,
      factionStrength: 1000,
      counterpartFactionId: 'fac_them' as never,
    });
    expect(options.map((o) => o.id)).toContain('ally_proposal');

    const result = system.executeOption('ally_proposal', {
      officerId: 'off_us',
      category: 'diplomacy',
      turnCount: 1,
      factionStrength: 1000,
      counterpartFactionId: 'fac_them' as never,
    });

    expect(result.success).toBe(true);
    expect(diplomacy.getRelation('fac_us' as never, 'fac_them' as never)).toBe(FactionRelation.ALLIANCE);
    expect(store.getOfficer('off_us' as never)?.merit).toBe(5);
  });

  it('should apply threaten effects with counterpart faction', () => {
    const store = createTestStore();
    createWorld(store, 'bully');
    createWorld(store, 'victim');
    const diplomacy = new DiplomacyEngine(store);
    const system = new StrategicOptionSystem(store, diplomacy);

    const result = system.executeOption('threaten', {
      officerId: 'off_bully',
      category: 'diplomacy',
      turnCount: 1,
      factionStrength: 1000,
      counterpartFactionId: 'fac_victim' as never,
    });

    expect(result.success).toBe(true);
    expect(store.getOfficer('off_bully' as never)?.infamy).toBe(5);
    expect(store.getFaction('fac_bully' as never)?.reputation).toBe(-3);
  });

  it('should handle unknown option gracefully', () => {
    const store = createTestStore();
    const system = new StrategicOptionSystem(store);

    const result = system.executeOption('unknown_option', {
      officerId: 'cao_cao',
      category: 'diplomacy',
      turnCount: 1,
      factionStrength: 1000,
    });

    expect(result.success).toBe(false);
  });
});
