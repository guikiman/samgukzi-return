/**
 * 무장편집 — "이 무장으로 어느 시나리오를 플레이할 수 있는가" 를 계산한다.
 *
 * 왜 순수 함수인가:
 * - 생년 하나를 바꾸면 시나리오 목록 전체가 달라진다. DOM 을 직접 만지면
 *   어떤 조합에서 목록이 비는지 재현이 어렵다.
 * - 판정 규칙은 플레이 가능/불가 + 이유(문구)를 함께 돌려줘야 UI 가
 *   '왜 안 되지?' 를 설명할 수 있다.
 *
 * 데이터는 두 갈래다:
 * - officers_full.json 의 1200인 = '기존 무장'. 여기서 골라 편집한다.
 * - 신규 무장은 사용자가 직접 입력한다. DB 에 없으므로 별도 경로다.
 */

import type { ScenarioData } from './scenario_system.js';
import { countWorldFactions } from './scenario_system.js';

/** 무장편집에서 다루는 최소 정보. 기존/신규를 같은 형태로 다룬다. */
export interface EditableOfficer {
    id: string;
    name: string;
    gender: 'M' | 'F';
    /** null = 자료에 없는 값. 0 으로 위장하지 않는다. */
    birthYear: number | null;
    deathYear: number | null;
    /** 성급(grade). 낮을수록 신입. null 가능 */
    grade: number | null;
    traits: string[];
}

export type PlayabilityReason =
    | { ok: true; age: number; note: string }
    | {
        ok: false;
        code: 'DEAD' | 'TOO_YOUNG' | 'TOO_OLD' | 'NO_BIRTH_YEAR' | 'NO_FACTION';
        reason: string;
    };

/** 플레이 시 최소 나이. 너무 어리면 심부름/배_COMMAND 가 성립하지 않는다. */
export const MIN_AGE = 16;
/** 플레이 시 최대 나이. 이 이상은 등장이 아니라 유작(遺作) 대상이다. */
export const MAX_AGE = 60;

/**
 * 시나리오 시작 시점에서 이 무장이 플레이 가능한지 판정한다.
 * 이유를 같이 돌려줘야 UI 가 탈락 사유를 보여줄 수 있다.
 */
export function evaluatePlayability(officer: EditableOfficer, startYear: number): PlayabilityReason {
    // 사망 연도가 시작 연도 이하면 이미 죽은 상태다.
    if (officer.deathYear !== null && officer.deathYear <= startYear) {
        return { ok: false, code: 'DEAD', reason: `${startYear}년에 이미 사망한 무장입니다.` };
    }
    // 출생 연도를 모르면 연령을 못 정한다. 가짜 나이를 만들어내지 않는다.
    if (officer.birthYear === null) {
        return {
            ok: false,
            code: 'NO_BIRTH_YEAR',
            reason: '출생 연도가 없어 연령을 확인할 수 없습니다. 직접 입력해 주세요.',
        };
    }
    const age = startYear - officer.birthYear;
    if (age < MIN_AGE) {
        return { ok: false, code: 'TOO_YOUNG', reason: `시작 시 ${age}세 — 최소 ${MIN_AGE}세 이상이어야 합니다.` };
    }
    if (age > MAX_AGE) {
        return { ok: false, code: 'TOO_OLD', reason: `시작 시 ${age}세 — ${MAX_AGE}세 이하만 플레이할 수 있습니다.` };
    }
    return {
        ok: true,
        age,
        note: `${startYear}년 · ${age}세로 등장`,
    };
}

export interface ScenarioAvailability {
    scenario: ScenarioData;
    startYear: number;
    startMonth: number;
    factionCount: number;
    playability: PlayabilityReason;
}

/** 시나리오 전체를 판정 결과와 함께 돌려준다. 정렬은 호출자가 한다. */
export function evaluateScenarios(
    scenarios: readonly ScenarioData[],
    officer: EditableOfficer,
): ScenarioAvailability[] {
    return scenarios.map((scenario) => {
        const [year, month] = scenario.start_date.split('-');
        const startYear = Number(year);
        return {
            scenario,
            startYear,
            startMonth: Number(month) || 1,
            factionCount: countWorldFactions(scenario),
            playability: evaluatePlayability(officer, startYear),
        };
    });
}

/** 플레이 가능한 시나리오만, 시작 연도순으로. 동연도는 난이도순. */
export function playableScenarios(availabilities: ScenarioAvailability[]): ScenarioAvailability[] {
    return availabilities
        .filter(a => a.playability.ok)
        .sort((a, b) =>
            a.startYear !== b.startYear
                ? a.startYear - b.startYear
                : a.scenario.difficulty - b.scenario.difficulty,
        );
}
