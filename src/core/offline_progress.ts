/**
 * 오프라인 진행 — 접속하지 않은 동안 세계가 계속 움직인다 [2026-10-04]
 * 파일: src/core/offline_progress.ts
 *
 * [무엇을 계산하는가]
 * 저장 시점(`savedAt`)과 로드 시점의 차이를 **턴 수**로 환산한다.
 * 환산율은 현실 1시간 = 6턴 (사용자 선택: 빠름 6턴).
 *
 *   오프라인 턴 = floor(경과 밀리초 / MS_PER_TURN)
 *   MS_PER_TURN = 10분 = 600_000ms
 *
 * [왜 연속 시간이 아니라 턴인가]
 * 이 게임은 턴제다. 월간 정산·AI·연의전·계절이 전부 턴 경계에서 돈다.
 * 연속 시간으로 바꾸면 month 참조 415건을 재작업해야 한다(위험 매우 높음).
 * 오프라인 동안 N턴을 한꺼번에 돌리면 **같은 파이프라인**을 쓰므로 기존 규칙이
 * 그대로 적용된다. 연속 시간은 오프라인 계산에만 있고 게임 시간 모델은 건드리지
 * 않는다.
 *
 * [왜 10분인가 — 단위 도출]
 * "현실 1시간 = 6턴" → 1턴 = 10분. 게임 시간으로는 1턴 = 1개월 이므로
 * 현실 10분 = 게임 1개월이 된다. 8시간 잠수림 = 48턴 = 게임 4년.
 *
 * 이건 "게임 1일 = 현실 24분" 과 직접 비교할 수 없다 — 그 비율은 게임 시간이
 * 연속 시간으로 흘러야 의미가 있고, 이 게임은 월 단위 턴제다(서로 다른 모델).
 * 오프라인에서는 턴 수가 곧 게임 경과가 된다.
 *
 * [왜 순수 함수인가]
 * 실제 턴 돌리기는 `GameEngine.executeTurn()` 이 맡는다. 여기는 환산과
 * 안전장치(상한·하한·중복 방지)만 계산한다. 그래야 (1) 테스트에서 지형 없이
 * 검증할 수 있고, (2) 나중에 환산율이 바뀌면 이 파일만 고치면 된다.
 */

/** 1턴 = 현실 10분 (ms). */
export const MS_PER_OFFLINE_TURN = 10 * 60 * 1000;

/** 한 번에 몰아서 처리하는 최대 턴 수. */
export const MAX_OFFLINE_TURNS = 24;

/**
 * 경과 시간(ms) → 오프라인 진행 턴 수.
 *
 * @param elapsedMs 저장 시점과 로드 시점의 차이 (밀리초)
 * @returns 적산 턴 수 — 음수면 0, 상한(MAX_OFFLINE_TURNS) 으로 잘름
 */
export function offlineTurnsForElapsed(elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
    return Math.min(MAX_OFFLINE_TURNS, Math.floor(elapsedMs / MS_PER_OFFLINE_TURN));
}

/**
 * 오프라인 진행 결과 요약 — 사람이 읽는 한 줄.
 *
 * 예: "8시간 동안 24턴 진행" / "10분 미만 — 진행 없음"
 */
export function describeOfflineProgress(elapsedMs: number, turns: number): string {
    if (turns <= 0) return '오프라인 동안 세계에 변화 없음';
    const hours = Math.floor(elapsedMs / 3600000);
    const mins = Math.floor((elapsedMs % 3600000) / 60000);
    const span = hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
    return `${span} 동안 ${turns}턴 진행`;
}
