/**
 * 시장 명령 코어 테스트 — 순수 함수.
 */
import { describe, expect, it } from 'vitest';
import {
    MARKET_ORDER_COST,
    marketMood,
    moodBar,
    pickRumorTarget,
    rumorLine,
    pickTalent,
    talentLine,
} from '../src/core/market_command.js';

describe('시장 명령 코어', () => {
    it('명령 비용은 令20 으로 균일하다', () => {
        expect(MARKET_ORDER_COST).toBe(20);
    });

    it('민심은 충성과 치안의 평균이다', () => {
        expect(marketMood(80, 60)).toBe(70);
        expect(marketMood(10, 10)).toBe(10);
    });

    it('민심은 0~100 을 벗어나지 않는다', () => {
        expect(marketMood(-20, 40)).toBe(10);
        expect(marketMood(120, 120)).toBe(100);
    });

    it('막대는 10칸이다', () => {
        expect(moodBar(0)).toBe('░░░░░░░░░░');
        expect(moodBar(100)).toBe('██████████');
        expect(moodBar(72)).toBe('███████░░░');
        expect(moodBar(10)).toBe('█░░░░░░░░░');
    });

    it('후보가 없으면 소문도 인재도 없다', () => {
        expect(pickRumorTarget([])).toBeNull();
        expect(pickTalent([])).toBeNull();
        expect(talentLine(null)).toContain('다음 장');
    });

    it('악명이 가장 높은 자가 소문 대상이다', () => {
        const cands = [
            { name: '갑', fame: 90, infamy: 5 },
            { name: '을', fame: 30, infamy: 40 },
            { name: '병', fame: 50, infamy: 10 },
        ];
        expect(pickRumorTarget(cands)?.name).toBe('을');
        expect(rumorLine(cands[1]!)).toContain('을');
    });

    it('동점이면 rand 로 고른다', () => {
        const cands = [
            { name: '갑', fame: 10, infamy: 5 },
            { name: '을', fame: 10, infamy: 5 },
        ];
        expect(pickRumorTarget(cands, () => 0)?.name).toBe('갑');
        expect(pickRumorTarget(cands, () => 0.99)?.name).toBe('을');
    });

    it('인재를 고르고 한 줄로 소개한다', () => {
        const found = pickTalent([{ name: '정', bestLabel: '지력', bestValue: 96 }], () => 0);
        expect(found?.name).toBe('정');
        expect(talentLine(found)).toContain('지력 96');
    });
});
