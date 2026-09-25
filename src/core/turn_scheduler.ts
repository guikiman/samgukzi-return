/**
 * 삼국지 8 리메이크 — 턴 스케줄러 (Time Slicing)
 * 파일: src/core/turn_scheduler.ts
 *
 * requestIdleCallback 기반 청크 단위 루프
 * 1,000명 AI 의사결정을 메인 스레드 블로킹 없이 분할 실행
 */

import {
    ChunkTask, SchedulerProgress, TurnSchedulerOptions,
    OfficerID, Officer, AIDecision, CommandType,
} from './types.js';

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
type IdleHandle = number;

declare global {
    function requestIdleCallback(cb: IdleCallback, opts?: { timeout: number }): IdleHandle;
    function cancelIdleCallback(handle: IdleHandle): void;
}

type TaskProcessor = (task: ChunkTask) => Promise<void> | void;

export class TurnScheduler {
    private tasks: ChunkTask[] = [];
    private processor: TaskProcessor;
    private options: TurnSchedulerOptions;
    private idleHandle: IdleHandle | null = null;
    private isRunning = false;
    private completedCount = 0;
    /** 비동기 processor가 끝날 때까지 완료로 간주하지 않기 위한 카운터 [201][295] */
    private inFlightCount = 0;
    private completionNotified = true;
    private totalTaskCount = 0;
    private currentChunk = 0;
    private onComplete: (() => void) | null = null;
    private onProgress: ((progress: SchedulerProgress) => void) | null = null;

    constructor(processor: TaskProcessor, options?: Partial<TurnSchedulerOptions>) {
        this.processor = processor;
        this.options = {
            chunkSize: options?.chunkSize ?? 50,
            maxFrameTimeMs: options?.maxFrameTimeMs ?? 16,
            useIdleCallback: options?.useIdleCallback ?? true,
        };
    }

    setTasks(tasks: ChunkTask[]): void {
        this.tasks = [...tasks];
        this.totalTaskCount = tasks.length;
        this.completedCount = 0;
        this.currentChunk = 0;
        this.inFlightCount = 0;
        this.completionNotified = this.totalTaskCount === 0;
    }

    setOnComplete(callback: () => void): void {
        this.onComplete = callback;
    }

    setOnProgress(callback: (progress: SchedulerProgress) => void): void {
        this.onProgress = callback;
    }

    isCurrentlyRunning(): boolean {
        return this.isRunning;
    }

    getProgress(): SchedulerProgress {
        return {
            total: this.totalTaskCount,
            completed: this.completedCount,
            currentChunk: this.currentChunk,
            isComplete: this.completedCount >= this.totalTaskCount,
        };
    }

    start(): void {
        if (this.isRunning || this.tasks.length === 0) return;
        this.isRunning = true;
        this.completedCount = 0;
        this.inFlightCount = 0;
        this.completionNotified = false;
        if (this.options.useIdleCallback && typeof requestIdleCallback !== 'undefined') {
            this.idleHandle = requestIdleCallback((deadline) => this.runChunk(deadline), { timeout: 100 });
        } else {
            this.runChunkSync();
        }
    }

    stop(): void {
        this.isRunning = false;
        if (this.idleHandle !== null && typeof cancelIdleCallback !== 'undefined') {
            cancelIdleCallback(this.idleHandle);
            this.idleHandle = null;
        }
    }

    private runChunk(deadline: { didTimeout: boolean; timeRemaining: () => number }): void {
        if (!this.isRunning) return;

        const chunkSize = this.options.chunkSize;
        let processed = 0;

        while (processed < chunkSize && this.tasks.length > 0) {
            const remaining = deadline.timeRemaining();
            if (remaining <= 0 && !deadline.didTimeout) break;

            const task = this.tasks.shift();
            if (task) {
                this.processTask(task);
                processed += 1;
            }
        }

        this.currentChunk += 1;
        this.emitProgress();

        if (this.tasks.length > 0 && this.isRunning) {
            this.idleHandle = requestIdleCallback(
                (d) => this.runChunk(d), { timeout: this.options.maxFrameTimeMs },
            );
        } else {
            this.finishIfDrained();
        }
    }

    private runChunkSync(): void {
        if (!this.isRunning) return;
        const chunkSize = this.options.chunkSize;
        const frameStart = performance.now();

        while (this.tasks.length > 0) {
            const task = this.tasks.shift();
            if (task) {
                this.processTask(task);
            }

            if (this.completedCount % chunkSize === 0 &&
                performance.now() - frameStart >= this.options.maxFrameTimeMs) {
                this.currentChunk += 1;
                this.emitProgress();
                setTimeout(() => {
                    if (this.isRunning) this.runChunkSync();
                }, 0);
                return;
            }
        }

        this.currentChunk += 1;
        this.emitProgress();
        this.finishIfDrained();
    }

    private processTask(task: ChunkTask): void {
        const result = this.processor(task);
        if (result instanceof Promise) {
            this.inFlightCount += 1;
            result.then(
                () => this.onTaskComplete(),
                () => this.onTaskComplete(),
            );
        } else {
            this.onTaskComplete();
        }
    }

    private onTaskComplete(): void {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.completedCount += 1;
        this.emitProgress();
        this.finishIfDrained();
    }

    /** 큐와 비동기 작업이 모두 비었을 때만 완료 알림을 한 번 발생시킨다. */
    private finishIfDrained(): void {
        if (!this.isRunning || this.tasks.length > 0 ||
            this.inFlightCount > 0 || this.completionNotified) {
            return;
        }
        this.isRunning = false;
        this.idleHandle = null;
        this.completionNotified = true;
        if (this.onComplete) this.onComplete();
    }

    private emitProgress(): void {
        if (this.onProgress) {
            this.onProgress(this.getProgress());
        }
    }
}

// ============================================================
// AI 턴 프로세서 — 1,000명 무장 의사결정을 청크로 분할
// ============================================================
export class AITurnProcessor {
    private store: import('./game_store.js').GameStore;
    private decisions: AIDecision[] = [];
    private chunkSize: number;

    constructor(store: import('./game_store.js').GameStore, chunkSize = 50) {
        this.store = store;
        this.chunkSize = chunkSize;
    }

    prepareAITasks(officerIds: OfficerID[]): ChunkTask[] {
        return officerIds.map(officerId => ({
            id: `ai_task_${officerId}`,
            officerId,
            execute: () => this.processSingleOfficer(officerId),
        }));
    }

    async processSingleOfficer(officerId: OfficerID): Promise<void> {
        const officer = this.store.getOfficer(officerId);
        if (!officer || officer.hasActedThisTurn || officer.status === 'FREE') return;

        const faction = officer.factionId ? this.store.getFaction(officer.factionId) : null;
        const city = officer.cityId ? this.store.getCity(officer.cityId) : null;

        if (!faction || !city) return;

        const decision = this.calculateDecision(officer, faction, city);
        if (decision) {
            this.decisions.push(decision);
            this.store.updateOfficer(officerId, { hasActedThisTurn: true });
        }
    }

    private calculateDecision(
        officer: Officer,
        faction: import('./types.js').Faction,
        city: import('./types.js').City,
    ): AIDecision | null {
        const personality = officer.personality;
        const stats = officer.stats;

        const personalityWeights: Record<string, Partial<Record<CommandType, number>>> = {
            AGGRESSIVE: { BATTLE: 0.4, MOVEMENT: 0.3, DOMESTIC: 0.1 },
            CALM: { DOMESTIC: 0.35, TRAINING: 0.25, DIPLOMACY: 0.2 },
            CAUTIOUS: { DOMESTIC: 0.3, TRAINING: 0.25, REST: 0.2 },
            TIMID: { REST: 0.3, DOMESTIC: 0.25, TRAINING: 0.2 },
            LOYAL: { DOMESTIC: 0.3, TRAINING: 0.25, RECRUITMENT: 0.2 },
            AMBITIOUS: { RECRUITMENT: 0.3, BATTLE: 0.2, DIPLOMACY: 0.2 },
        };

        const weights = personalityWeights[personality] ?? personalityWeights.CALM;
        let bestAction: CommandType = 'DOMESTIC';
        let bestWeight = 0;

        for (const [action, weight] of Object.entries(weights)) {
            const statKey = action === 'DOMESTIC' ? 'politics'
                          : action === 'TRAINING' ? 'intelligence'
                          : action === 'BATTLE' ? 'might'
                          : 'leadership';
            const statValue = stats[statKey as keyof typeof stats] ?? 50;
            const effectiveWeight = (weight ?? 0) * (statValue / 100);
            if (effectiveWeight > bestWeight) {
                bestWeight = effectiveWeight;
                bestAction = action as CommandType;
            }
        }

        return {
            officerId: officer.id,
            actionType: bestAction,
            priority: bestWeight,
            reasoning: `${personality} → ${bestAction} (weight: ${bestWeight.toFixed(2)})`,
            payload: { cityId: city.id, factionId: faction.id },
        };
    }

    getDecisions(): AIDecision[] {
        return this.decisions;
    }

    clearDecisions(): void {
        this.decisions = [];
    }
}

// ============================================================
// 턴 라이프사이클 관리자
// ============================================================
export class TurnLifecycleManager {
    private store: import('./game_store.js').GameStore;
    private scheduler: TurnScheduler;
    private aiProcessor: AITurnProcessor;

    constructor(store: import('./game_store.js').GameStore) {
        this.store = store;
        this.aiProcessor = new AITurnProcessor(store, 50);
        this.scheduler = new TurnScheduler(async (task) => {
            // 태스크마다 새 processor를 만들면 결정이 임시 객체에 사라진다.
            // 턴 단위 collector를 공유해야 executeAITurn이 실제 결과를 반환한다.
            await this.aiProcessor.processSingleOfficer(task.officerId);
        }, { chunkSize: 50 });
    }

    async executeAITurn(onProgress?: (progress: SchedulerProgress) => void): Promise<AIDecision[]> {
        this.aiProcessor.clearDecisions();

        const officers = this.store.getAllOfficers();
        const officerIds = officers
            .filter(o => !o.hasActedThisTurn && o.status !== 'FREE')
            .map(o => o.id);

        this.scheduler.setTasks(this.aiProcessor.prepareAITasks(officerIds));
        if (onProgress) this.scheduler.setOnProgress(onProgress);

        return new Promise((resolve) => {
            this.scheduler.setOnComplete(() => {
                resolve(this.aiProcessor.getDecisions());
            });
            this.scheduler.start();
        });
    }
}
