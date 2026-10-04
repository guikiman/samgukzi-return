/**
 * 삼국지리턴 — 통합 게임 엔진 (FSM 오케스트레이터)
 * 파일: src/core/game_engine.ts
 *
 * 모든 시스템을 통합하는 중앙 오케스트레이터
 * 유한 상태 머신 (FSM) 기반 페이즈 전환
 * 커맨드 큐 + 턴 스케줄러 + AI 워커 통합
 */

import {
    GamePhase, PhaseTransition, GlobalState, NormalizedState,
    Officer, Faction, City, Army, OfficerID, CityID, FactionID, MapFeature,
    ICommand, CommandResult, CommandContext, SerializedCommand,
    AIDecision, SchedulerProgress,
    GameEvent, EventListener, WorkerRequest, WorkerResponse,
    AIWorkerPayload, AIWorkerResult,
} from './types.js';
import { GameStore, gameStore } from './game_store.js';
import { CommandQueue, DomesticCommand, TrainingCommand, RecruitmentCommand, CityRecruitmentCommand, MovementCommand, BattleCommand, DiplomacyCommand, RestCommand, deserializeCommand, type DiplomacyAction } from './command_system.js';
import { TurnScheduler, AITurnProcessor, TurnLifecycleManager } from './turn_scheduler.js';
import { BootstrapContext, getBootstrap } from './bootstrap.js';
import { FactionAI } from './faction_ai_monthly.js';
import { FactionFateSystem } from './faction_fate_system.js';
import { OfficerLoyaltySystem } from './officer_loyalty_system.js';
import { DiplomacyEngine, FactionRelation } from './diplomacy_engine.js';
import { FactionDiplomacyAI } from './faction_diplomacy_ai.js';
import { ChronicleManager } from './chronicle_system.js';
import { DialogueEngine, type DialogueContext, type DialogueLine } from './dialogue_engine.js';
import { SpecializedEventSystem, type SpecializedEvent } from './specialized_event_system.js';
import { processHellConstraints } from './hell_constraint_system.js';
import { processMonthlyCaptiveEvents } from './captive_escape_system.js';
import { processMonthlyVengeance } from './vengeance_system.js';
import { processMonthlyRoamingEvents } from './roaming_event_system.js';
import { processMonthlyFreeOfficerVisits } from './free_officer_visit_system.js';
import { processMonthlySwornBrotherRescues } from './sworn_brother_rescue_system.js';
import { processMonthlySwornBrotherPacts } from './sworn_brother_pact_system.js';
import { planMonthlyTribeAffairs, demandsAbandonedBy, activeDemands } from './migration_tribe_system.js';
import {
    monthlyProgress, advanceMission, checkMissionExpiry, computeAudienceReward,
} from './imperial_audience_system.js';
import { advanceSiege } from './map_feature_siege_system.js';
// Python 시스템 모듈 TS 포팅 통합 [76-85][213-214][321-340][341-360][421-438][431-432][441-460]
import { StrategicCommandManager, StrategicPolicy, type IPolicyBridge } from './strategic_command_system.js';
import { DomesticScheduler } from './domestic_scheduler.js';
import type { WeatherType } from './intelligence_narrative_climate.js';
import { LifeSimulator } from './life_simulator.js';
import { MetaManager, LegacyManager, MetaDataManager } from './meta_systems.js';
import { IntelligenceManager, NarrativeManager, ClimateManager } from './intelligence_narrative_climate.js';
import { processVagrantMonthlyActions, resolvePlayerRaid } from './vagrant_monthly_actions.js';
// Python event_engine.py TS 포팅 [300] — 연의전 이벤트 체인 큐 + 조건 평가기
import { EventEngine, EventChainQueueManager, WarlordConditionEvaluator, type EvaluationContext } from './event_chain_engine.js';
import { HistoricalEventSystem } from './historical_event_system.js';
import { ScenarioBranchManager } from './scenario_branch_manager.js';
// 시나리오 연의전 데이터 로더 [300][301] — JSON 체인 정의 적재 + Schema 검증
import { BUILTIN_SCENARIO_EVENTS, loadScenarioEventChains } from './scenario_event_loader.js';
// 도시 안정 시스템 [148] — 민란 위험도/아사 판정 (Python city_manager.py 포팅)
import {
    CitySecurityState,
    accumulateUnpaidWages,
    checkRiot,
    decayRiotRisk,
    processStarvation,
} from './city_security_system.js';
// AI 스트리밍 엔진 [201][121-130] — Worker 기반 1,000명 가중치 AI (AGENTS.md §7)
import { AIStreamManager } from '../ai/ai_stream_manager.js';
import type { FactionDecisionBatch } from '../ai/ai_worker_simulator.js';
import type { ReplayCommandEvent } from './replay_share_manager.js';
// 턴 실행 트레이스 [디버그] — executeTurn 의 단계를 번호가 붙은 트리로 기록
import { TurnTrace } from './turn_trace.js';

type PhaseEnterHandler = () => void | Promise<void>;
type PhaseExitHandler = () => void;

interface FSMStateConfig {
    onEnter?: PhaseEnterHandler;
    onExit?: PhaseExitHandler;
    transitions: Record<string, GamePhase>;
}

export class GameEngine {
    private store: GameStore;
    private commandQueue: CommandQueue;
    private scheduler: TurnScheduler;
    private aiProcessor: AITurnProcessor;
    private lifecycleManager: TurnLifecycleManager;
    private fsm: Record<GamePhase, FSMStateConfig>;
    private currentPhase: GamePhase;
    private phaseHistory: PhaseTransition[];
    private eventListeners: Map<string, Set<EventListener>>;
    private eventQueue: GameEvent[];
    private worker: Worker | null = null;
    private workerPromises: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
    private bootstrap: BootstrapContext | null = null;
    private factionAI: import('./faction_ai_monthly.js').FactionAI;
    private fateSystem: FactionFateSystem;
    private loyaltySystem: OfficerLoyaltySystem;
    private diplomacy: DiplomacyEngine;
    private diplomacyAI: FactionDiplomacyAI;
    /** 대화 엔진 — 무장별 특화 대화 AI */
    readonly dialogueEngine: DialogueEngine;
    readonly specializedEvents: SpecializedEventSystem;
    /** 연대기 관리자 [Y-메타][441-460] — 서사적 이벤트 기록, 세이브에 포함 */
    readonly chronicle: import('./chronicle_system.js').ChronicleManager;
    /** 포팅 시스템: 군단/평정 [76-85] */
    readonly strategicCommand: StrategicCommandManager;
    /** 플레이어 내정 자동 배정·월간 실행 [49][76-85] */
    readonly domesticScheduler: DomesticScheduler;
    /** 포팅 시스템: 인생 시뮬레이션 [421-438] — 전상/제련/사사/은퇴 */
    readonly lifeSimulator: LifeSimulator;
    /** 포팅 시스템: 메타 게임 [213-214] — 업적/멀티 엔딩 (세션 전역 싱글톤) */
    readonly metaManager: MetaManager;
    /** 포팅 시스템: 가문/가보 상속 [431-432] */
    readonly legacyManager: LegacyManager;
    /** 포팅 시스템: 세력명/무기 모디파이어 (커스텀 데이터) */
    readonly metaDataManager: MetaDataManager;
    /** 포팅 시스템: 첩보 네트워크 [341-360] */
    readonly intelligenceManager: IntelligenceManager;
    /** 포팅 시스템: 나비 효과 내러티브 [441-460] */
    readonly narrativeManager: NarrativeManager;
    /** 포팅 시스템: 지역 기후 [321-340] */
    readonly climateManager: ClimateManager;
    /** 포팅 시스템: 연의전 이벤트 체인 엔진 [300] — 월간 스캔/발동 */
    readonly eventEngine: EventEngine;
    /** 역사 이벤트 (삼고초려/관도/적벽 등) — 이벤트 엔진과 연동 [106-114] */
    readonly historicalEvents: HistoricalEventSystem;
    /** 시나리오 분기 관리자 [106-114] — 외부(시나리오 로더)에서 분기 등록용 */
    readonly scenarioBranches = new ScenarioBranchManager();
    /** 도시 안정 상태 [148] — 도시 ID별 민란 위험도 (Python riot_risk) */
    private citySecurityStates = new Map<string, CitySecurityState>();
    private bankruptWarned = new Set<string>();
    /** 이번 달 발생한 민란/아사 기록 [148] — 월간 보고서 동향용 */
    private securityMonthlyLog: {
        riots: Array<{ cityId: string; cityName: string; fromFactionId: string | null }>;
        starvations: Array<{ cityId: string; cityName: string; losses: number }>;
    } = { riots: [], starvations: [] };
    private isProcessingTurn = false;
    /**
     * 턴 실행 트레이스 [디버그] — executeTurn 의 각 단계를 번호가 붙은
     * 트리로 기록한다. 기본값은 항상 켜져 있다(계측 비용이 무시할 만하고,
     * 꺼 두면 "왜 안 되는지" 를 볼 수단이 없다).
     *
     * [설계] 이벤트로 추적하지 않는다. 이벤트는 큐에 쌓였다가
     * processEventQueue() 에서 나중에 배수되므로, 구독만 하면 이 이벤트가
     * 어느 단계에서 났는지 복원할 수 없다(전부 마지막 배수 지점에 붙는다).
     * 그래서 각 단계를 명시적으로 연다.
     */
    private turnTrace: TurnTrace = new TurnTrace();
    /** UI/콘솔에서 마지막 턴 트리를 읽을 때 쓰는 공개 접근자 */
    getTurnTrace(): TurnTrace { return this.turnTrace; }
    /** AI 스트리밍 매니저 [201] — Worker 기반 세력별 스트리밍 AI (실패 시 메인 스레드 폴백) */
    private aiStream: AIStreamManager | null = null;
    /** 스트리밍 AI 영구 실패 플래그 — 워커 오류 이후 폴백 고정 */
    private streamFailed = false;
    /** 스트리밍 AI의 월간 결정 수집 버퍼 — executeTurn에서 소비 */
    private streamBatchCount = 0;
    /** 이번 턴에 Worker 스트리밍 경로가 실제 완료되었는지 — FactionAI 중복 방지 */
    private streamTurnCompleted = false;
    /** 민란 억제 롤 오버라이드 [148] — 테스트 결정론용. 값 지정 시 1회 소비 후 자동 해제 */
    private _riotRollOverride: number | null = null;

    /**
     * 민란 억제 롤 강제 지정 [148] — 0이면 억제 롤 성공(진압), 1이면 실패(민란 발생).
     * 테스트/리플레이 재현용이며, 지정 시 다음 판정 1회에만 적용 후 해제된다.
     */
    setRiotRollOverride(value: number | null): void {
        this._riotRollOverride = value;
    }

    private riotRollOverride(): number | null {
        const v = this._riotRollOverride;
        this._riotRollOverride = null; // 1회 소비 후 해제
        return v;
    }
    /**
     * 이번 달 포팅 시스템 동향 수집 버퍼 [76-85][321-340][341-360][421-438]
     * processPortedSystemsMonthly가 채우고, 월간 보고서(MonthlyReportSystem)가 peek한다.
     * peekMonthlyPortedLog(hasRead=true)로 읽으면 비워진다.
     */
    private portedMonthlyLog: {
        campaigns: Array<{ targetCity: string; leaderName: string; soldiers: number }>;
        transports: Array<{ fromCity: string; toCity: string; gold: number; food: number; soldiers: number }>;
        collapsedNetworks: Array<{ factionId: string; cityId: string }>;
        retired: Array<{ officerName: string; age: number }>;
        /** 전투 후 포로 처분 결과 — 월간 보고서 UI [121-130][131-145] */
        captives: Array<{ officerId: string; officerName: string; decision: 'RECRUIT' | 'EXECUTE' | 'RELEASE'; success: boolean; message: string }>;
        /** [83] 방랑군 동향 — 전환/등용/습격/재기 (월간 보고서 동향 섹션용) */
        vagrant: Array<{ factionName: string; kind: 'CONVERT' | 'RECRUIT' | 'RAID'; success: boolean; message: string }>;
    } = { campaigns: [], transports: [], collapsedNetworks: [], retired: [], captives: [], vagrant: [] };

    constructor(store?: GameStore) {
        this.store = store ?? gameStore;
        this.commandQueue = new CommandQueue(200);
        this.aiProcessor = new AITurnProcessor(this.store, 50);
        this.scheduler = new TurnScheduler(async (task) => {
            await this.aiProcessor.processSingleOfficer(task.officerId);
        }, { chunkSize: 50 });
        this.lifecycleManager = new TurnLifecycleManager(this.store);
        this.factionAI = new FactionAI(this.store);
        this.fateSystem = new FactionFateSystem(this.store);
        this.loyaltySystem = new OfficerLoyaltySystem(this.store);
        // 관계 엔진이 변경 즉시 정규화된 세력 diplomacy에도 반영한다. [341-360]
        this.diplomacy = new DiplomacyEngine(this.store);
        // 포로 등용 시 원소속 세력 원수화 페널티에서 동일 외교 엔진 사용 [24][341-360]
        this.loyaltySystem.diplomacy = this.diplomacy;
        this.factionAI.diplomacy = this.diplomacy;
        this.diplomacyAI = new FactionDiplomacyAI(this.store, this.diplomacy);
        this.dialogueEngine = new DialogueEngine(this.store);
        this.specializedEvents = new SpecializedEventSystem(this.store);
        this.chronicle = new ChronicleManager();
        this.chronicle.attachStore(this.store);
        // 포팅 시스템 초기화 [76-85][213-214][321-340][341-360][421-438][431-432][441-460]
        this.strategicCommand = new StrategicCommandManager('player');
        this.domesticScheduler = new DomesticScheduler(this.store);
        this.lifeSimulator = new LifeSimulator();
        this.metaManager = MetaManager.getInstance();
        this.legacyManager = new LegacyManager();
        this.metaDataManager = new MetaDataManager();
        this.intelligenceManager = new IntelligenceManager();
        this.narrativeManager = new NarrativeManager();
        this.climateManager = new ClimateManager();
        // 연의전 이벤트 체인 엔진 [300] + 역사 이벤트 등록 [106-114]
        this.eventEngine = new EventEngine(new EventChainQueueManager(), new WarlordConditionEvaluator());
        this.historicalEvents = new HistoricalEventSystem();
        this.historicalEvents.registerDefaultEvents();
        // 시나리오별 연의전 체인 적재는 initWorld에서 시나리오 ID로 수행 [300]
        this.currentPhase = GamePhase.TITLE;
        this.phaseHistory = [];
        this.eventListeners = new Map();
        this.eventQueue = [];
        this.workerPromises = new Map();

        this.fsm = this.buildFSM();
        this.initWorker();
        this.initBootstrap();
    }

    private initBootstrap(): void {
        this.bootstrap = getBootstrap();
        this.bootstrap.initializeEngine(this);
    }

    private buildFSM(): Record<GamePhase, FSMStateConfig> {
        return {
            [GamePhase.TITLE]: {
                onEnter: () => console.log('[Engine] TITLE phase'),
                transitions: { START: GamePhase.WORLD_MAP },
            },
            [GamePhase.WORLD_MAP]: {
                onEnter: () => this.onEnterWorldMap(),
                onExit: () => console.log('[Engine] WORLD_MAP exit'),
                transitions: {
                    COUNCIL_START: GamePhase.COUNCIL,
                    BATTLE_START: GamePhase.BATTLE,
                    EVENT_TRIGGER: GamePhase.EVENT,
                    DIALOGUE: GamePhase.DIALOGUE,
                },
            },
            [GamePhase.COUNCIL]: {
                onEnter: () => this.onEnterCouncil(),
                onExit: () => console.log('[Engine] COUNCIL exit'),
                transitions: {
                    COUNCIL_END: GamePhase.PERSONAL_ACTION,
                    BATTLE_START: GamePhase.BATTLE,
                },
            },
            [GamePhase.PERSONAL_ACTION]: {
                onEnter: () => this.onEnterPersonalAction(),
                onExit: () => console.log('[Engine] PERSONAL_ACTION exit'),
                transitions: {
                    ACTION_END: GamePhase.WORLD_MAP,
                    BATTLE_START: GamePhase.BATTLE,
                    EVENT_TRIGGER: GamePhase.EVENT,
                },
            },
            [GamePhase.BATTLE]: {
                onEnter: () => this.onEnterBattle(),
                onExit: () => this.onExitBattle(),
                transitions: {
                    BATTLE_END: GamePhase.WORLD_MAP,
                    BATTLE_LOST: GamePhase.GAME_OVER,
                },
            },
            [GamePhase.DIALOGUE]: {
                onEnter: () => console.log('[Engine] DIALOGUE enter'),
                transitions: { DIALOGUE_END: GamePhase.WORLD_MAP },
            },
            [GamePhase.EVENT]: {
                onEnter: () => this.onEnterEvent(),
                onExit: () => console.log('[Engine] EVENT exit'),
                transitions: {
                    EVENT_END: GamePhase.WORLD_MAP,
                    DIALOGUE: GamePhase.DIALOGUE,
                    BATTLE_START: GamePhase.BATTLE,
                },
            },
            [GamePhase.GAME_OVER]: {
                onEnter: () => console.log('[Engine] GAME_OVER'),
                transitions: {},
            },
        };
    }

    transition(event: string): boolean {
        const currentConfig = this.fsm[this.currentPhase];
        const targetPhase = currentConfig.transitions[event];
        if (!targetPhase) {
            console.warn(`[Engine] Invalid: ${this.currentPhase} --[${event}]--> ?`);
            return false;
        }

        if (currentConfig.onExit) currentConfig.onExit();

        const transition: PhaseTransition = {
            from: this.currentPhase, to: targetPhase, event, timestamp: Date.now(),
        };
        this.phaseHistory.push(transition);
        this.currentPhase = targetPhase;
        this.store.setPhase(targetPhase);

        const targetConfig = this.fsm[targetPhase];
        if (targetConfig.onEnter) {
            const result = targetConfig.onEnter();
            if (result instanceof Promise) {
                result.catch(err => console.error('[Engine] onEnter error:', err));
            }
        }
        this.emitEvent({ id: `phase_${Date.now()}`, type: 'PHASE_CHANGE', payload: { from: transition.from, to: transition.to }, timestamp: Date.now(), turn: this.store.getGlobalState().turnCount });
        return true;
    }

    getCurrentPhase(): GamePhase { return this.currentPhase; }
    getPhaseHistory(): PhaseTransition[] { return [...this.phaseHistory]; }

    generateDialogue(context: DialogueContext): DialogueLine {
        return this.dialogueEngine.generateDialogue(context);
    }

    getSpecializedEvents(officerId: string): readonly SpecializedEvent[] {
        return this.specializedEvents.getEventsForOfficer(officerId);
    }

    private onEnterWorldMap(): void {
        console.log('[Engine] WORLD_MAP enter');
        this.processWeatherEffect();
    }

    private async onEnterCouncil(): Promise<void> {
        console.log('[Engine] COUNCIL enter');
    }

    private onEnterPersonalAction(): void {
        console.log('[Engine] PERSONAL_ACTION enter');
        const playerOfficer = this.store.getGlobalState().selectedOfficerId;
        if (playerOfficer) {
            const officer = this.store.getOfficer(playerOfficer);
            if (officer) {
                console.log(`[Engine] Player: ${officer.name} (AP: ${officer.actionPoints})`);
            }
        }
    }

    private onEnterBattle(): void {
        console.log('[Engine] BATTLE enter');
        this.emitEvent({ id: `battle_${Date.now()}`, type: 'BATTLE_START', payload: {}, timestamp: Date.now(), turn: this.store.getGlobalState().turnCount });
    }

    private onExitBattle(): void {
        console.log('[Engine] BATTLE exit');
    }

    private onEnterEvent(): void {
        console.log('[Engine] EVENT enter');
        this.processEventQueue();
    }

    enqueueCommand(command: ICommand): void {
        this.commandQueue.enqueue(command);
        this.emitEvent({ id: `cmd_${Date.now()}`, type: 'COMMAND_ENQUEUE', payload: { cmdId: command.id, cmdType: command.type }, timestamp: Date.now(), turn: this.store.getGlobalState().turnCount });
    }

    private createCommandContext(): CommandContext {
        return {
            store: this.store,
            diplomacy: this.diplomacy,
            chronicle: this.chronicle,
            logger: (msg) => console.log(msg),
        };
    }

    /** 성공한 각 커맨드 실행 전 월간 포로 로그 길이 — undo 시 UI 버퍼도 같은 경계로 복원한다. */
    private executedCommandCaptiveLogSizes: number[] = [];
    /** 전투·포로·외교 명령 실행/복구 이벤트 — 리플레이 및 세이브 델타에서 재사용 [312] */
    private commandReplayLog: ReplayCommandEvent[] = [];

    private recordCommandReplay(command: ICommand, action: ReplayCommandEvent['action'], result?: CommandResult, success = true): void {
        const event: ReplayCommandEvent = {
            id: `${action.toLowerCase()}_${command.id}`,
            commandType: command.type,
            action,
            turn: command.turnIssued,
            timestamp: Date.now(),
            success,
            message: result?.message ?? `${action} ${command.type}`,
            logMessages: [...(result?.logMessages ?? [])],
            captiveOutcomes: (result?.captiveOutcomes ?? []).map(outcome => ({ ...outcome })),
        };
        this.commandReplayLog.push(event);
        this.emitEvent({
            id: `command_replay_${event.id}_${event.timestamp}`,
            type: 'COMMAND_REPLAY',
            payload: event as unknown as Record<string, unknown>,
            timestamp: event.timestamp,
            turn: event.turn,
        });
    }

    getCommandReplayLog(): ReplayCommandEvent[] {
        return this.commandReplayLog.map(event => ({
            ...event,
            logMessages: [...event.logMessages],
            captiveOutcomes: event.captiveOutcomes.map(outcome => ({ ...outcome })),
        }));
    }

    private emitCommandResult(result: CommandResult): void {
        if (result.commandType === 'BATTLE' && result.success) {
            this.portedMonthlyLog.captives.push(...(result.captiveOutcomes ?? []));
        }
        this.emitEvent({
            id: `command_result_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            type: 'COMMAND_EXECUTED',
            payload: {
                commandType: result.commandType,
                success: result.success,
                message: result.message,
                logMessages: result.logMessages ?? [],
                captiveOutcomes: result.captiveOutcomes ?? [],
            },
            timestamp: Date.now(),
            turn: this.store.getGlobalState().turnCount,
        });
    }

    executeNextCommand(): CommandResult | null {
        const before = this.portedMonthlyLog.captives.length;
        const command = this.commandQueue.peekPending();
        const result = this.commandQueue.executeNext(this.createCommandContext());
        if (command) this.recordCommandReplay(command, 'EXECUTE', result ?? undefined, result?.success ?? false);
        if (result?.success) this.executedCommandCaptiveLogSizes.push(before);
        if (result) this.emitCommandResult(result);
        return result;
    }

    executeAllCommands(): CommandResult[] {
        const results: CommandResult[] = [];
        const context = this.createCommandContext();
        while (this.getPendingCommandCount() > 0) {
            const before = this.portedMonthlyLog.captives.length;
            const command = this.commandQueue.peekPending();
            const result = this.commandQueue.executeNext(context);
            if (!result) break;
            if (command) this.recordCommandReplay(command, 'EXECUTE', result, result.success);
            if (result.success) this.executedCommandCaptiveLogSizes.push(before);
            results.push(result);
            this.emitCommandResult(result);
        }
        return results;
    }

    undoLastCommand(): boolean {
        const command = this.commandQueue.getLastExecuted();
        const success = this.commandQueue.undoLast(this.createCommandContext());
        if (command && success) this.recordCommandReplay(command, 'UNDO');
        if (success) {
            const previousSize = this.executedCommandCaptiveLogSizes.pop();
            if (previousSize !== undefined) this.portedMonthlyLog.captives.length = previousSize;
        }
        return success;
    }

    redoLastCommand(): boolean {
        const command = this.commandQueue.getLastUndone();
        const before = this.portedMonthlyLog.captives.length;
        const success = this.commandQueue.redoLast(this.createCommandContext());
        if (command && success) this.recordCommandReplay(command, 'REDO');
        if (success) this.executedCommandCaptiveLogSizes.push(before);
        return success;
    }

    canUndo(): boolean { return this.commandQueue.canUndo(); }
    canRedo(): boolean { return this.commandQueue.canRedo(); }
    getPendingCommandCount(): number { return this.commandQueue.getPendingCount(); }

    async executeTurn(onProgress?: (progress: SchedulerProgress) => void): Promise<void> {
        if (this.isProcessingTurn) {
            console.warn('[Engine] Turn already processing');
            return;
        }
        this.isProcessingTurn = true;

        try {
            const gs = this.store.getGlobalState();
            console.log(`[Engine] === Turn ${gs.turnCount} | ${gs.time.year}yr ${gs.time.month}mo ===`);
            // [트레이스] 이번 턴의 계측 시작 — 0번 루트 아래에 1, 2, 3… 이 쌓인다.
            this.turnTrace.beginTurn(gs.turnCount, gs.time.year, gs.time.month);

            this.turnTrace.step('무장 상태 초기화', 'setup')
                .endLazy(() => {
                    this.resetTurnFlags();
                    return `전 무장 행동력 회복`;
                });
            this.turnTrace.step('평정(议事) 페이즈', 'fsm')
                .endLazy(() => {
                    this.transition('COUNCIL_START');
                    return `${GamePhase[this.currentPhase] ?? this.currentPhase}`;
                });
            this.turnTrace.step('개인 행동 페이즈 진입', 'fsm')
                .endLazy(() => {
                    this.transition('COUNCIL_END');
                    return `${GamePhase[this.currentPhase] ?? this.currentPhase}`;
                });

            // AI 턴 — Worker 스트리밍 엔진 [201] 우선, 실패/미지원 시 기존
            // Time-Slicing 스케줄러 폴백. 두 경로 모두 동일한 커맨드 변환 파이프라인 사용.
            // [트레이스] async 단계를 맡기 위해 핸들을 먼저 연다.
            // endLazy 에 async 를 넘길 수는 없으므로, await 한 뒤 end() 로 닫는다.
            const aiStep = this.turnTrace.step('AI 턴 결정', 'ai');
            const decisions = await this.executeAITurnWithStreaming(onProgress);
            aiStep.end(`결정 ${decisions.length}건`);
            console.log(`[Engine] AI decisions: ${decisions.length}`);

            const convertStep = this.turnTrace.step('AI 결정 → 명령 변환', 'command');
            for (const decision of decisions) {
                this.convertDecisionToCommand(decision);
            }
            convertStep.end(`명령 ${this.commandQueue.getPendingCount()}건 대기`);

            const execStep = this.turnTrace.step('명령 일괄 실행', 'command');
            const results = this.executeAllCommands();
            const successCount = results.filter(r => r.success).length;
            console.log(`[Engine] Commands: ${successCount}/${results.length} ok`);
            execStep.end(`성공 ${successCount} / 전체 ${results.length}`);

            // 플레이어가 등록한 자동 내정 임무는 AI/커맨드 처리와 동일한 턴 종료를 거친다. [49][76-85]
            const domesticStep = this.turnTrace.step('플레이어 자동 내정 실행', 'domestic');
            const domesticResults = this.domesticScheduler.executeAll();
            for (const result of domesticResults) {
                this.emitEvent({
                    id: `domestic_${result.taskType}_${Date.now()}`,
                    type: 'DOMESTIC_ASSIGNMENT_COMPLETED',
                    payload: {
                        taskType: result.taskType,
                        statChanged: result.statChanged,
                        increment: result.increment,
                        fundsConsumed: result.fundsConsumed,
                        successLevel: result.successLevel,
                        message: result.log,
                    },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            domesticStep.end(domesticResults.length > 0
                ? `임무 ${domesticResults.length}건 완료`
                : '대기 중인 임무 없음');

            this.turnTrace.step('이벤트 큐 1차 배수', 'event')
                .endLazy(() => {
                    this.processEventQueue();
                    return `누적 이벤트 ${this.eventQueue.length}건`;
                });
            this.turnTrace.step('부트스트랩 턴 시작 훅', 'system')
                .endLazy(() => {
                    if (this.bootstrap) this.bootstrap.processTurnStart();
                    return this.bootstrap ? '24개 서브시스템' : '부트스트랩 없음(테스트 환경)';
                });
            // 월간 보고서 로그 리셋 — 새 달 동향만 담도록 [148]
            this.securityMonthlyLog.riots = [];
            this.securityMonthlyLog.starvations = [];
            // 세력 AI 월간 자율 행동 (내정/징병/출진) [201]
            // [트레이스] 세력별로 하위 단계를 연다 — "AI 가 무엇을 했나" 의 핵심.
            const factionStep = this.turnTrace.step('세력 AI 월간 행동', 'faction');
            const aiReports = this.factionAI.runMonthly({ skipCityDevelopment: this.streamTurnCompleted });
            for (const r of aiReports) {
                if (r.actions.length > 0) {
                    const factionHandle = this.turnTrace.step(r.factionName, 'faction');
                    for (const action of r.actions) {
                        this.turnTrace.note(action, '', 'faction-action');
                    }
                    factionHandle.end(
                        r.conqueredCityId ? `점령 성공 · ${r.actions.length}행동` : `${r.actions.length}행동`,
                    );
                    console.log(`[FactionAI] ${r.factionName}: ${r.actions.join(', ')}`);
                    this.emitEvent({
                        id: `faction_ai_${r.factionId}_${Date.now()}`,
                        type: 'FACTION_AI_ACTION',
                        payload: {
                            factionId: r.factionId,
                            actions: r.actions,
                            conqueredCityId: r.conqueredCityId,
                            captiveOutcomes: r.captiveOutcomes ?? [],
                        },
                        timestamp: Date.now(),
                        turn: this.store.getGlobalState().turnCount,
                    });
                }
            }
            const activeFactions = aiReports.filter(r => r.actions.length > 0).length;
            factionStep.end(activeFactions > 0
                ? `${activeFactions}개 세력이 행동 · 점령 ${aiReports.filter(r => r.conqueredCityId).length}건`
                : '이번 달 행동한 세력 없음');
            // 도시 안정 월간 판정 [148] — 아사/민란 위험도/민란 발생
            // 주의: 월 수입 유입(processMonthlyMaintenance) *전*에 판정한다.
            // Python city_manager.py 규격: 소비 반영 후 재고 0 이하 → 아사.
            // 수입을 먼저 반영하면 군량 고갈 세력이 수입 한 번에 회복되어 아사가 영원히 발생하지 않는다.
            this.turnTrace.step('도시 안정 판정', 'economy')
                .endLazy(() => {
                    this.processCitySecurityMonthly();
                    const riots = this.securityMonthlyLog.riots.length;
                    const starv = this.securityMonthlyLog.starvations.length;
                    return riots + starv > 0 ? `민란 ${riots} · 아사 ${starv}` : '이상 없음';
                });
            this.turnTrace.step('월 수입 유입', 'economy')
                .endLazy(() => {
                    this.processMonthlyMaintenance();
                    return '도시·세력 수입 반영';
                });
            this.turnTrace.step('월 세출', 'economy')
                .endLazy(() => {
                    this.processMonthlyUpkeep();
                    return '군사·관료 유지비';
                });
            // 연의전 이벤트 체인 스캔/발동 [300][106-114]
            this.turnTrace.step('연의전 이벤트 체인', 'event-chain')
                .endLazy(() => {
                    this.processEventChainMonthly();
                    return '조건 스캔 · 발동 처리';
                });
            // 포팅 시스템 월간 훅 [76-85][321-340][341-360][421-438] — 전략 명령 진행, 첩보망 유지비,
            // 지역 기후 전이, 계절 기반 수확 보정, 고령 무장 은퇴
            this.turnTrace.step('포팅 시스템 월간 훅', 'ported')
                .endLazy(() => {
                    this.processPortedSystemsMonthly();
                    return '군단·첩보·기후·은퇴';
                });
            // AI 세력 월간 자율 외교도 CommandQueue를 경유해 단일 diplomacy 원자를 사용한다. [341-360]
            const diploStep = this.turnTrace.step('세력 자율 외교', 'diplomacy');
            const diploReports = this.diplomacyAI.runMonthly((factionId, targetFactionId, action) => {
                const faction = this.store.getFaction(factionId);
                if (!faction) return { success: false, message: '행동 세력 없음' };
                const command = new DiplomacyCommand(
                    faction.leaderId,
                    targetFactionId,
                    action,
                    this.store.getGlobalState().turnCount,
                );
                this.enqueueCommand(command);
                const result = this.executeNextCommand();
                return { success: result?.success ?? false, message: result?.message ?? '외교 명령 실행 실패' };
            });
            for (const r of diploReports) {
                if (r.messages.length === 0) continue;
                const diploFactionStep = this.turnTrace.step(r.factionName, 'diplomacy');
                for (const msg of r.messages) {
                    this.turnTrace.note(msg, '', 'diplomacy-action');
                    console.log(`[Diplomacy] ${r.factionName}: ${msg}`);
                    this.emitEvent({
                        id: `diplomacy_${r.factionId}_${Date.now()}_${r.messages.indexOf(msg)}`,
                        type: 'FACTION_DIPLOMACY',
                        payload: { factionId: r.factionId, factionName: r.factionName, message: msg },
                        timestamp: Date.now(),
                        turn: this.store.getGlobalState().turnCount,
                    });
                }
                diploFactionStep.end(`${r.messages.length}건`);
            }
            diploStep.end(diploReports.length > 0
                ? `${diploReports.length}개 세력 검토`
                : '외교 행동 없음');
            // 무장 배신 판정 (AI 세력 무장) [24]
            const defectionStep = this.turnTrace.step('무장 배신 판정', 'social');
            const defections = this.loyaltySystem.processMonthlyDefections();
            for (const d of defections) {
                this.turnTrace.note(d.officerName, d.reason, 'social-action');
                console.log(`[Engine] 배신: ${d.officerName} (${d.reason})`);
                this.emitEvent({
                    id: `defection_${d.officerId}_${Date.now()}`,
                    type: 'OFFICER_DEFECTED',
                    payload: { officerId: d.officerId, officerName: d.officerName, reason: d.reason },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            defectionStep.end(defections.length > 0
                ? `배신 ${defections.length}명`
                : '배신 없음');
            // 포로 월간 탈출 판정 + 의형제 구출 [131-145][C-인간관계]
            const socialStep = this.turnTrace.step('인간관계 월간 사건', 'social');
            const rescueReport = processMonthlySwornBrotherRescues(this.store);
            for (const rec of rescueReport.rescued) {
                this.turnTrace.note('의형제 구출', rec.message, 'social-action');
                console.log(`[Engine] ${rec.message}`);
                this.emitEvent({
                    id: `sworn_rescue_${rec.officerId}_${Date.now()}`,
                    type: 'SWORN_BROTHER_RESCUED',
                    payload: { officerId: rec.officerId, officerName: rec.officerName, rescuerId: rec.rescuerId, rescuerName: rec.rescuerName, toCityId: rec.toCityId },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            const captiveReport = processMonthlyCaptiveEvents(this.store);
            for (const rec of captiveReport.escaped) {
                this.turnTrace.note('포로 탈출', rec.message, 'social-action');
                console.log(`[Engine] ${rec.message}`);
                this.emitEvent({
                    id: `captive_escape_${rec.officerId}_${Date.now()}`,
                    type: 'CAPTIVE_ESCAPED',
                    payload: { officerId: rec.officerId, officerName: rec.officerName, fromCityId: rec.fromCityId },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            // 월간 복수 이벤트 — 같은 도시/전장의 원수 무장 간 설전·단기접전 [32][33][C-인간관계]
            const vengeanceOutcomes = processMonthlyVengeance(this.store);
            for (const v of vengeanceOutcomes) {
                this.turnTrace.note('복수', v.message, 'social-action');
                console.log(`[Engine] ${v.message}`);
                this.emitEvent({
                    id: `vengeance_${v.actorId}_${Date.now()}`,
                    type: 'VENGEANCE_EVENT',
                    payload: { kind: v.kind, actorId: v.actorId, targetId: v.targetId, success: v.success, message: v.message },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            // 월간 의형제 결의 — 깊은 우호도 무장 간 결의 [C-인간관계][25]
            const pactReport = processMonthlySwornBrotherPacts(this.store);
            for (const pact of pactReport.pacts) {
                this.turnTrace.note('의형제 결의', pact.message, 'social-action');
                console.log(`[Engine] ${pact.message}`);
                this.emitEvent({
                    id: `sworn_pact_${pact.officerAId}_${pact.officerBId}_${Date.now()}`,
                    type: 'SWORN_BROTHER_PACT',
                    payload: { officerAName: pact.officerAName, officerBName: pact.officerBName, factionId: pact.factionId, message: pact.message },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            socialStep.end(
                `구출 ${rescueReport.rescued.length} · 탈출 ${captiveReport.escaped.length}`
                + ` · 복수 ${vengeanceOutcomes.length} · 결의 ${pactReport.pacts.length}`,
            );
            // 월간 로밍 이벤트 — 재야 명사 방문 (현자/은자/상인/행상인/산적) [25][441-460]
            const roamingStep = this.turnTrace.step('재야 명사 로밍', 'roaming');
            const roamingReport = processMonthlyRoamingEvents(this.store);
            for (const ev of roamingReport.events) {
                this.turnTrace.note(ev.type, ev.message, 'roaming-action');
                console.log(`[Engine] ${ev.message}`);
                this.emitEvent({
                    id: `roaming_${ev.type}_${ev.cityId}_${Date.now()}`,
                    type: 'GAME_ROAMING_EVENT',
                    payload: { roamingType: ev.type, cityId: ev.cityId, cityName: ev.cityName, factionName: ev.factionName, message: ev.message },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            roamingStep.end(roamingReport.events.length > 0
                ? `사건 ${roamingReport.events.length}건`
                : '방문 없음');
            // 재야 무장 출사 타진 — 자발적 방문 등용 [24][421-440]
            const visitStep = this.turnTrace.step('재야 무장 방문', 'visit');
            const visitReport = processMonthlyFreeOfficerVisits(this.store);
            for (const visit of visitReport) {
                this.turnTrace.note(visit.officerName, visit.message, 'visit-action');
                console.log(`[Engine] ${visit.message}`);
                this.emitEvent({
                    id: `free_visit_${visit.officerId}_${Date.now()}`,
                    type: 'FREE_OFFICER_VISIT',
                    // payload 는 UI(main.ts openVisitModal)가 FreeOfficerVisit 전체로 캐스팅해 쓴다.
                    // stats/ambition/fame/personalityLabel 을 빠뜨리면 모달이 visit.stats.leadership 에서
                    // 터져 이벤트 큐가 중단된다(턴 진행 실패). 빠짐없이 실어 보낸다.
                    payload: {
                        officerId: visit.officerId,
                        officerName: visit.officerName,
                        cityId: visit.cityId,
                        cityName: visit.cityName,
                        factionId: visit.factionId,
                        factionName: visit.factionName,
                        leaderId: visit.leaderId,
                        leaderName: visit.leaderName,
                        chance: visit.chance,
                        roll: visit.roll,
                        joined: visit.joined,
                        needsPlayerChoice: visit.needsPlayerChoice,
                        message: visit.message,
                        stats: visit.stats,
                        ambition: visit.ambition,
                        fame: visit.fame,
                        personalityLabel: visit.personalityLabel,
                    },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            visitStep.end(visitReport.length > 0
                ? `방문 ${visitReport.length}건`
                : '방문 없음');
            const tribeStep = this.turnTrace.step('이민족 월간 affairs', 'tribe');
            const tribeUpdates = planMonthlyTribeAffairs(
                this.store.getAllMigrationTribes(),
                this.store.getAllInvasionDemands(),
            );
            for (const u of tribeUpdates) {
                const tribe = this.store.getMigrationTribe(u.id);
                if (!tribe) continue;
                const abandoned = demandsAbandonedBy(u, tribe, this.store.getAllInvasionDemands());
                for (const demandId of abandoned) {
                    this.store.updateInvasionDemand(demandId, { withdrawn: true });
                }
                // 남은 요구의 기한을 한 달 줄인다. 기한이 0 이 되면 demandRetraction 이
                // '이미 철회된 요구' 로 보므로, 남은 기간이 에러 없이 소진된다.
                for (const demand of activeDemands(this.store.getAllInvasionDemands())) {
                    this.store.updateInvasionDemand(demand.id, {
                        monthsRemaining: Math.max(0, demand.monthsRemaining - 1),
                    });
                }
                this.store.updateMigrationTribe(u.id, {
                    negotiatedThisMonth: u.negotiatedThisMonth,
                    affinity: u.affinity,
                    settlement: u.settlement,
                });
                if (!u.message) continue;
                this.turnTrace.note(tribe.name, u.message, 'tribe-action');
                console.log(`[Engine] ${u.message}`);
                this.emitEvent({
                    id: `tribe_departed_${u.id}_${this.store.getGlobalState().turnCount}`,
                    type: 'TRIBE_DEPARTED',
                    payload: {
                        tribeId: u.id, tribeName: tribe.name,
                        affinity: u.affinity, abandonedDemandIds: abandoned,
                        message: u.message,
                    },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            const departedCount = tribeUpdates.filter(u => u.departed).length;
            tribeStep.end(departedCount > 0
                ? `이탈 ${departedCount}부족`
                : `교섭 잠금 해제 ${tribeUpdates.length}부족`);
            this.processMonthlyImperialAudience();
            this.processMonthlySieges();
            // 세력 운명 판정 — 멸망/통일/방랑군 재기 [83][213]
            // 무장이 남은 세력은 제거 대신 방랑군으로 전환 — playerFactionId 유효성 보장
            const fateStep = this.turnTrace.step('세력 운명 판정', 'fate');
            const fateReport = this.fateSystem.checkFatesWithVagrantRevival(true);
            for (const v of fateReport.vagrantConversions ?? []) {
                this.turnTrace.note('방랑군 전환', v.factionName, 'fate-action');
                console.log(`[Engine] 방랑군 전환: ${v.factionName} (직속 ${v.keptOfficers}, 이탈 ${v.releasedOfficers})`);
                this.portedMonthlyLog.vagrant.push({ factionName: v.factionName, kind: 'CONVERT', success: true, message: v.message });
                this.emitEvent({
                    id: `vagrant_${v.factionId}_${Date.now()}`,
                    type: 'FACTION_VAGRANT',
                    payload: { factionId: v.factionId, factionName: v.factionName, keptOfficers: v.keptOfficers, releasedOfficers: v.releasedOfficers, message: v.message },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            for (const name of fateReport.destroyedFactionNames) {
                this.turnTrace.note('세력 멸망', name, 'fate-action');
                console.log(`[Engine] 세력 멸망: ${name}`);
                this.emitEvent({
                    id: `faction_destroyed_${Date.now()}`,
                    type: 'FACTION_DESTROYED',
                    payload: { factionName: name },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            if (fateReport.ending) {
                this.emitEvent({
                    id: `game_ending_${Date.now()}`,
                    type: 'GAME_ENDING',
                    payload: { ending: fateReport.ending, winner: fateReport.winnerFactionName },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            // [213] playerFactionId 정합성 — 플레이어 세력 멸망 시 패배 이벤트 발화 (게임오버 트리거)
            if (fateReport.playerFactionDestroyed) {
                console.log('[Engine] 플레이어 세력 멸망 — PLAYER_DEFEAT');
                this.emitEvent({
                    id: `player_defeat_${Date.now()}`,
                    type: 'PLAYER_DEFEAT',
                    payload: { message: fateReport.playerDefeatMessage ?? '플레이어 세력이 멸망했습니다.' },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            fateStep.end(fateReport.ending
                ? `엔딩: ${fateReport.ending}`
                : `방랑 전환 ${fateReport.vagrantConversions?.length ?? 0} · 멸망 ${fateReport.destroyedFactionNames.length}`);
            this.turnTrace.step('시간 경과', 'time')
                .endLazy(() => {
                    this.store.advanceTime();
                    const t = this.store.getGlobalState().time;
                    return `${t.year}년 ${t.month}월`;
                });
            // 지옥 난이도 제약 — 수입 유실/탈영/반란 [X-난이도]
            const hellStep = this.turnTrace.step('지옥 난이도 제약', 'hell');
            const hellReport = processHellConstraints(this.store);
            if (hellReport.taxLeaked > 0) {
                console.log(`[Engine] 지옥: 세수 유실 ${hellReport.taxLeaked}`);
                this.emitEvent({
                    id: `hell_tax_${Date.now()}`,
                    type: 'HELL_CONSTRAINT',
                    payload: { kind: 'TAX_LEAK', amount: hellReport.taxLeaked, message: `⚔️ 전란으로 세수 ${hellReport.taxLeaked}이(가) 유실되었습니다` },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            for (const d of hellReport.deserted) {
                console.log(`[Engine] 지옥: 탈영 ${d.officerName}`);
                this.emitEvent({
                    id: `hell_desert_${d.officerId}_${Date.now()}`,
                    type: 'HELL_CONSTRAINT',
                    payload: { kind: 'DESERTION', officerId: d.officerId, message: `🚪 저충성 무장 ${d.officerName}이(가) 군을 이탈했습니다` },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            for (const r of hellReport.revolted) {
                console.log(`[Engine] 지옥: 반란 ${r.cityName}`);
                this.emitEvent({
                    id: `hell_revolt_${r.cityId}_${Date.now()}`,
                    type: 'HELL_CONSTRAINT',
                    payload: { kind: 'REVOLT', cityId: r.cityId, message: `🔥 치안이 무너진 ${r.cityName}에서 반란이 일어 ${r.fromFactionName}에서 이탈했습니다` },
                    timestamp: Date.now(),
                    turn: this.store.getGlobalState().turnCount,
                });
            }
            // [결함 수정] 턴 중반 유지보수 이벤트(재야 방문/로밍/복수/구출 등)가
            // 다음 턴 시작까지 배출되지 않아 UI가 1턴 늦게 반응하는 문제 해소
            this.turnTrace.step('이벤트 큐 최종 배수', 'event')
                .endLazy(() => {
                    const queued = this.eventQueue.length;
                    this.processEventQueue();
                    return `배수 ${queued}건`;
                });
            hellStep.end(
                `유실 ${hellReport.taxLeaked} · 탈영 ${hellReport.deserted.length}`
                + ` · 반란 ${hellReport.revolted.length}`,
            );
            this.turnTrace.step('턴 종료 (FSM 복귀)', 'fsm')
                .endLazy(() => {
                    // 턴 종료 시 개인 행동 페이즈를 지도 페이즈로 되돌린다.
                    // executeTurn()은 월간 자동 진행이므로 다음 턴의 COUNCIL_START가
                    // 반드시 WORLD_MAP에서 시작되도록 FSM 경계를 닫는다.
                    const wasPersonal = this.currentPhase === GamePhase.PERSONAL_ACTION;
                    if (wasPersonal) this.transition('ACTION_END');
                    return wasPersonal
                        ? `PERSONAL_ACTION → ${GamePhase[this.currentPhase] ?? this.currentPhase}`
                        : `${GamePhase[this.currentPhase] ?? this.currentPhase} 유지`;
                });
            this.turnTrace.endTurn();
            console.log('[Engine] === Turn end ===');
            console.log(`[Engine] 턴 트레이스:\n${this.turnTrace.toText(2)}`);
        } finally {
            this.isProcessingTurn = false;
        }
    }

    private resetTurnFlags(): void {
        const officers = this.store.getAllOfficers();
        for (const officer of officers) {
            this.store.updateOfficer(officer.id, {
                hasActedThisTurn: false,
                actionPoints: officer.maxActionPoints,
            });
        }
    }

    // ============================================================
    // AI 스트리밍 턴 [201][121-130] — Worker 우선 + 메인 스레드 폴백
    // ============================================================

    /**
     * Worker 스트리밍 AI 엔진으로 월간 AI 턴을 실행한다 (AGENTS.md §7).
     *
     * - Worker 가능 환경: AIStreamManager가 1,000명 무장을 세력 단위로 분할 연산하고,
     *   각 배치가 도착하는 대로 즉시 커맨드로 변환한다 (스트리밍 반영).
     * - Worker 불가/오류 (Node 테스트, 구형 브라우저): 기존 TurnScheduler 폴백.
     *
     * @returns 소비된 총 결정 수 (스트리밍 + 폴백 합산)
     */
    private async executeAITurnWithStreaming(
        onProgress?: (progress: SchedulerProgress) => void,
    ): Promise<AIDecision[]> {
        this.streamTurnCompleted = false;
        // Worker 미지원 환경 (Node 테스트 등) — 폴백 직행
        if (typeof Worker === 'undefined') {
            return this.lifecycleManager.executeAITurn(onProgress);
        }

        // 지연 스폰 — 첫 턴에만 생성
        if (!this.aiStream) {
            this.aiStream = new AIStreamManager({
                onFactionUpdate: (batch) => this.applyStreamedBatch(batch),
                onError: (msg) => console.warn(`[AIStream] ${msg}`),
            });
        }

        // 이미 워커가 죽어 있으면 폴백
        if (this.streamFailed) {
            return this.lifecycleManager.executeAITurn(onProgress);
        }

        try {
            const snapshot = AIStreamManager.buildSnapshot(
                this.store as never,
                this.store.getGlobalState().playerFactionId,
            );
            this.streamBatchCount = 0;
            await this.aiStream.startMonthlyTurn(snapshot);
            this.streamTurnCompleted = true;
            console.log(`[Engine] Streaming AI batches: ${this.streamBatchCount}`);
            // 스트리밍 경로에서는 결정이 배치 도착 시점에 이미 소비됨
            return [];
        } catch {
            // 워커 스폰/통신 실패 — 이후 턴부터는 폴백 고정
            this.streamFailed = true;
            this.aiStream.terminate();
            this.aiStream = null;
            return this.lifecycleManager.executeAITurn(onProgress);
        }
    }

    /** 스트리밍 배치 → 커맨드 즉시 변환 [201] */
    private applyStreamedBatch(batch: FactionDecisionBatch): void {
        this.streamBatchCount += 1;
        for (const decision of batch.decisions) {
            this.convertDecisionToCommand(decision);
        }
    }

    private convertDecisionToCommand(decision: AIDecision): void {
        const officerId = decision.officerId;
        const gs = this.store.getGlobalState();
        const officer = this.store.getOfficer(officerId);
        // Worker/폴백 결정은 신뢰할 수 없는 외부 입력과 동일하게 검증한다.
        // 플레이어 세력과 이미 행동한 무장은 큐에 중복 등록하지 않는다. [201][49]
        if (!officer || !officer.factionId || officer.factionId === gs.playerFactionId || officer.hasActedThisTurn) {
            return;
        }

        const payload = decision.payload;
        const stringPayload = (key: string): string | null => typeof payload[key] === 'string' ? payload[key] as string : null;
        // 스트리밍 시뮬레이터는 targetCityId, 기존 AIDecisionEngine은 cityId를 사용한다.
        const targetCityId = stringPayload('cityId') ?? stringPayload('targetCityId');
        const targetFactionId = stringPayload('targetFactionId');
        const turn = gs.turnCount;
        let command: ICommand | null = null;

        switch (decision.actionType) {
            case 'DOMESTIC': {
                const city = targetCityId ? this.store.getCity(targetCityId) : null;
                if (city && city.ownerId === officer.factionId && officer.cityId === city.id) {
                    command = new DomesticCommand(officerId, city.id, stringPayload('facilityType') ?? 'FARM', turn);
                }
                break;
            }
            case 'TRAINING': {
                const statKey = stringPayload('statKey');
                if (statKey && ['leadership', 'might', 'intelligence', 'politics', 'charisma'].includes(statKey)) {
                    command = new TrainingCommand(officerId, statKey as 'leadership' | 'might' | 'intelligence' | 'politics' | 'charisma', turn);
                }
                break;
            }
            case 'RECRUITMENT': {
                const targetOfficerId = stringPayload('targetOfficerId');
                if (targetOfficerId) {
                    command = new RecruitmentCommand(officerId, targetOfficerId, turn);
                } else if (targetCityId) {
                    command = new CityRecruitmentCommand(officerId, targetCityId, turn);
                }
                break;
            }
            case 'MOVEMENT': {
                const fromCityId = stringPayload('fromCityId');
                const toCityId = stringPayload('toCityId');
                if (fromCityId && toCityId && fromCityId !== toCityId && officer.cityId === fromCityId) {
                    command = new MovementCommand(officerId, fromCityId, toCityId, turn);
                }
                break;
            }
            case 'BATTLE': {
                // 스트리밍 AI는 목표 도시 ID를, 기존 결정 엔진은 적 세력 ID를 보낸다.
                const target = targetCityId ? this.store.getCity(targetCityId) : targetFactionId
                    ? this.store.getAllCities().find(c => c.ownerId === targetFactionId) ?? null
                    : null;
                const attackerFaction = this.store.getFaction(officer.factionId);
                const atWar = !!target?.ownerId && !!attackerFaction && (
                    attackerFaction.diplomacy[target.ownerId]?.treaty === 'WAR'
                    || this.diplomacy.getRelation(officer.factionId, target.ownerId) === FactionRelation.WAR
                );
                if (target && atWar && officer.cityId && target.id !== officer.cityId && target.ownerId !== officer.factionId) {
                    command = new BattleCommand(officerId, officer.cityId, target.id, turn);
                }
                break;
            }
            case 'DIPLOMACY': {
                const validActions: DiplomacyAction[] = ['ALLIANCE', 'BREAK_ALLIANCE', 'DECLARE_WAR', 'PEACE', 'GIFT'];
                const explicitAction = stringPayload('action');
                const domainTreaty = targetFactionId ? this.store.getFaction(officer.factionId)?.diplomacy[targetFactionId]?.treaty : undefined;
                const engineRelation = targetFactionId
                    ? this.diplomacy.getRelation(officer.factionId, targetFactionId)
                    : undefined;
                const action = explicitAction && validActions.includes(explicitAction as DiplomacyAction)
                    ? explicitAction as DiplomacyAction
                    : domainTreaty === 'WAR' || engineRelation === FactionRelation.WAR ? 'PEACE'
                        : domainTreaty === 'ALLIANCE' || engineRelation === FactionRelation.ALLIANCE ? 'GIFT'
                            : 'ALLIANCE';
                if (targetFactionId && targetFactionId !== officer.factionId && this.store.getFaction(targetFactionId)) {
                    command = new DiplomacyCommand(officerId, targetFactionId, action, turn);
                }
                break;
            }
            case 'REST':
                command = new RestCommand(officerId, turn);
                break;
            // 사회·탐색 등 전용 커맨드가 없는 결정은 잘못된 REST로 변환하지 않고 폐기한다.
            default:
                command = null;
        }

        if (command) {
            this.enqueueCommand(command);
            this.store.updateOfficer(officerId, { hasActedThisTurn: true });
        }
    }

    /**
     * 연의전 이벤트 체인 월간 스캔/발동 [300][106-114]
     *
     * 1) 큐에 등록된 체인 노드를 조건 평가 후 활성화 → GameEvent 발화 + 연대기 기록
     * 2) HistoricalEventSystem(삼고초려/관도/적벽 등) 조건 검사 → 발동 시 GameEvent 발화
     * 3) 발동한 역사 이벤트를 분기 트리거 조건으로 삼아 사실/가상 분기 활성화
     */
    private processEventChainMonthly(): void {
        const gs = this.store.getGlobalState();
        const turn = gs.turnCount;

        // 평가 컨텍스트 — 스토어 스냅샷 구성 [300]
        const warlords = new Map<string, { status: 'alive' | 'dead'; factionId: string | null; cityId: string | null }>();
        for (const o of this.store.getAllOfficers()) {
            warlords.set(o.id, {
                status: 'alive',
                factionId: o.factionId,
                cityId: o.cityId,
            });
        }
        const factionLeaders = new Map<string, string>();
        for (const faction of this.store.getAllFactions()) {
            factionLeaders.set(faction.id, faction.leaderId);
        }

        const ctx: EvaluationContext = {
            currentYear: gs.time.year,
            currentTurn: turn,
            warlords,
            factionLeaders,
            getAffinity: (officerId) => {
                const edges = this.store.getRelationships(officerId);
                return edges.length > 0 ? edges[0].affinity : 0;
            },
            getOfficerCity: (officerId) => warlords.get(officerId)?.cityId ?? null,
        };

        // 1) 이벤트 체인 큐 스캔/활성화 [300]
        const activated = this.eventEngine.scanAndActivate(ctx);
        for (const node of activated) {
            console.log(`[EventChain] ${node.eventId}: ${node.result.eventName}`);
            this.chronicle.add('HISTORICAL', node.result.eventName);
            this.emitEvent({
                id: `event_chain_${node.eventId}_${Date.now()}`,
                type: 'HISTORICAL_EVENT',
                payload: {
                    eventId: node.eventId,
                    eventName: node.result.eventName,
                    dialogueLines: node.result.dialogueLines,
                },
                timestamp: Date.now(),
                turn,
            });
            // 연쇄 이벤트 — 체인상 다음 노드를 큐에 적재
            const next = this.eventEngine.getNextChainEvent(node.eventId);
            if (next) this.eventEngine.queueMgr.enqueue(next);
        }

        // 2) 역사 이벤트 조건 검사 [106-114]
        const officerStatus = new Map<string, boolean>();
        for (const o of this.store.getAllOfficers()) {
            officerStatus.set(o.id, true); // removeOfficer 시 목록에서 사라지므로 존재 = 생존
        }
        const factionStatus = new Map<string, boolean>();
        for (const f of this.store.getAllFactions()) {
            factionStatus.set(f.id, true);
        }
        const fired = this.historicalEvents.checkEvents(gs.time.year, gs.time.month, officerStatus, factionStatus);
        const firedIds: string[] = [];
        for (const ev of fired) {
            firedIds.push(ev.id);
            console.log(`[EventChain] 역사 이벤트: ${ev.title}`);
            this.chronicle.add('HISTORICAL', `${ev.title} — ${ev.description}`);
            this.emitEvent({
                id: `historical_${ev.id}_${Date.now()}`,
                type: 'HISTORICAL_EVENT',
                payload: { eventId: ev.id, eventName: ev.title, description: ev.description, source: 'historical' },
                timestamp: Date.now(),
                turn,
            });
        }

        // 3) 발생 이벤트 기반 시나리오 분기 활성화 [106-114]
        if (firedIds.length > 0) {
            const firedSet = new Set<string>(firedIds);
            for (const branch of this.scenarioBranches.getAvailableBranches(firedSet)) {
                if (this.scenarioBranches.activateBranch(branch.branchId, this.eventEngine)) {
                    console.log(`[EventChain] 분기 활성화: ${branch.branchId} (${branch.branchType})`);
                }
            }
        }
    }

    private static readonly OFFICER_SALARY = 15;
    private static readonly CITY_UPKEEP = 10;
    private static readonly ARMY_UPKEEP_PER_SOLDIER = 2;
    private static readonly FOOD_UPKEEP_BASE = 60;
    private static readonly FOOD_UPKEEP_PER_OFFICER = 15;
    private static readonly FOOD_UPKEEP_PER_CITY = 40;

    /**
     * 월 세출 [C-2] — processCitySecurityMonthly의 `food <= 0` 아사 판정을
     * 실제로 발동시키기 위한 지출선. 수입만 있고 이 지출이 없으면 굶주림이
     * 영영 불가능해진다. 상수를 임의 튜닝값으로 보고 지우면 그 버그가 되살아난다.
     */
    /** 요충지 포위 월간 진행 — 개월 감소, 수비군 감소, 성공/파산 판정. */
    private processMonthlySieges(): void {
        const sieges = this.store.getAllSieges();
        if (sieges.length === 0) return;
        const step = this.turnTrace.step('요충지 포위 진행', 'siege');
        const turn = this.store.getGlobalState().turnCount;
        for (const operation of sieges) {
            const feature = this.store.getMapFeature(operation.featureId);
            if (!feature) {
                this.store.clearSiege(operation.factionId);
                continue;
            }
            const before = feature.ownerId;
            const result = advanceSiege(operation, feature, turn);
            this.store.updateMapFeature(feature.id, result.feature);
            if (result.status === 'ACTIVE') {
                this.store.setSiege(result.operation);
            } else {
                this.store.clearSiege(operation.factionId);
            }
            this.turnTrace.note(feature.name, result.message, 'siege-action');
            console.log(`[Engine] ${result.message}`);
            this.emitEvent({
                id: `feature_siege_${feature.id}_${turn}`,
                type: 'MAP_FEATURE_SIEGE',
                payload: {
                    featureId: feature.id, featureName: feature.name,
                    factionId: operation.factionId, status: result.status,
                    previousOwnerId: before, newOwnerId: result.feature.ownerId,
                    message: result.message,
                },
                timestamp: Date.now(),
                turn,
            });
        }
        step.end(`포위 ${sieges.length}건 진행`);
    }

    private processMonthlyImperialAudience(): void {
        const step = this.turnTrace.step('황제 임무 월간', 'audience');
        const court = this.store.getImperialCourt();
        const turn = this.store.getGlobalState().turnCount;
        const activeId = court?.activeMissionId ?? null;
        const active = activeId ? court?.missions[activeId] : null;
        if (!active || active.status !== 'ACTIVE') {
            step.end(court ? '진행 중인 임무 없음' : '황제 미설정');
            return;
        }

        const officer = this.store.getOfficer(active.officerId);
        if (!officer || !officer.runtime.isAlive) {
            this.store.updateAudienceMission(active.id, { status: 'FAILED' });
            this.store.updateImperialCourt({ activeMissionId: null, lastAudienceTurn: turn });
            step.end('담당 무장 사망으로 실패');
            return;
        }

        const expiry = checkMissionExpiry(active, turn);
        const advanced = advanceMission(expiry.mission, monthlyProgress(officer, active.kind));
        this.store.updateAudienceMission(active.id, advanced.mission);

        if (advanced.succeeded) {
            const reward = computeAudienceReward(officer, advanced.mission);
            this.store.updateOfficer(officer.id, { rank: reward.rank });
            const faction = officer.factionId ? this.store.getFaction(officer.factionId) : null;
            if (faction) this.store.updateFaction(faction.id, { gold: faction.gold + reward.gold });
            this.store.updateImperialCourt({ activeMissionId: null, lastAudienceTurn: turn });
            console.log(`[Engine] ${reward.message}`);
            this.emitEvent({
                id: `imperial_mission_succeeded_${active.id}_${turn}`,
                type: 'IMPERIAL_MISSION_SUCCEEDED',
                payload: {
                    officerId: officer.id, officerName: officer.name,
                    kind: active.kind, rank: reward.rank, promoted: reward.promoted,
                    gold: reward.gold, message: reward.message,
                },
                timestamp: Date.now(),
                turn,
            });
            step.end(`성공 · ${officer.name} 관직 ${reward.rank} · ${reward.gold}金`);
            return;
        }

        if (expiry.expired) {
            this.store.updateImperialCourt({ activeMissionId: null, lastAudienceTurn: turn });
            console.log(`[Engine] ${expiry.message} (${officer.name})`);
            step.end(`기한 만료 · ${officer.name}`);
            return;
        }

        step.end(`${officer.name} 진척 ${advanced.mission.progress}/${advanced.mission.targetAmount}`);
    }

    private processMonthlyUpkeep(): void {
        const factions = this.store.getAllFactions();
        for (const faction of factions) {
            const cities = this.store.getCitiesByFaction(faction.id);
            const officerCount = faction.officers.length;
            const cityCount = cities.length;
            let soldierCount = 0;
            for (const armyId of faction.armies) {
                const army = this.store.getArmy(armyId);
                if (army) soldierCount += army.soldiers;
            }

            const goldUpkeep =
                officerCount * GameEngine.OFFICER_SALARY +
                cityCount * GameEngine.CITY_UPKEEP +
                soldierCount * GameEngine.ARMY_UPKEEP_PER_SOLDIER;
            const foodUpkeep =
                GameEngine.FOOD_UPKEEP_BASE +
                officerCount * GameEngine.FOOD_UPKEEP_PER_OFFICER +
                cityCount * GameEngine.FOOD_UPKEEP_PER_CITY +
                soldierCount;

            if (goldUpkeep === 0 && foodUpkeep === 0) continue;
            this.store.updateFaction(faction.id, {
                gold: faction.gold - goldUpkeep,
                food: faction.food - foodUpkeep,
            });
        }
    }

    private processMonthlyMaintenance(): void {
        const factions = this.store.getAllFactions();
        for (const faction of factions) {
            const cities = this.store.getCitiesByFaction(faction.id);
            const goldIncome = cities.reduce((sum, c) => sum + c.goldIncome, 0);
            const foodIncome = cities.reduce((sum, c) => sum + c.foodIncome, 0);
            this.store.updateFaction(faction.id, {
                gold: faction.gold + goldIncome,
                food: faction.food + foodIncome,
            });
            // 도시 자금에 월 수입 유입 [E1-361: 거시 경제] — 내정 재원 순환
            // 1) 발전도 연동 수입 재계산: 상업↑ → goldIncome↑, 농업↑ → foodIncome↑
            // 2) 상업 수익(골드 수입의 3배)은 도시 자금에 직접 귀속, 전액은 세력 국고로도 입금
            //    → 개발(상업+)할수록 다음 달 수입이 늘어나는 선순환
            for (const c of cities) {
                const ds = c.developmentStats;
                // 발전도 성장분: 매월 상업+3, 농업+2 자연 성장 (개발 투자 시 추가)
                const grownCommerce = Math.min(ds.maxCommerce, ds.commerce + 3);
                const grownFarming = Math.min(ds.maxFarming, ds.farming + 2);
                const grownGoldIncome = 90 + Math.floor(grownCommerce);
                this.store.updateCity(c.id, {
                    goldIncome: grownGoldIncome,
                    foodIncome: 200 + Math.floor(grownFarming * 2.62),
                    developmentStats: { ...ds, commerce: grownCommerce, farming: grownFarming },
                    funds: c.funds + grownGoldIncome * 3,
                });
            }
        }

        const officers = this.store.getAllOfficers();
        const currentYear = this.store.getGlobalState().time.year;
        for (const officer of officers) {
            if (officer.deathYear && currentYear >= officer.deathYear) {
                console.log(`[Engine] ${officer.name} died (lifespan)`);
                const gs = this.store.getGlobalState();
                const age = currentYear - officer.birthYear;
                this.store.removeOfficer(officer.id);
                this.emitEvent({
                    id: `death_${officer.id}`,
                    type: 'OFFICER_DEATH',
                    payload: {
                        officerId: officer.id,
                        officerName: officer.name,
                        cause: 'OLD_AGE',
                        age,
                        year: currentYear,
                        turn: gs.turnCount,
                        factionId: officer.factionId,
                    },
                    timestamp: Date.now(),
                    turn: gs.turnCount,
                });
            }
        }
    }

    /**
     * 도시 안정 월간 판정 [148] — 민란 위험도 진정, 아사(군량부족) 소모, 민란 발생
     *
     * Python city_manager.py의 process_turn 포팅:
     * 1) 세력 군량 0이면 소속 도시 전체 아사 — 병력 5% 소모 + 위험도 +15
     * 2) 월말 위험도 자연 감소 (치안 비례)
     * 3) 위험도 ≥ 100 && 치안 억제 실패 시 민란 — 도시 소속 이탈 (무주화)
     */
    private processCitySecurityMonthly(): void {
        const turn = this.store.getGlobalState().turnCount;
        const gs = this.store.getGlobalState();
        for (const faction of this.store.getAllFactions()) {
            if (faction.gold >= 0) this.bankruptWarned.delete(faction.id);
        }

        for (const city of this.store.getAllCities()) {
            if (!city.ownerId) continue;
            let sec = this.citySecurityStates.get(city.id);
            if (!sec) {
                sec = { cityId: city.id, riotRisk: 0, publicOrder: city.developmentStats.publicOrder };
                this.citySecurityStates.set(city.id, sec);
            }
            sec.publicOrder = city.developmentStats.publicOrder;

            // 1) 아사 판정 — 세력 군량 고갈 시 병력 5% 소모 [148]
            const faction = this.store.getFaction(city.ownerId);
            if (faction && faction.food <= 0) {
                const before = city.development;
                const result = processStarvation(sec, 0, before);
                if (result.starveLoss > 0) {
                    this.store.updateCity(city.id, { development: result.soldiersAfter });
                    this.securityMonthlyLog.starvations.push({
                        cityId: city.id,
                        cityName: city.name,
                        losses: result.starveLoss,
                    });
                    console.log(`[Security] ${city.name} 아사 — 병력 ${result.starveLoss} 소모 (군량 부족)`);
                    this.chronicle.add('HISTORICAL', `${city.name}에서 굶주림으로 병력 ${result.starveLoss}이 죽었다`);
                    this.emitEvent({
                        id: `starvation_${city.id}_${Date.now()}`,
                        type: 'CITY_STARVATION',
                        payload: { cityId: city.id, cityName: city.name, losses: result.starveLoss, factionId: city.ownerId },
                        timestamp: Date.now(),
                        turn,
                    });
                }
            }

            // 1b) 월세 미납 [C-3] — 파산 세력은 도시마다 위험도가 오른다 [148]
            if (faction && faction.gold < 0) {
                accumulateUnpaidWages(sec);
                if (!this.bankruptWarned.has(faction.id)) {
                    this.bankruptWarned.add(faction.id);
                    this.chronicle.add('HISTORICAL', `${faction.name}가 월세를 내지 못해 ${city.name}에서 민심이 샜다`);
                    this.emitEvent({
                        id: `bankrupt_${faction.id}_${turn}`,
                        type: 'FACTION_BANKRUPT',
                        payload: { factionId: faction.id, factionName: faction.name, gold: faction.gold, turn },
                        timestamp: Date.now(),
                        turn,
                    });
                }
            }

            // 2) 위험도 자연 감소 (치안 비례)
            decayRiotRisk(sec, city.developmentStats.publicOrder);

            // 3) 민란 판정 [148] — roll 주입으로 테스트 결정론 보장
            const outcome = checkRiot(sec, city.ownerId, this.riotRollOverride() ?? Math.random());
            if (outcome.occurred) {
                // 민란 — 도시 소속 이탈 (무주화)
                this.store.updateCity(city.id, { ownerId: null });
                this.securityMonthlyLog.riots.push({
                    cityId: city.id,
                    cityName: city.name,
                    fromFactionId: outcome.fromFactionId ?? null,
                });
                console.log(`[Security] ${city.name} ${outcome.message}`);
                this.chronicle.add('DESTROYED', `${city.name}에서 민란이 일어나 도시가 소속 세력에서 이탈했다`);
                this.emitEvent({
                    id: `riot_${city.id}_${Date.now()}`,
                    type: 'CITY_RIOT',
                    payload: { cityId: city.id, cityName: city.name, fromFactionId: outcome.fromFactionId, turn },
                    timestamp: Date.now(),
                    turn,
                });
            }
        }
        void gs;
    }

    /**
     * 이번 달 도시 안정 동향 peek [148] — 월간 보고서용. consume=true면 읽 후 비운다.
     */
    peekMonthlySecurityLog(consume = false): {
        riots: Array<{ cityId: string; cityName: string; fromFactionId: string | null }>;
        starvations: Array<{ cityId: string; cityName: string; losses: number }>;
    } {
        const snapshot = {
            riots: [...this.securityMonthlyLog.riots],
            starvations: [...this.securityMonthlyLog.starvations],
        };
        if (consume) {
            this.securityMonthlyLog.riots = [];
            this.securityMonthlyLog.starvations = [];
        }
        return snapshot;
    }

    /**
     * 포팅 시스템 월간 훅 [76-85][321-340][341-360][421-438]
     * 1) 전략 명령 진행 — 출진/수송 큐 처리 및 완료 이벤트 발화
     * 2) 첩보망 유지비 — 레벨 1 소모, 미유지 시 붕괴 이벤트
     * 3) 지역 기후 전이 — 계절 기반 날씨 전이 및 수확 보정 반영
     * 4) 고령 무장 은퇴 — 60세 도달 무장 은퇴 기록
     */
    private processPortedSystemsMonthly(): void {
        const turn = this.store.getGlobalState().turnCount;

        // 1) 전략 명령 진행 [76-79]
        const { campaignsCompleted, transportsCompleted } = this.strategicCommand.processTurn(turn);
        for (const campaign of campaignsCompleted) {
            const leader = this.store.getOfficer(campaign.army.leaderId);
            this.portedMonthlyLog.campaigns.push({
                targetCity: campaign.targetCity,
                leaderName: leader?.name ?? campaign.army.leaderId,
                soldiers: campaign.army.soldiers,
            });
            this.emitEvent({
                id: `campaign_${campaign.targetCity}_${Date.now()}`,
                type: 'CAMPAIGN_ORDER_COMPLETED',
                payload: { targetCityId: campaign.targetCity, leaderId: campaign.army.leaderId, soldiers: campaign.army.soldiers },
                timestamp: Date.now(),
                turn,
            });
        }
        for (const t of transportsCompleted) {
            this.portedMonthlyLog.transports.push({
                fromCity: t.fromCity,
                toCity: t.toCity,
                gold: t.gold,
                food: t.food,
                soldiers: t.soldiers,
            });
            this.emitEvent({
                id: `transport_${t.toCity}_${Date.now()}`,
                type: 'TRANSPORT_COMPLETED',
                payload: { fromCityId: t.fromCity, toCityId: t.toCity, gold: t.gold, food: t.food, soldiers: t.soldiers },
                timestamp: Date.now(),
                turn,
            });
        }

        // 2) 첩보망 유지비 [346] — 월간 레벨 1 소모
        for (const n of this.intelligenceManager.getAllNetworks()) {
            const survived = this.intelligenceManager.decayNetworks(n.factionId, n.cityId, 1);
            if (!survived) {
                this.portedMonthlyLog.collapsedNetworks.push({ factionId: n.factionId, cityId: n.cityId });
                this.emitEvent({
                    id: `intel_collapse_${n.factionId}_${n.cityId}_${Date.now()}`,
                    type: 'INTELLIGENCE_NETWORK_COLLAPSED',
                    payload: { factionId: n.factionId, cityId: n.cityId },
                    timestamp: Date.now(),
                    turn,
                });
            }
        }

        // 3) 지역 기후 전이 [321-340] — 계절 기반 날씨 전이
        const month = this.store.getGlobalState().time.month;
        const season = month >= 3 && month <= 5 ? 'SPRING'
            : month >= 6 && month <= 8 ? 'SUMMER'
            : month >= 9 && month <= 11 ? 'AUTUMN' : 'WINTER';
        const seasonWeather: Record<string, WeatherType[]> = {
            SPRING: ['SUNNY', 'CLOUDY', 'RAIN'],
            SUMMER: ['SUNNY', 'HEATWAVE', 'STORM'],
            AUTUMN: ['SUNNY', 'CLOUDY', 'FOG'],
            WINTER: ['SNOW', 'CLOUDY'],
        };
        const seasonTemp: Record<string, number> = { SPRING: 16, SUMMER: 30, AUTUMN: 14, WINTER: -2 };
        for (const c of this.climateManager.getAllClimates()) {
            const pool = seasonWeather[season];
            const weather = pool[Math.floor(Math.random() * pool.length)];
            const updated = this.climateManager.updateClimate(c.regionId, weather, seasonTemp[season]);
            if (updated && updated.harvestModifier < 1.0) {
                // 악천후 수확 보정을 도시 소속 세력에 반영 — 군량 차감
                for (const city of this.store.getAllCities()) {
                    if (city.ownerId) {
                        const faction = this.store.getFaction(city.ownerId);
                        if (faction) {
                            const penalty = Math.round((1.0 - updated.harvestModifier) * 50);
                            if (penalty > 0) {
                                this.store.updateFaction(faction.id, { food: Math.max(0, faction.food - penalty) });
                            }
                        }
                    }
                }
            }
        }

        // 4) 고령 무장 은퇴 [434] — 60세 도달 시 은퇴 기록
        const year = this.store.getGlobalState().time.year;
        for (const officer of this.store.getAllOfficers()) {
            const age = year - officer.birthYear;
            if (this.lifeSimulator.canRetire(officer.id, age)) {
                this.lifeSimulator.retire(officer.id, year);
                this.portedMonthlyLog.retired.push({ officerName: officer.name, age });
                this.emitEvent({
                    id: `retire_${officer.id}_${Date.now()}`,
                    type: 'OFFICER_RETIRED',
                    payload: { officerId: officer.id, officerName: officer.name, age, year },
                    timestamp: Date.now(),
                    turn,
                });
            }
        }

        // 5) 방랑군 재기 행동 [83][421-440] — 재야 등용 + 도시 습격 → 재기(FACTION_REVIVED) 경로
        const vagrantResults = processVagrantMonthlyActions(this.store);
        for (const r of vagrantResults) {
            console.log(`[Engine] 방랑군: ${r.message}`);
            this.portedMonthlyLog.vagrant.push({
                factionName: r.factionName,
                kind: r.kind === 'RAID' ? 'RAID' : 'RECRUIT',
                success: r.success,
                message: r.message,
            });
            this.emitEvent({
                id: `vagrant_action_${r.factionId}_${r.kind}_${Date.now()}`,
                type: r.kind === 'RAID' && r.success ? 'FACTION_REVIVED' : 'VAGRANT_ACTION',
                payload: {
                    factionId: r.factionId,
                    factionName: r.factionName,
                    kind: r.kind,
                    success: r.success,
                    capturedCityId: r.capturedCityId ?? null,
                    recruitedOfficerId: r.recruitedOfficerId ?? null,
                    message: r.message,
                },
                timestamp: Date.now(),
                turn,
            });
        }
    }

    /**
     * 이번 달 포팅 시스템 동향 peek [76-85][321-340][341-360][421-438]
     * 월간 보고서(MonthlyReportSystem)가 호출. consume=true면 읽 후 버퍼를 비운다.
     */
    peekMonthlyPortedLog(consume = false): {
        campaigns: Array<{ targetCity: string; leaderName: string; soldiers: number }>;
        transports: Array<{ fromCity: string; toCity: string; gold: number; food: number; soldiers: number }>;
        collapsedNetworks: Array<{ factionId: string; cityId: string }>;
        retired: Array<{ officerName: string; age: number }>;
        captives: Array<{ officerId: string; officerName: string; decision: 'RECRUIT' | 'EXECUTE' | 'RELEASE'; success: boolean; message: string }>;
        vagrant: Array<{ factionName: string; kind: 'CONVERT' | 'RECRUIT' | 'RAID'; success: boolean; message: string }>;
    } {
        const snapshot = {
            campaigns: [...this.portedMonthlyLog.campaigns],
            transports: [...this.portedMonthlyLog.transports],
            collapsedNetworks: [...this.portedMonthlyLog.collapsedNetworks],
            retired: [...this.portedMonthlyLog.retired],
            captives: [...this.portedMonthlyLog.captives],
            vagrant: [...this.portedMonthlyLog.vagrant],
        };
        if (consume) {
            this.portedMonthlyLog.campaigns = [];
            this.portedMonthlyLog.transports = [];
            this.portedMonthlyLog.collapsedNetworks = [];
            this.portedMonthlyLog.retired = [];
            this.portedMonthlyLog.captives = [];
            this.portedMonthlyLog.vagrant = [];
        }
        return snapshot;
    }

    private processWeatherEffect(): void {
        const gs = this.store.getGlobalState();
        if (gs.weather === 'STORM' || gs.weather === 'SNOW') {
            console.log(`[Engine] Weather: ${gs.weather}`);
            const officers = this.store.getAllOfficers();
            for (const officer of officers) {
                this.store.updateOfficer(officer.id, {
                    stamina: Math.max(0, officer.stamina - 5),
                });
            }
        }
    }

    emitEvent(event: GameEvent): void {
        // [결함 수정] 큐에 넣고 리스너를 즉시 발화하면 processEventQueue에서
        // 동일 이벤트가 2회 dispatch되었다 (유령 로그/이중 자동 저장의 원인).
        // 큐잉만 하고 processEventQueue에서 단일 발화하도록 변경.
        this.eventQueue.push(event);
    }

    subscribe(eventType: string, listener: EventListener): () => void {
        if (!this.eventListeners.has(eventType)) {
            this.eventListeners.set(eventType, new Set());
        }
        this.eventListeners.get(eventType)!.add(listener);
        return () => this.eventListeners.get(eventType)?.delete(listener);
    }

    private processEventQueue(): void {
        while (this.eventQueue.length > 0) {
            const event = this.eventQueue.shift();
            if (!event) continue;
            const listeners = this.eventListeners.get(event.type);
            if (listeners) {
                for (const listener of listeners) {
                    // [결함 방지] 리스너는 UI(main.ts) 를 포함해 외부에서 등록된다.
                    // 여기서 던진 예외가 executeTurn 전체를 중단시켜 그 달 처리와
                    // 남은 이벤트 발화가 함께 사라진다 — 실제로 FREE_OFFICER_VISIT
                    // payload 결손으로 턴이 멈췄던 사례가 있다.
                    // 리스너 하나가 죽어도 나머지와 남은 이벤트는 계속 처리한다.
                    try {
                        listener(event);
                    } catch (err) {
                        console.error(`[Engine] 이벤트 리스너 실패 (${event.type}) — 나머지 처리를 계속합니다`, err);
                    }
                }
            }
        }
    }

    getPendingEvents(): GameEvent[] { return [...this.eventQueue]; }

    private initWorker(): void {
        if (typeof Worker === 'undefined') {
            console.warn('[Engine] Web Worker not supported - fallback');
            return;
        }
        try {
            this.worker = new Worker(new URL('./ai_worker.js', import.meta.url), { type: 'module' });
            this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
                const response = e.data;
                const pending = this.workerPromises.get(response.id);
                if (pending) {
                    if (response.success) {
                        pending.resolve(response.result);
                    } else {
                        pending.reject(new Error(response.error ?? 'Unknown worker error'));
                    }
                    this.workerPromises.delete(response.id);
                }
            };
            this.worker.onerror = (err) => {
                console.error('[Engine] Worker error:', err);
            };
        } catch (err) {
            console.warn('[Engine] Worker init failed, fallback:', err);
            this.worker = null;
        }
    }

    async requestAIWorker(payload: AIWorkerPayload): Promise<AIWorkerResult> {
        if (!this.worker) {
            return this.localAIProcessing(payload);
        }

        const request: WorkerRequest = {
            id: `ai_req_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            type: 'AI_DECISION',
            payload: payload as unknown as Record<string, unknown>,
        };

        return new Promise((resolve, reject) => {
            this.workerPromises.set(request.id, {
                resolve: (v) => resolve(v as AIWorkerResult),
                reject,
            });
            this.worker!.postMessage(request);
        });
    }

    private async localAIProcessing(payload: AIWorkerPayload): Promise<AIWorkerResult> {
        const decisions: AIDecision[] = [];
        for (const officerId of payload.officerIds) {
            const officer = payload.stateSnapshot.officers[officerId];
            if (!officer) continue;
            decisions.push({
                officerId,
                actionType: officer.actionPoints < 20 ? 'REST' : 'DOMESTIC',
                priority: 0.5,
                reasoning: 'Local fallback decision',
                payload: { cityId: officer.cityId ?? '' },
            });
        }
        return { decisions };
    }

    terminateWorker(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.workerPromises.clear();
        // 스트리밍 AI 워커도 함께 정리 [201]
        this.aiStream?.terminate();
        this.aiStream = null;
    }

    /** 외교 엔진 접근자 (UI/AI 용) [70-73] */
    get diplomacyEngine(): DiplomacyEngine {
        return this.diplomacy;
    }

    /**
     * 플레이어 도시 습격 커맨드 [83] — 전략 포인트 30 소비 후 습격 판정.
     * 플레이어 세력이 방랑군일 때만 가능. 성공 시 FACTION_REVIVED 이벤트.
     */
    playerRaidCity(targetCityId: CityID): { success: boolean; message: string } {
        const gs = this.store.getGlobalState();
        const pf = gs.playerFactionId;
        const faction = pf ? this.store.getFaction(pf) : null;
        if (!faction) return { success: false, message: '세력을 찾을 수 없습니다.' };
        if (!faction.isVagrant) return { success: false, message: '습격은 방랑군 상태에서만 가능합니다.' };
        if (!this.strategicCommand.orderRaid()) {
            return { success: false, message: `전략 포인트가 부족합니다 (필요 30, 현재 ${this.strategicCommand.getStrategyPoints()}).` };
        }
        const outcome = resolvePlayerRaid(this.store, pf!, targetCityId);
        this.emitEvent({
            id: `player_raid_${targetCityId}_${Date.now()}`,
            type: outcome.success ? 'FACTION_REVIVED' : 'VAGRANT_ACTION',
            payload: {
                factionId: pf,
                factionName: faction.name,
                kind: 'RAID',
                success: outcome.success,
                capturedCityId: outcome.capturedCityId ?? null,
                message: outcome.message,
            },
            timestamp: Date.now(),
            turn: gs.turnCount,
        });
        return outcome;
    }

    save(): {
        state: NormalizedState; globalState: GlobalState; commands: SerializedCommand[];
        diplomacy: Array<{ a: string; b: string; relation: string }>;
        chronicle?: import('./chronicle_system.js').ChronicleEntry[];
        /** 전투·포로·외교 실행/복구 이벤트 — 세이브 델타 및 리플레이 [312] */
        commandReplayLog?: ReplayCommandEvent[];
        /** 포팅 시스템 스냅샷 [76-85][321-340][341-360][421-438][431-432][441-460] */
        ported?: {
            strategic: ReturnType<StrategicCommandManager['serialize']>;
            climates: Array<{ regionId: string; weather: string; temperature: number; harvestModifier: number }>;
            narratives: Array<{ id: number; description: string; recordedAt: number }>;
            /** 첩보망 [346] — 세이브에 포함 */
            intelNetworks?: Array<{ factionId: FactionID; cityId: CityID; level: number; builtAtTurn: number }>;
            /** 은퇴 무장 [434] — 세이브에 포함 */
            retiredOfficers?: Array<{ officerId: OfficerID; retireYear: number; finalRank: string }>;
            /** 연의전 이벤트/분기 [300][106-114] — 발동 이력 보존 */
            eventChains?: {
                historical: { triggeredIds: string[]; flags: Array<[string, boolean]> };
                activeBranchId: string | null;
            };
        };
    } {
        return {
            state: this.store.createSnapshot(),
            globalState: this.store.getGlobalState(),
            // 실행된 커맨드는 현재 상태에 이미 반영되므로 저장 후 재실행하지 않는다. [17]
            commands: this.commandQueue.serializePending(),
            diplomacy: this.diplomacy.serialize(),
            // 연대기 포함 [Y-메타][441-460] — 이어하기 후에도 역사 유지
            chronicle: this.chronicle.serialize(),
            commandReplayLog: this.getCommandReplayLog(),
            // 포팅 시스템 상태 포함 — 이어하기 후 군단/기후/내러티브 복원
            ported: {
                strategic: this.strategicCommand.serialize(),
                climates: this.climateManager.getAllClimates().map((c) => ({
                    regionId: c.regionId,
                    weather: c.weather,
                    temperature: c.temperature,
                    harvestModifier: c.harvestModifier,
                })),
                narratives: this.narrativeManager.getEvents().map((e) => ({
                    id: e.id,
                    description: e.description,
                    recordedAt: e.recordedAt,
                })),
                intelNetworks: this.intelligenceManager.serializeNetworks(),
                retiredOfficers: this.lifeSimulator.getAllRetiredOfficers().map((r) => ({
                    officerId: r.officerId,
                    retireYear: r.retireYear,
                    finalRank: r.finalRank,
                })),
                eventChains: {
                    historical: this.historicalEvents.serialize(),
                    activeBranchId: this.scenarioBranches.getActiveBranchId(),
                },
            },
        };
    }

    saveCompressed(): string {
        if (this.bootstrap) {
            return this.bootstrap.prepareSave(this);
        }
        return JSON.stringify(this.save());
    }

    loadCompressed(compressed: string): boolean {
        if (this.bootstrap) {
            return this.bootstrap.loadFromSave(this, compressed);
        }
        try {
            const data = JSON.parse(compressed);
            this.load(data);
            return true;
        } catch {
            return false;
        }
    }

    load(data: {
        state: NormalizedState; globalState: GlobalState; commands: SerializedCommand[];
        diplomacy?: Array<{ a: string; b: string; relation: string }>;
        chronicle?: import('./chronicle_system.js').ChronicleEntry[];
        commandReplayLog?: ReplayCommandEvent[];
        ported?: {
            strategic: ReturnType<StrategicCommandManager['serialize']>;
            climates: Array<{ regionId: string; weather: string; temperature: number; harvestModifier: number }>;
            narratives: Array<{ id: number; description: string; recordedAt: number }>;
            intelNetworks?: Array<{ factionId: FactionID; cityId: CityID; level: number; builtAtTurn: number }>;
            retiredOfficers?: Array<{ officerId: OfficerID; retireYear: number; finalRank: string }>;
            eventChains?: {
                historical: { triggeredIds: string[]; flags: Array<[string, boolean]> };
                activeBranchId: string | null;
            };
        };
    }): void {
        this.store.restoreSnapshot(data.state);
        this.store.setGlobalState(data.globalState);
        // FSM을 세이브 시점 페이즈로 동기화 (onEnter 부작용 없이 상태만 복원)
        if (data.globalState.phase && data.globalState.phase !== this.currentPhase) {
            this.currentPhase = data.globalState.phase;
        }
        // 외교 관계 복원 (구버전 세이브 호환: 없으면 초기화 상태 유지)
        if (data.diplomacy) {
            this.diplomacy.restore(data.diplomacy);
        }
        // 연대기 복원 (구버전 세이브 호환: 없으면 빈 상태 유지) [Y-메타][441-460]
        if (data.chronicle) {
            this.chronicle.load(data.chronicle);
        }
        this.commandReplayLog = data.commandReplayLog?.map(event => ({
            ...event,
            logMessages: [...event.logMessages],
            captiveOutcomes: event.captiveOutcomes.map(outcome => ({ ...outcome })),
        })) ?? [];
        // 포팅 시스템 복원 (구버전 세이브 호환: 없으면 초기화 상태 유지)
        if (data.ported) {
            this.strategicCommand.restore(data.ported.strategic);
            for (const c of data.ported.climates) {
                this.climateManager.updateClimate(
                    c.regionId,
                    c.weather as import('./intelligence_narrative_climate.js').WeatherType,
                    c.temperature,
                );
            }
            for (const e of data.ported.narratives) {
                this.narrativeManager.recordEvent(e.description, e.recordedAt);
            }
            if (data.ported.intelNetworks) {
                this.intelligenceManager.restoreNetworks(data.ported.intelNetworks);
            }
            if (data.ported.retiredOfficers) {
                this.lifeSimulator.restoreRetiredOfficers(data.ported.retiredOfficers);
            }
            // 연의전 이벤트 발동 이력 복원 — 재발동 방지 [300][106-114]
            if (data.ported.eventChains) {
                this.historicalEvents.restore(data.ported.eventChains.historical);
                if (data.ported.eventChains.activeBranchId) {
                    this.scenarioBranches.selectBranch(data.ported.eventChains.activeBranchId);
                }
            }
        }
        this.commandQueue.clear();
        for (const cmdData of data.commands) {
            this.commandQueue.enqueue(deserializeCommand(cmdData));
        }
        console.log('[Engine] Save loaded');
    }

    initWorld(
        officers: Officer[],
        factions: Faction[],
        cities: City[],
        armies: Army[],
        scenarioId?: string,
        mapFeatures: MapFeature[] = [],
    ): void {
        this.store.initWorld(officers, factions, cities, armies, mapFeatures);
        // 시나리오의 세력 treaty를 관계 엔진에 적재해 초기 상태부터 단일 원자를 유지한다. [341-360]
        this.diplomacy.restore([]);
        for (const faction of factions) {
            for (const [targetId, entry] of Object.entries(faction.diplomacy)) {
                if (entry.treaty === 'WAR') this.diplomacy.setRelation(faction.id, targetId, FactionRelation.WAR);
                else if (entry.treaty === 'ALLIANCE') this.diplomacy.setRelation(faction.id, targetId, FactionRelation.ALLIANCE);
                else if (entry.treaty === 'VASSAL') this.diplomacy.setRelation(faction.id, targetId, FactionRelation.SURRENDERED);
            }
        }
        // 도시 안정 상태 초기화 [148]
        this.citySecurityStates.clear();
        for (const c of cities) {
            this.citySecurityStates.set(c.id, {
                cityId: c.id,
                riotRisk: 0,
                publicOrder: c.developmentStats.publicOrder,
            });
        }
        // 시나리오별 연의전 체인 적재 [300][301] — 시나리오 ID가 주어지면 해당 체인만
        if (scenarioId) {
            const loaded = loadScenarioEventChains(this.eventEngine, BUILTIN_SCENARIO_EVENTS, scenarioId);
            if (loaded.length > 0) {
                console.log(`[EventChain] 시나리오 ${scenarioId} 연의전 체인 ${loaded.length}개 적재`);
            }
        }
        this.transition('START');
        console.log('[Engine] World initialized');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

let engineInstance: GameEngine | null = null;

export function getGameEngine(): GameEngine {
    if (!engineInstance) engineInstance = new GameEngine();
    return engineInstance;
}
