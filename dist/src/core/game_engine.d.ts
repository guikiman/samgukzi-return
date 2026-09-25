/**
 * 삼국지 8 리메이크 — 통합 게임 엔진 (FSM 오케스트레이터)
 * 파일: src/core/game_engine.ts
 *
 * 모든 시스템을 통합하는 중앙 오케스트레이터
 * 유한 상태 머신 (FSM) 기반 페이즈 전환
 * 커맨드 큐 + 턴 스케줄러 + AI 워커 통합
 */
import { GamePhase, PhaseTransition, GlobalState, NormalizedState, Officer, Faction, City, Army, OfficerID, CityID, FactionID, ICommand, CommandResult, SerializedCommand, SchedulerProgress, GameEvent, EventListener, AIWorkerPayload, AIWorkerResult } from './types.js';
import { GameStore } from './game_store.js';
import { DiplomacyEngine } from './diplomacy_engine.js';
import { StrategicCommandManager } from './strategic_command_system.js';
import { DomesticScheduler } from './domestic_scheduler.js';
import { LifeSimulator } from './life_simulator.js';
import { MetaManager, LegacyManager, MetaDataManager } from './meta_systems.js';
import { IntelligenceManager, NarrativeManager, ClimateManager } from './intelligence_narrative_climate.js';
import { EventEngine } from './event_chain_engine.js';
import { HistoricalEventSystem } from './historical_event_system.js';
import { ScenarioBranchManager } from './scenario_branch_manager.js';
import type { ReplayCommandEvent } from './replay_share_manager.js';
export declare class GameEngine {
    private store;
    private commandQueue;
    private scheduler;
    private aiProcessor;
    private lifecycleManager;
    private fsm;
    private currentPhase;
    private phaseHistory;
    private eventListeners;
    private eventQueue;
    private worker;
    private workerPromises;
    private bootstrap;
    private factionAI;
    private fateSystem;
    private loyaltySystem;
    private diplomacy;
    private diplomacyAI;
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
    readonly scenarioBranches: ScenarioBranchManager;
    /** 도시 안정 상태 [148] — 도시 ID별 민란 위험도 (Python riot_risk) */
    private citySecurityStates;
    /** 이번 달 발생한 민란/아사 기록 [148] — 월간 보고서 동향용 */
    private securityMonthlyLog;
    private isProcessingTurn;
    /** AI 스트리밍 매니저 [201] — Worker 기반 세력별 스트리밍 AI (실패 시 메인 스레드 폴백) */
    private aiStream;
    /** 스트리밍 AI 영구 실패 플래그 — 워커 오류 이후 폴백 고정 */
    private streamFailed;
    /** 스트리밍 AI의 월간 결정 수집 버퍼 — executeTurn에서 소비 */
    private streamBatchCount;
    /** 이번 턴에 Worker 스트리밍 경로가 실제 완료되었는지 — FactionAI 중복 방지 */
    private streamTurnCompleted;
    /** 민란 억제 롤 오버라이드 [148] — 테스트 결정론용. 값 지정 시 1회 소비 후 자동 해제 */
    private _riotRollOverride;
    /**
     * 민란 억제 롤 강제 지정 [148] — 0이면 억제 롤 성공(진압), 1이면 실패(민란 발생).
     * 테스트/리플레이 재현용이며, 지정 시 다음 판정 1회에만 적용 후 해제된다.
     */
    setRiotRollOverride(value: number | null): void;
    private riotRollOverride;
    /**
     * 이번 달 포팅 시스템 동향 수집 버퍼 [76-85][321-340][341-360][421-438]
     * processPortedSystemsMonthly가 채우고, 월간 보고서(MonthlyReportSystem)가 peek한다.
     * peekMonthlyPortedLog(hasRead=true)로 읽으면 비워진다.
     */
    private portedMonthlyLog;
    constructor(store?: GameStore);
    private initBootstrap;
    private buildFSM;
    transition(event: string): boolean;
    getCurrentPhase(): GamePhase;
    getPhaseHistory(): PhaseTransition[];
    private onEnterWorldMap;
    private onEnterCouncil;
    private onEnterPersonalAction;
    private onEnterBattle;
    private onExitBattle;
    private onEnterEvent;
    enqueueCommand(command: ICommand): void;
    private createCommandContext;
    /** 성공한 각 커맨드 실행 전 월간 포로 로그 길이 — undo 시 UI 버퍼도 같은 경계로 복원한다. */
    private executedCommandCaptiveLogSizes;
    /** 전투·포로·외교 명령 실행/복구 이벤트 — 리플레이 및 세이브 델타에서 재사용 [312] */
    private commandReplayLog;
    private recordCommandReplay;
    getCommandReplayLog(): ReplayCommandEvent[];
    private emitCommandResult;
    executeNextCommand(): CommandResult | null;
    executeAllCommands(): CommandResult[];
    undoLastCommand(): boolean;
    redoLastCommand(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    getPendingCommandCount(): number;
    executeTurn(onProgress?: (progress: SchedulerProgress) => void): Promise<void>;
    private resetTurnFlags;
    /**
     * Worker 스트리밍 AI 엔진으로 월간 AI 턴을 실행한다 (AGENTS.md §7).
     *
     * - Worker 가능 환경: AIStreamManager가 1,000명 무장을 세력 단위로 분할 연산하고,
     *   각 배치가 도착하는 대로 즉시 커맨드로 변환한다 (스트리밍 반영).
     * - Worker 불가/오류 (Node 테스트, 구형 브라우저): 기존 TurnScheduler 폴백.
     *
     * @returns 소비된 총 결정 수 (스트리밍 + 폴백 합산)
     */
    private executeAITurnWithStreaming;
    /** 스트리밍 배치 → 커맨드 즉시 변환 [201] */
    private applyStreamedBatch;
    private convertDecisionToCommand;
    /**
     * 연의전 이벤트 체인 월간 스캔/발동 [300][106-114]
     *
     * 1) 큐에 등록된 체인 노드를 조건 평가 후 활성화 → GameEvent 발화 + 연대기 기록
     * 2) HistoricalEventSystem(삼고초려/관도/적벽 등) 조건 검사 → 발동 시 GameEvent 발화
     * 3) 발동한 역사 이벤트를 분기 트리거 조건으로 삼아 사실/가상 분기 활성화
     */
    private processEventChainMonthly;
    private processMonthlyMaintenance;
    /**
     * 도시 안정 월간 판정 [148] — 민란 위험도 진정, 아사(군량부족) 소모, 민란 발생
     *
     * Python city_manager.py의 process_turn 포팅:
     * 1) 세력 군량 0이면 소속 도시 전체 아사 — 병력 5% 소모 + 위험도 +15
     * 2) 월말 위험도 자연 감소 (치안 비례)
     * 3) 위험도 ≥ 100 && 치안 억제 실패 시 민란 — 도시 소속 이탈 (무주화)
     */
    private processCitySecurityMonthly;
    /**
     * 이번 달 도시 안정 동향 peek [148] — 월간 보고서용. consume=true면 읽 후 비운다.
     */
    peekMonthlySecurityLog(consume?: boolean): {
        riots: Array<{
            cityId: string;
            cityName: string;
            fromFactionId: string | null;
        }>;
        starvations: Array<{
            cityId: string;
            cityName: string;
            losses: number;
        }>;
    };
    /**
     * 포팅 시스템 월간 훅 [76-85][321-340][341-360][421-438]
     * 1) 전략 명령 진행 — 출진/수송 큐 처리 및 완료 이벤트 발화
     * 2) 첩보망 유지비 — 레벨 1 소모, 미유지 시 붕괴 이벤트
     * 3) 지역 기후 전이 — 계절 기반 날씨 전이 및 수확 보정 반영
     * 4) 고령 무장 은퇴 — 60세 도달 무장 은퇴 기록
     */
    private processPortedSystemsMonthly;
    /**
     * 이번 달 포팅 시스템 동향 peek [76-85][321-340][341-360][421-438]
     * 월간 보고서(MonthlyReportSystem)가 호출. consume=true면 읽 후 버퍼를 비운다.
     */
    peekMonthlyPortedLog(consume?: boolean): {
        campaigns: Array<{
            targetCity: string;
            leaderName: string;
            soldiers: number;
        }>;
        transports: Array<{
            fromCity: string;
            toCity: string;
            gold: number;
            food: number;
            soldiers: number;
        }>;
        collapsedNetworks: Array<{
            factionId: string;
            cityId: string;
        }>;
        retired: Array<{
            officerName: string;
            age: number;
        }>;
        captives: Array<{
            officerId: string;
            officerName: string;
            decision: 'RECRUIT' | 'EXECUTE' | 'RELEASE';
            success: boolean;
            message: string;
        }>;
        vagrant: Array<{
            factionName: string;
            kind: 'CONVERT' | 'RECRUIT' | 'RAID';
            success: boolean;
            message: string;
        }>;
    };
    private processWeatherEffect;
    emitEvent(event: GameEvent): void;
    subscribe(eventType: string, listener: EventListener): () => void;
    private processEventQueue;
    getPendingEvents(): GameEvent[];
    private initWorker;
    requestAIWorker(payload: AIWorkerPayload): Promise<AIWorkerResult>;
    private localAIProcessing;
    terminateWorker(): void;
    /** 외교 엔진 접근자 (UI/AI 용) [70-73] */
    get diplomacyEngine(): DiplomacyEngine;
    /**
     * 플레이어 도시 습격 커맨드 [83] — 전략 포인트 30 소비 후 습격 판정.
     * 플레이어 세력이 방랑군일 때만 가능. 성공 시 FACTION_REVIVED 이벤트.
     */
    playerRaidCity(targetCityId: CityID): {
        success: boolean;
        message: string;
    };
    save(): {
        state: NormalizedState;
        globalState: GlobalState;
        commands: SerializedCommand[];
        diplomacy: Array<{
            a: string;
            b: string;
            relation: string;
        }>;
        chronicle?: import('./chronicle_system.js').ChronicleEntry[];
        /** 전투·포로·외교 실행/복구 이벤트 — 세이브 델타 및 리플레이 [312] */
        commandReplayLog?: ReplayCommandEvent[];
        /** 포팅 시스템 스냅샷 [76-85][321-340][341-360][421-438][431-432][441-460] */
        ported?: {
            strategic: ReturnType<StrategicCommandManager['serialize']>;
            climates: Array<{
                regionId: string;
                weather: string;
                temperature: number;
                harvestModifier: number;
            }>;
            narratives: Array<{
                id: number;
                description: string;
                recordedAt: number;
            }>;
            /** 첩보망 [346] — 세이브에 포함 */
            intelNetworks?: Array<{
                factionId: FactionID;
                cityId: CityID;
                level: number;
                builtAtTurn: number;
            }>;
            /** 은퇴 무장 [434] — 세이브에 포함 */
            retiredOfficers?: Array<{
                officerId: OfficerID;
                retireYear: number;
                finalRank: string;
            }>;
            /** 연의전 이벤트/분기 [300][106-114] — 발동 이력 보존 */
            eventChains?: {
                historical: {
                    triggeredIds: string[];
                    flags: Array<[string, boolean]>;
                };
                activeBranchId: string | null;
            };
        };
    };
    saveCompressed(): string;
    loadCompressed(compressed: string): boolean;
    load(data: {
        state: NormalizedState;
        globalState: GlobalState;
        commands: SerializedCommand[];
        diplomacy?: Array<{
            a: string;
            b: string;
            relation: string;
        }>;
        chronicle?: import('./chronicle_system.js').ChronicleEntry[];
        commandReplayLog?: ReplayCommandEvent[];
        ported?: {
            strategic: ReturnType<StrategicCommandManager['serialize']>;
            climates: Array<{
                regionId: string;
                weather: string;
                temperature: number;
                harvestModifier: number;
            }>;
            narratives: Array<{
                id: number;
                description: string;
                recordedAt: number;
            }>;
            intelNetworks?: Array<{
                factionId: FactionID;
                cityId: CityID;
                level: number;
                builtAtTurn: number;
            }>;
            retiredOfficers?: Array<{
                officerId: OfficerID;
                retireYear: number;
                finalRank: string;
            }>;
            eventChains?: {
                historical: {
                    triggeredIds: string[];
                    flags: Array<[string, boolean]>;
                };
                activeBranchId: string | null;
            };
        };
    }): void;
    initWorld(officers: Officer[], factions: Faction[], cities: City[], armies: Army[], scenarioId?: string): void;
    private delay;
}
export declare function getGameEngine(): GameEngine;
//# sourceMappingURL=game_engine.d.ts.map