/**
 * 무장편집 — 필드별 랜덤 생성.
 *
 * 규칙:
 * - 같은 시드면 같은 결과. 사용자가 "랜덤" 을 눌렀다가 값을 비교할 수 있어야 한다.
 * - 빈 폼에서 '전체 랜덤' 을 누르면 그때만 이름까지 뽑는다.
 *   (매번 이름을 바꾸면 사용자가 입력한 성명이 사라져 불편하다)
 */

import { hashSeed, rollCustomStats } from './custom_officer_start.js';
import type { OfficerStats } from './types.js';

const SURNAMES = ['한', '최', '강', '서', '박', '문', '윤', '장', '임', '조', '배', '백', '허', '유', '남', '심', '노', '하', '곽', '성'];
const GIVEN = ['중윤', '정원', '도현', '현우', '서준', '지호', '민준', '예준', '시우', '하윤', '우진', '재윤', '건우', '승호', '태양', '유진'];
const SPECIALTIES = ['火攻', '水攻', '伏兵', '突騎', '攻城', '戦法', '外交', '内政', '醫術', '用兵', '騎射', '槍術'];
export type EditorField = 'name' | 'courtesy' | 'gender' | 'birth' | 'death' | 'grade' | 'rank' | 'specialty';

function rng(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        // Lehmer — 모듈러 편향 없이 균등
        s = (s * 48271) % 2147483647;
        return s / 2147483647;
    };
}

/** 성명 2~3자 (한국 성 + 이름 1~2자) */
export function randomName(seed: number): string {
    const r = rng(seed);
    const surname = SURNAMES[Math.floor(r() * SURNAMES.length)];
    const given = GIVEN[Math.floor(r() * GIVEN.length)];
    return surname + given;
}

/**
 * 출생 연도. 150~205 에 몰려 있게 한다 — 실제 자료 분포(160~190 최다)를 따른다.
 * 너무 넓으면 대부분 시나리오에서 탈락해 목록이 비어버린다.
 */
export function randomBirthYear(seed: number): number {
    const r = rng(seed);
    // 삼각 분포: 150~205 사이에서 가운데(175)에 밀린다
    const a = r();
    const b = r();
    const t = (a + b) / 2;
    return Math.round(150 + t * 55);
}

/** 사망 연도 — 출생 + 생애 25~70세. 빈 값(생존)이 더 흔하다. */
export function randomDeathYear(seed: number, birthYear: number): number | null {
    const r = rng(seed);
    if (r() < 0.55) return null; // 반 이상은 생존
    // 같은 난수열을 재사용한다. 두 번 뽑으면 생애가 한쪽으로 쏠린다.
    const lifespan = 25 + Math.floor(r() * 46);
    return birthYear + lifespan;
}

export function randomGrade(seed: number): number {
    const r = rng(seed);
    return Math.floor(r() * 10);
}

export function randomSpecialty(seed: number): string {
    const r = rng(seed);
    return SPECIALTIES[Math.floor(r() * SPECIALTIES.length)];
}

export function randomGender(seed: number): 'M' | 'F' {
    return rng(seed)() < 0.94 ? 'M' : 'F';
}

/** 시드 문자열로 필드 하나를 뽑는다. UI 는 이 함수만 호출한다. */
export function randomField(field: EditorField, seedText: string, birthYear: number): string {
    const seed = hashSeed(`${field}|${seedText}`);
    switch (field) {
        case 'name': return randomName(seed);
        case 'courtesy': return randomName(seed).slice(1);
        case 'gender': return randomGender(seed);
        case 'birth': return String(randomBirthYear(seed));
        case 'death': {
            const d = randomDeathYear(seed, birthYear);
            return d === null ? '' : String(d);
        }
        case 'grade': return String(randomGrade(seed));
        case 'rank': return String(Math.floor(rng(seed)() * 10));
        case 'specialty': return randomSpecialty(seed);
    }
}

/** 전체 랜덤 — 이름·자·생년·사망·성급·품계·특기·능력치를 한 번에. */
export function rollWholeOfficer(seedText: string): {
    name: string; courtesy: string; gender: 'M' | 'F';
    birthYear: number; deathYear: number | null; grade: number; rank: number;
    specialty: string; stats: OfficerStats;
} {
    const seed = hashSeed(`all|${seedText}`);
    const birthYear = randomBirthYear(seed);
    return {
        name: randomName(seed),
        courtesy: randomName(seed ^ 0x51ab).slice(1),
        gender: randomGender(seed),
        birthYear,
        deathYear: randomDeathYear(seed, birthYear),
        grade: randomGrade(seed),
        rank: Math.floor(rng(seed ^ 0x7f4a)() * 10),
        specialty: randomSpecialty(seed),
        stats: rollCustomStats(seed),
    };
}
