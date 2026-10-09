import { describe, it, expect } from 'vitest';
import {
    offlineTurnsForElapsed,
    describeOfflineProgress,
    MS_PER_OFFLINE_TURN,
    MAX_OFFLINE_TURNS,
} from '../src/core/offline_progress.js';

/**
 * 환산 기준: 현실 1시간 = 6턴 (사용자 선택).
 * 1턴 = 10분 = 600_000ms. 게임 시간으로는 1턴 = 1개월 이므로
 * 현실 10분 = 게임 1개월. 8시간 잠수림 = 48턴 = 게임 4년 — 상한 24턴으로 잘름.
 */
describe('offline_progress — 경과 시간을 턴 수로 환산', () => {
    it('1시간 경과하면 6턴이다', () => {
        expect(offlineTurnsForElapsed(3600000)).toBe(6);
    });

    it('10분 미만이면 0턴이다 — 깜빡 닫았다 열어도 진행되지 않는다', () => {
        expect(offlineTurnsForElapsed(9 * 60000)).toBe(0);
        expect(offlineTurnsForElapsed(10 * 60000)).toBe(1);
    });

    it('24턴 상한을 넘지 않는다 — 오래 닫아도 무한 진행 안 된다', () => {
        // 8시간 = 48턴 이지만 상한은 24턴.
        expect(offlineTurnsForElapsed(8 * 3600000)).toBe(MAX_OFFLINE_TURNS);
        // 1주일 닫아 둬도 24턴.
        expect(offlineTurnsForElapsed(7 * 24 * 3600000)).toBe(MAX_OFFLINE_TURNS);
    });

    it('음수·NaN·무한이면 0턴이다 — 시계가 뒤로 가도 안전하다', () => {
        expect(offlineTurnsForElapsed(-1000)).toBe(0);
        expect(offlineTurnsForElapsed(NaN)).toBe(0);
        expect(offlineTurnsForElapsed(Infinity)).toBe(0);
    });

    it('0이면 0턴이다', () => {
        expect(offlineTurnsForElapsed(0)).toBe(0);
    });
});

describe('offline_progress — 요약 문구', () => {
    it('8시간 24턴이면 "8시간 0분 동안 24턴 진행"', () => {
        const text = describeOfflineProgress(8 * 3600000, 24);
        expect(text).toContain('24턴');
        expect(text).toContain('8시간');
    });

    it('10분 미만이면 "변화 없음"', () => {
        expect(describeOfflineProgress(5 * 60000, 0)).toContain('변화 없음');
    });

    it('1시간 미만이면 분 단위로 표기한다', () => {
        const text = describeOfflineProgress(40 * 60000, 4);
        expect(text).toContain('40분');
        expect(text).toContain('4턴');
    });
});

describe('offline_progress — 상수 정합성', () => {
    it('MS_PER_OFFLINE_TURN 은 10분이다', () => {
        expect(MS_PER_OFFLINE_TURN).toBe(600000);
    });

    it('MAX_OFFLINE_TURNS 는 24다', () => {
        expect(MAX_OFFLINE_TURNS).toBe(24);
    });

    it('환산율이 "현실 1시간 = 6턴" 과 맞는다', () => {
        // 3600000 / 600000 = 6. 상수가 바뀌면 이 테스트가 먼저 깨진다.
        expect(3600000 / MS_PER_OFFLINE_TURN).toBe(6);
    });
});
