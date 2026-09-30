/**
 * [461-480] 온보딩 상태 저장소 단위 테스트
 * 파일: tests/onboarding_state.test.ts
 *
 * 소유권(ONBOARDING-WORKTREES.md PR1): 대상은 src/core/onboarding_state.ts.
 * 이 테스트는 그 모듈을 "명세"로 삼는다. 구현이 없으면 모듈 해석 실패로
 * 전부 red 가 되고, PR1 이 병합되면 green 이 된다.
 *
 * 검증 축:
 * - 단계 이동이 양쪽 끝에서 클램프되는가
 * - 완료 기록이 samgukzi_return_tutorial_done 이 아닌 별도 키에 남는가 (기존 튜토리얼 보존)
 * - reset 이 첫 실행 상태로 되돌리는가
 * - Math.random / Date.now 같은 비순수 호출로 결과가 흔들리지 않는가
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    ONBOARDING_STORAGE_KEY,
    ONBOARDING_TOTAL_STEPS,
    ONBOARDING_DEFAULT_DIFFICULTY,
    ONBOARDING_FACTION_OPTIONS,
    ONBOARDING_DIFFICULTIES,
    OnboardingStateStore,
    createInitialOnboardingState,
    resetOnboardingState,
    nextStep,
    prevStep,
    goToStep,
    completeOnboarding,
    deferOnboarding,
    dismissOnboarding,
    resumeOnboarding,
    isLastOnboardingStep,
    shouldShowOnboarding,
    isOnboardingComplete,
    onboardingProgress,
    setOnboardingDifficulty,
    setStartingFaction,
    getOnboardingPreferences,
    serializeOnboardingState,
    deserializeOnboardingState,
} from '../src/core/onboarding_state.js';
import type { OnboardingState, StorageLike } from '../src/core/onboarding_state.js';
import { TUTORIAL_STEPS } from '../src/core/tutorial_system.js';

/** 기존 튜토리얼 완료 키 — 온보딩이 이걸 덮어쓰면 안 된다 */
const TUTORIAL_KEY = 'samgukzi_return_tutorial_done';

/** 쓰기 이력을 모두 기록하는 메모리 스토리지 */
function createMemoryStorage(seed: Record<string, string> = {}): StorageLike & { writes: string[] } {
    const data: Record<string, string> = { ...seed };
    // `this` 는 화살표 함수에서 바인딩되지 않으므로 클로저 변수를 쓴다.
    const writes: string[] = [];
    return {
        writes,
        getItem: (k: string) => (k in data ? data[k] : null),
        setItem: (k: string, v: string) => { data[k] = v; writes.push(k); },
        removeItem: (k: string) => { delete data[k]; },
    };
}

const LAST_INDEX = ONBOARDING_TOTAL_STEPS - 1;


describe('[461-480] 온보딩 상태 · 단계 이동 경계 클램프', () => {
    it('단계 수는 튜토리얼 단계 배열에서 파생된다 (중복 정의 금지)', () => {
        expect(ONBOARDING_TOTAL_STEPS).toBe(TUTORIAL_STEPS.length);
        expect(ONBOARDING_TOTAL_STEPS).toBeGreaterThan(0);
    });

    it('초기 상태는 0단계·active이며 첫 실행으로 시작한다', () => {
        const s = createInitialOnboardingState();
        expect(s.stepIndex).toBe(0);
        expect(s.status).toBe('active');
        expect(s.dismissed).toBe(false);
        expect(s.startingFaction).toBeNull();
        expect(s.deferredAtStep).toBeNull();
        expect(s.difficulty).toBe(ONBOARDING_DEFAULT_DIFFICULTY);
    });

    it('첫 단계에서 prev 를 눌러도 0단계에 머문다 (하단 클램프)', () => {
        const s = prevStep(createInitialOnboardingState());
        expect(s.stepIndex).toBe(0);
    });

    it('마지막 단계에서 next 를 눌러도 마지막에 머문다 (상단 클램프)', () => {
        let s = goToStep(createInitialOnboardingState(), LAST_INDEX);
        expect(s.stepIndex).toBe(LAST_INDEX);
        expect(isLastOnboardingStep(s)).toBe(true);
        for (let i = 0; i < 25; i++) s = nextStep(s); // 끝까지 밀어도 안전해야 한다
        expect(s.stepIndex).toBe(LAST_INDEX);
        expect(isLastOnboardingStep(s)).toBe(true);
    });

    it('next/prev 가 한 단계씩 오르내린다', () => {
        const s0 = createInitialOnboardingState();
        const s1 = nextStep(s0);
        expect(s1.stepIndex).toBe(1);
        expect(prevStep(s1).stepIndex).toBe(0);
    });

    it('goToStep 은 범위를 벗어난 값을 클램프한다', () => {
        const s0 = createInitialOnboardingState();
        expect(goToStep(s0, -999).stepIndex).toBe(0);
        expect(goToStep(s0, 9999).stepIndex).toBe(LAST_INDEX);
        expect(goToStep(s0, Number.NaN).stepIndex).toBe(0);
    });

    it('방문한 단계는 정렬·중복 없는 불변 배열로 쌓인다', () => {
        let s = createInitialOnboardingState();
        s = nextStep(s);
        s = prevStep(s);
        s = nextStep(s);
        expect(s.visitedStepIndexes).toEqual([0, 1]);
    });

    it('진행률은 0~1 을 벗어나지 않는다', () => {
        const s0 = createInitialOnboardingState();
        const s1 = goToStep(s0, LAST_INDEX);
        expect(onboardingProgress(s0)).toBeGreaterThan(0);
        expect(onboardingProgress(s0)).toBeLessThanOrEqual(1);
        expect(onboardingProgress(s1)).toBe(1);
    });
});

describe('[461-480] 온보딩 상태 · 완료 기록은 튜토리얼 키를 건드리지 않는다', () => {
    let storage: ReturnType<typeof createMemoryStorage>;

    beforeEach(() => {
        storage = createMemoryStorage();
    });

    it('저장 키가 기존 튜토리얼 키와 다르다', () => {
        expect(ONBOARDING_STORAGE_KEY).not.toBe(TUTORIAL_KEY);
    });

    it('완료하면 온보딩 키에만 기록된다', () => {
        const store = new OnboardingStateStore(storage);
        store.complete();
        expect(storage.writes.length).toBeGreaterThan(0);
        expect(storage.writes.every((k) => k === ONBOARDING_STORAGE_KEY)).toBe(true);
    });

    it('완료 기록이 튜토리얼 완료 키를 덮어쓰지 않는다', () => {
        // 튜토리얼은 이미 완료된 플레이어 → 온보딩을 끝내도 그대로여야 한다
        const seeded = createMemoryStorage({ [TUTORIAL_KEY]: 'done' });
        const store = new OnboardingStateStore(seeded);
        store.complete();
        expect(seeded.getItem(TUTORIAL_KEY)).toBe('done');
    });

    it('온보딩 키가 없더라도 튜토리얼 키는 새로 생기지 않는다', () => {
        const store = new OnboardingStateStore(storage);
        store.complete();
        expect(storage.getItem(TUTORIAL_KEY)).toBeNull();
    });

    it('완료 상태는 새 저장소 인스턴스에서도 복원된다', () => {
        const store = new OnboardingStateStore(storage);
        store.complete();
        expect(isOnboardingComplete(store.getState())).toBe(true);
        expect(shouldShowOnboarding(store.getState())).toBe(false);

        const reopened = new OnboardingStateStore(storage);
        expect(isOnboardingComplete(reopened.getState())).toBe(true);
        expect(shouldShowOnboarding(reopened.getState())).toBe(false);
    });

    it('완료 전에는 다시 띄워야 한다 (첫 실행 판정)', () => {
        const store = new OnboardingStateStore(storage);
        expect(shouldShowOnboarding(store.getState())).toBe(true);
        expect(isOnboardingComplete(store.getState())).toBe(false);
    });

    it('브라우저 localStorage 경로에서도 온보딩 키에만 쓴다', () => {
        // 기본 스토리지 경로(=전역 localStorage)도 같은 키 규약을 지켜야 한다
        const data: Record<string, string> = { [TUTORIAL_KEY]: 'done' };
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => (k in data ? data[k] : null),
            setItem: (k: string, v: string) => { data[k] = v; },
            removeItem: (k: string) => { delete data[k]; },
        });
        try {
            const store = new OnboardingStateStore();
            expect(store.storageKey).toBe(ONBOARDING_STORAGE_KEY);
            store.complete();
            expect(data[ONBOARDING_STORAGE_KEY]).toBeDefined();
            expect(data[TUTORIAL_KEY]).toBe('done');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('[461-480] 온보딩 상태 · 닫기/미루기/다시보기 수명주기', () => {
    it('나중에 보기로 미루면 그 지점을 기억한다', () => {
        const s = deferOnboarding(goToStep(createInitialOnboardingState(), 2));
        expect(s.status).toBe('deferred');
        expect(s.deferredAtStep).toBe(2);
        expect(shouldShowOnboarding(s)).toBe(false);
    });

    it('다시 보기로 열면 미뤘던 지점에서 이어진다', () => {
        const deferred = deferOnboarding(goToStep(createInitialOnboardingState(), 2));
        const resumed = resumeOnboarding(deferred);
        expect(resumed.status).toBe('active');
        expect(resumed.stepIndex).toBe(2);
        expect(resumed.deferredAtStep).toBeNull();
        expect(shouldShowOnboarding(resumed)).toBe(true);
    });

    it('다시 보지 않기로 닫으면 재오퍼하지 않는다', () => {
        const dismissed = dismissOnboarding(createInitialOnboardingState());
        expect(dismissed.status).toBe('dismissed');
        expect(dismissed.dismissed).toBe(true);
        expect(shouldShowOnboarding(dismissed)).toBe(false);
    });

    it('완료는 미루기 상태를 덮어쓴다', () => {
        const completed = completeOnboarding(deferOnboarding(createInitialOnboardingState()));
        expect(completed.status).toBe('completed');
        expect(completed.deferredAtStep).toBeNull();
    });
});

describe('[461-480] 온보딩 상태 · reset 은 첫 실행으로 되돌린다', () => {
    it('순수 reset 은 초기 상태와 같다', () => {
        const dirty = completeOnboarding(
            setStartingFaction(setOnboardingDifficulty(createInitialOnboardingState(), 5), 'shu'),
        );
        expect(dirty).not.toEqual(createInitialOnboardingState());
        expect(resetOnboardingState()).toEqual(createInitialOnboardingState());
    });

    it('reset 은 단계 0 · active · 선택값 초기화로 돌아간다', () => {
        const store = new OnboardingStateStore(createMemoryStorage());
        store.goToStep(4);
        store.setDifficulty(1);
        store.setStartingFaction('wu');
        store.complete();

        const after = store.reset();
        expect(after.stepIndex).toBe(0);
        expect(after.status).toBe('active');
        expect(after.difficulty).toBe(ONBOARDING_DEFAULT_DIFFICULTY);
        expect(after.startingFaction).toBeNull();
        expect(isOnboardingComplete(after)).toBe(false);
        expect(shouldShowOnboarding(after)).toBe(true);
    });

    it('reset 후에도 다시 정상적으로 진행된다', () => {
        const store = new OnboardingStateStore(createMemoryStorage());
        store.complete();
        store.reset();
        expect(nextStep(store.getState()).stepIndex).toBe(1);
    });
});

describe('[461-480] 온보딩 상태 · 선택값 정규화', () => {
    it('난이도는 1~5 로 정규화된다', () => {
        const s0 = createInitialOnboardingState();
        expect(setOnboardingDifficulty(s0, 0).difficulty).toBe(1);
        expect(setOnboardingDifficulty(s0, 99).difficulty).toBe(5);
        expect(setOnboardingDifficulty(s0, Number.NaN).difficulty).toBe(ONBOARDING_DEFAULT_DIFFICULTY);
        for (const d of ONBOARDING_DIFFICULTIES) {
            expect(setOnboardingDifficulty(s0, d).difficulty).toBe(d);
        }
    });

    it('시작 세력은 등록된 후보만 받는다', () => {
        const s0 = createInitialOnboardingState();
        expect(ONBOARDING_FACTION_OPTIONS.length).toBeGreaterThan(0);
        for (const opt of ONBOARDING_FACTION_OPTIONS) {
            expect(setStartingFaction(s0, opt.id).startingFaction).toBe(opt.id);
        }
    });

    it('취향 스냅샷은 난이도와 세력만 담는다', () => {
        const s = setStartingFaction(setOnboardingDifficulty(createInitialOnboardingState(), 4), 'wei');
        expect(getOnboardingPreferences(s)).toEqual({ difficulty: 4, startingFaction: 'wei' });
    });
});

describe('[461-480] 온보딩 상태 · 직렬화 왕복', () => {
    it('직렬화 → 역직렬화 로 상태가 보존된다', () => {
        const original: OnboardingState = setStartingFaction(
            goToStep(createInitialOnboardingState(), 3),
            'custom',
        );
        const restored = deserializeOnboardingState(serializeOnboardingState(original));
        expect(restored).toEqual(original);
    });

    it('손상된 저장본은 null 로 무효 처리된다', () => {
        expect(deserializeOnboardingState('{')).toBeNull();
        expect(deserializeOnboardingState('')).toBeNull();
        expect(deserializeOnboardingState('"문자열"')).toBeNull();
    });

    it('저장본의 범위를 벗어나는 값도 클램프되어 읽힌다', () => {
        const restored = deserializeOnboardingState(
            '{"stepIndex":9999,"status":"active","visitedStepIndexes":[],'
            + '"difficulty":42,"startingFaction":"진짜세력","deferredAtStep":null,"dismissed":false}',
        );
        expect(restored).not.toBeNull();
        expect(restored!.stepIndex).toBe(LAST_INDEX);
        expect(restored!.difficulty).toBe(5);
        expect(restored!.startingFaction).toBeNull();
    });
});

describe('[461-480] 온보딩 상태 · 결정론 (비순수 호출 금지)', () => {
    it('소스에 난수·시각 생성기가 쓰이지 않는다 (주석 제외)', () => {
        const source = readFileSync(new URL('../src/core/onboarding_state.ts', import.meta.url), 'utf8');
        // 문서 주석에 "Math.random 을 쓰지 않는다" 는 설명이 있으므로 코드로만 검사한다.
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        expect(code).not.toMatch(/Math\s*\.\s*random/);
        expect(code).not.toMatch(/Date\s*\.\s*now/);
        expect(code).not.toMatch(/new\s+Date\s*\(/);
    });

    it('같은 입력이면 전이 결과가 매번 같다', () => {
        const s0 = createInitialOnboardingState();
        expect(nextStep(s0)).toEqual(nextStep(s0));
        expect(goToStep(s0, 2)).toEqual(goToStep(s0, 2));
        expect(completeOnboarding(s0)).toEqual(completeOnboarding(s0));
        expect(resetOnboardingState()).toEqual(resetOnboardingState());
    });

    it('직렬화 문자열도 결정론적이다', () => {
        const s = goToStep(createInitialOnboardingState(), 1);
        expect(serializeOnboardingState(s)).toBe(serializeOnboardingState(s));
    });

    it('초기 상태를 여러 번 만들어도 값이 흔들리지 않는다', () => {
        const a = createInitialOnboardingState();
        const b = createInitialOnboardingState();
        expect(a).toEqual(b);
        expect(a).not.toBe(b); // 서로 다른 객체지만 값은 같아야 한다
    });
});

