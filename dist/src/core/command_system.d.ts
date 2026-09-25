/**
 * 삼국지 8 리메이크 — 커맨드 패턴 시스템
 * 파일: src/core/command_system.ts
 *
 * 커맨드 패턴 + 큐 + Undo/Redo 구현
 * 모든 무장 행동을 Command 객체로 캡슐화
 */
import { ICommand, SerializedCommand, CommandContext, CommandResult, SideEffect, CommandType, OfficerID, CityID, FactionID, ID } from './types.js';
declare abstract class BaseCommand implements ICommand {
    readonly id: string;
    readonly type: CommandType;
    readonly officerId: OfficerID;
    readonly turnIssued: number;
    readonly timestamp: number;
    protected sideEffects: SideEffect[];
    constructor(type: CommandType, officerId: OfficerID, turnIssued: number);
    abstract execute(context: CommandContext): CommandResult;
    abstract undo(context: CommandContext): boolean;
    abstract serialize(): SerializedCommand;
    protected buildResult(success: boolean, message: string, extra?: Pick<CommandResult, 'logMessages' | 'captiveOutcomes'>): CommandResult;
    protected recordSideEffect(target: SideEffect['target'], targetId: ID, field: string, oldValue: unknown, newValue: unknown): void;
}
export declare class DomesticCommand extends BaseCommand {
    private cityId;
    private facilityType;
    private goldCost;
    private statKey;
    constructor(officerId: OfficerID, cityId: CityID, facilityType: string, turn: number);
    execute(context: CommandContext): CommandResult;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
}
export declare class TrainingCommand extends BaseCommand {
    private statKey;
    constructor(officerId: OfficerID, statKey: typeof TrainingCommand.prototype.statKey, turn: number);
    execute(context: CommandContext): CommandResult;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
}
export declare class RecruitmentCommand extends BaseCommand {
    private targetOfficerId;
    constructor(officerId: OfficerID, targetOfficerId: OfficerID, turn: number);
    execute(context: CommandContext): CommandResult;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
} /** [201] AI 스트리밍 징병 결정 — 도시 병력/개발도 보강을 큐에서 실행 */
export declare class CityRecruitmentCommand extends BaseCommand {
    private cityId;
    constructor(officerId: OfficerID, cityId: CityID, turn: number);
    execute(context: CommandContext): CommandResult;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
}
export declare class MovementCommand extends BaseCommand {
    private fromCityId;
    private toCityId;
    constructor(officerId: OfficerID, fromCityId: CityID, toCityId: CityID, turn: number);
    execute(context: CommandContext): CommandResult;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
}
/** AI 결정의 전투를 즉시 라운드제 전투로 해결하고 도시 상태를 원자적으로 반영한다. */
export declare class BattleCommand extends BaseCommand {
    private sourceCityId;
    private targetCityId;
    /** 전투 후처리는 여러 엔티티를 변경하므로 Undo는 직전 전체 상태로 복원한다. [131-145] */
    private preBattleSnapshot;
    private preBattleDiplomacy;
    private preBattleChronicle;
    constructor(officerId: OfficerID, sourceCityId: CityID, targetCityId: CityID, turn: number);
    execute(context: CommandContext): CommandResult;
    private createUnit;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
}
export type DiplomacyAction = 'ALLIANCE' | 'BREAK_ALLIANCE' | 'DECLARE_WAR' | 'PEACE' | 'GIFT';
export declare class DiplomacyCommand extends BaseCommand {
    private targetFactionId;
    private action;
    constructor(officerId: OfficerID, targetFactionId: FactionID, action: DiplomacyAction, turn: number);
    execute(context: CommandContext): CommandResult;
    private syncFactionTreaties;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
}
export declare class RestCommand extends BaseCommand {
    constructor(officerId: OfficerID, turn: number);
    execute(context: CommandContext): CommandResult;
    undo(context: CommandContext): boolean;
    serialize(): SerializedCommand;
}
export declare function deserializeCommand(data: SerializedCommand): ICommand;
export declare class CommandQueue {
    private pending;
    private executed;
    private undone;
    private maxHistory;
    constructor(maxHistory?: number);
    enqueue(command: ICommand): void;
    dequeue(): ICommand | undefined;
    executeNext(context: CommandContext): CommandResult | null;
    executeAll(context: CommandContext): CommandResult[];
    undoLast(context: CommandContext): boolean;
    redoLast(context: CommandContext): boolean;
    clear(): void;
    getPendingCount(): number;
    getExecutedCount(): number;
    /** 실행/복구 이벤트를 리플레이에 기록할 때 직전 커맨드를 조회한다. */
    peekPending(): ICommand | undefined;
    getLastExecuted(): ICommand | undefined;
    getLastUndone(): ICommand | undefined;
    canUndo(): boolean;
    canRedo(): boolean;
    /** 저장용 직렬화 — 실행 완료 명령은 상태에 이미 반영되었으므로 pending만 보존한다. [17] */
    serializePending(): SerializedCommand[];
    /** 진단/기존 API용 전체 직렬화 — executed 이력까지 포함한다. */
    serializeAll(): SerializedCommand[];
}
export {};
//# sourceMappingURL=command_system.d.ts.map