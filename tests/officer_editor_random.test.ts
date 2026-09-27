/**
 * 무장편집 — 랜덤 생성의 결정성과 범위.
 * UI 는 이 함수들만 호출하므로, 여기서 범위를 보장하면 화면은 안전하다.
 */
import { describe, it, expect } from 'vitest';
import {
    randomName,
    randomBirthYear,
    randomDeathYear,
    randomGrade,
    randomSpecialty,
    randomGender,
    randomField,
    rollWholeOfficer,
} from '../src/core/officer_editor_random.js';
import { evaluatePlayability } from '../src/core/officer_editor_scenarios.js';
import scenariosData from '../src/data/scenarios/index.json' with { type: 'json' };

describe('필드별 랜덤', () => {
    it('성명은 2~3자 한글이다', () => {
        for (let s = 0; s < 200; s++) {
            const n = randomName(s);
            expect(n.length).toBeGreaterThanOrEqual(2);
            expect(n.length).toBeLessThanOrEqual(3);
            expect(/^[가-힣]+$/.test(n)).toBe(true);
        }
    });

    it('출생 연도는 150~205 안에 있다 (넓으면 대부분 탈락한다)', () => {
        for (let s = 0; s < 500; s++) {
            const y = randomBirthYear(s);
            expect(y).toBeGreaterThanOrEqual(150);
            expect(y).toBeLessThanOrEqual(205);
        }
    });

    it('성급은 0~9 안에 있다', () => {
        for (let s = 0; s < 200; s++) {
            const g = randomGrade(s);
            expect(g).toBeGreaterThanOrEqual(0);
            expect(g).toBeLessThanOrEqual(9);
        }
    });

    it('사망 연도는 생年之后다 (생년보다 이르면 말이 안 된다)', () => {
        for (let s = 0; s < 500; s++) {
            const birth = randomBirthYear(s);
            const d = randomDeathYear(s, birth);
            if (d === null) continue;
            expect(d).toBeGreaterThan(birth);
        }
    });

    it('생존(null)이 절반 이상이다 (전원이 即死면 목록이 비어버린다)', () => {
        let alive = 0;
        for (let s = 0; s < 400; s++) if (randomDeathYear(s, 180) === null) alive++;
        expect(alive).toBeGreaterThan(200);
    });

    it('특기는 비어 있지 않다', () => {
        for (let s = 0; s < 100; s++) expect(randomSpecialty(s).length).toBeGreaterThan(0);
    });

    it('성별은 남/녀 둘 중 하나', () => {
        for (let s = 0; s < 100; s++) expect(['M', 'F']).toContain(randomGender(s));
    });

    it('같은 시드는 같은 값을 낸다 (재현 가능성)', () => {
        expect(randomName(42)).toBe(randomName(42));
        expect(randomBirthYear(42)).toBe(randomBirthYear(42));
        expect(randomField('name', 'a|b|', 180)).toBe(randomField('name', 'a|b|', 180));
    });

    it('randomField 가 사망연도를 빈 문자열로 주면 생존으로 읽힌다', () => {
        const by = 180;
        const value = randomField('death', `${by}|death`, by);
        expect(value === '' || Number.parseInt(value, 10) > by).toBe(true);
    });
});

describe('rollWholeOfficer', () => {
    it('모든 필드가 채워진 유효한 객체를 준다', () => {
        const o = rollWholeOfficer('seed');
        expect(o.name.length).toBeGreaterThan(0);
        expect(o.courtesy.length).toBeGreaterThan(0);
        expect(['M', 'F']).toContain(o.gender);
        expect(o.birthYear).toBeGreaterThanOrEqual(150);
        expect(o.grade).toBeGreaterThanOrEqual(0);
        expect(o.grade).toBeLessThanOrEqual(9);
        expect(o.rank).toBeGreaterThanOrEqual(0);
        expect(o.rank).toBeLessThanOrEqual(9);
        expect(o.specialty.length).toBeGreaterThan(0);
    });

    it('능력치가 5개 모두 슬라이더 범위 안이다', () => {
        const o = rollWholeOfficer('seed');
        for (const v of Object.values(o.stats)) {
            expect(v).toBeGreaterThanOrEqual(1);
            expect(v).toBeLessThanOrEqual(100);
        }
    });

    it('같은 시드는 같은 무장이다', () => {
        expect(rollWholeOfficer('abc')).toEqual(rollWholeOfficer('abc'));
    });

    it('대부분의 시드가 최소 한 개 시나리오에라도 등장할 수 있다 (목록이 비지 않게)', () => {
        const scenarios = scenariosData as { id: string; start_date: string; difficulty: number; factions: unknown[]; description: string; special_conditions: unknown; status: string; title_kr: string; title_en: string }[];
        let anyPlayable = 0;
        for (let s = 0; s < 60; s++) {
            const o = rollWholeOfficer(`s${s}`);
            const officer = {
                id: 'x', name: o.name, gender: o.gender,
                birthYear: o.birthYear, deathYear: o.deathYear, grade: o.grade, traits: [],
            };
            const ok = scenarios.some(sc => {
                const y = Number(sc.start_date.slice(0, 4));
                return evaluatePlayability(officer, y).ok;
            });
            if (ok) anyPlayable++;
        }
        expect(anyPlayable).toBeGreaterThan(50);
    });
});
