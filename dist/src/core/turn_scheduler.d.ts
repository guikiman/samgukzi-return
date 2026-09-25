/**
 * 삼국지 8 리메이크 — 턴 스케줄러 (Time Slicing)
 * 파일: src/core/turn_scheduler.ts
 *
 * requestIdleCallback 기반 청크 단위 루프
 * 1,000명 AI 의사결정을 메인 스레드 블로킹 없이 분할 실행
 */
import { ChunkTask, SchedulerProgress, TurnSchedulerOptions, OfficerID, AIDecision } from './types.js';
type IdleCallback = (deadline: {
    didTimeout: boolean;
    timeRemaining: () => number;
}) => void;
type IdleHandle = number;
declare global {
    function requestIdleCallback(cb: IdleCallback, opts?: {
        timeout: number;
    }): IdleHandle;
    function cancelIdleCallback(handle: IdleHandle): void;
}
type TaskProcessor = (task: ChunkTask) => Promise<void> | void;
export declare class TurnScheduler {
    private tasks;
    private processor;
    private options;
    private idleHandle;
    private isRunning;
    private completedCount;
    /** 비동기 processor가 끝날 때까지 완료로 간주하지 않기 위한 카운터 [201][295] */
    private inFlightCount;
    private completionNotified;
    private totalTaskCount;
    private currentChunk;
    private onComplete;
    private onProgress;
    constructor(processor: TaskProcessor, options?: Partial<TurnSchedulerOptions>);
    setTasks(tasks: ChunkTask[]): void;
    setOnComplete(callback: () => void): void;
    setOnProgress(callback: (progress: SchedulerProgress) => void): void;
    isCurrentlyRunning(): boolean;
    getProgress(): SchedulerProgress;
    start(): void;
    stop(): void;
    private runChunk;
    private runChunkSync;
    private processTask;
    private onTaskComplete;
    /** 큐와 비동기 작업이 모두 비었을 때만 완료 알림을 한 번 발생시킨다. */
    private finishIfDrained;
    private emitProgress;
}
export declare class AITurnProcessor {
    private store;
    private decisions;
    private chunkSize;
    constructor(store: import('./game_store.js').GameStore, chunkSize?: number);
    prepareAITasks(officerIds: OfficerID[]): ChunkTask[];
    processSingleOfficer(officerId: OfficerID): Promise<void>;
    private calculateDecision;
    getDecisions(): AIDecision[];
    clearDecisions(): void;
}
export declare class TurnLifecycleManager {
    private store;
    private scheduler;
    private aiProcessor;
    constructor(store: import('./game_store.js').GameStore);
    executeAITurn(onProgress?: (progress: SchedulerProgress) => void): Promise<AIDecision[]>;
}
export {};
//# sourceMappingURL=turn_scheduler.d.ts.map