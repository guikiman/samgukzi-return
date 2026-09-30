/**
 * 전략 시뮬레이션 선택지 시스템
 *
 * 외교/전투/내정 선택지를 무장별로 특화하여 생성한다.
 * 플레이어가 전략적 결정을 내릴 수 있는 풍부한 선택지를 제공한다.
 */

import type { GameStore } from './game_store.js';
import type { Officer, Faction, City, FactionID } from './types.js';
import type { DiplomacyEngine } from './diplomacy_engine.js';

export interface StrategicOption {
  readonly id: string;
  readonly category: 'diplomacy' | 'battle' | 'domestic';
  readonly title: string;
  readonly description: string;
  readonly requirements: readonly string[];
  readonly effects: readonly string[];
  readonly risk: 'low' | 'medium' | 'high';
  readonly affinityImpact: number;
}

export interface StrategicContext {
  readonly officerId: string;
  readonly category: 'diplomacy' | 'battle' | 'domestic';
  readonly turnCount: number;
  readonly factionStrength: number;
  // 외교 상대 세력 — 있으면 동맹/협박이 실제 조약·유언비어로 적용된다.
  readonly counterpartFactionId?: FactionID;
}

const DIPLOMACY_OPTIONS: readonly StrategicOption[] = [
  {
    id: 'ally_proposal',
    category: 'diplomacy',
    title: '동맹 제안',
    description: '다른 세력과 동맹을 맺어 공동 방어한다',
    requirements: ['우호도 30 이상', '세력 간 관계 양호'],
    effects: ['공동 방어 활성화', '교역 보너스 +20%'],
    risk: 'low',
    affinityImpact: 5,
  },
  {
    id: 'trade_agreement',
    category: 'diplomacy',
    title: '교역 협정',
    description: '다른 세력과 교역을 활성화한다',
    requirements: ['우호도 20 이상'],
    effects: ['국고 +150', '공적 +3'],
    risk: 'low',
    affinityImpact: 3,
  },
  {
    id: 'threaten',
    category: 'diplomacy',
    title: '협박',
    description: '군사적 위협으로 상대를 굴복시킨다',
    requirements: ['군사력 우위'],
    effects: ['유언비어 유포', '악명 +5', '명성 -3'],
    risk: 'high',
    affinityImpact: -10,
  },
  {
    id: 'spy_mission',
    category: 'diplomacy',
    title: '첩보 활동',
    description: '적 세력에 첩자를 보내 정보를 수집한다',
    requirements: ['지력 70 이상'],
    effects: ['첩보 판정', '성공 시 공적 +10·명성 +5'],
    risk: 'medium',
    affinityImpact: 0,
  },
];

const BATTLE_OPTIONS: readonly StrategicOption[] = [
  {
    id: 'full_attack',
    category: 'battle',
    title: '총공격 태세',
    description: '전시 동원령으로 총공격 태세를 갖춘다',
    requirements: ['군량 300 이상', '자금 200 이상'],
    effects: ['군량 -300', '자금 -200', '방어 +15'],
    risk: 'high',
    affinityImpact: 0,
  },
  {
    id: 'siege',
    category: 'battle',
    title: '포위전 준비',
    description: '장기 포위전에 대비해 병참을 비축한다',
    requirements: ['군량 150 이상'],
    effects: ['군량 -150', '방어 +10'],
    risk: 'medium',
    affinityImpact: 0,
  },
  {
    id: 'ambush',
    category: 'battle',
    title: '매복 훈련',
    description: '기습 전술을 훈련해 전투력을 높인다',
    requirements: ['지형 지식'],
    effects: ['방어 +5', '공적 +5'],
    risk: 'medium',
    affinityImpact: 0,
  },
  {
    id: 'defense',
    category: 'battle',
    title: '방어 전략',
    description: '도시를 방어하여 적의 공격을 막는다',
    requirements: ['자금 200 이상'],
    effects: ['자금 -200', '방어 +20'],
    risk: 'low',
    affinityImpact: 0,
  },
];

const DOMESTIC_OPTIONS: readonly StrategicOption[] = [
  {
    id: 'city_development',
    category: 'domestic',
    title: '도시 개발',
    description: '도시의 인프라를 개발한다',
    requirements: ['자금 500 이상'],
    effects: ['자금 -500', '상업 +10', '농업 +10'],
    risk: 'low',
    affinityImpact: 2,
  },
  {
    id: 'military_training',
    category: 'domestic',
    title: '군사 훈련',
    description: '병사의 훈련을 강화한다',
    requirements: ['자금 300 이상'],
    effects: ['자금 -300', '병력 +200', '방어 +5'],
    risk: 'low',
    affinityImpact: 1,
  },
  {
    id: 'tax_increase',
    category: 'domestic',
    title: '세금 인상',
    description: '세금을 인상하여 수입을 늘린다',
    requirements: ['치안 50 이상'],
    effects: ['국고 +300', '충성 -10', '치안 -5'],
    risk: 'medium',
    affinityImpact: -3,
  },
  {
    id: 'welfare',
    category: 'domestic',
    title: '복지 정책',
    description: '백성의 복지를 향상시킨다',
    requirements: ['자금 400 이상'],
    effects: ['자금 -400', '충성 +15', '치안 +10'],
    risk: 'low',
    affinityImpact: 4,
  },
];

const COUNTERPART_GATED = ['ally_proposal', 'threaten'];

export class StrategicOptionSystem {
  private store: GameStore;
  private diplomacy: DiplomacyEngine | null;

  constructor(store: GameStore, diplomacy?: DiplomacyEngine) {
    this.store = store;
    this.diplomacy = diplomacy ?? null;
  }

  getOptions(context: StrategicContext): readonly StrategicOption[] {
    const officer = this.store.getOfficer(context.officerId);
    if (!officer) return [];

    const allOptions = this.getOptionsByCategory(context.category);
    return allOptions.filter((option) => {
      if (COUNTERPART_GATED.includes(option.id) && !this.resolveCounterpart(officer, context)) return false;
      return this.meetsRequirements(option, officer, context);
    });
  }

  private getOptionsByCategory(category: StrategicContext['category']): readonly StrategicOption[] {
    switch (category) {
      case 'diplomacy': return DIPLOMACY_OPTIONS;
      case 'battle': return BATTLE_OPTIONS;
      case 'domestic': return DOMESTIC_OPTIONS;
    }
  }

  private officerFaction(officer: Officer): Faction | null {
    return officer.factionId ? (this.store.getFaction(officer.factionId) ?? null) : null;
  }

  private officerCity(officer: Officer): City | null {
    return officer.cityId ? (this.store.getCity(officer.cityId) ?? null) : null;
  }

  private resolveCounterpart(officer: Officer, context: StrategicContext): FactionID | null {
    const counterpart = context.counterpartFactionId;
    if (!counterpart || counterpart === officer.factionId) return null;
    return this.store.getFaction(counterpart) ? counterpart : null;
  }

  private parseAmount(req: string): number | null {
    const match = /(\d+)/.exec(req);
    return match?.[1] ? parseInt(match[1], 10) : null;
  }

  private meetsRequirements(option: StrategicOption, officer: Officer, context: StrategicContext): boolean {
    const faction = this.officerFaction(officer);
    const city = this.officerCity(officer);
    for (const req of option.requirements) {
      if (req.includes('지력') && officer.stats.intelligence < 70) return false;
      const amount = this.parseAmount(req);
      if (amount === null) continue;
      if (req.includes('자금')) {
        const pool = city?.funds ?? faction?.gold ?? context.factionStrength;
        if (pool < amount) return false;
      } else if (req.includes('군량')) {
        const pool = faction?.food ?? context.factionStrength;
        if (pool < amount) return false;
      } else if (req.includes('병력') || req.includes('군사력')) {
        const pool = city?.development ?? context.factionStrength;
        if (pool < amount) return false;
      } else if (req.includes('치안')) {
        const order = city?.developmentStats.publicOrder;
        if (order !== undefined && order < amount) return false;
      }
    }
    return true;
  }

  executeOption(optionId: string, context: StrategicContext): { success: boolean; message: string } {
    const option = this.findOption(optionId);
    if (!option) return { success: false, message: '선택지를 찾을 수 없습니다' };

    const officer = this.store.getOfficer(context.officerId);
    if (!officer) return { success: false, message: '무장을 찾을 수 없습니다' };
    if (!this.meetsRequirements(option, officer, context)) {
      return { success: false, message: `${option.title} 요건을 충족하지 못합니다` };
    }

    const applied = this.applyOption(optionId, officer, context);
    if (applied.length === 0) return { success: false, message: `${option.title} — 적용할 세력·도시가 없습니다` };
    return { success: true, message: `${option.title} 실행: ${applied.join(', ')}` };
  }

  private spendFactionGold(faction: Faction | null, amount: number, applied: string[], label: string): boolean {
    if (!faction) return true;
    if (faction.gold < amount) return false;
    this.store.updateFaction(faction.id, { gold: faction.gold - amount });
    applied.push(`${label} -${amount}`);
    return true;
  }

  private applyOption(optionId: string, officer: Officer, context: StrategicContext): string[] {
    const applied: string[] = [];
    const faction = this.officerFaction(officer);
    const city = this.officerCity(officer);
    const counterpart = this.resolveCounterpart(officer, context);

    switch (optionId) {
      case 'ally_proposal': {
        if (counterpart && faction && this.diplomacy) {
          const result = this.diplomacy.formAlliance(faction.id, counterpart, 0);
          if (!result.success) return [];
          applied.push(`동맹 체결 (${result.message})`);
        }
        this.store.updateOfficer(officer.id, { merit: officer.merit + 5 });
        applied.push('공적 +5');
        break;
      }
      case 'trade_agreement': {
        if (faction) {
          this.store.updateFaction(faction.id, { gold: faction.gold + 150 });
          applied.push('국고 +150');
        }
        this.store.updateOfficer(officer.id, { merit: officer.merit + 3 });
        applied.push('공적 +3');
        break;
      }
      case 'threaten': {
        if (counterpart && this.diplomacy) {
          const result = this.diplomacy.spreadRumor(counterpart);
          applied.push(result.message);
        }
        this.store.updateOfficer(officer.id, { infamy: officer.infamy + 5 });
        applied.push('악명 +5');
        if (faction) {
          this.store.updateFaction(faction.id, { reputation: faction.reputation - 3 });
          applied.push('명성 -3');
        }
        break;
      }
      case 'spy_mission': {
        const result = this.diplomacy?.plantSpy() ?? { success: true, message: '첩보 개시' };
        if (!result.success) {
          this.store.updateOfficer(officer.id, { infamy: officer.infamy + 3 });
          return [`첩보 실패 (${result.message})`, '악명 +3'];
        }
        this.store.updateOfficer(officer.id, { merit: officer.merit + 10, fame: officer.fame + 5 });
        applied.push(`첩보 성공 (${result.message})`, '공적 +10', '명성 +5');
        break;
      }
      case 'full_attack': {
        if (faction && (faction.food < 300 || faction.gold < 200)) return [];
        if (faction) {
          this.store.updateFaction(faction.id, { food: faction.food - 300, gold: faction.gold - 200 });
          applied.push('군량 -300', '자금 -200');
        }
        if (city) {
          this.store.updateCity(city.id, { defense: Math.min(city.maxDefense, city.defense + 15) });
          applied.push('방어 +15');
        }
        break;
      }
      case 'siege': {
        if (faction && faction.food < 150) return [];
        if (faction) {
          this.store.updateFaction(faction.id, { food: faction.food - 150 });
          applied.push('군량 -150');
        }
        if (city) {
          this.store.updateCity(city.id, { defense: Math.min(city.maxDefense, city.defense + 10) });
          applied.push('방어 +10');
        }
        break;
      }
      case 'ambush': {
        if (city) {
          this.store.updateCity(city.id, { defense: Math.min(city.maxDefense, city.defense + 5) });
          applied.push('방어 +5');
        }
        this.store.updateOfficer(officer.id, { merit: officer.merit + 5 });
        applied.push('공적 +5');
        break;
      }
      case 'defense': {
        if (city && city.funds < 200) return [];
        if (city) {
          this.store.updateCity(city.id, {
            funds: city.funds - 200,
            defense: Math.min(city.maxDefense, city.defense + 20),
          });
          applied.push('자금 -200', '방어 +20');
        } else {
          return [];
        }
        break;
      }
      case 'city_development': {
        if (city && city.funds < 500) return [];
        if (city) {
          const ds = city.developmentStats;
          this.store.updateCity(city.id, {
            funds: city.funds - 500,
            developmentStats: {
              ...ds,
              commerce: Math.min(ds.maxCommerce, ds.commerce + 10),
              farming: Math.min(ds.maxFarming, ds.farming + 10),
            },
          });
          applied.push('자금 -500', '상업 +10', '농업 +10');
        } else {
          return [];
        }
        break;
      }
      case 'military_training': {
        if (city && city.funds < 300) return [];
        if (city) {
          this.store.updateCity(city.id, {
            funds: city.funds - 300,
            development: city.development + 200,
            defense: Math.min(city.maxDefense, city.defense + 5),
          });
          applied.push('자금 -300', '병력 +200', '방어 +5');
        } else {
          return [];
        }
        break;
      }
      case 'tax_increase': {
        if (faction) {
          this.store.updateFaction(faction.id, { gold: faction.gold + 300 });
          applied.push('국고 +300');
        }
        if (city) {
          const ds = city.developmentStats;
          this.store.updateCity(city.id, {
            loyalty: Math.max(0, city.loyalty - 10),
            developmentStats: { ...ds, publicOrder: Math.max(0, ds.publicOrder - 5) },
          });
          applied.push('충성 -10', '치안 -5');
        }
        break;
      }
      case 'welfare': {
        if (city && city.funds < 400) return [];
        if (city) {
          const ds = city.developmentStats;
          this.store.updateCity(city.id, {
            funds: city.funds - 400,
            loyalty: Math.min(100, city.loyalty + 15),
            developmentStats: { ...ds, publicOrder: Math.min(ds.maxPublicOrder, ds.publicOrder + 10) },
          });
          applied.push('자금 -400', '충성 +15', '치안 +10');
        } else {
          return [];
        }
        break;
      }
      default:
        break;
    }
    return applied;
  }

  private findOption(optionId: string): StrategicOption | undefined {
    return [...DIPLOMACY_OPTIONS, ...BATTLE_OPTIONS, ...DOMESTIC_OPTIONS].find((o) => o.id === optionId);
  }
}
