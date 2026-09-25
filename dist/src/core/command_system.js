/**
 * 삼국지 8 리메이크 — 커맨드 패턴 시스템
 * 파일: src/core/command_system.ts
 *
 * 커맨드 패턴 + 큐 + Undo/Redo 구현
 * 모든 무장 행동을 Command 객체로 캡슐화
 */
import { OfficerStatus, } from './types.js';
import { simulateAutoBattle } from './auto_battle_simulator.js';
import { FactionRelation } from './diplomacy_engine.js';
import { processBattleSpoils } from './battle_spoils_system.js';
import { processCaptives } from './ai_captive_system.js';
let cmdCounter = 0;
function genCmdId(prefix) {
    cmdCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${cmdCounter}`;
}
class BaseCommand {
    constructor(type, officerId, turnIssued) {
        this.sideEffects = [];
        this.id = genCmdId(type.toLowerCase());
        this.type = type;
        this.officerId = officerId;
        this.turnIssued = turnIssued;
        this.timestamp = Date.now();
    }
    buildResult(success, message, extra) {
        return { success, message, sideEffects: this.sideEffects, commandType: this.type, ...extra };
    }
    recordSideEffect(target, targetId, field, oldValue, newValue) {
        this.sideEffects.push({ target, targetId, field, oldValue, newValue });
    }
}
// ============================================================
// [DOMESTIC] 내정 커맨드
// ============================================================
export class DomesticCommand extends BaseCommand {
    constructor(officerId, cityId, facilityType, turn) {
        super('DOMESTIC', officerId, turn);
        this.cityId = cityId;
        this.facilityType = facilityType;
        this.goldCost = 100;
        this.statKey = 'politics';
    }
    execute(context) {
        const officer = context.store.getOfficer(this.officerId);
        const city = context.store.getCity(this.cityId);
        if (!officer || !city)
            return this.buildResult(false, '무장 또는 도시 없음');
        if (officer.actionPoints < 10)
            return this.buildResult(false, '행동력 부족');
        const oldAP = officer.actionPoints;
        const oldDev = city.development;
        const statValue = officer.stats[this.statKey];
        const gain = Math.floor(statValue * 0.1) + 5;
        context.store.updateOfficer(this.officerId, {
            actionPoints: oldAP - 10,
            exp: { ...officer.exp, [this.statKey]: officer.exp[this.statKey] + 5 },
        });
        context.store.updateCity(this.cityId, { development: oldDev + gain });
        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 10);
        this.recordSideEffect('city', this.cityId, 'development', oldDev, oldDev + gain);
        context.logger(`[내정] ${officer.name} → ${city.name} 개발 +${gain}`);
        return this.buildResult(true, `${city.name} 개발 +${gain}`);
    }
    undo(context) {
        for (const se of this.sideEffects) {
            if (se.target === 'officer') {
                const off = context.store.getOfficer(se.targetId);
                if (off)
                    context.store.updateOfficer(se.targetId, { ...off, [se.field]: se.oldValue });
            }
            else if (se.target === 'city') {
                const c = context.store.getCity(se.targetId);
                if (c)
                    context.store.updateCity(se.targetId, { ...c, [se.field]: se.oldValue });
            }
        }
        return true;
    }
    serialize() {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { cityId: this.cityId, facilityType: this.facilityType, goldCost: this.goldCost },
        };
    }
}
// ============================================================
// [TRAINING] 훈련 커맨드
// ============================================================
export class TrainingCommand extends BaseCommand {
    constructor(officerId, statKey, turn) {
        super('TRAINING', officerId, turn);
        this.statKey = statKey;
    }
    execute(context) {
        const officer = context.store.getOfficer(this.officerId);
        if (!officer)
            return this.buildResult(false, '무장 없음');
        if (officer.actionPoints < 10)
            return this.buildResult(false, '행동력 부족');
        if (officer.stamina < 20)
            return this.buildResult(false, '기력 부족');
        const oldAP = officer.actionPoints;
        const oldStamina = officer.stamina;
        const oldExp = officer.exp[this.statKey];
        const expGain = 10 + Math.floor(officer.stats[this.statKey] * 0.05);
        const newExp = Math.min(100, oldExp + expGain);
        context.store.updateOfficer(this.officerId, {
            actionPoints: oldAP - 10,
            stamina: oldStamina - 20,
            exp: { ...officer.exp, [this.statKey]: newExp },
        });
        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 10);
        this.recordSideEffect('officer', this.officerId, 'stamina', oldStamina, oldStamina - 20);
        this.recordSideEffect('officer', this.officerId, `exp.${this.statKey}`, oldExp, newExp);
        context.logger(`[훈련] ${officer.name} ${this.statKey} 경험치 +${expGain}`);
        return this.buildResult(true, `${this.statKey} 경험치 +${expGain}`);
    }
    undo(context) {
        const officer = context.store.getOfficer(this.officerId);
        if (!officer)
            return false;
        for (const se of this.sideEffects) {
            if (se.field.startsWith('exp.')) {
                const key = se.field.split('.')[1];
                context.store.updateOfficer(this.officerId, { exp: { ...officer.exp, [key]: se.oldValue } });
            }
            else {
                context.store.updateOfficer(this.officerId, { [se.field]: se.oldValue });
            }
        }
        return true;
    }
    serialize() {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { statKey: this.statKey },
        };
    }
}
// ============================================================
// [RECRUITMENT] 등용 커맨드
// ============================================================
export class RecruitmentCommand extends BaseCommand {
    constructor(officerId, targetOfficerId, turn) {
        super('RECRUITMENT', officerId, turn);
        this.targetOfficerId = targetOfficerId;
    }
    execute(context) {
        const officer = context.store.getOfficer(this.officerId);
        const target = context.store.getOfficer(this.targetOfficerId);
        if (!officer || !target)
            return this.buildResult(false, '무장 없음');
        if (officer.actionPoints < 20)
            return this.buildResult(false, '행동력 부족');
        if (target.factionId !== null)
            return this.buildResult(false, '이미 소속된 무장');
        const officerFaction = officer.factionId ? context.store.getFaction(officer.factionId) : null;
        if (!officerFaction)
            return this.buildResult(false, '세력 없음');
        const charismaFactor = officer.stats.charisma / 100;
        const loyaltyFactor = 1 - (target.loyalty / 100);
        const successRate = Math.min(0.95, charismaFactor * 0.5 + loyaltyFactor * 0.3 + 0.2);
        if (Math.random() > successRate) {
            context.store.updateOfficer(this.officerId, { actionPoints: officer.actionPoints - 20 });
            this.recordSideEffect('officer', this.officerId, 'actionPoints', officer.actionPoints, officer.actionPoints - 20);
            context.logger(`[등용] ${officer.name} → ${target.name} 등용 실패`);
            return this.buildResult(false, '등용 실패');
        }
        const oldFaction = target.factionId;
        const oldStatus = target.status;
        const oldCity = target.cityId;
        context.store.updateOfficer(this.targetOfficerId, {
            factionId: officer.factionId,
            status: OfficerStatus.OFFICER,
            cityId: officer.cityId,
            loyalty: Math.min(100, target.loyalty + 20),
        });
        context.store.updateOfficer(this.officerId, { actionPoints: officer.actionPoints - 20 });
        if (officerFaction && !officerFaction.officers.includes(this.targetOfficerId)) {
            const newOfficerList = [...officerFaction.officers, this.targetOfficerId];
            context.store.updateFaction(officerFaction.id, { officers: newOfficerList });
        }
        this.recordSideEffect('officer', this.targetOfficerId, 'factionId', oldFaction, officer.factionId);
        this.recordSideEffect('officer', this.targetOfficerId, 'status', oldStatus, 'OFFICER');
        this.recordSideEffect('officer', this.officerId, 'actionPoints', officer.actionPoints, officer.actionPoints - 20);
        context.logger(`[등용] ${officer.name} → ${target.name} 등용 성공`);
        return this.buildResult(true, `${target.name} 등용 성공`);
    }
    undo(context) {
        for (const se of this.sideEffects) {
            const off = context.store.getOfficer(se.targetId);
            if (off)
                context.store.updateOfficer(se.targetId, { ...off, [se.field]: se.oldValue });
        }
        return true;
    }
    serialize() {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { targetOfficerId: this.targetOfficerId },
        };
    }
} /** [201] AI 스트리밍 징병 결정 — 도시 병력/개발도 보강을 큐에서 실행 */
export class CityRecruitmentCommand extends BaseCommand {
    constructor(officerId, cityId, turn) {
        super('RECRUITMENT', officerId, turn);
        this.cityId = cityId;
    }
    execute(context) {
        const officer = context.store.getOfficer(this.officerId);
        const city = context.store.getCity(this.cityId);
        if (!officer || !city)
            return this.buildResult(false, '무장 또는 도시 없음');
        if (officer.actionPoints < 20)
            return this.buildResult(false, '행동력 부족');
        if (!officer.factionId || city.ownerId !== officer.factionId)
            return this.buildResult(false, '소속 도시가 아님');
        if (city.funds < 200)
            return this.buildResult(false, '도시 자금 부족');
        if (city.development >= 200)
            return this.buildResult(false, '이미 징병 가능한 병력임');
        const oldAP = officer.actionPoints;
        const oldFunds = city.funds;
        const oldDevelopment = city.development;
        const newDevelopment = oldDevelopment + 600;
        context.store.updateOfficer(this.officerId, { actionPoints: oldAP - 20 });
        context.store.updateCity(this.cityId, { funds: oldFunds - 200, development: newDevelopment });
        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 20);
        this.recordSideEffect('city', this.cityId, 'funds', oldFunds, oldFunds - 200);
        this.recordSideEffect('city', this.cityId, 'development', oldDevelopment, newDevelopment);
        context.logger(`[징병] ${officer.name} → ${city.name} 병력 +600`);
        return this.buildResult(true, `${city.name} 병력 +600`);
    }
    undo(context) {
        for (const se of this.sideEffects) {
            if (se.target === 'officer') {
                const off = context.store.getOfficer(se.targetId);
                if (off)
                    context.store.updateOfficer(se.targetId, { actionPoints: se.oldValue });
            }
            else if (se.target === 'city') {
                const city = context.store.getCity(se.targetId);
                if (city)
                    context.store.updateCity(se.targetId, { [se.field]: se.oldValue });
            }
        }
        return true;
    }
    serialize() {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { targetCityId: this.cityId },
        };
    }
}
// ============================================================
// [MOVEMENT] 이동 커맨드
// ============================================================
export class MovementCommand extends BaseCommand {
    constructor(officerId, fromCityId, toCityId, turn) {
        super('MOVEMENT', officerId, turn);
        this.fromCityId = fromCityId;
        this.toCityId = toCityId;
    }
    execute(context) {
        const officer = context.store.getOfficer(this.officerId);
        const fromCity = context.store.getCity(this.fromCityId);
        const toCity = context.store.getCity(this.toCityId);
        if (!officer || !fromCity || !toCity)
            return this.buildResult(false, '무장 또는 도시 없음');
        if (officer.actionPoints < 30)
            return this.buildResult(false, '행동력 부족');
        const oldAP = officer.actionPoints;
        const oldCity = officer.cityId;
        context.store.updateOfficer(this.officerId, {
            actionPoints: oldAP - 30,
            cityId: this.toCityId,
        });
        const newFromOfficers = fromCity.officerIds.filter(id => id !== this.officerId);
        context.store.updateCity(this.fromCityId, { officerIds: newFromOfficers });
        const newToOfficers = toCity.officerIds.includes(this.officerId)
            ? toCity.officerIds
            : [...toCity.officerIds, this.officerId];
        context.store.updateCity(this.toCityId, { officerIds: newToOfficers });
        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 30);
        this.recordSideEffect('officer', this.officerId, 'cityId', oldCity, this.toCityId);
        this.recordSideEffect('city', this.fromCityId, 'officerIds', fromCity.officerIds, newFromOfficers);
        this.recordSideEffect('city', this.toCityId, 'officerIds', toCity.officerIds, newToOfficers);
        context.logger(`[이동] ${officer.name}: ${fromCity.name} → ${toCity.name}`);
        return this.buildResult(true, `${fromCity.name} → ${toCity.name}`);
    }
    undo(context) {
        for (const se of this.sideEffects) {
            if (se.target === 'officer') {
                const off = context.store.getOfficer(se.targetId);
                if (off)
                    context.store.updateOfficer(se.targetId, { ...off, [se.field]: se.oldValue });
            }
            else if (se.target === 'city') {
                const c = context.store.getCity(se.targetId);
                if (c)
                    context.store.updateCity(se.targetId, { ...c, [se.field]: se.oldValue });
            }
        }
        return true;
    }
    serialize() {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { fromCityId: this.fromCityId, toCityId: this.toCityId },
        };
    }
}
// ============================================================
// [295][BATTLE] 자동 전투 커맨드
// ============================================================
/** AI 결정의 전투를 즉시 라운드제 전투로 해결하고 도시 상태를 원자적으로 반영한다. */
export class BattleCommand extends BaseCommand {
    constructor(officerId, sourceCityId, targetCityId, turn) {
        super('BATTLE', officerId, turn);
        /** 전투 후처리는 여러 엔티티를 변경하므로 Undo는 직전 전체 상태로 복원한다. [131-145] */
        this.preBattleSnapshot = null;
        this.preBattleDiplomacy = null;
        this.preBattleChronicle = null;
        this.sourceCityId = sourceCityId;
        this.targetCityId = targetCityId;
    }
    execute(context) {
        const officer = context.store.getOfficer(this.officerId);
        const source = context.store.getCity(this.sourceCityId);
        const target = context.store.getCity(this.targetCityId);
        if (!officer || !source || !target)
            return this.buildResult(false, '무장 또는 도시 없음');
        if (!officer.factionId || source.ownerId !== officer.factionId || officer.cityId !== source.id) {
            return this.buildResult(false, '출진 무장의 소속 도시가 아님');
        }
        if (!target.ownerId || target.ownerId === officer.factionId || target.id === source.id) {
            return this.buildResult(false, '유효한 적 도시가 아님');
        }
        if (officer.actionPoints < 30)
            return this.buildResult(false, '행동력 부족');
        const attackerFaction = context.store.getFaction(officer.factionId);
        const targetFaction = context.store.getFaction(target.ownerId);
        if (!attackerFaction || !targetFaction)
            return this.buildResult(false, '세력 없음');
        const domainWar = attackerFaction.diplomacy[targetFaction.id]?.treaty === 'WAR'
            || targetFaction.diplomacy[attackerFaction.id]?.treaty === 'WAR';
        const engineWar = context.diplomacy?.getRelation(attackerFaction.id, targetFaction.id) === FactionRelation.WAR;
        if (!domainWar && !engineWar)
            return this.buildResult(false, '전쟁 상태가 아님');
        const defenderLeader = targetFaction.leaderId ? context.store.getOfficer(targetFaction.leaderId) : null;
        const attackerSides = {
            attacker: this.createUnit(`${officer.factionId}_${source.id}_${target.id}`, officer.id, officer.name, officer.stats.leadership, officer.stats.might, Math.max(1, source.development + source.defense), source.loyalty, source.hexCoord),
            defender: this.createUnit(`${target.ownerId}_${target.id}_defense`, defenderLeader?.id ?? target.ownerId, defenderLeader?.name ?? target.name, defenderLeader?.stats.leadership ?? 50, defenderLeader?.stats.might ?? 50, Math.max(1, target.development + target.defense), target.loyalty, target.hexCoord),
            siege: true,
            attackerTile: { q: source.hexCoord.q, r: source.hexCoord.r, terrain: 'PLAIN', elevation: 0 },
            defenderTile: { q: target.hexCoord.q, r: target.hexCoord.r, terrain: 'CITY_WALL', elevation: 0 },
        };
        const battle = simulateAutoBattle(attackerSides);
        const won = battle.winner === 'attacker';
        // 후처리가 임의 변경을 만들 수 있으므로 Undo/Redo 원자성 경계는 전투 직전 전체 상태로 둔다.
        this.preBattleSnapshot = context.store.createSnapshot();
        this.preBattleDiplomacy = context.diplomacy?.serialize() ?? null;
        this.preBattleChronicle = context.chronicle?.serialize() ?? null;
        const oldAP = officer.actionPoints;
        const logMessages = [];
        let captiveOutcomes = [];
        if (won) {
            // 소유권 변경 전에 약탈·포로 포획·병력 재배치를 처리한다. [131-145]
            const spoils = processBattleSpoils(context.store, this.sourceCityId, this.targetCityId);
            logMessages.push(...spoils.messages);
            context.logger(`[전투 후처리] ${spoils.messages.join(' / ')}`);
            // 포획 즉시 AI 포로 처분을 수행한다. 등용·처형·석방 모두 전투 커맨드 안에서
            // 원자적으로 처리되어 실행/undo가 동일한 상태 경계를 사용한다. [121-130][131-145]
            if (spoils.capturedOfficerIds.length > 0) {
                const captiveReport = processCaptives(context.store, officer.factionId, spoils.capturedOfficerIds, context.diplomacy);
                logMessages.push(...captiveReport.messages);
                captiveOutcomes = captiveReport.outcomes;
                for (const outcome of captiveReport.outcomes) {
                    context.chronicle?.add('CAPTURE', outcome.message, undefined, {
                        factionId: officer.factionId,
                        cityId: this.targetCityId,
                    });
                }
                if (captiveReport.messages.length > 0) {
                    context.logger(`[포로 처분] ${captiveReport.messages.join(' / ')}`);
                }
            }
        }
        const currentSource = context.store.getCity(this.sourceCityId);
        const newSourceDevelopment = Math.max(0, Math.floor(currentSource.development * 0.85));
        context.store.updateOfficer(this.officerId, { actionPoints: oldAP - 30 });
        context.store.updateCity(this.sourceCityId, { development: newSourceDevelopment });
        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 30);
        this.recordSideEffect('city', this.sourceCityId, 'development', source.development, newSourceDevelopment);
        if (won) {
            const conqueredTarget = context.store.getCity(this.targetCityId);
            const oldOwner = conqueredTarget.ownerId;
            const oldDefense = conqueredTarget.defense;
            const newDefense = Math.max(5, Math.floor(oldDefense * 0.4));
            context.store.updateCity(this.targetCityId, { ownerId: officer.factionId, defense: newDefense });
            this.recordSideEffect('city', this.targetCityId, 'ownerId', oldOwner, officer.factionId);
            this.recordSideEffect('city', this.targetCityId, 'defense', oldDefense, newDefense);
        }
        const message = won ? `${battle.summary} · 전리품 확보` : battle.summary;
        context.logger(`[전투] ${officer.name}: ${source.name} → ${target.name} — ${message}`);
        return this.buildResult(true, message, {
            ...(logMessages.length > 0 ? { logMessages } : {}),
            ...(captiveOutcomes.length > 0 ? { captiveOutcomes } : {}),
        });
    }
    createUnit(unitId, commanderId, commanderName, leadership, might, soldiers, morale, position) {
        return {
            unitId,
            commanderId,
            commanderName,
            leadership,
            might,
            soldiers,
            morale: Math.max(30, Math.min(90, morale)),
            training: 60,
            isSupplied: true,
            position,
        };
    }
    undo(context) {
        if (!this.preBattleSnapshot)
            return false;
        context.store.restoreSnapshot(this.preBattleSnapshot);
        if (this.preBattleDiplomacy)
            context.diplomacy?.restore(this.preBattleDiplomacy);
        if (this.preBattleChronicle)
            context.chronicle?.load(this.preBattleChronicle);
        this.sideEffects = [];
        return true;
    }
    serialize() {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { sourceCityId: this.sourceCityId, targetCityId: this.targetCityId },
        };
    }
}
export class DiplomacyCommand extends BaseCommand {
    constructor(officerId, targetFactionId, action, turn) {
        super('DIPLOMACY', officerId, turn);
        this.targetFactionId = targetFactionId;
        this.action = action;
    }
    execute(context) {
        const officer = context.store.getOfficer(this.officerId);
        const diplomacy = context.diplomacy;
        if (!officer?.factionId || !diplomacy)
            return this.buildResult(false, '무장 또는 외교 엔진 없음');
        if (!context.store.getFaction(this.targetFactionId))
            return this.buildResult(false, '대상 세력 없음');
        if (officer.factionId === this.targetFactionId)
            return this.buildResult(false, '자기 세력 대상 불가');
        if (officer.actionPoints < 10)
            return this.buildResult(false, '행동력 부족');
        const relation = diplomacy.getRelation(officer.factionId, this.targetFactionId);
        const oldTreaties = new Map();
        for (const [a, b] of [[officer.factionId, this.targetFactionId], [this.targetFactionId, officer.factionId]]) {
            oldTreaties.set(`${a}|${b}`, context.store.getFaction(a)?.diplomacy[b]);
        }
        let result;
        switch (this.action) {
            case 'ALLIANCE':
                result = diplomacy.formAlliance(officer.factionId, this.targetFactionId);
                break;
            case 'BREAK_ALLIANCE':
                result = diplomacy.breakAlliance(officer.factionId, this.targetFactionId);
                break;
            case 'DECLARE_WAR':
                result = diplomacy.declareWar(officer.factionId, this.targetFactionId);
                break;
            case 'PEACE':
                result = diplomacy.makePeace(officer.factionId, this.targetFactionId);
                break;
            case 'GIFT':
                result = diplomacy.sendGift(officer.factionId, this.targetFactionId, 0, 0);
                break;
        }
        if (!result.success)
            return this.buildResult(false, result.message);
        const oldAP = officer.actionPoints;
        context.store.updateOfficer(this.officerId, { actionPoints: oldAP - 10 });
        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 10);
        this.recordSideEffect('relation', `${officer.factionId}|${this.targetFactionId}`, 'diplomacy', relation, diplomacy.getRelation(officer.factionId, this.targetFactionId));
        this.syncFactionTreaties(context, officer.factionId, oldTreaties);
        context.logger(`[외교] ${officer.name}: ${result.message}`);
        return this.buildResult(true, result.message);
    }
    syncFactionTreaties(context, sourceFactionId, oldTreaties) {
        const relation = context.diplomacy.getRelation(sourceFactionId, this.targetFactionId);
        const treaty = relation === FactionRelation.WAR ? 'WAR'
            : relation === FactionRelation.ALLIANCE ? 'ALLIANCE'
                : relation === FactionRelation.NEUTRAL ? 'CEASEFIRE' : 'NONE';
        for (const [a, b] of [[sourceFactionId, this.targetFactionId], [this.targetFactionId, sourceFactionId]]) {
            const faction = context.store.getFaction(a);
            if (!faction)
                continue;
            const oldEntry = oldTreaties.get(`${a}|${b}`);
            const newEntry = { relation: 0, treaty, duration: 1 };
            context.store.updateFaction(a, { diplomacy: { ...faction.diplomacy, [b]: newEntry } });
            this.recordSideEffect('faction', a, `diplomacy.${b}`, oldEntry, newEntry);
        }
    }
    undo(context) {
        if (!context.diplomacy)
            return false;
        for (const se of this.sideEffects) {
            if (se.target === 'relation') {
                context.diplomacy.setRelation(se.targetId.split('|')[0], se.targetId.split('|')[1], se.oldValue);
            }
            else if (se.target === 'officer') {
                const officer = context.store.getOfficer(se.targetId);
                if (officer)
                    context.store.updateOfficer(se.targetId, { [se.field]: se.oldValue });
            }
            else if (se.target === 'faction' && se.field.startsWith('diplomacy.')) {
                const faction = context.store.getFaction(se.targetId);
                if (!faction)
                    continue;
                const targetId = se.field.slice('diplomacy.'.length);
                const diplomacy = { ...faction.diplomacy };
                if (se.oldValue === undefined)
                    delete diplomacy[targetId];
                else
                    diplomacy[targetId] = se.oldValue;
                context.store.updateFaction(faction.id, { diplomacy });
            }
        }
        return true;
    }
    serialize() {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { targetFactionId: this.targetFactionId, action: this.action },
        };
    }
}
// ============================================================
// [REST] 휴양 커맨드
// ============================================================
export class RestCommand extends BaseCommand {
    constructor(officerId, turn) {
        super('REST', officerId, turn);
    }
    execute(context) {
        const officer = context.store.getOfficer(this.officerId);
        if (!officer)
            return this.buildResult(false, '무장 없음');
        const oldStamina = officer.stamina;
        const oldHP = officer.hp;
        const newStamina = Math.min(officer.maxStamina, oldStamina + 50);
        const newHP = Math.min(officer.maxHp, oldHP + 10);
        context.store.updateOfficer(this.officerId, { stamina: newStamina, hp: newHP });
        this.recordSideEffect('officer', this.officerId, 'stamina', oldStamina, newStamina);
        this.recordSideEffect('officer', this.officerId, 'hp', oldHP, newHP);
        context.logger(`[휴양] ${officer.name} 기력 +${newStamina - oldStamina}`);
        return this.buildResult(true, '휴양 완료');
    }
    undo(context) {
        for (const se of this.sideEffects) {
            const off = context.store.getOfficer(se.targetId);
            if (off)
                context.store.updateOfficer(se.targetId, { ...off, [se.field]: se.oldValue });
        }
        return true;
    }
    serialize() {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: {},
        };
    }
}
// ============================================================
// 커맨드 역직렬화 (저장/로드용)
// ============================================================
export function deserializeCommand(data) {
    const base = { officerId: data.officerId, turn: data.turnIssued };
    switch (data.type) {
        case 'DOMESTIC':
            return new DomesticCommand(base.officerId, data.payload.cityId, data.payload.facilityType, base.turn);
        case 'TRAINING':
            return new TrainingCommand(base.officerId, data.payload.statKey, base.turn);
        case 'RECRUITMENT':
            return data.payload.targetOfficerId
                ? new RecruitmentCommand(base.officerId, data.payload.targetOfficerId, base.turn)
                : new CityRecruitmentCommand(base.officerId, data.payload.targetCityId, base.turn);
        case 'MOVEMENT':
            return new MovementCommand(base.officerId, data.payload.fromCityId, data.payload.toCityId, base.turn);
        case 'BATTLE':
            return new BattleCommand(base.officerId, data.payload.sourceCityId, data.payload.targetCityId, base.turn);
        case 'DIPLOMACY': {
            const actions = ['ALLIANCE', 'BREAK_ALLIANCE', 'DECLARE_WAR', 'PEACE', 'GIFT'];
            const action = actions.includes(data.payload.action)
                ? data.payload.action
                : 'ALLIANCE';
            return new DiplomacyCommand(base.officerId, data.payload.targetFactionId, action, base.turn);
        }
        case 'REST':
            return new RestCommand(base.officerId, base.turn);
        default:
            return new RestCommand(base.officerId, base.turn);
    }
}
// ============================================================
// 커맨드 큐 — FIFO 실행 + Undo/Redo 스택
// ============================================================
export class CommandQueue {
    constructor(maxHistory = 200) {
        this.pending = [];
        this.executed = [];
        this.undone = [];
        this.maxHistory = maxHistory;
    }
    enqueue(command) {
        this.pending.push(command);
    }
    dequeue() {
        return this.pending.shift();
    }
    executeNext(context) {
        const cmd = this.pending.shift();
        if (!cmd)
            return null;
        const result = cmd.execute(context);
        if (result.success) {
            this.executed.push(cmd);
            if (this.executed.length > this.maxHistory)
                this.executed.shift();
            this.undone = [];
        }
        return result;
    }
    executeAll(context) {
        const results = [];
        while (this.pending.length > 0) {
            const result = this.executeNext(context);
            if (result)
                results.push(result);
        }
        return results;
    }
    undoLast(context) {
        const cmd = this.executed.pop();
        if (!cmd)
            return false;
        const success = cmd.undo(context);
        if (success)
            this.undone.push(cmd);
        return success;
    }
    redoLast(context) {
        const cmd = this.undone.pop();
        if (!cmd)
            return false;
        const result = cmd.execute(context);
        if (result.success) {
            this.executed.push(cmd);
            return true;
        }
        this.undone.push(cmd);
        return false;
    }
    clear() {
        this.pending = [];
        this.executed = [];
        this.undone = [];
    }
    getPendingCount() { return this.pending.length; }
    getExecutedCount() { return this.executed.length; }
    /** 실행/복구 이벤트를 리플레이에 기록할 때 직전 커맨드를 조회한다. */
    peekPending() { return this.pending[0]; }
    getLastExecuted() { return this.executed[this.executed.length - 1]; }
    getLastUndone() { return this.undone[this.undone.length - 1]; }
    canUndo() { return this.executed.length > 0; }
    canRedo() { return this.undone.length > 0; }
    /** 저장용 직렬화 — 실행 완료 명령은 상태에 이미 반영되었으므로 pending만 보존한다. [17] */
    serializePending() {
        return this.pending.map(c => c.serialize());
    }
    /** 진단/기존 API용 전체 직렬화 — executed 이력까지 포함한다. */
    serializeAll() {
        return [...this.pending, ...this.executed].map(c => c.serialize());
    }
}
//# sourceMappingURL=command_system.js.map