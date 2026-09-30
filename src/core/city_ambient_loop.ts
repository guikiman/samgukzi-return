/**
 * 도시 씬 주야 자동 순환 — 틱의 타이머 수명과 재그림 가드를 main.ts 밖으로 뺀다.
 *
 * [왜 분리했는가]
 * 이 로직은 원래 main.ts 안에 있었다. 그런데 main.ts 는 최상위에서 DOM 을 만져서
 * 노드 환경에서 import 가 불가능하고, 따라서 "패널을 닫으면 타이머가 멈추는가",
 * "도시를 바꾸면 이전 도시를 다시 그리지 않는가" 를 자동 검사로 지킬 수 없었다.
 * 그 결과 패널을 숨기는 경로 하나가 stop 을 빠뜨려도 아무도 모른다 — 실제로
 * 출진 버튼 경로가 정확히 그랬다(아래 테스트가 이걸 붙잡는다).
 *
 * 순수 로직만 밖으로 빼서 vitest 로 검증 가능하게 한다. DOM 은 건드리지 않는다.
 */

/** 자동 순환 주기(ms). 씬이 열려 있는 동안 이 간격으로 다시 그린다. */
export const CITY_AMBIENT_INTERVAL_MS = 500;

/** 한 틱에서 재그림해도 되는지 판단하는 데 필요한 상태. */
export interface AmbientRedrawState {
    /** 캔버스가 패널에서 활성 상태인지 (is-active 클래스). */
    readonly sceneActive: boolean;
    /** 대상 도시가 아직 존재하는지. */
    readonly cityExists: boolean;
    /** 화면에 그려져 있는 도시 id — 도시를 바꿨으면 이전 도시를 다시 그리지 않는다. */
    readonly drawnCityId: string | null;
    /** 이 타이머가 감시 중인 도시 id. */
    readonly targetCityId: string;
}

/**
 * 재그림 조건.
 *
 * - 씬이 닫혔으면 그리지 않는다(숨김 패널을 0.5초마다 다시 그리는 것).
 * - 도시가 사라졌으면 그리지 않는다(모듈이 도는 중 삭제된 도시 접근 방지).
 * - 그려진 도시가 감시 대상과 다르면 그리지 않는다(도시 전환 직후 이전 도시가
 *   한 프레임 더 그려지는 깜빡임 방지).
 */
export function shouldRedrawAmbient(state: AmbientRedrawState): boolean {
    return state.sceneActive && state.cityExists && state.drawnCityId === state.targetCityId;
}

export interface AmbientTicker {
    start(): void;
    stop(): void;
    /** 현재 타이머가 살아 있는지. */
    readonly running: boolean;
}

/**
 * 주기적으로 onTick 을 부르는 단일 타이머.
 *
 * start 를 여러 번 불러도 타이머는 하나만 산다 — 이게 없으면 도시를 열 때마다
 * 0.5초 간격의 중복 repaint 가 쌓여 프레임이 배수로 느려진다.
 */
export function createAmbientTicker(intervalMs: number, onTick: () => void): AmbientTicker {
    let handle: ReturnType<typeof setInterval> | null = null;
    return {
        start(): void {
            if (handle !== null) return;
            handle = setInterval(onTick, intervalMs);
        },
        stop(): void {
            if (handle === null) return;
            clearInterval(handle);
            handle = null;
        },
        get running(): boolean {
            return handle !== null;
        },
    };
}
