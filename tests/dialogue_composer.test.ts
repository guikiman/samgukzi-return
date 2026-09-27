/**
 * 대화 조립기 — 결정론과 결(tier) 반영을 확인한다.
 * AI 를 고쳤을 때 제일 무너지는 건 '같은 말만 반복' 과 '결이 안 읽히는 것' 이다.
 */
import { describe, it, expect } from 'vitest';
import {
    composeDialogue,
    composeResponse,
    affinityTier,
} from '../src/core/dialogue_composer.js';
import type { DialogueTopic } from '../src/core/dialogue_composer.js';

const TOPICS: DialogueTopic[] = ['military', 'strategy', 'domestic', 'diplomacy', 'personal', 'report'];

const ctx = (over: Partial<Parameters<typeof composeDialogue>[0]> = {}) => ({
    speaker: { name: '荀彧' },
    listener: { name: '曹操' },
    topic: 'military' as DialogueTopic,
    affinity: 0,
    ...over,
});

describe('affinityTier', () => {
    it('구간 경계를 정확히 나눈다', () => {
        expect(affinityTier(-100)).toBe('hostile');
        expect(affinityTier(-40)).toBe('hostile');
        expect(affinityTier(-39)).toBe('wary');
        expect(affinityTier(-10)).toBe('wary');
        expect(affinityTier(-9)).toBe('neutral');
        expect(affinityTier(29)).toBe('neutral');
        expect(affinityTier(30)).toBe('trusting');
        expect(affinityTier(69)).toBe('trusting');
        expect(affinityTier(70)).toBe('devoted');
        expect(affinityTier(100)).toBe('devoted');
    });
});

describe('composeDialogue', () => {
    it('빈 문자열을 내지 않는다 (모든 화제 × 모든 결)', () => {
        for (const topic of TOPICS) {
            for (const affinity of [-80, -20, 0, 50, 95]) {
                const text = composeDialogue(ctx({ topic, affinity }));
                expect(text.trim().length, `${topic}/${affinity}`).toBeGreaterThan(10);
            }
        }
    });

    it('같은 입력에는 같은 문장 (결정론)', () => {
        for (const topic of TOPICS) {
            expect(composeDialogue(ctx({ topic }))).toBe(composeDialogue(ctx({ topic })));
        }
    });

    it('화제가 다르면 문장이 달라진다', () => {
        const a = composeDialogue(ctx({ topic: 'military' }));
        const b = composeDialogue(ctx({ topic: 'domestic' }));
        expect(a).not.toBe(b);
    });

    it('결이 다르면 도입부가 달라진다 (높은 우호/낮은 우호는 같은 말로 나오면 안 된다)', () => {
        const hostile = composeDialogue(ctx({ affinity: -80 }));
        const devoted = composeDialogue(ctx({ affinity: 95 }));
        expect(hostile).not.toBe(devoted);
    });

    it('화자 이름이 문장에 들어간다', () => {
        const text = composeDialogue(ctx({ speaker: { name: '诸葛亮' }, listener: { name: '刘备' } }));
        expect(text).toContain('诸葛亮');
    });

    it('연도가 있으면 시점이 표시된다', () => {
        expect(composeDialogue(ctx({ year: 194, month: 3 }))).toContain('194년 3월');
    });

    it('연도가 없으면 시점을 지어내지 않는다', () => {
        expect(composeDialogue(ctx())).not.toContain('기준:');
    });

    it('성향 줄이 있으면 본문에 반영된다', () => {
        const text = composeDialogue(ctx({ speaker: { name: '荀彧', traitLine: '간신' } }));
        expect(text).toContain('荀彧');
    });

    it('상태 한 줄이 들어가면 그대로 반영된다', () => {
        expect(composeDialogue(ctx({ stateLine: '군사 · 병력 12,000' }))).toContain('병력 12,000');
    });

    it('자리표시자가 그대로 새어나오지 않는다', () => {
        const text = composeDialogue(ctx({ speaker: { name: 'A', traitLine: 't' }, listener: { name: 'B' } }));
        expect(text).not.toContain('{L}');
        expect(text).not.toContain('{S}');
    });

    it('장문장이 아니다 (San8 계열은 2~3문장)', () => {
        const text = composeDialogue(ctx({ topic: 'strategy', affinity: 50 }));
        const sentences = (text.match(/[.。]/g) ?? []).length;
        expect(sentences).toBeLessThanOrEqual(5);
    });

    it('빈 이름에도 예외 없이 문장이 나온다', () => {
        expect(() => composeDialogue(ctx({ speaker: { name: '' }, listener: { name: '' } }))).not.toThrow();
    });
});

describe('composeResponse', () => {
    it('우호도 상승이면 상승량을 보여준다', () => {
        expect(composeResponse('공격', 10, 13, 'seed')).toContain('+3');
    });
    it('우호도 하락이면 하락량을 보여준다', () => {
        expect(composeResponse('공격', 10, 6, 'seed')).toContain('-4');
    });
    it('변화가 없으면 변화 없음이라 말한다', () => {
        const r = composeResponse('대기', 10, 10, 'seed');
        expect(r).not.toContain('+0');
    });
    it('선택지 라벨이 응답에 포함된다', () => {
        expect(composeResponse('전진', 0, 5, 's')).toContain('전진');
    });
    it('같은 시드는 같은 응답 (결정론)', () => {
        expect(composeResponse('A', 0, 5, 'seed')).toBe(composeResponse('A', 0, 5, 'seed'));
    });
});
