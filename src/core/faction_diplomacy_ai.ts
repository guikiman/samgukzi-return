/**
 * AI 세력 월간 자율 외교 [341-360: 지정학적 외교]
 *
 * 각 AI 세력이 매월 군주 성향·세력 전력비에 따라 자율적으로:
 * 1) 약한 이웃에게 선전포고 (공격적 성향)
 * 2) 전력 열세 시 강자에게 휴전 제파 (TIMID/CAUTIOUS)
 * 3) 강자 앞에서 동맹 결성 (중립 상대)
 *
 * 판정은 DiplomacyEngine에 위임하고, 결과는 이벤트 페이로드로 UI에 전달된다.
 */

import type { GameStore } from './game_store.js';
import type { FactionID } from './types.js';
import { DiplomacyEngine, FactionRelation, type DiplomacyResult } from './diplomacy_engine.js';
import type { DiplomacyAction } from './command_system.js';

/** 월간 AI가 선택할 수 있는 커맨드 기반 외교 액션 [341-360] */
export type FactionDiplomacyAction = Extract<DiplomacyAction, 'DECLARE_WAR' | 'PEACE' | 'ALLIANCE'>;
export type DiplomacyActionExecutor = (
    factionId: FactionID,
    targetFactionId: FactionID,
    action: FactionDiplomacyAction,
) => DiplomacyResult;

/** 성향별 외교 공격성 (선전포고 확률 가중) */
const DIPLO_AGGRESSION: Record<string, number> = {
    AGGRESSIVE: 0.45,
    AMBITIOUS: 0.3,
    CALM: 0.15,
    LOYAL: 0.1,
    CAUTIOUS: 0.05,
    TIMID: 0.0,
};

export interface FactionDiplomacyReport {
    factionId: FactionID;
    factionName: string;
    messages: string[];
}

export class FactionDiplomacyAI {
    constructor(
        private store: GameStore,
        private engine: DiplomacyEngine,
    ) {}

    /** 세력 총 전력 = 소속 도시 development 합 + 병력 가산 */
    private factionPower(factionId: FactionID): number {
        const cities = this.store.getCitiesByFaction(factionId);
        let power = 0;
        for (const c of cities) {
            power += c.development + c.defense * 0.5;
        }
        return power;
    }

    /** 월간 자율 외교 실행 — 플레이어 세력 제외 */
    runMonthly(executor?: DiplomacyActionExecutor): FactionDiplomacyReport[] {
        const gs = this.store.getGlobalState();
        const reports: FactionDiplomacyReport[] = [];
        const factions = this.store.getAllFactions();

        // 외교 엔진에 최신 전력 데이터 동기화
        for (const f of factions) {
            this.engine.setFactionData(f.id, { totalPower: Math.floor(this.factionPower(f.id)), gold: f.gold });
        }

        for (const faction of factions) {
            if (faction.id === gs.playerFactionId) continue;
            const report = this.runFaction(faction.id, executor);
            if (report.messages.length > 0) {
                reports.push(report);
            }
        }
        return reports;
    }

    private runFaction(factionId: FactionID, executor?: DiplomacyActionExecutor): FactionDiplomacyReport {
        const messages: string[] = [];
        const faction = this.store.getFaction(factionId);
        if (!faction) return { factionId, factionName: '?', messages };

        const leader = faction.leaderId ? this.store.getOfficer(faction.leaderId) : null;
        const aggression = DIPLO_AGGRESSION[leader?.personality ?? 'CALM'] ?? 0.15;
        const others = this.store.getAllFactions().filter(f => f.id !== factionId);

        // 1) 전쟁 중 관계 정리: 열세면 휴전 시도
        for (const other of others) {
            if (this.engine.getRelation(factionId, other.id) !== FactionRelation.WAR) continue;
            const myPower = this.factionPower(factionId);
            const theirPower = this.factionPower(other.id);
            // 전력이 절반 이하면 휴전 시도 (TIMID/CAUTIOUS는 항상 시도)
            if (theirPower > 0 && myPower < theirPower * 0.5) {
                const result = executor
                    ? executor(factionId, other.id, 'PEACE')
                    : this.engine.makePeace(factionId, other.id);
                if (result.success) {
                    messages.push(`${other.name}과(와) 휴전 (전력 열세)`);
                }
            }
        }

        // 2) 선전포고: 인접한 약한 이웃 대상, 성향 확률
        if (Math.random() < aggression) {
            const myPower = this.factionPower(factionId);
            const candidates = others
                .filter(o => {
                    const rel = this.engine.getRelation(factionId, o.id);
                    if (rel === FactionRelation.WAR || rel === FactionRelation.ALLIANCE) return false;
                    // 인접 판정: 도시 간 거리 (전도 좌표 기준)
                    return this.areAdjacent(factionId, o.id);
                })
                .map(o => ({ faction: o, power: this.factionPower(o.id) }))
                .filter(c => c.power < myPower * 0.8) // 나보다 약한 세력만
                .sort((a, b) => a.power - b.power);

            if (candidates.length > 0) {
                const target = candidates[0].faction;
                const result = executor
                    ? executor(factionId, target.id, 'DECLARE_WAR')
                    : this.engine.declareWar(factionId, target.id);
                if (result.success) {
                    messages.push(`${target.name}에 선전포고!`);
                }
            }
        }

        // 3) 동맹: 나보다 강한 세력에게 (전쟁 중이 아니면)
        if (messages.length === 0 && Math.random() < 0.2) {
            const myPower = this.factionPower(factionId);
            const stronger = others
                .filter(o => {
                    if (this.engine.getRelation(factionId, o.id) !== FactionRelation.NEUTRAL) return false;
                    return this.factionPower(o.id) > myPower * 1.3;
                })
                .sort((a, b) => this.factionPower(b.id) - this.factionPower(a.id));

            if (stronger.length > 0) {
                const target = stronger[0];
                const result = executor
                    ? executor(factionId, target.id, 'ALLIANCE')
                    : this.engine.formAlliance(factionId, target.id);
                if (result.success) messages.push(`${target.name}과(와) 동맹 체결`);
            }
        }

        return { factionId, factionName: faction.name, messages };
    }

    /** 두 세력이 인접하는지 — 소속 도시 간 최단 거리 판정 */
    private areAdjacent(a: FactionID, b: FactionID): boolean {
        const citiesA = this.store.getCitiesByFaction(a);
        const citiesB = this.store.getCitiesByFaction(b);
        for (const ca of citiesA) {
            for (const cb of citiesB) {
                const dx = (ca.mapX ?? 0) - (cb.mapX ?? 0);
                const dy = (ca.mapY ?? 0) - (cb.mapY ?? 0);
                if (Math.hypot(dx, dy) <= 0.16) return true;
            }
        }
        return false;
    }
}
