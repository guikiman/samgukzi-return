/**
 * 도시 무장 목록 — 재야 병합 규칙.
 *
 * 登用 패널을 지운 뒤 재야가 화면에서 사라지는 것을 막는 규칙이라, 월드 상태에 의존하지
 * 않도록 순수 함수로 검증한다.
 */
import { describe, it, expect } from 'vitest';
import {
    isFreeOfficer,
    isFreeOfficerInCity,
    mergeCityAndFreeOfficers,
    officerRoleLabel,
} from '../src/core/city_officer_roster';
import type { Officer } from '../src/core/types';

const CITY = 'city_target';

function officer(id: string, over: Partial<Officer> = {}): Officer {
    return {
        id,
        name: id,
        factionId: 'fac_wei',
        cityId: CITY,
        status: 'ACTIVE',
        rank: 3,
        stats: { leadership: 50, might: 50, intelligence: 50, politics: 50, charm: 50 },
        ...over,
    } as Officer;
}

const free = (id: string, power = 50, cityId: string = CITY): Officer =>
    officer(id, {
        factionId: null,
        status: 'FREE',
        cityId,
        stats: { leadership: power, might: power, intelligence: 10, politics: 10, charm: 10 },
    } as Partial<Officer>);

describe('isFreeOfficer', () => {
    it('무소속 + FREE 여야 재야다', () => {
        expect(isFreeOfficer(free('a'))).toBe(true);
    });

    it('무소속이어도 포로/기타 상태면 재야가 아니다', () => {
        expect(isFreeOfficer(officer('a', { factionId: null, status: 'PRISONER' }))).toBe(false);
    });

    it('FREE 여도 세력 소속이면 재야가 아니다', () => {
        expect(isFreeOfficer(officer('a', { factionId: 'fac_shu', status: 'FREE' }))).toBe(false);
    });
});

describe('isFreeOfficerInCity', () => {
    it('재야이면서 이 도시에 있으면 참', () => {
        expect(isFreeOfficerInCity(free('a'), CITY)).toBe(true);
    });

    it('재야여도 다른 도시면 거짓 — 목록에 뜨면 안 된다', () => {
        expect(isFreeOfficerInCity(free('a', 50, 'city_elsewhere'), CITY)).toBe(false);
    });

    it('도시 소속이면 재야가 아니므로 거짓', () => {
        expect(isFreeOfficerInCity(officer('a'), CITY)).toBe(false);
    });
});

describe('mergeCityAndFreeOfficers', () => {
    it('재야가 없으면 도시 소속 그대로 — 순서도 유지', () => {
        const city = [officer('c1'), officer('c2')];
        expect(mergeCityAndFreeOfficers(city, [officer('x')], CITY)).toEqual(city);
    });

    it('이 도시의 재야를 뒤에 붙인다', () => {
        const out = mergeCityAndFreeOfficers([officer('c1')], [officer('c2'), free('f1')], CITY);
        expect(out.map(o => o.id)).toEqual(['c1', 'f1']);
    });

    it('다른 도시의 재야는 넣지 않는다 — 화면에 없는 무장이 뜨면 안 된다', () => {
        const out = mergeCityAndFreeOfficers([], [free('here'), free('there', 90, 'city_elsewhere')], CITY);
        expect(out.map(o => o.id)).toEqual(['here']);
    });

    it('이미 목록에 있는 무장은 재야로 다시 붙이지 않는다 — 중복 방지', () => {
        const city = [officer('c1', { status: 'FREE', factionId: null })];
        const out = mergeCityAndFreeOfficers(city, [city[0]], CITY);
        expect(out).toHaveLength(1);
    });

    it('재야끼리는 통+무 합 내림차순', () => {
        const out = mergeCityAndFreeOfficers([], [free('low', 10), free('high', 90), free('mid', 50)], CITY);
        expect(out.map(o => o.id)).toEqual(['high', 'mid', 'low']);
    });

    it('세력 소속자는 재야로 뽑지 않는다', () => {
        const out = mergeCityAndFreeOfficers([], [officer('ally'), officer('ally2', { status: 'FREE' })], CITY);
        expect(out).toHaveLength(0);
    });

    it('판정 함수를 주입할 수 있다 — 경계를 좁혀 볼 때 쓴다', () => {
        const onlyX = mergeCityAndFreeOfficers([], [free('f1'), officer('c9')], CITY, o => o.id === 'c9');
        expect(onlyX.map(o => o.id)).toEqual(['c9']);
    });

    it('입력을 바꾸지 않는다', () => {
        const city = [officer('c1')];
        const all = [free('f1')];
        mergeCityAndFreeOfficers(city, all, CITY);
        expect(city).toHaveLength(1);
        expect(all).toHaveLength(1);
    });

    it('빈 입력도 안전하다', () => {
        expect(mergeCityAndFreeOfficers([], [], CITY)).toEqual([]);
    });
});

describe('officerRoleLabel', () => {
    it('군주는 군주', () => {
        expect(officerRoleLabel(officer('c1', { rank: 1 }), 'c1')).toBe('군주');
    });

    it('5품 이상은 장군, 미만은 무관', () => {
        expect(officerRoleLabel(officer('c1', { rank: 5 }), null)).toBe('장군');
        expect(officerRoleLabel(officer('c1', { rank: 4 }), null)).toBe('무관');
    });

    it('재야는 품과 무관하게 재야다', () => {
        // 도시 소속 군주라면 '군주' 가 되어야 하지만, 재야는 군주 될 수 없으므로 재야가 우선.
        expect(officerRoleLabel(free('f1'), 'f1')).toBe('재야');
    });
});
