/**
 * 무장편집 — 기존 무장 검색과 무작위 선택.
 *
 * officers_full.json 의 1200명을 브라우저에서 직접 필터링한다.
 * 1200건은 검색어 한 번에 전부 훑어도 수 ms 이므로 인덱스를 복잡하게 만들
 * 필요는 없다. 다만 렌더는 상위 N 건만 한다 (1200개 DOM 은 무겁다).
 */

import { OFFICER_PROFILES } from './officer_profile_schema.js';
import type { OfficerProfile } from './officer_profile_schema.js';
// EditableOfficer 는 여기서 정의하지 않는다. 시나리오 판정 모듈이 소유자다.
import { MIN_AGE, MAX_AGE } from './officer_editor_scenarios.js';
import type { EditableOfficer } from './officer_editor_scenarios.js';

/** 렌더 상한 — 이 이상은 스크롤을 만들어 UX 를 해친다. */
export const ROSTER_PAGE_SIZE = 60;

/** 공통 형태(EditableOfficer)로 변환 — 신규 무장과 같은 UI 를 재사용하기 위함. */
export function toEditable(profile: OfficerProfile): EditableOfficer {
    return {
        id: profile.id,
        name: profile.name,
        gender: profile.gender,
        // 출생연도 미상은 null 로 유지한다 — 0 으로 위장하면 판정이 틀어진다.
        birthYear: profile.birthYear,
        deathYear: profile.deathYear,
        grade: profile.grade,
        traits: profile.traits ?? [],
    };
}

/** 저장된 데이터셋을 순수 배열로 한 번만 만들어 둔다 (필터마다 재구축 금지). */
let CACHE: OfficerProfile[] | null = null;
function roster(): OfficerProfile[] {
    if (CACHE === null) CACHE = OFFICER_PROFILES.all();
    return CACHE;
}

export type RosterSort = 'birth-asc' | 'birth-desc' | 'playable';

export interface RosterQuery {
    /** 이름 부분 일치 */
    text?: string;
    gender?: 'M' | 'F' | null;
    /** null 이면 하한 없음 */
    birthMin?: number | null;
    birthMax?: number | null;
    limit?: number;
    /**
     * 정렬. 기본은 birth-asc (연생 순이라 예측 가능하다).
     * 편집 화면은 'playable' 을 쓴다 — 맨 앞 카드가 반드시 탈 수 있어야 하기 때문이다.
     * 연생/역연 어느 쪽으로도 이르지 못한다. 111년생은 너무 늙고 249년생은 아직 태어나지 않았다.
     */
    sort?: RosterSort;
    /** sort='playable' 일 때 판정 기준 연도 (보통 시나리오 시작 연도) */
    playableYears?: readonly number[];
}

/**
 * 검색. 결과는 생년 오름차순 — 편집 화면이 연령순으로 읽히기 쉽도록.
 * 검색어가 없으면 이름순이 아니라 생년순이 '어떤 세대인가' 를 빨리 알려준다.
 */
export function searchRoster(query: RosterQuery = {}): OfficerProfile[] {
    const text = (query.text ?? '').trim();
    const min = query.birthMin ?? -Infinity;
    const max = query.birthMax ?? Infinity;
    const limit = query.limit ?? ROSTER_PAGE_SIZE;

    const matched: OfficerProfile[] = [];
    for (const p of roster()) {
        if (query.gender && p.gender !== query.gender) continue;
        // 출생연도 미상은 생년 필터가 걸린 검색에서 제외한다.
        // (비교는 null 을 걸러내고, 없는 값은 -Infinity 로 둬서 하한에 걸린다)
        if (min !== -Infinity || max !== Infinity) {
            const by = p.birthYear ?? -Infinity;
            if (by < min || by > max) continue;
        }
        if (text !== '' && !p.name.includes(text)) continue;
        matched.push(p);
    }
    // 출생연도 미상은 뒤로 보낸다 (null 을 0 으로 두면 맨 앞에 몰린다).
    // 출생 연도 미상은 항상 뒤로 보낸다 (null 을 0 으로 두면 맨 앞에 몰린다).
    const sort = query.sort ?? 'birth-asc';
    if (sort === 'playable') {
        // 몇 개의 시나리오에서든 탈 수 있는 무장부터 온다.
        const years = query.playableYears ?? [];
        const score = (p: OfficerProfile): number => {
            if (p.birthYear === null) return -1;
            let n = 0;
            for (const y of years) {
                if (p.deathYear !== null && p.deathYear <= y) continue;
                const age = y - p.birthYear;
                if (age >= MIN_AGE && age <= MAX_AGE) n++;
            }
            return n;
        };
        matched.sort((a, b) =>
            score(b) - score(a) || a.birthYear! - b.birthYear! || a.name.localeCompare(b.name, 'ko'));
        return matched.slice(0, limit);
    }
    matched.sort((a, b) => {
        if (a.birthYear === null && b.birthYear === null) return a.name.localeCompare(b.name, 'ko');
        if (a.birthYear === null) return 1;
        if (b.birthYear === null) return -1;
        return sort === 'birth-desc' ? b.birthYear - a.birthYear : a.birthYear - b.birthYear;
    });
    return matched.slice(0, limit);
}

/** 조건에 맞는 총 인원 (상한 무시) — UI 에 '총 N명 중 M명' 을 보여준다. */
export function countRoster(query: RosterQuery = {}): number {
    return searchRoster({ ...query, limit: Number.MAX_SAFE_INTEGER }).length;
}

/**
 * 무작위 무장. 시드를 주면 재현된다.
 * filter 로 조건(예: 200년생만)을 걸면 그 안에서만 뽑는다.
 */
export function randomProfile(seed: number, filter?: (p: OfficerProfile) => boolean): OfficerProfile | null {
    const pool = filter ? roster().filter(filter) : roster();
    if (pool.length === 0) return null;
    // Lehmer 방식으로 균등 뽑기 (모듈러 편향 없음)
    let s = (seed >>> 0) || 1;
    const r = (s * 48271) % 2147483647;
    s = r;
    const idx = Math.min(pool.length - 1, Math.floor((s / 2147483647) * pool.length));
    return pool[idx] ?? null;
}

/** 시나리오 시작 연도에 실제로 살아 있는 무장만. 편집 화면 기본 목록에 쓴다. */
export function aliveAt(profiles: readonly OfficerProfile[], year: number): OfficerProfile[] {
    return profiles.filter(p => {
        if (p.deathYear !== null && p.deathYear <= year) return false;
        const by = p.birthYear ?? -Infinity;
        return by <= year;
    });
}
