import { describe, expect, it } from 'vitest';
import { ConversationSystem } from '../src/core/conversation_system.js';

describe('[90] 대화 분기 발생기', () => {
    const officer = {
        name: '诸葛亮',
        personality: '智谋',
    };

    it('무장·정세 키워드로 전술 분기를 선택한다', () => {
        const branch = new ConversationSystem().getDialogueBranch(officer, '다음 전투 작전', 12);
        expect(branch.id).toBe('military');
        expect(branch.title).toContain('诸葛亮');
        expect(branch.choices.length).toBe(2);
    });

    it('도시 키워드는 내정 분기를 선택한다', () => {
        const branch = new ConversationSystem().getDialogueBranch(officer, '도시 치안과 농업', 0);
        expect(branch.id).toBe('domestic');
        expect(branch.choices.some(choice => choice.id === 'relief')).toBe(true);
    });

    it('키워드가 없으면 성격과 능력의 기본 성향을 사용한다', () => {
        const branch = new ConversationSystem().getDialogueBranch(
            { name: '张飞', personality: '武勇' },
            '',
            -35,
        );
        expect(branch.id).toBe('military');
        expect(branch.text).toContain('거리를 두려');
    });

    it('대화 분기는 스토어를 변경하지 않는 순수 데이터다', () => {
        const branch = new ConversationSystem().getDialogueBranch(officer, '외교', 45);
        expect(branch.id).toBe('diplomacy');
        expect(branch.choices.every(choice => choice.affinityDelta > 0)).toBe(true);
        expect(branch.choices[0].description.length).toBeGreaterThan(0);
    });
});
