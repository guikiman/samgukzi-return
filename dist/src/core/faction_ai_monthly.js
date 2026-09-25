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
import { assembleReinforcements } from './reinforcement_system.js';
import { processBattleSpoils } from './battle_spoils_system.js';
import { processCaptives } from './ai_captive_system.js';
// [295] 유저 비개입 자동 전투 시뮬레이터 — AI 출진 판정을 확률 단판에서 라운드제 소모전으로 격상
import { simulateAutoBattle } from './auto_battle_simulator.js';
/** 전도 정규화 좌표 기반 인접 판정 거리 (main.ts의 ADJACENT_DIST와 동일 기준) */
const ADJACENT_DIST = 0.16;
/** 군주 성향별 공격성 (출진 확률 가중) */
const AGGRESSION = {
    AGGRESSIVE: 0.75,
    AMBITIOUS: 0.55,
    CALM: 0.25,
    CAUTIOUS: 0.15,
    LOYAL: 0.2,
    TIMID: 0.05,
};
export class FactionAI {
    constructor(store) {
        this.store = store;
        /** 포로 등용 원수화 페널티용 외교 엔진 (엔진에서 주입) */
        this.diplomacy = null;
    }
    /** 월간 세력 AI 실행 — 플레이어 세력 제외 */
    runMonthly(options = {}) {
        const gs = this.store.getGlobalState();
        const reports = [];
        for (const faction of this.store.getAllFactions()) {
            if (faction.id === gs.playerFactionId)
                continue;
            reports.push(this.runFaction(faction, options));
        }
        return reports;
    }
    runFaction(faction, options = {}) {
        const actions = [];
        let conqueredCityId = null;
        const captiveOutcomes = [];
        const leader = faction.leaderId ? this.store.getOfficer(faction.leaderId) : null;
        const aggression = AGGRESSION[leader?.personality ?? 'CALM'] ?? 0.25;
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
                    }
                    else {
                        ds.commerce = Math.min(ds.maxCommerce, ds.commerce + 2);
                        ds.farming = Math.min(ds.maxFarming, ds.farming + 4);
                    }
                    this.store.updateCity(city.id, { funds: city.funds - 250, developmentStats: ds });
                    actions.push(`${city.name} 개발 (상${ds.commerce}/농${ds.farming})`);
                }
            }
            // 2) 징병: 병력 200 미만 도시는 자금 200으로 병력 +600
            for (const city of cities) {
                if (city.development < 200 && city.funds >= 200) {
                    this.store.updateCity(city.id, {
                        funds: city.funds - 200,
                        development: city.development + 600,
                    });
                    actions.push(`${city.name} 징병 (+600)`);
                }
            }
        }
        // 3) 출진: 병력 우위 + 인접 적 도시 + 성향 확률
        const attackCities = cities.filter(c => c.development >= 300);
        for (const src of attackCities) {
            if (Math.random() > aggression)
                continue;
            const targets = this.store.getAllCities().filter(c => {
                if (!c.ownerId || c.ownerId === faction.id)
                    return false;
                const dx = (c.mapX ?? 0) - (src.mapX ?? 0);
                const dy = (c.mapY ?? 0) - (src.mapY ?? 0);
                return Math.hypot(dx, dy) <= ADJACENT_DIST;
            });
            if (targets.length === 0)
                continue;
            // 가장 약한 표적 선택 + 병력 우위 확인
            targets.sort((a, b) => a.development - b.development);
            const target = targets[0];
            const attackPower = src.development + src.defense;
            const defensePower = target.development + target.defense * 1.5;
            if (attackPower < defensePower * 1.2)
                continue; // 우위 아니면 보수적
            // 인접 아군 도시 증원 — 방어 도시 수비력 가산 [107]
            const st = this.store.getState();
            const reinf = target.ownerId
                ? assembleReinforcements(target.id, target.ownerId, this.store.getAllCities(), Object.values(st.officers), Object.values(st.armies))
                : { totalTroops: 0, contingents: [], officerIds: [], defenseCityId: target.id };
            const reinfPower = Math.floor(reinf.totalTroops / 20);
            const defensePower2 = defensePower + reinfPower;
            // [295] 자동 전투 시뮬레이션 — 유저 비개입 전투를 라운드제 소모전으로 즉시 해결.
            // 도시 발전도/병력·수비력·증원을 병력 수치로 환산해 양측 부대를 구성한다.
            const leaderStats = leader?.stats;
            const attackerUnit = {
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
            const defenderUnit = {
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
            const sides = {
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
            }
            else {
                this.store.updateCity(src.id, { development: Math.max(0, Math.floor(src.development * 0.85)) });
                actions.push(`${target.name} 공성 실패`);
            }
            break; // 세력당 월 1회 출진
        }
        return { factionId: faction.id, factionName: faction.name, actions, conqueredCityId, captiveOutcomes };
    }
}
//# sourceMappingURL=faction_ai_monthly.js.map