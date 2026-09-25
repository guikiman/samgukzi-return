/**
 * [3] 외교 엔진 — Diplomacy Engine
 *
 * [70-73] 외교: 동맹/파기, 항복 권고, 친선(증정), 원군 요청
 * [74-75] 계략: 파괴, 이간
 *
 * 15가지 외교 제안 수락 여부를 무장 야망-의리-지력 다차원 벡터 내적으로 판정
 */
import type { FactionID, IGameStore } from './types.js';
export declare enum FactionRelation {
    ALLIANCE = "alliance",
    NEUTRAL = "neutral",
    WAR = "war",
    SURRENDERED = "surrendered"
}
export interface DiplomacyResult {
    success: boolean;
    message: string;
}
export declare class DiplomacyEngine {
    private relations;
    private factionData;
    /** 관계 상태를 정규화된 세력 diplomacy와 동기화하는 선택적 스토어. [341-360] */
    private readonly stateStore?;
    constructor(stateStore?: Pick<IGameStore, 'getFaction' | 'updateFaction'>);
    private key;
    getRelation(a: FactionID, b: FactionID): FactionRelation;
    setRelation(a: FactionID, b: FactionID, rel: FactionRelation): void;
    /** 엔진 관계를 도메인 세력의 양방향 treaty로 투영한다. [341-360] */
    private syncFactionTreaty;
    setFactionData(factionId: FactionID, data: {
        totalPower: number;
        gold: number;
    }): void;
    /**
     * 동맹 제안 [341-360][11]
     * 전쟁 중인 세력과는 불가. 평판 보정: 제안자의 명성이 높으면 상대가 받아들이기 쉽고,
     * 악명이 높으면 경계해 거절 확률 상승. reputationModifier는 스토어 연동 시 주입.
     */
    formAlliance(a: FactionID, b: FactionID, reputationModifier?: number): DiplomacyResult;
    /**
     * 동맹 파기
     */
    breakAlliance(a: FactionID, b: FactionID): DiplomacyResult;
    /**
     * 전쟁 선포
     */
    declareWar(a: FactionID, b: FactionID): DiplomacyResult;
    /**
     * 항복 권고
     * 세력 전력비 3:1 이상이거나 target 전력 0이면 자동 항복
     */
    persuadeSurrender(target: FactionID, persuader: FactionID): DiplomacyResult;
    /**
     * 친선 증정 (금/식량)
     * NEUTRAL → ALLIANCE 자동 승격
     */
    sendGift(from: FactionID, to: FactionID, gold: number, food: number): DiplomacyResult;
    /**
     * 원군 요청 (성공률 70%)
     */
    requestReinforcements(from: FactionID, target: FactionID): DiplomacyResult;
    /**
     * 파괴 계략 — 투자금에 비례한 성공 확률
     */
    sabotage(targetCityId: string, investment: number): DiplomacyResult;
    /**
     * 이간질 — 투자금에 비례한 충성도 감소
     */
    sowDiscord(targetOfficer: string, investment: number): DiplomacyResult & {
        loyaltyDrop?: number;
    };
    /**
     * 종속 관계 설정 (조공국)
     */
    formVassalage(suzerain: FactionID, vassal: FactionID): boolean;
    /**
     * 인질 교환
     */
    exchangeHostages(a: FactionID, b: FactionID): boolean;
    /**
     * 휴전 (전쟁 → 중립) [341-360: 지정학 외교][11]
     * 평판 보정: 악명 높은 제안자는 거절당할 수 있음 (보정 0이면 기존 동작)
     */
    makePeace(a: FactionID, b: FactionID, reputationModifier?: number): DiplomacyResult;
    /**
     * 대리 전쟁 선포
     */
    declareProxyWar(sponsor: FactionID, target: FactionID, proxy: FactionID): boolean;
    /**
     * 포로 석방 협상
     */
    negotiateRelease(goldOffer: number): DiplomacyResult;
    /**
     * 이중 스파이 심기 (성공률 30%)
     */
    plantSpy(): DiplomacyResult;
    /**
     * 소문 퍼뜨리기 (이간질)
     */
    spreadRumor(targetFaction: FactionID): DiplomacyResult;
    /**
     * 세이브/로드 지원 [212]: 관계 상태 직렬화
     */
    serialize(): Array<{
        a: string;
        b: string;
        relation: string;
    }>;
    /**
     * 세이브/로드 지원 [212]: 관계 상태 복원
     */
    restore(data: Array<{
        a: string;
        b: string;
        relation: string;
    }>): void;
}
//# sourceMappingURL=diplomacy_engine.d.ts.map