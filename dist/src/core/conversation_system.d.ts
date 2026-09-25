import type { Officer } from './types.js';
/** [90] 대화 분기에서 사용할 선택지. */
export interface ConversationBranchChoice {
    id: string;
    label: string;
    description: string;
    affinityDelta: number;
}
/** [90] 무장과 주공의 대화 분기 결과. */
export interface ConversationBranch {
    id: string;
    title: string;
    speaker: string;
    text: string;
    choices: ConversationBranchChoice[];
}
type DialogueOfficer = Pick<Officer, 'name' | 'personality'>;
/**
 * [90] 대화 분기 발생기.
 *
 * 키워드가 명시되면 그 주제를 우선하고, 없으면 무장 성향과 관계 수치를 사용한다.
 * UI에서 선택지를 렌더링할 수 있는 데이터로 반환하며, 이 객체 자체는 스토어를 변경하지 않는다.
 */
export declare class ConversationSystem {
    getDialogueBranch(officer: DialogueOfficer | null | undefined, keyword: string, affinity?: number): ConversationBranch;
}
export {};
//# sourceMappingURL=conversation_system.d.ts.map