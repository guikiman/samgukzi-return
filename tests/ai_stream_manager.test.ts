import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIStreamManager, type AITurnPayload } from '../src/ai/ai_stream_manager.js';

type OutboundMessage =
    | { type: 'STREAM_FACTION_DECISION'; data: { factionId: string; decisions: []; elapsedMs: number } }
    | { type: 'AI_TURN_COMPLETE'; data: { totalDecisions: number; elapsedMs: number } }
    | { type: 'ERROR'; data: string };

class MockWorker {
    static instances: MockWorker[] = [];

    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();

    constructor() {
        MockWorker.instances.push(this);
    }

    emit(message: OutboundMessage): void {
        this.onmessage?.({ data: message } as MessageEvent);
    }

    fail(message: string): void {
        this.onerror?.({ message } as ErrorEvent);
    }
}

const payload: AITurnPayload = {
    year: 220,
    month: 1,
    turn: 1,
    factions: {},
    officers: [],
    cities: {},
};

describe('AIStreamManager', () => {
    beforeEach(() => {
        MockWorker.instances = [];
        vi.stubGlobal('Worker', MockWorker);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('streams faction decisions and resolves on AI_TURN_COMPLETE', async () => {
        const onFactionUpdate = vi.fn();
        const onTurnComplete = vi.fn();
        const manager = new AIStreamManager({ onFactionUpdate, onTurnComplete });
        const completion = manager.startMonthlyTurn(payload);
        const worker = MockWorker.instances[0];

        expect(manager.isBusy()).toBe(true);
        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'START_AI_TURN', payload });

        worker.emit({
            type: 'STREAM_FACTION_DECISION',
            data: { factionId: 'faction-1', decisions: [], elapsedMs: 4 },
        });
        worker.emit({
            type: 'AI_TURN_COMPLETE',
            data: { totalDecisions: 12, elapsedMs: 18 },
        });

        await expect(completion).resolves.toBeUndefined();
        expect(onFactionUpdate).toHaveBeenCalledWith({
            factionId: 'faction-1',
            decisions: [],
            elapsedMs: 4,
        });
        expect(onTurnComplete).toHaveBeenCalledWith({ totalDecisions: 12, elapsedMs: 18 });
        expect(manager.isBusy()).toBe(false);
    });

    it('reports worker errors and releases a pending turn', async () => {
        const onError = vi.fn();
        const manager = new AIStreamManager({ onFactionUpdate: vi.fn(), onError });
        const completion = manager.startMonthlyTurn(payload);
        const worker = MockWorker.instances[0];

        worker.fail('worker crashed');

        await expect(completion).resolves.toBeUndefined();
        expect(onError).toHaveBeenCalledWith('worker crashed');
        expect(manager.isBusy()).toBe(false);
    });

    it('rejects a second turn while one is already running', async () => {
        const manager = new AIStreamManager({ onFactionUpdate: vi.fn() });
        const firstTurn = manager.startMonthlyTurn(payload);

        await expect(manager.startMonthlyTurn(payload)).rejects.toThrow('AI turn already running');

        MockWorker.instances[0].emit({
            type: 'AI_TURN_COMPLETE',
            data: { totalDecisions: 0, elapsedMs: 0 },
        });
        await firstTurn;
    });

    it('terminates the worker and resets the busy state', async () => {
        const manager = new AIStreamManager({ onFactionUpdate: vi.fn() });
        const completion = manager.startMonthlyTurn(payload);
        const worker = MockWorker.instances[0];

        manager.terminate();

        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(manager.isBusy()).toBe(false);
        // terminate intentionally drops the pending promise; this assertion documents
        // the lifecycle contract without leaving an unhandled rejected promise.
        void completion;
    });
});
