import { offlineTurnsForElapsed, describeOfflineProgress } from './offline_progress.js';
import type { GameEngine } from './game_engine.js';

/**
 * 오프라인 진행 — 저장 후 지난 시간만큼 턴을 몰아서 돌린다.
 *
 * [왜 load() 안에서가 아니라 별도로 부르는가]
 * `executeTurn()` 은 비동기(AI Worker·스케줄러 포함)다. `load()` 를 async 로
 * 바꾸면 그걸 부르는 모든 곳(슬롯·자동저장·E2E)이 await 를 붙여야 한다.
 * 분리하면 로드 후 언제든 비동기로 돌릴 수 있고, UI 는 진행 표시만 하면 된다.
 *
 * @param nowMs 로드 시점 (기본 Date.now()). 테스트에서 시간을 주입한다.
 * @returns 진행한 턴 수. 0 이면 아무 일도 안 했다.
 */
export async function catchUpOfflineTurns(
    engine: GameEngine,
    nowMs: number = Date.now(),
): Promise<{ turns: number; message: string }> {
    const gs = engine['store'].getGlobalState();
    const elapsed = nowMs - (gs.savedAt ?? nowMs);
    const turns = offlineTurnsForElapsed(elapsed);
    const message = describeOfflineProgress(elapsed, turns);
    if (turns <= 0) return { turns: 0, message };
    for (let i = 0; i < turns; i++) {
        await engine.executeTurn();
    }
    // 진행한 턴만큼 시각을 당긴다 — 같은 세이브를 다시 로드하면 중복 진행된다.
    engine['store'].setGlobalState({
        ...engine['store'].getGlobalState(),
        savedAt: nowMs,
    });
    return { turns, message };
}