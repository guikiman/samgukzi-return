/**
 * 도시 진입 화면의 무장 목록 — 도시 소속 + 재야(無所屬) 합치기.
 *
 * [왜 재야를 섞는가]
 * 登用(등용) 패널을 2026-09-30 에 통째로 삭제했다. 그 패널이 "등용 가능한 재야 무장" 을
 * 보여주던 유일한 자리였는데, 도시 무장 목록만 남으면 화면에서 재야 무장이 완전히 사라져
 * "등용할 사람이 없다" 는 사실과 "화면에 없다" 를 구분할 수 없게 된다. 목록에 합쳐
 * 두면 재야는 '재야' 라는 role 로 보인다.
 *
 * [재야의 범위는 "이 도시에 있는" 재야]
 * 월드 전체 재야를 넣으면 화면에 없는 무장이 뜨고, 무엇이 개입 가능한지 알 수 없다.
 * 도시 안에 있는 재야만 넣는다 — 그래야 이 화면의 다른 항목(시설·성주·배지) 과 같은
 * "지금 이 도시에 있는 것" 이라는 기준이 유지된다.
 *
 * 순수 함수로 뺀 이유: 합치기 규칙(중복 제거·재야 판정·정렬)이 DOM 없이 검증되어야
 * E2E 가 월드 상태(재야 몇 명인지)에 의존하지 않는다.
 */

import type { Officer } from './types.js';

/** 재야 판정 — 무소속이면서 자유 상태. 같은 값이어야 목록· recruits elsewhere 가 일치한다. */
export function isFreeOfficer(officer: Officer): boolean {
    return officer.factionId === null && officer.status === 'FREE';
}

/** 재야이면서 이 도시에 있는가 — 목록에 넣을 재야의 실제 조건. */
export function isFreeOfficerInCity(officer: Officer, cityId: string): boolean {
    return isFreeOfficer(officer) && officer.cityId === cityId;
}

/** 능력치 합 — 도시 소속 정렬 기준. */
function power(officer: Officer): number {
    return officer.stats.leadership + officer.stats.might;
}

/**
 * 도시 소속 무장 뒤에 "이 도시에 있는 재야" 를 붙인다.
 *
 * @param cityOfficers 도시에 배속된 무장 (순서 유지)
 * @param allOfficers 월드 전체 무장 — 여기서 이 도시의 재야만 뽑아 붙인다
 * @param cityId 현재 보고 있는 도시
 * @param isFree 재야 판정 (기본값은 isFreeOfficerInCity). 테스트에서 경계를 좁히려고 쓴다.
 */
export function mergeCityAndFreeOfficers(
    cityOfficers: readonly Officer[],
    allOfficers: readonly Officer[],
    cityId: string,
    isFree: (officer: Officer, cityId: string) => boolean = isFreeOfficerInCity,
): Officer[] {
    const seen = new Set(cityOfficers.map(o => o.id));
    const free = allOfficers
        .filter(o => isFree(o, cityId) && !seen.has(o.id))
        .sort((a, b) => power(b) - power(a));
    return [...cityOfficers, ...free];
}

/** 목록에 보여줄 role 라벨 — 도시 소속과 재야를 한 줄로 구분한다. */
export function officerRoleLabel(officer: Officer, leaderId: string | null): string {
    if (isFreeOfficer(officer)) return '재야';
    if (officer.id === leaderId) return '군주';
    return officer.rank >= 5 ? '장군' : '무관';
}
