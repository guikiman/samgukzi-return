/**
 * AI 세력 월간 자율 외교 [341-360: 지정학적 외교]
 *
 * 각 AI 세력이 매월 군주 성향·세력 전력비에 따라 자율적으로:
 * 1) 약한 이웃에게 선전포고 (공격적 성향)
 * 2) 전력 열세 시 강자에게 휴전 제파 (TIMID/CAUTIOUS)
 * 3) 강자 앞에서 동맹 결성 (중립 상대)
 *
 * 판정은 DiplomacyEngine에 위임하고, 결과는 이벤트 페이로드로 UI에 전달된다.
 */
import type { GameStore } from './game_store.js';
import type { FactionID } from './types.js';
import { DiplomacyEngine, type DiplomacyResult } from './diplomacy_engine.js';
import type { DiplomacyAction } from './command_system.js';
/** 월간 AI가 선택할 수 있는 커맨드 기반 외교 액션 [341-360] */
export type FactionDiplomacyAction = Extract<DiplomacyAction, 'DECLARE_WAR' | 'PEACE' | 'ALLIANCE'>;
export type DiplomacyActionExecutor = (factionId: FactionID, targetFactionId: FactionID, action: FactionDiplomacyAction) => DiplomacyResult;
export interface FactionDiplomacyReport {
    factionId: FactionID;
    factionName: string;
    messages: string[];
}
export declare class FactionDiplomacyAI {
    private store;
    private engine;
    constructor(store: GameStore, engine: DiplomacyEngine);
    /** 세력 총 전력 = 소속 도시 development 합 + 병력 가산 */
    private factionPower;
    /** 월간 자율 외교 실행 — 플레이어 세력 제외 */
    runMonthly(executor?: DiplomacyActionExecutor): FactionDiplomacyReport[];
    private runFaction;
    /** 두 세력이 인접하는지 — 소속 도시 간 최단 거리 판정 */
    private areAdjacent;
}
//# sourceMappingURL=faction_diplomacy_ai.d.ts.map