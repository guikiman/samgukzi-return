import { readFileSync } from 'node:fs';
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

// ---------------------------------------------------------------- trait 기반 분기

describe('[90] 대화 분기 — trait 기반 개인화', () => {
    const sys = new ConversationSystem();

    /** 공격형 trait 과 책략형 trait. officer_differentiation 의 축 매핑을 그대로 쓴다. */
    const AGGRESSOR = { name: '猛将', personality: '武勇', traits: ['저돌', '과감'] };
    const SCHEMER = { name: '隐士', personality: '智谋', traits: ['책사', '기략'] };

    it('성향이 다른 두 무장은 다른 분기와 다른 문장을 얻는다', () => {
        const a = sys.getDialogueBranch(AGGRESSOR, '', 0);
        const b = sys.getDialogueBranch(SCHEMER, '', 0);

        expect(a.id).toBe('military');
        expect(b.id).toBe('strategy');
        expect(a.id).not.toBe(b.id);
        expect(a.text).not.toBe(b.text);
        // 프레이밍에 각자의 성향 축/성격이 드러난다
        expect(a.text).toContain('공격성');
        expect(a.text).toContain('저돌');
        expect(b.text).toContain('책략');
        expect(b.text).toContain('책사');
    });

    it('명시 키워드는 성향이 무엇이든 항상 이긴다', () => {
        // AGGRESSOR 는 성향상 military 지만, 키워드는 domestic 이므로 domestic 이 이긴다.
        const branch = sys.getDialogueBranch(AGGRESSOR, '도시 치안과 농업', 0);
        expect(branch.id).toBe('domestic');
        expect(branch.choices.some(choice => choice.id === 'relief')).toBe(true);

        // SCHEMER 는 성향상 strategy 지만, 키워드는 diplomacy 이므로 diplomacy 가 이긴다.
        const other = sys.getDialogueBranch(SCHEMER, '외교', 0);
        expect(other.id).toBe('diplomacy');
    });

    it('personality 만 넘겨도 성향 정보가 없을 때 동작이 완전히 그대로다', () => {
        // 성향 정보가 없으므로 기존 personality 폴백 + 원래 문장이 그대로 나와야 한다.
        const branch = sys.getDialogueBranch({ name: '张飞', personality: '武勇' }, '', -35);
        expect(branch.id).toBe('military');
        expect(branch.text).toBe(
            '张飞는 주공의 결정을 경계하며 거리를 두려 한다. “요즘 병사들의 상태가 마음에 걸립니다. 주공은 어떤 작전을 선호하십니까?”',
        );
        expect(branch.text).not.toContain('성향이 두드러지고');
        // 성향 줄은 요청하지 않았고 정보도 없으므로 붙지 않는다
        expect(branch.traitLine).toBeUndefined();
    });

    it('trait 요약 줄을 옵션으로 요청하면 describeTendency 출력이 붙는다', () => {
        const branch = sys.getDialogueBranch(AGGRESSOR, '', 0, { includeTraitLine: true });
        expect(branch.traitLine).toBeTruthy();
        expect(branch.traitLine).toContain('猛将');
        expect(branch.traitLine).toContain('공격성');
        expect(branch.traitLine).toContain('저돌');

        // 같은 정보를 별도 API로도 꺼낼 수 있다
        expect(sys.getTraitLine(AGGRESSOR)).toBe(branch.traitLine);
    });

    it('성향을 모르면 trait 줄을 요청해도 undefined 다(빈칸 처리)', () => {
        const branch = sys.getDialogueBranch({ name: '无名', personality: '智谋' }, '', 0, { includeTraitLine: true });
        expect(branch.traitLine).toBeUndefined();
        expect(sys.getTraitLine({ name: '无名', personality: '智谋' })).toBeUndefined();
        expect(sys.getTraitLine(undefined)).toBeUndefined();
    });

    it('동일 입력은 언제나 같은 결과다 — Math.random 이 없다', () => {
        for (const officer of [AGGRESSOR, SCHEMER]) {
            const a = sys.getDialogueBranch(officer, '', 7, { includeTraitLine: true });
            const b = sys.getDialogueBranch(officer, '', 7, { includeTraitLine: true });
            const c = sys.getDialogueBranch(officer, '', 7, { includeTraitLine: true });
            expect(a).toEqual(b);
            expect(b).toEqual(c);
        }
    });

    it('소스에 난수 생성기가 쓰이지 않는다 (주석 제외)', () => {
        const source = readFileSync(new URL('../src/core/conversation_system.ts', import.meta.url), 'utf8');
        // 주석에 적은 안내 문구는 제외하고 실제 코드만 검사한다.
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        expect(code).not.toMatch(/Math\s*\.\s*random/);
        expect(code).not.toMatch(/\brandom\b/);
    });

    it('성향 조합을 돌아도 출력이 null/undefined/NaN 으로 새지 않는다', () => {
        const combos = [
            AGGRESSOR, SCHEMER,
            { name: '内政', personality: 'CALM', traits: ['농정', '법률'] },
            { name: '外交', personality: 'LOYAL', traits: ['인맥', '구심'] },
            { name: '贪婪', personality: 'GREEDY', traits: ['탐욕', '강탈'] },
            { name: '未知trait', personality: 'TIMID', traits: ['존재하지않는성향'] },
        ];
        const keywords = ['', '다음 전투 작전', '도시 치안과 농업', '외교', '병법 계략', '개인적인 과거'];
        const affinities = [-100, -35, 0, 45, 100];

        for (const officer of combos) {
            for (const keyword of keywords) {
                for (const affinity of affinities) {
                    const branch = sys.getDialogueBranch(officer, keyword, affinity, { includeTraitLine: true });
                    const strings = [branch.id, branch.title, branch.speaker, branch.text, branch.traitLine ?? ''];
                    for (const choice of branch.choices) {
                        strings.push(choice.id, choice.label, choice.description, String(choice.affinityDelta));
                    }
                    for (const s of strings) {
                        expect(s).not.toContain('null');
                        expect(s).not.toContain('undefined');
                        expect(s).not.toContain('NaN');
                    }
                }
            }
        }
    });

    it('선택지와 affinityDelta 는 원래 값 그대로 유지된다', () => {
        const branch = sys.getDialogueBranch(AGGRESSOR, '', 0);
        expect(branch.choices.map(c => c.id)).toEqual(['offense', 'attack']);
        expect(branch.choices.map(c => c.affinityDelta)).toEqual([2, 3]);
    });
});
