/**
 * [461-480] 마이크로 UX · 온보딩 상태 저장소 (순수 상태 모델)
 * 파일: src/core/onboarding_state.ts
 *
 * 설계 (ownership: 이 파일은 온보딩 "상태"만 소유한다):
 * - tutorial_system.ts가 10단계 안내 문구와 rtk8_tutorial_done 플래그를 소유하므로
 *   여기서는 단계 수/단계 id를 다시 정의하지 않고 TUTORIAL_STEPS에서 파생한다.
 * - 이 모듈은 온보딩이 지금 어디까지 왔는지(단계), 닫혔는지/나중에 보기로 미뤘는지,
 *   온보딩에서 수집한 취향(난이도·시작 세력)만 담는다. 문구 렌더링과 DOM은 소유하지 않는다.
 * - 결정론 보장: Math.random / Date.now / setTimeout 등 비순수 호출을 쓰지 않는다.
 *   같은 상태 + 같은 입력 => 항상 같은 출력.
 * - 부작용은 localStorage 쓰기/읽기뿐. 스토리지는 주입 가능(StorageLike)이라
 *   DOM 없는 node 환경에서 그대로 단위 테스트할 수 있다.
 *
 * 저장 키는 기존 튜토리얼 키(rtk8_tutorial_done)와 반드시 달라야 한다.
 * 두 키가 겹치면 온보딩을 초기화할 때 튜토리얼 완료 기록까지 지워져 버린다.
 */

import { TUTORIAL_STEPS } from './tutorial_system.js';

/** 온보딩 전용 로컬 스토리지 키 — rtk8_tutorial_done과 의도적으로 분리됨 */
export const ONBOARDING_STORAGE_KEY = 'rtk8_onboarding_state_v1';

/** 온보딩이 수집하는 난이도 — 게임 전역 difficulty(1~5)와 동일한 도메인 */
export type OnboardingDifficulty = 1 | 2 | 3 | 4 | 5;

/** 온보딩 시작 세력 후보 (id는 게임 FactionID 문자열과 동일한 형태) */
export type OnboardingStartingFaction = 'wei' | 'shu' | 'wu' | 'custom';

/** 온보딩 수명주기 상태 — 순수 판정에만 쓰인다 */
export type OnboardingStatus = 'active' | 'completed' | 'deferred' | 'dismissed';

export interface OnboardingFactionOption {
    readonly id: OnboardingStartingFaction;
    readonly name: string;
    readonly leader: string;
    readonly blurb: string;
}

/** 온보딩이 고를 수 있는 시작 세력 목록 (패널 라벨 재사용용) */
export const ONBOARDING_FACTION_OPTIONS: readonly OnboardingFactionOption[] = [
    { id: 'wei', name: '魏', leader: '曹操', blurb: '양강 중원. 병력과 지식이 뛰어나지만 내부 권력 다툼이 잦다.' },
    { id: 'shu', name: '蜀', leader: '劉備', blurb: '의리와 계열이 강점. 정작은 부족해 인재를 모아야 한다.' },
    { id: 'wu', name: '吳', leader: '孫權', blurb: '강동 수중 세력. 병졸과 함선이 강점.' },
    { id: 'custom', name: '自定', leader: '플레이어', blurb: '시작 설정을 직접 고른다.' },
];

/** 온보딩 기본 난이도 — difficulty_balance_system의 DEFAULT_DIFFICULTY(3)와 동일한 기본값 */
export const ONBOARDING_DEFAULT_DIFFICULTY: OnboardingDifficulty = 3;

/** 총 단계 수 — tutorial_system의 단계 배열 길이를 그대로 사용 (중복 정의 금지) */
export const ONBOARDING_TOTAL_STEPS: number = TUTORIAL_STEPS.length;

/** 온보딩에서 고를 수 있는 난이도 목록 */
export const ONBOARDING_DIFFICULTIES: readonly OnboardingDifficulty[] = [1, 2, 3, 4, 5];

/**
 * 온보딩 상태 스냅샷 — 모든 필드는 readonly이며, 전이는 항상 새 객체를 반환한다.
 * (기존 state_immutability 규약과 동일: 외부에서 직접 변형하지 않는다.)
 */
export interface OnboardingState {
    /** 현재 온보딩 단계 인덱스 (0-based, TUTORIAL_STEPS 기준) */
    readonly stepIndex: number;
    /** 온보딩 수명주기 상태 */
    readonly status: OnboardingStatus;
    /** 이미 지나온 단계 인덱스들 — 정렬·중복 없는 불변 배열로 유지 */
    readonly visitedStepIndexes: readonly number[];
    /** 온보딩에서 고른 난이도 (선택 전이면 기본값) */
    readonly difficulty: OnboardingDifficulty;
    /** 온보딩에서 고른 시작 세력 (선택 전이면 null) */
    readonly startingFaction: OnboardingStartingFaction | null;
    /** '나중에 보기'로 미룬 시점의 단계 인덱스 — 재오ffer 시 어디로 돌아갈지 알 수 있음 */
    readonly deferredAtStep: number | null;
    /** '다시 보지 않기'로 닫았는지 — UI가 재오퍼를 막을 때 사용 */
    readonly dismissed: boolean;
}

/**
 * localStorage의 최소 인터페이스 — 브라우저 localStorage도 이 모양이므로 그대로 주입 가능.
 * 스토리지가 없거나 접근이 막힌 환경(사파리 프라이빗 등)에서는 전부 안전하게 no-op 처리된다.
 */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** 전역 localStorage를 안전하게 얻는다. 없으면 null(=no storage) */
function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== 'undefined' ? (localStorage as StorageLike) : null;
    } catch {
        // 스토리지 접근 자체가 예외를 던지는 환경
        return null;
    }
}

/** 새 온보딩의 초기 상태를 만든다. 인자 없이 순수하게 동작한다. */
export function createInitialOnboardingState(): OnboardingState {
    return {
        stepIndex: 0,
        status: 'active',
        visitedStepIndexes: [0],
        difficulty: ONBOARDING_DEFAULT_DIFFICULTY,
        startingFaction: null,
        deferredAtStep: null,
        dismissed: false,
    };
}

/** 온보딩 전체 진행률(0~1) — 분모 0 방어 포함 */
export function onboardingProgress(state: OnboardingState): number {
    if (ONBOARDING_TOTAL_STEPS <= 0) return 1;
    return clamp01((state.stepIndex + 1) / ONBOARDING_TOTAL_STEPS);
}

/** 진행률 백분율 정수(0~100) — 패널의 "3/10" 표기용 */
export function onboardingProgressPercent(state: OnboardingState): number {
    return Math.round(onboardingProgress(state) * 100);
}

/** 현재 단계가 마지막인지 — 다음 버튼 숨김 판단용 */
export function isLastOnboardingStep(state: OnboardingState): boolean {
    return state.stepIndex >= ONBOARDING_TOTAL_STEPS - 1;
}

/** 온보딩을 지금 띄워야 하는가 — 닫기/완료된 플레이어는 재오퍼하지 않는다. */
export function shouldShowOnboarding(state: OnboardingState): boolean {
    return state.status === 'active' && !state.dismissed;
}

/** 온보딩을 끝까지 마쳤는가 (튜토리얼 완료 플래그와는 별개 상태로 관리) */
export function isOnboardingComplete(state: OnboardingState): boolean {
    return state.status === 'completed';
}

/** 온보딩 기본값으로 되돌린다 (순수) — 재생을 위한 reset()의 논리 부분 */
export function resetOnboardingState(): OnboardingState {
    return createInitialOnboardingState();
}

/** 특정 단계로 이동한다 (순수) — 범위를 벗어나면 클램프 */
export function goToStep(state: OnboardingState, stepIndex: number): OnboardingState {
    return advanceToStep(state, stepIndex);
}

/** 다음 단계로 이동 (순수). 마지막 단계면 이동하지 않고 그 상태를 그대로 반환. */
export function nextStep(state: OnboardingState): OnboardingState {
    if (isLastOnboardingStep(state)) return state;
    return advanceToStep(state, state.stepIndex + 1);
}

/** 이전 단계로 이동 (순수). 첫 단계면 이동하지 않는다. */
export function prevStep(state: OnboardingState): OnboardingState {
    return advanceToStep(state, state.stepIndex - 1);
}

/** 완료 처리 (순수) — 마지막 단계까지 도달했을 때 호출 */
export function completeOnboarding(state: OnboardingState): OnboardingState {
    return {
        ...state,
        status: 'completed',
        stepIndex: clampIndex(state.stepIndex),
        visitedStepIndexes: markVisited(state.visitedStepIndexes, state.stepIndex),
        deferredAtStep: null,
    };
}

/** '나중에 보기' — 지금 닫되 상태를 기억해 다음 오프너에 이어서 보여준다 (순수) */
export function deferOnboarding(state: OnboardingState): OnboardingState {
    return {
        ...state,
        status: 'deferred',
        stepIndex: clampIndex(state.stepIndex),
        visitedStepIndexes: markVisited(state.visitedStepIndexes, state.stepIndex),
        deferredAtStep: clampIndex(state.stepIndex),
        dismissed: false,
    };
}

/** '다시 보지 않기' — 재오퍼 없이 영구 닫기 (순수) */
export function dismissOnboarding(state: OnboardingState): OnboardingState {
    return {
        ...state,
        status: 'dismissed',
        stepIndex: clampIndex(state.stepIndex),
        visitedStepIndexes: markVisited(state.visitedStepIndexes, state.stepIndex),
        deferredAtStep: null,
        dismissed: true,
    };
}

/** 닫혔던 온보딩을 미룬 지점부터 다시 연다 (순수) */
export function resumeOnboarding(state: OnboardingState): OnboardingState {
    return {
        ...state,
        status: 'active',
        stepIndex: clampIndex(state.deferredAtStep ?? 0),
        deferredAtStep: null,
        dismissed: false,
    };
}

/** 난이도 선택 기록 (순수) — 범위를 벗어나면 1~5로 정규화 */
export function setOnboardingDifficulty(
    state: OnboardingState,
    difficulty: number,
): OnboardingState {
    return { ...state, difficulty: normalizeDifficulty(difficulty) };
}

/** 시작 세력 선택 기록 (순수) — null은 '선택 전'으로 되돌리는 것도 허용 */
export function setStartingFaction(
    state: OnboardingState,
    faction: OnboardingStartingFaction | null,
): OnboardingState {
    return { ...state, startingFaction: normalizeFaction(faction) };
}

// ---------------------------------------------------- (de)serialization

/** 온보딩에서 수집한 시작 설정 — 게임 시작 화면이 그대로 쓸 수 있는 평범한 값 */
export interface OnboardingPreferences {
    readonly difficulty: OnboardingDifficulty;
    readonly startingFaction: OnboardingStartingFaction | null;
}

/** 온보딩 취향만 골라낸다 (순수) — 다른 상태 필드는 필요 없는 호출자를 위해 분리 */
export function getOnboardingPreferences(state: OnboardingState): OnboardingPreferences {
    return { difficulty: state.difficulty, startingFaction: state.startingFaction };
}

/** 상태를 저장용 문자열로 직렬화 (순수) — 키 순서를 고정해 출력을 결정론적으로 만든다. */
export function serializeOnboardingState(state: OnboardingState): string {
    return JSON.stringify({
        stepIndex: clampIndex(state.stepIndex),
        status: state.status,
        visitedStepIndexes: [...state.visitedStepIndexes].sort((a, b) => a - b),
        difficulty: normalizeDifficulty(state.difficulty),
        startingFaction: normalizeFaction(state.startingFaction),
        deferredAtStep: state.deferredAtStep === null ? null : clampIndex(state.deferredAtStep),
        dismissed: state.dismissed === true,
    });
}

/**
 * 저장 문자열을 상태로 되돌린다 (순수).
 * 손상되었거나 알 수 없는 값이면 null을 돌려주고, 호출자가 초기 상태로 대체한다.
 */
export function deserializeOnboardingState(raw: string | null): OnboardingState | null {
    if (raw === null || raw === '') return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    return normalizeOnboardingState(parsed);
}

/**
 * 외부에서 들어온 임의의 값을 온보딩 상태로 정규화한다 (순수).
 * 구버전/부분 저장본도 안전하게 흡수하며, 알 수 없는 값만 기본값으로 대체한다.
 */
export function normalizeOnboardingState(input: unknown): OnboardingState | null {
    if (typeof input !== 'object' || input === null) return null;
    const rec = input as Record<string, unknown>;
    if (typeof rec.stepIndex !== 'number' || !Number.isFinite(rec.stepIndex)) return null;

    const status = normalizeStatus(rec.status);
    return {
        stepIndex: clampIndex(rec.stepIndex),
        status,
        visitedStepIndexes: normalizeVisited(rec.visitedStepIndexes, rec.stepIndex),
        difficulty: normalizeDifficulty(rec.difficulty),
        startingFaction: normalizeFaction(rec.startingFaction),
        deferredAtStep: typeof rec.deferredAtStep === 'number' ? clampIndex(rec.deferredAtStep) : null,
        // 'dismissed' 상태면 dismissed도 참이어야 상태가 뒤집히지 않는다
        dismissed: status === 'dismissed' || rec.dismissed === true,
    };
}

// ------------------------------------------------------------ store class

/**
 * 온보딩 상태 저장소 — localStorage 부작용은 이 클래스에만 존재한다.
 * panel(worker 2)은 이 타입을 통해 읽고, 테스트는 메모리 스토리지를 주입한다.
 */
export class OnboardingStateStore {
    private readonly storage: StorageLike | null;
    private readonly key: string;
    private cache: OnboardingState;

    constructor(
        storage: StorageLike | null = defaultStorage(),
        key: string = ONBOARDING_STORAGE_KEY,
    ) {
        this.storage = storage;
        this.key = key;
        this.cache = this.read();
    }

    /** 사용 중인 스토리지 키 */
    get storageKey(): string {
        return this.key;
    }

    /** 현재 상태 스냅샷 (불변 객체) */
    getState(): OnboardingState {
        return this.cache;
    }

    /** 현재 상태를 새 객체로 전이하고 그 결과를 반환한다. 모든 mutator는 이 경로를 지난다. */
    update(mutator: (prev: OnboardingState) => OnboardingState): OnboardingState {
        const next = mutator(this.cache);
        this.cache = next;
        this.persist();
        return this.cache;
    }

    goToStep(stepIndex: number): OnboardingState { return this.update((s) => goToStep(s, stepIndex)); }
    next(): OnboardingState { return this.update(nextStep); }
    prev(): OnboardingState { return this.update(prevStep); }
    complete(): OnboardingState { return this.update(completeOnboarding); }
    defer(): OnboardingState { return this.update(deferOnboarding); }
    dismiss(): OnboardingState { return this.update(dismissOnboarding); }
    resume(): OnboardingState { return this.update(resumeOnboarding); }
    setDifficulty(difficulty: number): OnboardingState {
        return this.update((s) => setOnboardingDifficulty(s, difficulty));
    }
    setStartingFaction(faction: OnboardingStartingFaction | null): OnboardingState {
        return this.update((s) => setStartingFaction(s, faction));
    }

    /**
     * 온보딩을 처음부터 다시 — 온보딩 키만 초기 상태로 덮어쓴다.
     * 튜토리얼 완료 키(rtk8_tutorial_done)는 절대 건드리지 않는다.
     */
    reset(): OnboardingState {
        this.cache = resetOnboardingState();
        this.persist();
        return this.cache;
    }

    /** 외부(다른 탭/설정 화면)에서 바꾼 값을 다시 읽는다 */
    reload(): OnboardingState {
        this.cache = this.read();
        return this.cache;
    }

    private persist(): void {
        try {
            this.storage?.setItem(this.key, serializeOnboardingState(this.cache));
        } catch {
            // 용량 초과/프라이빗 모드 — 세션 내 상태만 유지한다
        }
    }

    private read(): OnboardingState {
        let raw: string | null = null;
        try {
            raw = this.storage?.getItem(this.key) ?? null;
        } catch {
            raw = null;
        }
        return deserializeOnboardingState(raw) ?? createInitialOnboardingState();
    }
}

// ----------------------------------------------- module-level entry points

/** 모듈 전역 기본 저장소 — main.ts가 import해 쓰는 진입점 (테스트는 위 클래스를 직접 주입해 쓴다) */
const defaultStore = new OnboardingStateStore();

export function getOnboardingState(): OnboardingState { return defaultStore.getState(); }
export function setOnboardingStep(index: number): OnboardingState { return defaultStore.goToStep(index); }
export function advanceOnboardingStep(): OnboardingState { return defaultStore.next(); }
export function retreatOnboardingStep(): OnboardingState { return defaultStore.prev(); }
export function completeOnboardingFlow(): OnboardingState { return defaultStore.complete(); }
export function deferOnboardingFlow(): OnboardingState { return defaultStore.defer(); }
export function dismissOnboardingFlow(): OnboardingState { return defaultStore.dismiss(); }
export function resumeOnboardingFlow(): OnboardingState { return defaultStore.resume(); }
export function applyOnboardingDifficulty(difficulty: number): OnboardingState {
    return defaultStore.setDifficulty(difficulty);
}
export function applyStartingFaction(faction: OnboardingStartingFaction | null): OnboardingState {
    return defaultStore.setStartingFaction(faction);
}
/** 온보딩 재생용 리셋 — 전역 저장소 기준 */
export function resetOnboarding(): OnboardingState { return defaultStore.reset(); }

// ---------------------------------------------------------------- helpers

function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** 0 ~ ONBOARDING_TOTAL_STEPS-1 사이로 클램프. 단계가 0개면 0. */
function clampIndex(index: number): number {
    const max = Math.max(0, ONBOARDING_TOTAL_STEPS - 1);
    if (!Number.isFinite(index)) return 0;
    const int = Math.trunc(index);
    return int < 0 ? 0 : int > max ? max : int;
}

function normalizeDifficulty(value: unknown): OnboardingDifficulty {
    if (typeof value !== 'number' || !Number.isFinite(value)) return ONBOARDING_DEFAULT_DIFFICULTY;
    const int = Math.trunc(value);
    if (int < 1) return 1;
    if (int > 5) return 5;
    return int as OnboardingDifficulty;
}

function normalizeFaction(value: unknown): OnboardingStartingFaction | null {
    if (value === null || value === undefined) return null;
    return ONBOARDING_FACTION_OPTIONS.some((o) => o.id === value)
        ? (value as OnboardingStartingFaction)
        : null;
}

function normalizeStatus(value: unknown): OnboardingStatus {
    return value === 'completed' || value === 'deferred' || value === 'dismissed' || value === 'active'
        ? value
        : 'active';
}

function markVisited(visited: readonly number[], stepIndex: number): readonly number[] {
    const set = new Set<number>(visited.map(clampIndex));
    set.add(clampIndex(stepIndex));
    return [...set].sort((a, b) => a - b);
}

function normalizeVisited(visited: unknown, currentStep: number): readonly number[] {
    const list = Array.isArray(visited) ? visited.filter((n): n is number => typeof n === 'number') : [];
    return markVisited(list, currentStep);
}

function advanceToStep(state: OnboardingState, stepIndex: number): OnboardingState {
    const next = clampIndex(stepIndex);
    return {
        ...state,
        stepIndex: next,
        visitedStepIndexes: markVisited(state.visitedStepIndexes, next),
    };
}

