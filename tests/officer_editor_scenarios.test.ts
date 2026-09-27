/**
 * 무장편집 — 시나리오 판정 로직.
 *
 * "이 무장으로 어떤 시나리오를 탈 수 있는가" 는 화면 모양과 무관한 판정이므로
 * 순수 함수로 두고 여기서 전부 확인한다. UI 는 이 결과를 그리기만 한다.
 */
import { describe, it, expect } from 'vitest';
import {
    evaluatePlayability,
    evaluateScenarios,
    playableScenarios,
    MIN_AGE,
    MAX_AGE,
} from '../src/core/officer_editor_scenarios.js';
import type { EditableOfficer } from '../src/core/officer_editor_scenarios.js';
import scenariosData from '../src/data/scenarios/index.json' with { type: 'json' };
import type { ScenarioData } from '../src/core/scenario_system.js';

const scenarios = scenariosData as ScenarioData[];

const officer = (over: Partial<EditableOfficer> = {}): EditableOfficer => ({
    id: 'off_x',
    name: '한중윤',
    gender: 'M',
    birthYear: 180,
    deathYear: null,
    grade: 3,
    traits: [],
    ...over,
});

describe('evaluatePlayability', () => {
    it('장수판(시작 시 만 30세)은 연령 내외로 통과한다', () => {
        const r = evaluatePlayability(officer({ birthYear: 164 }), 194);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.age).toBe(30);
    });

    it(`만 ${MIN_AGE}세 경계는 통과한다 (미만만 탈락)`, () => {
        expect(evaluatePlayability(officer({ birthYear: 194 - MIN_AGE }), 194).ok).toBe(true);
    });

    it(`만 ${MIN_AGE - 1}세는 너무 어리다`, () => {
        const r = evaluatePlayability(officer({ birthYear: 194 - MIN_AGE + 1 }), 194);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('TOO_YOUNG');
    });

    it(`만 ${MAX_AGE}세 경계는 통과한다 (초과만 탈락)`, () => {
        expect(evaluatePlayability(officer({ birthYear: 194 - MAX_AGE }), 194).ok).toBe(true);
    });

    it(`만 ${MAX_AGE + 1}세는 너무 많다`, () => {
        const r = evaluatePlayability(officer({ birthYear: 194 - MAX_AGE - 1 }), 194);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('TOO_OLD');
    });

    it('시작 연도 전에 죽었으면 사망으로 탈락한다', () => {
        const r = evaluatePlayability(officer({ birthYear: 180, deathYear: 190 }), 194);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('DEAD');
    });

    it('사망 연도 == 시작 연도 이면 이미 사망한 것으로 본다 (경계는 탈락)', () => {
        const r = evaluatePlayability(officer({ birthYear: 180, deathYear: 194 }), 194);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('DEAD');
    });

    it('살아남는다면 사망연도 이후 시나리오는 탈락하고 이전은 통과한다', () => {
        const p = officer({ birthYear: 170, deathYear: 200 });
        expect(evaluatePlayability(p, 190).ok).toBe(true);
        expect(evaluatePlayability(p, 194).ok).toBe(true);
        expect(evaluatePlayability(p, 207).ok).toBe(false);
    });

    it('출생연도 미상은 연령을 지어내지 않고 사유를 준다', () => {
        const r = evaluatePlayability(officer({ birthYear: null }), 194);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('NO_BIRTH_YEAR');
    });

    it('탈락 사유 문자열이 항상 채워진다 (빈 문구로 UI 가 비면 안 된다)', () => {
        for (const p of [officer({ birthYear: 200 }), officer({ birthYear: 100 }), officer({ deathYear: 190 })]) {
            const r = evaluatePlayability(p, 194);
            if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
        }
    });
});

describe('evaluateScenarios / playableScenarios', () => {
    it('모든 시나리오를 빠짐없이 판정한다', () => {
        const list = evaluateScenarios(scenarios, officer());
        expect(list).toHaveLength(scenarios.length);
    });

    it('판정 결과가 시작 연월을 숫자로 파싱한다', () => {
        const list = evaluateScenarios(scenarios, officer());
        const jan184 = list.find(a => a.scenario.id === '01')!;
        expect(jan184.startYear).toBe(184);
        expect(jan184.startMonth).toBe(1);
    });

    it('20세기생(190년생)은 184 시나리오를 탈 수 없다 (아직 태어나지 않음)', () => {
        const list = evaluateScenarios(scenarios, officer({ birthYear: 190 }));
        const y184 = list.find(a => a.scenario.id === '01')!; // 184-01
        expect(y184.playability.ok).toBe(false);
    });

    it('20세기생은 194 시나리오에서 아직 어리다 (4세)', () => {
        const list = evaluateScenarios(scenarios, officer({ birthYear: 190 }));
        const a = list.find(x => x.scenario.id === '03')!; // 194-01
        expect(a.playability.ok).toBe(false);
    });

    it('20세기생은 자기 시대 이후 시나리오를 통과한다 (207/220/234)', () => {
        const list = evaluateScenarios(scenarios, officer({ birthYear: 190 }));
        for (const id of ['05', '07', '06']) { // 207, 220, 234
            const a = list.find(x => x.scenario.id === id)!;
            expect(a.playability.ok, `scenario ${id}`).toBe(true);
        }
    });

    it('178년생은 184 시나리오에서 아직 6세라 탈락한다 (최소 16세)', () => {
        const list = evaluateScenarios(scenarios, officer({ birthYear: 178 }));
        const a = list.find(x => x.scenario.id === '01')!; // 184-01
        expect(a.playability.ok).toBe(false);
        if (!a.playability.ok) expect(a.playability.code).toBe('TOO_YOUNG');
    });

    it('160년생은 184 시나리오를 통과한다 (24세)', () => {
        const list = evaluateScenarios(scenarios, officer({ birthYear: 160 }));
        const a = list.find(x => x.scenario.id === '01')!;
        expect(a.playability.ok).toBe(true);
        if (a.playability.ok) expect(a.playability.age).toBe(24);
    });

    it('결과가 시작 연도 오름차순으로 정렬된다', () => {
        const list = playableScenarios(evaluateScenarios(scenarios, officer({ birthYear: 150 })));
        const years = list.map(a => a.startYear);
        expect(years).toEqual([...years].sort((a, b) => a - b));
    });

    it('탈락한 시나리오는 목록에 섞이지 않는다', () => {
        const list = playableScenarios(evaluateScenarios(scenarios, officer({ birthYear: 205 })));
        expect(list.every(a => a.playability.ok)).toBe(true);
        // 205년생은 184/190/194/200 에는 너무 어리다
        expect(list.map(a => a.scenario.id)).not.toContain('01');
    });

    it('중복 id 를 넣어도 결과가 안정적이다 (id 로 판정하지 않는다)', () => {
        const dup = [...scenarios, scenarios[0]];
        const list = evaluateScenarios(dup, officer());
        expect(list).toHaveLength(scenarios.length + 1);
        // 같은 시나리오가 두 번 평가되어도 둘 다 판정은 같다
        const same = list.filter(a => a.scenario.id === '01');
        expect(same).toHaveLength(2);
        expect(same[0].playability.ok).toBe(same[1].playability.ok);
    });

    it('빈 시나리오 목록이면 빈 결과 (예외 없음)', () => {
        expect(playableScenarios(evaluateScenarios([], officer()))).toEqual([]);
    });
});
