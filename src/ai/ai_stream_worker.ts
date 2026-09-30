/**
 * 삼국지리턴 — AI 스트리밍 워커 엔트리 (Worker 스레드)
 * 파일: src/ai/ai_stream_worker.ts
 *
 * 메인 스레드의 START_AI_TURN 메시지를 받아 1,000명 무장 AI 턴을 실행하고,
 * 세력 단위 연산이 끝날 때마다 STREAM_FACTION_DECISION으로 즉시 스트리밍 전송.
 *
 * [201] Web Worker 비동기 AI 연산
 */

import { runAITurn, type AITurnPayload, type WorkerOutboundMessage } from './ai_worker_simulator.js';

const workerSelf = self as unknown as {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: WorkerOutboundMessage) => void;
};

workerSelf.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data as { type: string; payload?: AITurnPayload };

    if (type !== 'START_AI_TURN' || !payload) {
        workerSelf.postMessage({
            type: 'ERROR',
            data: `Unknown message type: ${type ?? '(none)'}`,
        });
        return;
    }

    try {
        const { totalDecisions, elapsedMs } = await runAITurn(payload, (batch) => {
            // 💡 세력 단위 연산이 끝날 때마다 메인 스레드로 즉시 스트리밍 전송
            workerSelf.postMessage({ type: 'STREAM_FACTION_DECISION', data: batch });
        });
        workerSelf.postMessage({ type: 'AI_TURN_COMPLETE', data: { totalDecisions, elapsedMs } });
    } catch (error) {
        workerSelf.postMessage({
            type: 'ERROR',
            data: error instanceof Error ? error.message : String(error),
        });
    }
};

export {};
