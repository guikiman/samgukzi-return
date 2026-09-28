/**
 * 삼국지 8 리메이크 — 커맨드 패턴 시스템
 * 파일: src/core/command_system.ts
 *
 * 커맨드 패턴 + 큐 + Undo/Redo 구현
 * 모든 무장 행동을 Command 객체로 캡슐화
 */

import {
    ICommand, SerializedCommand, CommandContext, CommandResult, SideEffect,
    CommandType, OfficerID, CityID, FactionID, ID, OfficerStatus, Faction, FacilityType,
} from './types.js';
import { simulateAutoBattle, type AutoBattleSides, type AutoBattleUnit } from './auto_battle_simulator.js';
import { DiplomacyEngine, FactionRelation, type DiplomacyResult } from './diplomacy_engine.js';
import { processBattleSpoils } from './battle_spoils_system.js';
import { processCaptives } from './ai_captive_system.js';
// 병력 상한(garrisonCap)을 한 곳에서 가져온다. CityRecruitmentCommand 와
// faction_ai_monthly 가 서로 다른 상한을 쓰면 "도시마다 병력 규칙이 다르다" 는
// 종류의 결함이 다시 생긴다(main.ts BARRACKS 가 그랬듯).
// faction_ai_monthly 는 command_system 을 import 하지 않으므로 순환이 없다.
import { garrisonCap } from './faction_ai_monthly.js';

let cmdCounter = 0;

function genCmdId(prefix: string): string {
    cmdCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${cmdCounter}`;
}

/**
 * SideEffect 하나를 되돌린다 — 점(.) 으로 표기된 중첩 경로를 처리한다.
 *
 * [결함 수정] DomesticCommand 의 undo 는 `{ ...off, [se.field]: se.oldValue }`
 * 형태였다. 이 커맨드가 "exp.politics" 같은 점 경로를 SideEffect 에 기록하면
 * 위 식은 "exp.politics" 라 이름이 붙은 새 키를 만들어 버린다. 원래의
 * exp.politics 값은 그대로 남으므로 undo 가 아무 일도 하지 않은 것처럼 보이고
 * 쓰러진 속성만 늘어난다.
 *
 * (TrainingCommand 와 DiplomacyCommand 는 이미 exp. / diplomacy. 를 각각
 * 손으로 분기 처리하고 있었다. 이 헬퍼는 그 분기를 한 곳으로 모으고,
 * 점 경로를 쓰게 되는 커맨드가 늘어도 놓치지 않게 한다.)
 *
 * 경로에 점이 없으면 이전과 동일하게 최상위 필드를 복원한다.
 */
function restoreField<T extends object>(entity: T, field: string, oldValue: unknown): T {
    if (!field.includes('.')) {
        return { ...entity, [field]: oldValue } as T;
    }
    const [head, ...rest] = field.split('.');
    const child = (entity as Record<string, unknown>)[head];
    if (rest.length === 0) return { ...entity, [head]: oldValue } as T;
    if (child === null || typeof child !== 'object') return entity;
    return {
        ...entity,
        [head]: restoreField(child as Record<string, unknown>, rest.join('.'), oldValue),
    } as T;
}

abstract class BaseCommand implements ICommand {
    public readonly id: string;
    public readonly type: CommandType;
    public readonly officerId: OfficerID;
    public readonly turnIssued: number;
    public readonly timestamp: number;
    protected sideEffects: SideEffect[] = [];

    constructor(type: CommandType, officerId: OfficerID, turnIssued: number) {
        this.id = genCmdId(type.toLowerCase());
        this.type = type;
        this.officerId = officerId;
        this.turnIssued = turnIssued;
        this.timestamp = Date.now();
    }

    abstract execute(context: CommandContext): CommandResult;
    abstract undo(context: CommandContext): boolean;
    abstract serialize(): SerializedCommand;

    protected buildResult(
        success: boolean,
        message: string,
        extra?: Pick<CommandResult, 'logMessages' | 'captiveOutcomes'>,
    ): CommandResult {
        return { success, message, sideEffects: this.sideEffects, commandType: this.type, ...extra };
    }

    protected recordSideEffect(
        target: SideEffect['target'], targetId: ID,
        field: string, oldValue: unknown, newValue: unknown,
    ): void {
        this.sideEffects.push({ target, targetId, field, oldValue, newValue });
    }
}

// ============================================================
// [DOMESTIC] 내정 커맨드
// ============================================================

/**
 * 내정 커맨드가 올릴 개발 지표의 필드/최댓값 — 시설 종류로 결정.
 *
 * [결함 수정] 이 커맨드는 원래 "개발" 이라 해서 `city.development`
 * (병력 수) 에 5~15 를 더했다. City.development 은 병력(명) 이므로
 * 행동력 10 을 소모해 병력 10 명을 늘리는 셈이 되어 사실상 아무 효과도
 * 없었다. 로그만 "개발 +10" 이라 해서 플레이어는 지표가 오른 것으로
 * 오인했다.
 *
 * development 은 병력이라 개발 지표를 올릴 수 없다. 개발 지표는
 * developmentStats 를 쓰기로 이미 정해져 있다(types.ts 참고).
 * 따라서 시설에 대응하는 지표를 올리도록 바꾼다.
 */
function domesticStatTarget(
    facilityType: string,
): { field: 'commerce' | 'farming' | 'technology' | 'publicOrder'; maxField: 'maxCommerce' | 'maxFarming' | 'maxTechnology' | 'maxPublicOrder'; label: string } {
    switch (facilityType) {
        case FacilityType.MARKET:
            return { field: 'commerce', maxField: 'maxCommerce', label: '상업' };
        case FacilityType.FARM:
            return { field: 'farming', maxField: 'maxFarming', label: '농업' };
        case FacilityType.BLACKSMITH:
            return { field: 'technology', maxField: 'maxTechnology', label: '기술' };
        case FacilityType.TAVERN:
        default:
            return { field: 'publicOrder', maxField: 'maxPublicOrder', label: '치안' };
    }
}

export class DomesticCommand extends BaseCommand {
    private cityId: CityID;
    private facilityType: string;
    private goldCost: number;
    private statKey: 'leadership' | 'might' | 'intelligence' | 'politics' | 'charisma';

    constructor(officerId: OfficerID, cityId: CityID, facilityType: string, turn: number) {
        super('DOMESTIC', officerId, turn);
        this.cityId = cityId;
        this.facilityType = facilityType;
        this.goldCost = 100;
        this.statKey = 'politics';
    }

    execute(context: CommandContext): CommandResult {
        const officer = context.store.getOfficer(this.officerId);
        const city = context.store.getCity(this.cityId);
        if (!officer || !city) return this.buildResult(false, '무장 또는 도시 없음');
        if (officer.actionPoints < 10) return this.buildResult(false, '행동력 부족');

        const oldAP = officer.actionPoints;
        const oldExp = officer.exp[this.statKey];
        const statValue = officer.stats[this.statKey];
        const gain = Math.floor(statValue * 0.1) + 5;

        // [결함 수정] 병력(development)이 아니라 해당 시설의 개발 지표를 올린다.
        const target = domesticStatTarget(this.facilityType);
        const oldStats = city.developmentStats;
        const newValue = Math.min(oldStats[target.maxField], oldStats[target.field] + gain);
        const newStats = { ...oldStats, [target.field]: newValue };
        const applied = newValue - oldStats[target.field];

        context.store.updateOfficer(this.officerId, {
            actionPoints: oldAP - 10,
            exp: { ...officer.exp, [this.statKey]: oldExp + 5 },
        });
        context.store.updateCity(this.cityId, { developmentStats: newStats });

        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 10);
        // [결함 수정] exp 를 SideEffect 에 기록한다. 예전엔 exp 를 +5 올려놓고
        // 되돌리기 경로에 남기지 않아 undo 시 경험치가 되돌아오지 않았다.
        this.recordSideEffect('officer', this.officerId, `exp.${this.statKey}`, oldExp, oldExp + 5);
        // [결함 수정] 통째로 기록해야 undo 가 다른 필드까지 되돌린다.
        this.recordSideEffect('city', this.cityId, 'developmentStats', oldStats, newStats);

        // 상한에 걸려 아무것도 올리지 못했다면 성공은 하지만 메시지에 알린다.
        if (applied <= 0) {
            context.logger(`[내정] ${officer.name} → ${city.name} ${target.label} 상한 도달 — 변화 없음`);
            return this.buildResult(true, `${city.name} ${target.label} 이미 상한입니다`);
        }

        context.logger(`[내정] ${officer.name} → ${city.name} ${target.label} +${applied}`);
        return this.buildResult(true, `${city.name} ${target.label} +${applied}`);
    }

    undo(context: CommandContext): boolean {
        for (const se of this.sideEffects) {
            if (se.target === 'officer') {
                const off = context.store.getOfficer(se.targetId as OfficerID);
                if (off) context.store.updateOfficer(se.targetId as OfficerID,
                    restoreField(off, se.field, se.oldValue) as Partial<typeof off>);
            } else if (se.target === 'city') {
                const c = context.store.getCity(se.targetId as CityID);
                if (c) context.store.updateCity(se.targetId as CityID,
                    restoreField(c, se.field, se.oldValue) as Partial<typeof c>);
            }
        }
        return true;
    }

    serialize(): SerializedCommand {
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
    private statKey: 'leadership' | 'might' | 'intelligence' | 'politics' | 'charisma';

    constructor(officerId: OfficerID, statKey: typeof TrainingCommand.prototype.statKey, turn: number) {
        super('TRAINING', officerId, turn);
        this.statKey = statKey;
    }

    execute(context: CommandContext): CommandResult {
        const officer = context.store.getOfficer(this.officerId);
        if (!officer) return this.buildResult(false, '무장 없음');
        if (officer.actionPoints < 10) return this.buildResult(false, '행동력 부족');
        if (officer.stamina < 20) return this.buildResult(false, '기력 부족');

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

    undo(context: CommandContext): boolean {
        const officer = context.store.getOfficer(this.officerId);
        if (!officer) return false;
        for (const se of this.sideEffects) {
            if (se.field.startsWith('exp.')) {
                const key = se.field.split('.')[1] as keyof typeof officer.exp;
                context.store.updateOfficer(this.officerId,
                    { exp: { ...officer.exp, [key]: se.oldValue as number } });
            } else {
                context.store.updateOfficer(this.officerId,
                    { [se.field]: se.oldValue } as Partial<typeof officer>);
            }
        }
        return true;
    }

    serialize(): SerializedCommand {
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
    private targetOfficerId: OfficerID;

    constructor(officerId: OfficerID, targetOfficerId: OfficerID, turn: number) {
        super('RECRUITMENT', officerId, turn);
        this.targetOfficerId = targetOfficerId;
    }

    execute(context: CommandContext): CommandResult {
        const officer = context.store.getOfficer(this.officerId);
        const target = context.store.getOfficer(this.targetOfficerId);
        if (!officer || !target) return this.buildResult(false, '무장 없음');
        if (officer.actionPoints < 20) return this.buildResult(false, '행동력 부족');
        if (target.factionId !== null) return this.buildResult(false, '이미 소속된 무장');

        const officerFaction = officer.factionId ? context.store.getFaction(officer.factionId) : null;
        if (!officerFaction) return this.buildResult(false, '세력 없음');

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

    undo(context: CommandContext): boolean {
        for (const se of this.sideEffects) {
            const off = context.store.getOfficer(se.targetId as OfficerID);
            if (off) context.store.updateOfficer(se.targetId as OfficerID, { ...off, [se.field]: se.oldValue } as Partial<typeof off>);
        }
        return true;
    }

    serialize(): SerializedCommand {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { targetOfficerId: this.targetOfficerId },
        };
    }
}/** [201] AI 스트리밍 징병 결정 — 도시 병력/개발도 보강을 큐에서 실행 */
export class CityRecruitmentCommand extends BaseCommand {
    private cityId: CityID;

    constructor(officerId: OfficerID, cityId: CityID, turn: number) {
        super('RECRUITMENT', officerId, turn);
        this.cityId = cityId;
    }

    execute(context: CommandContext): CommandResult {
        const officer = context.store.getOfficer(this.officerId);
        const city = context.store.getCity(this.cityId);
        if (!officer || !city) return this.buildResult(false, '무장 또는 도시 없음');
        if (officer.actionPoints < 20) return this.buildResult(false, '행동력 부족');
        if (!officer.factionId || city.ownerId !== officer.factionId) return this.buildResult(false, '소속 도시가 아님');
        if (city.funds < 200) return this.buildResult(false, '도시 자금 부족');
        // [결함 수정] 상한 판정을 garrisonCap(인구 12~15%) 으로 한다.
        // 예전엔 `city.development >= 200` 이었다. development 이 병력(명) 인
        // 지금 이 조건은 도시마다 영원히 참이 되어 이 커맨드가 아예 실행되지
        // 않았다. 기존 테스트가 `development: 100` 을 하드코딩해서 이 사실을
        // 가리고 있었다 — 값을 스텁으로 낮춰 두면 규모 결함은 영영 안 보인다.
        if (city.development >= garrisonCap(city)) return this.buildResult(false, '병력이 이미 garrison 상한에 달함');

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

    undo(context: CommandContext): boolean {
        for (const se of this.sideEffects) {
            if (se.target === 'officer') {
                const off = context.store.getOfficer(se.targetId as OfficerID);
                if (off) context.store.updateOfficer(se.targetId as OfficerID, { actionPoints: se.oldValue as number });
            } else if (se.target === 'city') {
                const city = context.store.getCity(se.targetId as CityID);
                if (city) context.store.updateCity(se.targetId as CityID, { [se.field]: se.oldValue } as Partial<typeof city>);
            }
        }
        return true;
    }

    serialize(): SerializedCommand {
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
    private fromCityId: CityID;
    private toCityId: CityID;

    constructor(officerId: OfficerID, fromCityId: CityID, toCityId: CityID, turn: number) {
        super('MOVEMENT', officerId, turn);
        this.fromCityId = fromCityId;
        this.toCityId = toCityId;
    }

    execute(context: CommandContext): CommandResult {
        const officer = context.store.getOfficer(this.officerId);
        const fromCity = context.store.getCity(this.fromCityId);
        const toCity = context.store.getCity(this.toCityId);
        if (!officer || !fromCity || !toCity) return this.buildResult(false, '무장 또는 도시 없음');
        if (officer.actionPoints < 30) return this.buildResult(false, '행동력 부족');

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

    undo(context: CommandContext): boolean {
        for (const se of this.sideEffects) {
            if (se.target === 'officer') {
                const off = context.store.getOfficer(se.targetId as OfficerID);
                if (off) context.store.updateOfficer(se.targetId as OfficerID, { ...off, [se.field]: se.oldValue } as Partial<typeof off>);
            } else if (se.target === 'city') {
                const c = context.store.getCity(se.targetId as CityID);
                if (c) context.store.updateCity(se.targetId as CityID, { ...c, [se.field]: se.oldValue } as Partial<typeof c>);
            }
        }
        return true;
    }

    serialize(): SerializedCommand {
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
    private sourceCityId: CityID;
    private targetCityId: CityID;
    /** 전투 후처리는 여러 엔티티를 변경하므로 Undo는 직전 전체 상태로 복원한다. [131-145] */
    private preBattleSnapshot: ReturnType<CommandContext['store']['createSnapshot']> | null = null;
    private preBattleDiplomacy: ReturnType<DiplomacyEngine['serialize']> | null = null;
    private preBattleChronicle: ReturnType<NonNullable<CommandContext['chronicle']>['serialize']> | null = null;

    constructor(officerId: OfficerID, sourceCityId: CityID, targetCityId: CityID, turn: number) {
        super('BATTLE', officerId, turn);
        this.sourceCityId = sourceCityId;
        this.targetCityId = targetCityId;
    }

    execute(context: CommandContext): CommandResult {
        const officer = context.store.getOfficer(this.officerId);
        const source = context.store.getCity(this.sourceCityId);
        const target = context.store.getCity(this.targetCityId);
        if (!officer || !source || !target) return this.buildResult(false, '무장 또는 도시 없음');
        if (!officer.factionId || source.ownerId !== officer.factionId || officer.cityId !== source.id) {
            return this.buildResult(false, '출진 무장의 소속 도시가 아님');
        }
        if (!target.ownerId || target.ownerId === officer.factionId || target.id === source.id) {
            return this.buildResult(false, '유효한 적 도시가 아님');
        }
        if (officer.actionPoints < 30) return this.buildResult(false, '행동력 부족');

        const attackerFaction = context.store.getFaction(officer.factionId);
        const targetFaction = context.store.getFaction(target.ownerId);
        if (!attackerFaction || !targetFaction) return this.buildResult(false, '세력 없음');
        const domainWar = attackerFaction.diplomacy[targetFaction.id]?.treaty === 'WAR'
            || targetFaction.diplomacy[attackerFaction.id]?.treaty === 'WAR';
        const engineWar = context.diplomacy?.getRelation(attackerFaction.id, targetFaction.id) === FactionRelation.WAR;
        if (!domainWar && !engineWar) return this.buildResult(false, '전쟁 상태가 아님');

        const defenderLeader = targetFaction.leaderId ? context.store.getOfficer(targetFaction.leaderId) : null;
        const attackerSides: AutoBattleSides = {
            attacker: this.createUnit(
                `${officer.factionId}_${source.id}_${target.id}`,
                officer.id,
                officer.name,
                officer.stats.leadership,
                officer.stats.might,
                Math.max(1, source.development + source.defense),
                source.loyalty,
                source.hexCoord,
            ),
            defender: this.createUnit(
                `${target.ownerId}_${target.id}_defense`,
                defenderLeader?.id ?? target.ownerId,
                defenderLeader?.name ?? target.name,
                defenderLeader?.stats.leadership ?? 50,
                defenderLeader?.stats.might ?? 50,
                Math.max(1, target.development + target.defense),
                target.loyalty,
                target.hexCoord,
            ),
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
        const logMessages: string[] = [];
        let captiveOutcomes: NonNullable<CommandResult['captiveOutcomes']> = [];
        if (won) {
            // 소유권 변경 전에 약탈·포로 포획·병력 재배치를 처리한다. [131-145]
            const spoils = processBattleSpoils(context.store, this.sourceCityId, this.targetCityId);
            logMessages.push(...spoils.messages);
            context.logger(`[전투 후처리] ${spoils.messages.join(' / ')}`);
            // 포획 즉시 AI 포로 처분을 수행한다. 등용·처형·석방 모두 전투 커맨드 안에서
            // 원자적으로 처리되어 실행/undo가 동일한 상태 경계를 사용한다. [121-130][131-145]
            if (spoils.capturedOfficerIds.length > 0) {
                const captiveReport = processCaptives(
                    context.store,
                    officer.factionId,
                    spoils.capturedOfficerIds,
                    context.diplomacy,
                );
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

        const currentSource = context.store.getCity(this.sourceCityId)!;
        const newSourceDevelopment = Math.max(0, Math.floor(currentSource.development * 0.85));
        context.store.updateOfficer(this.officerId, { actionPoints: oldAP - 30 });
        context.store.updateCity(this.sourceCityId, { development: newSourceDevelopment });
        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 30);
        this.recordSideEffect('city', this.sourceCityId, 'development', source.development, newSourceDevelopment);

        if (won) {
            const conqueredTarget = context.store.getCity(this.targetCityId)!;
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

    private createUnit(
        unitId: string,
        commanderId: string,
        commanderName: string,
        leadership: number,
        might: number,
        soldiers: number,
        morale: number,
        position: { q: number; r: number },
    ): AutoBattleUnit {
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

    undo(context: CommandContext): boolean {
        if (!this.preBattleSnapshot) return false;
        context.store.restoreSnapshot(this.preBattleSnapshot);
        if (this.preBattleDiplomacy) context.diplomacy?.restore(this.preBattleDiplomacy);
        if (this.preBattleChronicle) context.chronicle?.load(this.preBattleChronicle);
        this.sideEffects = [];
        return true;
    }

    serialize(): SerializedCommand {
        return {
            id: this.id, type: this.type, officerId: this.officerId,
            turnIssued: this.turnIssued, timestamp: this.timestamp,
            payload: { sourceCityId: this.sourceCityId, targetCityId: this.targetCityId },
        };
    }
}

// ============================================================
// [341-360][DIPLOMACY] 외교 커맨드
// ============================================================

export type DiplomacyAction = 'ALLIANCE' | 'BREAK_ALLIANCE' | 'DECLARE_WAR' | 'PEACE' | 'GIFT';

export class DiplomacyCommand extends BaseCommand {
    private targetFactionId: FactionID;
    private action: DiplomacyAction;

    constructor(officerId: OfficerID, targetFactionId: FactionID, action: DiplomacyAction, turn: number) {
        super('DIPLOMACY', officerId, turn);
        this.targetFactionId = targetFactionId;
        this.action = action;
    }

    execute(context: CommandContext): CommandResult {
        const officer = context.store.getOfficer(this.officerId);
        const diplomacy = context.diplomacy;
        if (!officer?.factionId || !diplomacy) return this.buildResult(false, '무장 또는 외교 엔진 없음');
        if (!context.store.getFaction(this.targetFactionId)) return this.buildResult(false, '대상 세력 없음');
        if (officer.factionId === this.targetFactionId) return this.buildResult(false, '자기 세력 대상 불가');
        if (officer.actionPoints < 10) return this.buildResult(false, '행동력 부족');

        const relation = diplomacy.getRelation(officer.factionId, this.targetFactionId);
        const oldTreaties = new Map<string, NonNullable<Faction['diplomacy']>[string] | undefined>();
        for (const [a, b] of [[officer.factionId, this.targetFactionId], [this.targetFactionId, officer.factionId]] as const) {
            oldTreaties.set(`${a}|${b}`, context.store.getFaction(a)?.diplomacy[b]);
        }
        let result: DiplomacyResult;
        switch (this.action) {
            case 'ALLIANCE': result = diplomacy.formAlliance(officer.factionId, this.targetFactionId); break;
            case 'BREAK_ALLIANCE': result = diplomacy.breakAlliance(officer.factionId, this.targetFactionId); break;
            case 'DECLARE_WAR': result = diplomacy.declareWar(officer.factionId, this.targetFactionId); break;
            case 'PEACE': result = diplomacy.makePeace(officer.factionId, this.targetFactionId); break;
            case 'GIFT': result = diplomacy.sendGift(officer.factionId, this.targetFactionId, 0, 0); break;
        }
        if (!result.success) return this.buildResult(false, result.message);

        const oldAP = officer.actionPoints;
        context.store.updateOfficer(this.officerId, { actionPoints: oldAP - 10 });
        this.recordSideEffect('officer', this.officerId, 'actionPoints', oldAP, oldAP - 10);
        this.recordSideEffect('relation', `${officer.factionId}|${this.targetFactionId}`, 'diplomacy', relation, diplomacy.getRelation(officer.factionId, this.targetFactionId));
        this.syncFactionTreaties(context, officer.factionId, oldTreaties);
        context.logger(`[외교] ${officer.name}: ${result.message}`);
        return this.buildResult(true, result.message);
    }

    private syncFactionTreaties(
        context: CommandContext,
        sourceFactionId: FactionID,
        oldTreaties: Map<string, NonNullable<Faction['diplomacy']>[string] | undefined>,
    ): void {
        const relation = context.diplomacy!.getRelation(sourceFactionId, this.targetFactionId);
        const treaty = relation === FactionRelation.WAR ? 'WAR'
            : relation === FactionRelation.ALLIANCE ? 'ALLIANCE'
                : relation === FactionRelation.NEUTRAL ? 'CEASEFIRE' : 'NONE';
        for (const [a, b] of [[sourceFactionId, this.targetFactionId], [this.targetFactionId, sourceFactionId]] as const) {
            const faction = context.store.getFaction(a);
            if (!faction) continue;
            const oldEntry = oldTreaties.get(`${a}|${b}`);
            const newEntry: NonNullable<typeof faction.diplomacy>[string] = { relation: 0, treaty, duration: 1 };
            context.store.updateFaction(a, { diplomacy: { ...faction.diplomacy, [b]: newEntry } });
            this.recordSideEffect('faction', a, `diplomacy.${b}`, oldEntry, newEntry);
        }
    }

    undo(context: CommandContext): boolean {
        if (!context.diplomacy) return false;
        for (const se of this.sideEffects) {
            if (se.target === 'relation') {
                context.diplomacy.setRelation(
                    se.targetId.split('|')[0] as FactionID,
                    se.targetId.split('|')[1] as FactionID,
                    se.oldValue as FactionRelation,
                );
            } else if (se.target === 'officer') {
                const officer = context.store.getOfficer(se.targetId as OfficerID);
                if (officer) context.store.updateOfficer(se.targetId as OfficerID, { [se.field]: se.oldValue } as Partial<typeof officer>);
            } else if (se.target === 'faction' && se.field.startsWith('diplomacy.')) {
                const faction = context.store.getFaction(se.targetId as FactionID);
                if (!faction) continue;
                const targetId = se.field.slice('diplomacy.'.length);
                const diplomacy = { ...faction.diplomacy };
                if (se.oldValue === undefined) delete diplomacy[targetId];
                else diplomacy[targetId] = se.oldValue as typeof diplomacy[string];
                context.store.updateFaction(faction.id, { diplomacy });
            }
        }
        return true;
    }

    serialize(): SerializedCommand {
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
    constructor(officerId: OfficerID, turn: number) {
        super('REST', officerId, turn);
    }

    execute(context: CommandContext): CommandResult {
        const officer = context.store.getOfficer(this.officerId);
        if (!officer) return this.buildResult(false, '무장 없음');

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

    undo(context: CommandContext): boolean {
        for (const se of this.sideEffects) {
            const off = context.store.getOfficer(se.targetId as OfficerID);
            if (off) context.store.updateOfficer(se.targetId as OfficerID, { ...off, [se.field]: se.oldValue } as Partial<typeof off>);
        }
        return true;
    }

    serialize(): SerializedCommand {
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
export function deserializeCommand(data: SerializedCommand): ICommand {
    const base = { officerId: data.officerId, turn: data.turnIssued };
    switch (data.type) {
        case 'DOMESTIC':
            return new DomesticCommand(base.officerId, data.payload.cityId as CityID, data.payload.facilityType as string, base.turn);
        case 'TRAINING':
            return new TrainingCommand(base.officerId, data.payload.statKey as 'leadership', base.turn);
        case 'RECRUITMENT':
            return data.payload.targetOfficerId
                ? new RecruitmentCommand(base.officerId, data.payload.targetOfficerId as OfficerID, base.turn)
                : new CityRecruitmentCommand(base.officerId, data.payload.targetCityId as CityID, base.turn);
        case 'MOVEMENT':
            return new MovementCommand(base.officerId, data.payload.fromCityId as CityID, data.payload.toCityId as CityID, base.turn);
        case 'BATTLE':
            return new BattleCommand(base.officerId, data.payload.sourceCityId as CityID, data.payload.targetCityId as CityID, base.turn);
        case 'DIPLOMACY': {
            const actions: DiplomacyAction[] = ['ALLIANCE', 'BREAK_ALLIANCE', 'DECLARE_WAR', 'PEACE', 'GIFT'];
            const action = actions.includes(data.payload.action as DiplomacyAction)
                ? data.payload.action as DiplomacyAction
                : 'ALLIANCE';
            return new DiplomacyCommand(base.officerId, data.payload.targetFactionId as FactionID, action, base.turn);
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
    private pending: ICommand[] = [];
    private executed: ICommand[] = [];
    private undone: ICommand[] = [];
    private maxHistory: number;

    constructor(maxHistory = 200) {
        this.maxHistory = maxHistory;
    }

    enqueue(command: ICommand): void {
        this.pending.push(command);
    }

    dequeue(): ICommand | undefined {
        return this.pending.shift();
    }

    executeNext(context: CommandContext): CommandResult | null {
        const cmd = this.pending.shift();
        if (!cmd) return null;

        const result = cmd.execute(context);
        if (result.success) {
            this.executed.push(cmd);
            if (this.executed.length > this.maxHistory) this.executed.shift();
            this.undone = [];
        }
        return result;
    }

    executeAll(context: CommandContext): CommandResult[] {
        const results: CommandResult[] = [];
        while (this.pending.length > 0) {
            const result = this.executeNext(context);
            if (result) results.push(result);
        }
        return results;
    }

    undoLast(context: CommandContext): boolean {
        const cmd = this.executed.pop();
        if (!cmd) return false;
        const success = cmd.undo(context);
        if (success) this.undone.push(cmd);
        return success;
    }

    redoLast(context: CommandContext): boolean {
        const cmd = this.undone.pop();
        if (!cmd) return false;
        const result = cmd.execute(context);
        if (result.success) {
            this.executed.push(cmd);
            return true;
        }
        this.undone.push(cmd);
        return false;
    }

    clear(): void {
        this.pending = [];
        this.executed = [];
        this.undone = [];
    }

    getPendingCount(): number { return this.pending.length; }
    getExecutedCount(): number { return this.executed.length; }
    /** 실행/복구 이벤트를 리플레이에 기록할 때 직전 커맨드를 조회한다. */
    peekPending(): ICommand | undefined { return this.pending[0]; }
    getLastExecuted(): ICommand | undefined { return this.executed[this.executed.length - 1]; }
    getLastUndone(): ICommand | undefined { return this.undone[this.undone.length - 1]; }
    canUndo(): boolean { return this.executed.length > 0; }
    canRedo(): boolean { return this.undone.length > 0; }

    /** 저장용 직렬화 — 실행 완료 명령은 상태에 이미 반영되었으므로 pending만 보존한다. [17] */
    serializePending(): SerializedCommand[] {
        return this.pending.map(c => c.serialize());
    }

    /** 진단/기존 API용 전체 직렬화 — executed 이력까지 포함한다. */
    serializeAll(): SerializedCommand[] {
        return [...this.pending, ...this.executed].map(c => c.serialize());
    }
}
