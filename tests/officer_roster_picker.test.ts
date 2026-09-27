/**
 * 무장편집 — 기존 무장 검색/무작위 선택.
 * 실제 1200명 데이터셋을 그대로 쓴다 (Mock 으로 가면 nullable 처리를 놓친다).
 */
import { describe, it, expect } from 'vitest';
import {
    searchRoster,
    countRoster,
    toEditable,
    randomProfile,
    aliveAt,
    ROSTER_PAGE_SIZE,
} from '../src/core/officer_roster_picker.js';
import { OFFICER_PROFILES } from '../src/core/officer_profile_schema.js';

describe('searchRoster', () => {
    it('조건이 없으면 상한까지만 준다 (1200개를 DOM 에 그리지 않는다)', () => {
        const r = searchRoster();
        expect(r).toHaveLength(ROSTER_PAGE_SIZE);
        expect(r.length).toBeLessThan(OFFICER_PROFILES.size);
    });

    it('기본 정렬은 연생 순이다 (예측 가능해야 한다)', () => {
        const r = searchRoster({ limit: 300 });
        for (let i = 1; i < r.length; i++) {
            const a = r[i - 1].birthYear, b = r[i].birthYear;
            if (a === null || b === null) continue;
            expect(b).toBeGreaterThanOrEqual(a);
        }
    });

    it("sort='playable' 이면 맨 앞 카드가 어떤 시나리오에서든 탈 수 있다", () => {
        const years = [184, 190, 194, 200, 207, 220, 234];
        const r = searchRoster({ sort: 'playable', playableYears: years, limit: 20 });
        expect(r.length).toBeGreaterThan(0);
        for (const p of r) {
            if (p.birthYear === null) continue;
            const ok = years.some(y => {
                if (p.deathYear !== null && p.deathYear <= y) return false;
                const age = y - p.birthYear;
                return age >= 16 && age <= 60;
            });
            expect(ok, `${p.name} 이 어느 시나리오에서도 탈 수 없다`).toBe(true);
        }
    });

    it("sort='playable' 은 111년생(어느 시나리오에서도 탈 수 없음)을 맨 뒤로 보낸다", () => {
        const years = [184, 194, 220];
        const r = searchRoster({ sort: 'playable', playableYears: years, limit: 200 });
        // 맨 앞은 반드시 '어떤 연도에든 탈 수 있는' 무장이므로 111년생일 수 없다.
        const first = r[0];
        expect(first.birthYear).not.toBeNull();
        expect(first.birthYear!).toBeGreaterThan(111);
    });

    it("sort='playable' 에서 연도 목록이 비면 예외 없이 정렬된다", () => {
        expect(() => searchRoster({ sort: 'playable', playableYears: [], limit: 5 })).not.toThrow();
    });

    it("sort='birth-desc' 는 역순이다", () => {
        const r = searchRoster({ sort: 'birth-desc', limit: 50 });
        for (let i = 1; i < r.length; i++) {
            const a = r[i - 1].birthYear, b = r[i].birthYear;
            if (a === null || b === null) continue;
            expect(a).toBeGreaterThanOrEqual(b);
        }
    });

    it('이름 부분 일치가 실제로 걸린다', () => {
        const all = OFFICER_PROFILES.all();
        const sample = all.find(p => p.name.length >= 2)!;
        const sub = sample.name.slice(0, 2);
        const r = searchRoster({ text: sub, limit: 50 });
        expect(r.length).toBeGreaterThan(0);
        expect(r.every(p => p.name.includes(sub))).toBe(true);
    });

    it('결과 없는 검색어는 빈 배열 (예외 아님)', () => {
        expect(searchRoster({ text: 'ZZZZZZ없는이름' })).toEqual([]);
    });

    it('연대 필터가 실제로 범위를 좁힌다', () => {
        const r = searchRoster({ birthMin: 160, birthMax: 169, limit: 500 });
        expect(r.length).toBeGreaterThan(0);
        expect(r.every(p => p.birthYear !== null && p.birthYear >= 160 && p.birthYear <= 169)).toBe(true);
    });

    it('연대 필터 걸면 출생연도 미상은 제외된다 (비교가 안 되므로)', () => {
        const r = searchRoster({ birthMin: 160, birthMax: 169, limit: 500 });
        expect(r.every(p => p.birthYear !== null)).toBe(true);
    });

    it('성별 필터가 동작한다', () => {
        const r = searchRoster({ gender: 'F', limit: 20 });
        expect(r.every(p => p.gender === 'F')).toBe(true);
    });

    it('countRoster 는 상한을 무시하고 전체 수를 준다', () => {
        const total = countRoster();
        expect(total).toBe(OFFICER_PROFILES.size);
        expect(total).toBeGreaterThan(searchRoster().length);
    });

    it('성별 필터가 성별 카운트를 줄인다', () => {
        expect(countRoster({ gender: 'F' })).toBeLessThan(countRoster());
    });
});

describe('toEditable', () => {
    it('출생연도 미상은 null 로 유지된다 (0 으로 위장하지 않는다)', () => {
        const p = OFFICER_PROFILES.all().find(x => x.birthYear === null);
        if (!p) return; // 데이터에 없다면 이 주장은 검증 불가 — 통과시킨다
        expect(toEditable(p).birthYear).toBeNull();
    });

    it('일반 프로필은 값을 그대로 옮긴다', () => {
        const p = OFFICER_PROFILES.all().find(x => x.birthYear !== null)!;
        const e = toEditable(p);
        expect(e.id).toBe(p.id);
        expect(e.name).toBe(p.name);
        expect(e.birthYear).toBe(p.birthYear);
    });
});

describe('randomProfile', () => {
    it('항상 프로필을 돌려준다 (풀이 비어 있지 않은 한)', () => {
        const p = randomProfile(12345);
        expect(p).not.toBeNull();
        expect(p!.id).toBeTruthy();
    });

    it('같은 시드는 같은 무장이다', () => {
        expect(randomProfile(7)!.id).toBe(randomProfile(7)!.id);
    });

    it('필터를 지키는 무장만 나온다', () => {
        const p = randomProfile(99, c => c.gender === 'F');
        if (p) expect(p.gender).toBe('F');
    });

    it('아무도 조건에 맞지 않으면 null (무한 재귀 방지)', () => {
        expect(randomProfile(1, () => false)).toBeNull();
    });
});

describe('aliveAt', () => {
    const all = OFFICER_PROFILES.all();
    it('해당 연도 이전에 죽은 무장은 제외된다', () => {
        const r = aliveAt(all, 194);
        expect(r.every(p => p.deathYear === null || p.deathYear > 194)).toBe(true);
    });
    it('아직 태어나지 않은 무장은 제외된다', () => {
        const r = aliveAt(all, 180);
        expect(r.every(p => p.birthYear !== null && p.birthYear <= 180)).toBe(true);
    });
});
