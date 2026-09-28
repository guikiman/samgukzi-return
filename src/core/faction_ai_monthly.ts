/**
 * 세력 AI — 월간 자율 행동 [201][K-고급 AI]
 *
 * executeTurn에서 호출되며, 플레이어 세력을 제외한 모든 세력에 대해:
 * 1) 내정: 도시 자금이 충분하면 개발 (developmentStats 상승)
 * 2) 징병: 병력(development)이 적으면 모집
 * 3) 출진: 병력 우위 + 인접 적 도시가 있으면 확률적 공성 (도시 점령)
 *
 * 성향(군주 personality)에 따라 공격성이 달라진다.
 */

import type { GameStore } from './game_store.js';
import type { City, Faction } from './types.js';
import { assembleReinforcements } from './reinforcement_system.js';
import { processBattleSpoils } from './battle_spoils_system.js';
import { processCaptives, type CaptiveOutcome } from './ai_captive_system.js';
// [295] 유저 비개입 자동 전투 시뮬레이터 — AI 출진 판정을 확률 단판에서 라운드제 소모전으로 격상
import { simulateAutoBattle, type AutoBattleSides, type AutoBattleUnit } from './auto_battle_simulator.js';
import { getAIMonthlyDifficultyMultiplier } from './difficulty_balance_system.js';

/** 전도 정규화 좌표 기반 인접 판정 거리 (main.ts의 ADJACENT_DIST와 동일 기준) */
const ADJACENT_DIST = 0.16;

/**
 * [결함 수정] 병력 증가 상수.
 *
 * 원래 징병은 `병력 200 미만이면 +600` 인 일회성 판정이라,
 * development 이 0~100 개발도일 때는 그럴듯했지만 이 값이
 * 병력(수천~수만)인 걸 확인하고 나니 조건이 영원히 거짓이 되어
 * 병력이 1명도 늘지 않았다. 그 결과 AI가 24개월 내내 공격 0회였다.
 */
const RECRUIT_RATE = 0.004;              // 매달 인구 0.4% 를 병력으로 징발
const RECRUIT_COST_PER_THOUSAND = 8;    // 1,000명당 징병비(공급은 도시 식량 수입과 별개)

/** 출진에 필요한 최소 병력 — 인구의 비율 (garrison cap 12~15% 보다 낮게 둔다) */
const MIN_ATTACK_FORCE_RATIO = 0.08;

/**
 * 출진에 필요한 열세 배수. [결함 수정]
 * 1.2 는 증원이 사실상 0 이던 시절의 값이다. 지금은 양측 모두
 * 인접 도시 증원을 받으므로 1.2 는 너무 높다 — 도시 간 병력 차이가
 * 1~2천 명 수준이므로 1.2 배는 사실상 성립하지 않는다.
 * 실측에서 비율이 0.96~1.04 였으므로 1.05 로 낮춘다.
 */
const SUPERIORITY_RATIO = 1.05;

/**
 * 도시가 유지할 수 있는 최대 병력 — 인구의 12% (수도 15%).
 * 상한이 없으면 모든 도시가 무한정 불어나 출진 열세 판정이 무의미해진다.
 *
 * [결함 수정] main.ts 의 시설/건물 BARRACKS 도 병력을 늘리는데 상한을
 * 각각 "무제한" 과 "1000" 으로 두어 같은 건물이 도시마다 다르게 동작했다.
 * 이 함수를 export 해 한 곳에서만 정의하고, main.ts 도 여기서 가져간다.
 */
export function garrisonCap(city: { population: number; isCapital: boolean }): number {
    return Math.max(400, Math.round(city.population * (city.isCapital ? 0.15 : 0.12)));
}

/** 군주 성향별 공격성 (출진 확률 가중) */
const AGGRESSION: Record<string, number> = {
    AGGRESSIVE: 0.75,
    AMBITIOUS: 0.55,
    CALM: 0.25,
    CAUTIOUS: 0.15,
    LOYAL: 0.2,
    TIMID: 0.05,
};

export interface FactionAIMonthlyOptions {
    /** 스트리밍 AI가 이미 커맨드 큐로 내정/징병을 처리한 경우 직접 처리 중복을 방지한다. [201] */
    skipCityDevelopment?: boolean;
    /** 신규 게임 초기 12개월 AI 난이도 곡선을 명시적으로 주입 (테스트/재현용). */
    aiDifficultyMultiplier?: number;
}

export interface FactionAIReport {
    factionId: string;
    factionName: string;
    actions: string[];
    conqueredCityId: string | null;
    /** UI/연대기에 전달할 포로 처분 결과 [121-130][131-145] */
    captiveOutcomes?: CaptiveOutcome[];
}

export class FactionAI {
    /** 포로 등용 원수화 페널티용 외교 엔진 (엔진에서 주입) */
    diplomacy: import('./diplomacy_engine.js').DiplomacyEngine | null = null;

    constructor(private store: GameStore) {}

    /** 월간 세력 AI 실행 — 플레이어 세력 제외 */
    runMonthly(options: FactionAIMonthlyOptions = {}): FactionAIReport[] {
        const gs = this.store.getGlobalState();
        const reports: FactionAIReport[] = [];

        for (const faction of this.store.getAllFactions()) {
            if (faction.id === gs.playerFactionId) continue;
            reports.push(this.runFaction(faction, options));
        }
        return reports;
    }

    private runFaction(faction: Faction, options: FactionAIMonthlyOptions = {}): FactionAIReport {
        const actions: string[] = [];
        let conqueredCityId: string | null = null;
        const captiveOutcomes: CaptiveOutcome[] = [];
        const leader = faction.leaderId ? this.store.getOfficer(faction.leaderId) : null;
        const baseAggression = AGGRESSION[leader?.personality ?? 'CALM'] ?? 0.25;
        const difficultyMultiplier = options.aiDifficultyMultiplier ?? getAIMonthlyDifficultyMultiplier(this.store);
        const aggression = Math.min(1, baseAggression * difficultyMultiplier);

        const cities = this.store.getCitiesByFaction(faction.id);
        if (cities.length === 0) {
            return { factionId: faction.id, factionName: faction.name, actions: ['소속 도시 없음'], conqueredCityId: null };
        }

        // 스트리밍 AI의 도시 커맨드와 중복되지 않도록, 해당 턴에는 직접 내정/징병을 생략한다.
        // 자동 전투와 월간 전술은 별도 시스템이므로 계속 처리한다. [201][295]
        if (!options.skipCityDevelopment) {
            // 1) 내정: 도시 자금 300 이상이면 개발 (상업/농업 교대)
            for (const city of cities) {
                if (city.funds >= 300) {
                    const ds = { ...city.developmentStats };
                    if (city.id.charCodeAt(city.id.length - 1) % 2 === 0) {
                        ds.commerce = Math.min(ds.maxCommerce, ds.commerce + 4);
                        ds.farming = Math.min(ds.maxFarming, ds.farming + 2);
                    } else {
                        ds.commerce = Math.min(ds.maxCommerce, ds.commerce + 2);
                        ds.farming = Math.min(ds.maxFarming, ds.farming + 4);
                    }
                    this.store.updateCity(city.id, { funds: city.funds - 250, developmentStats: ds });
                    actions.push(`${city.name} 개발 (상${ds.commerce}/농${ds.farming})`);
                }
            }

            // 2) 징병: 인구 비례 월간 병력 증가 [결함 수정]
            //
            // 원래는 `development < 200 이면 +600` 인 일회성 판정이었다.
            // development 이 0~100 개발도일 때는 그럴듯했지만, 이 값이
            // 병력(수천~수만)인 걸 확인한 뒤로는 조건이 영원히 거짓이 되어
            // 징병이 완전히 죽었다. 24개월 시뮬레이션에서 도시 병력이
            // 1명도 늘지 않아 AI가 영영 출진하지 못했다.
            //
            // 지금은 매달 인구의 RECRUIT_RATE 만큼 병력이 늘고,
            // 상한(garrison cap)을 넘으면 더 이상 늘지 않는다.
            // 자금이 모자라면 징병하지 않는다.
            for (const city of cities) {
                const target = garrisonCap(city);
                if (city.development >= target) continue;
                const cost = Math.ceil(RECRUIT_COST_PER_THOUSAND * (1 + (target - city.development) / 4000));
                if (city.funds < cost) continue;

                const gain = Math.min(
                    Math.round(city.population * RECRUIT_RATE),
                    target - city.development,
                );
                if (gain <= 0) continue;

                this.store.updateCity(city.id, {
                    funds: city.funds - cost,
                    development: city.development + gain,
                });
                actions.push(`${city.name} 징병 (+${gain.toLocaleString()})`);
            }
        }

        // 3) 출진: 병력 우위 + 인접 적 도시 + 성향 확률
        // [결함 수정] 출진 자격을 절대값(300)이 아니라 "평시 병력의 비율"로 본다.
        // 절대값 300 은 development 이 0~100 개발도일 때의 값이라,
        // 병력 규모(수천~수만)로 바꾸면 전 도시가 자동으로 출진 후보가 되어
        // 판정阈치가 의미를 잃는다.
        const attackCities = cities.filter(c => c.development >= c.population * MIN_ATTACK_FORCE_RATIO);
        for (const src of attackCities) {
            if (Math.random() > aggression) continue;
            const targets = this.store.getAllCities().filter(c => {
                if (!c.ownerId || c.ownerId === faction.id) return false;
                // 플레이어 세력은 기존 보호 계약대로 AI 직접 공격 대상에서 제외한다. [201][49]
                if (c.ownerId === this.store.getGlobalState().playerFactionId) return false;
                const dx = (c.mapX ?? 0) - (src.mapX ?? 0);
                const dy = (c.mapY ?? 0) - (src.mapY ?? 0);
                return Math.hypot(dx, dy) <= ADJACENT_DIST;
            });
            if (targets.length === 0) continue;

            // 가장 약한 표적 선택 + 병력 우위 확인
            targets.sort((a, b) => a.development - b.development);
            const target = targets[0];

            // 인접 아군 도시 증원 — 양쪽 모두 동일하게 반영한다 [결함 수정][107]
            //
            // 원래는 방어측에만 증원을 더했다. 그리고 보정식이
            // `reinfPower = totalTroops / 20` 인데, 증원이 한 번도 0 이
            // 아니었던 개발도 0~100 시절(증원 ~600) 감안한 상수였다.
            // 지금은 증원이 수천~수만 규모라 방어력이 +400 되면서
            // 공격측은 그대로라 열세 조건(1.2배)이 구조적으로 불가능했다.
            // 실측: 공격/방어 비율이 0.96~1.04 에 머물렀다.
            const st = this.store.getState();
            const allCities = this.store.getAllCities();
            const allOfficers = Object.values(st.officers);
            const allArmies = Object.values(st.armies);

            const defenderReinf = target.ownerId
                ? assembleReinforcements(target.id, target.ownerId, allCities, allOfficers, allArmies)
                : { totalTroops: 0, contingents: [], officerIds: [], defenseCityId: target.id };
            const attackerReinf = assembleReinforcements(
                src.id, faction.id, allCities, allOfficers, allArmies,
            );

            // 병력 규모가 커졌으므로 1/N 보정이 아니라 "평시 병력의 50%" 로 더한다.
            // 그래야 양측이 같은 척도로 비교되어 1.2배 열세가 의미를 갖는다.
            const defensePower = target.development + defenderReinf.totalTroops * 0.5 + target.defense * 1.5;
            const attackPower = src.development + attackerReinf.totalTroops * 0.5 + src.defense;
            if (attackPower < defensePower * SUPERIORITY_RATIO) continue; // 우위 아니면 보수적
            const defensePower2 = defensePower;

            // [295] 자동 전투 시뮬레이션 — 유저 비개입 전투를 라운드제 소모전으로 즉시 해결.
            // 도시 발전도/병력·수비력·증원을 병력 수치로 환산해 양측 부대를 구성한다.
            const leaderStats = leader?.stats;
            const attackerUnit: AutoBattleUnit = {
                unitId: `${faction.id}_siege_${target.id}`,
                commanderId: leader?.id ?? faction.id,
                commanderName: leader?.name ?? faction.name,
                leadership: leaderStats?.leadership ?? 50,
                might: leaderStats?.might ?? 50,
                soldiers: Math.max(1, attackPower),
                morale: 70,
                training: 60,
                isSupplied: true,
                position: { q: 0, r: 0 },
            };
            const defenderUnit: AutoBattleUnit = {
                unitId: `${target.id}_defense`,
                commanderId: target.ownerId ?? 'unknown',
                commanderName: target.name,
                leadership: 50,
                might: 50,
                soldiers: Math.max(1, defensePower2),
                morale: Math.max(30, Math.min(90, target.loyalty)),
                training: 50,
                isSupplied: true,
                position: { q: 1, r: 0 },
            };
            const sides: AutoBattleSides = {
                attacker: attackerUnit,
                defender: defenderUnit,
                siege: true, // 공성전 — 성벽 방어막 보정 적용
            };
            const battle = simulateAutoBattle(sides);
            const won = battle.winner === 'attacker';
            actions.push(battle.summary);
            if (won) {
                const prevOwnerId = target.ownerId;
                // 전투 후처리 [131-145] — 소유권 변경 전에 실행해야 약탈/포획이
                // 옛 소유 세력 기준으로 정확히 적용된다
                if (prevOwnerId) {
                    const spoils = processBattleSpoils(this.store, src.id, target.id);
                    actions.push(...spoils.messages);
                    // AI 포로 후처리 [121-130]: 등용/처형/석방 판정 (등용 시 원수화 페널티 포함)
                    if (spoils.capturedOfficerIds.length > 0 && this.diplomacy) {
                        const captiveReport = processCaptives(this.store, faction.id, spoils.capturedOfficerIds, this.diplomacy);
                        actions.push(...captiveReport.messages);
                        captiveOutcomes.push(...captiveReport.outcomes);
                    }
                }
                this.store.updateCity(target.id, { ownerId: faction.id, defense: Math.max(5, Math.floor(target.defense * 0.4)) });
                this.store.updateCity(src.id, { development: Math.max(0, Math.floor(src.development * 0.85)) });
                conqueredCityId = target.id;
                actions.push(`${target.name} 점령!`);
            } else {
                this.store.updateCity(src.id, { development: Math.max(0, Math.floor(src.development * 0.85)) });
                actions.push(`${target.name} 공성 실패`);
            }
            break; // 세력당 월 1회 출진
        }

        return { factionId: faction.id, factionName: faction.name, actions, conqueredCityId, captiveOutcomes };
    }
}
