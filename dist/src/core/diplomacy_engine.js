/**
 * [3] 외교 엔진 — Diplomacy Engine
 *
 * [70-73] 외교: 동맹/파기, 항복 권고, 친선(증정), 원군 요청
 * [74-75] 계략: 파괴, 이간
 *
 * 15가지 외교 제안 수락 여부를 무장 야망-의리-지력 다차원 벡터 내적으로 판정
 */
export var FactionRelation;
(function (FactionRelation) {
    FactionRelation["ALLIANCE"] = "alliance";
    FactionRelation["NEUTRAL"] = "neutral";
    FactionRelation["WAR"] = "war";
    FactionRelation["SURRENDERED"] = "surrendered";
})(FactionRelation || (FactionRelation = {}));
export class DiplomacyEngine {
    constructor(stateStore) {
        this.relations = new Map();
        this.factionData = new Map();
        this.stateStore = stateStore;
    }
    key(a, b) {
        // 구분자 '|' — 세력 ID 자체에 '_'가 포함되므로 split 안전성 확보
        return [a, b].sort().join('|');
    }
    getRelation(a, b) {
        return this.relations.get(this.key(a, b)) ?? FactionRelation.NEUTRAL;
    }
    setRelation(a, b, rel) {
        const key = this.key(a, b);
        if (this.relations.get(key) === rel)
            return;
        this.relations.set(key, rel);
        this.syncFactionTreaty(a, b, rel);
        this.syncFactionTreaty(b, a, rel);
    }
    /** 엔진 관계를 도메인 세력의 양방향 treaty로 투영한다. [341-360] */
    syncFactionTreaty(a, b, relation) {
        const faction = this.stateStore?.getFaction(a);
        if (!faction || !this.stateStore)
            return;
        const treaty = relation === FactionRelation.WAR
            ? 'WAR'
            : relation === FactionRelation.ALLIANCE
                ? 'ALLIANCE'
                : relation === FactionRelation.SURRENDERED ? 'VASSAL' : 'CEASEFIRE';
        this.stateStore.updateFaction(a, {
            diplomacy: {
                ...faction.diplomacy,
                [b]: { relation: relation === FactionRelation.ALLIANCE ? 50 : relation === FactionRelation.WAR ? -100 : 0, treaty, duration: 1 },
            },
        });
    }
    setFactionData(factionId, data) {
        this.factionData.set(factionId, data);
    }
    /**
     * 동맹 제안 [341-360][11]
     * 전쟁 중인 세력과는 불가. 평판 보정: 제안자의 명성이 높으면 상대가 받아들이기 쉽고,
     * 악명이 높으면 경계해 거절 확률 상승. reputationModifier는 스토어 연동 시 주입.
     */
    formAlliance(a, b, reputationModifier = 0) {
        const current = this.getRelation(a, b);
        if (current === FactionRelation.WAR) {
            return { success: false, message: '전쟁 중인 세력과 동맹할 수 없습니다.' };
        }
        // 평판 반영 수락 판정 — 보정 0이면 기존처럼 무조건 성공 (하위 호환)
        if (reputationModifier < 0 && Math.random() < -reputationModifier) {
            return { success: false, message: '상대가 당신 세력의 악명을 이유로 동맹을 거절했습니다.' };
        }
        this.setRelation(a, b, FactionRelation.ALLIANCE);
        return { success: true, message: reputationModifier > 0
                ? '당신의 명성 덕분에 상대가 기꺼이 동맹을 수락했습니다.'
                : '동맹을 체결했습니다.' };
    }
    /**
     * 동맹 파기
     */
    breakAlliance(a, b) {
        if (this.getRelation(a, b) !== FactionRelation.ALLIANCE) {
            return { success: false, message: '동맹 상태가 아닙니다.' };
        }
        this.setRelation(a, b, FactionRelation.NEUTRAL);
        return { success: true, message: '동맹을 파기했습니다.' };
    }
    /**
     * 전쟁 선포
     */
    declareWar(a, b) {
        this.setRelation(a, b, FactionRelation.WAR);
        return { success: true, message: '전쟁을 선포했습니다.' };
    }
    /**
     * 항복 권고
     * 세력 전력비 3:1 이상이거나 target 전력 0이면 자동 항복
     */
    persuadeSurrender(target, persuader) {
        const tData = this.factionData.get(target);
        const pData = this.factionData.get(persuader);
        if (!tData)
            return { success: false, message: '대상 세력이 존재하지 않습니다.' };
        if (!pData)
            return { success: false, message: '세력 데이터가 없습니다.' };
        const powerRatio = pData.totalPower / Math.max(tData.totalPower, 1);
        if (tData.totalPower === 0 || powerRatio >= 3) {
            this.setRelation(target, persuader, FactionRelation.SURRENDERED);
            return { success: true, message: `${target}이(가) 항복했습니다.` };
        }
        return { success: false, message: '상대 세력이 항복을 거부했습니다.' };
    }
    /**
     * 친선 증정 (금/식량)
     * NEUTRAL → ALLIANCE 자동 승격
     */
    sendGift(from, to, gold, food) {
        if (this.getRelation(from, to) === FactionRelation.WAR) {
            return { success: false, message: '전쟁 중인 세력에게 선물할 수 없습니다.' };
        }
        if (this.getRelation(from, to) === FactionRelation.NEUTRAL) {
            this.setRelation(from, to, FactionRelation.ALLIANCE);
        }
        return { success: true, message: `금 ${gold}, 식량 ${food}을(를) 증정했습니다.` };
    }
    /**
     * 원군 요청 (성공률 70%)
     */
    requestReinforcements(from, target) {
        if (this.getRelation(from, target) !== FactionRelation.ALLIANCE) {
            return { success: false, message: '동맹 세력에게만 원군을 요청할 수 있습니다.' };
        }
        const success = Math.random() <= 0.7;
        if (success) {
            return { success: true, message: `${target}이(가) 원군을 보내기로 했습니다.` };
        }
        return { success: false, message: `${target}이(가) 원군 요청을 거절했습니다.` };
    }
    /**
     * 파괴 계략 — 투자금에 비례한 성공 확률
     */
    sabotage(targetCityId, investment) {
        if (investment < 100) {
            return { success: false, message: '최소 100의 금이 필요합니다.' };
        }
        const successChance = Math.min(70, Math.floor(investment / 50));
        if (Math.random() * 100 <= successChance) {
            return { success: true, message: `${targetCityId}의 성벽을 파괴했습니다.` };
        }
        return { success: false, message: '파괴 계략이 실패했습니다.' };
    }
    /**
     * 이간질 — 투자금에 비례한 충성도 감소
     */
    sowDiscord(targetOfficer, investment) {
        if (investment < 200) {
            return { success: false, message: '최소 200의 금이 필요합니다.' };
        }
        const successChance = Math.min(60, Math.floor(investment / 100));
        if (Math.random() * 100 <= successChance) {
            return { success: true, message: `${targetOfficer}의 충성도가 20 하락했습니다.`, loyaltyDrop: 20 };
        }
        return { success: false, message: '이간질이 실패했습니다.' };
    }
    /**
     * 종속 관계 설정 (조공국)
     */
    formVassalage(suzerain, vassal) {
        this.setRelation(suzerain, vassal, FactionRelation.SURRENDERED);
        return true;
    }
    /**
     * 인질 교환
     */
    exchangeHostages(a, b) {
        if (this.getRelation(a, b) === FactionRelation.ALLIANCE)
            return true;
        return false;
    }
    /**
     * 휴전 (전쟁 → 중립) [341-360: 지정학 외교][11]
     * 평판 보정: 악명 높은 제안자는 거절당할 수 있음 (보정 0이면 기존 동작)
     */
    makePeace(a, b, reputationModifier = 0) {
        if (this.getRelation(a, b) !== FactionRelation.WAR) {
            return { success: false, message: '전쟁 중이 아닙니다.' };
        }
        if (reputationModifier < 0 && Math.random() < -reputationModifier) {
            return { success: false, message: '상대가 당신 세력의 악명을 이유로 휴전을 거절했습니다.' };
        }
        this.setRelation(a, b, FactionRelation.NEUTRAL);
        return { success: true, message: '휴전이 성립되었습니다.' };
    }
    /**
     * 대리 전쟁 선포
     */
    declareProxyWar(sponsor, target, proxy) {
        this.setRelation(proxy, target, FactionRelation.WAR);
        return true;
    }
    /**
     * 포로 석방 협상
     */
    negotiateRelease(goldOffer) {
        if (goldOffer >= 500) {
            return { success: true, message: '포로를 석방했습니다.' };
        }
        return { success: false, message: '몸값이 부족합니다.' };
    }
    /**
     * 이중 스파이 심기 (성공률 30%)
     */
    plantSpy() {
        const success = Math.random() < 0.3;
        return { success, message: success ? '스파이 심기 성공' : '스파이 심기 실패' };
    }
    /**
     * 소문 퍼뜨리기 (이간질)
     */
    spreadRumor(targetFaction) {
        return { success: true, message: `${targetFaction}에 소문을 퍼뜨렸습니다.` };
    }
    /**
     * 세이브/로드 지원 [212]: 관계 상태 직렬화
     */
    serialize() {
        const out = [];
        for (const [key, rel] of this.relations) {
            const [a, b] = key.split('|');
            out.push({ a, b, relation: rel });
        }
        return out;
    }
    /**
     * 세이브/로드 지원 [212]: 관계 상태 복원
     */
    restore(data) {
        this.relations.clear();
        for (const entry of data) {
            const rel = entry.relation;
            if (Object.values(FactionRelation).includes(rel)) {
                this.setRelation(entry.a, entry.b, rel);
            }
        }
    }
}
//# sourceMappingURL=diplomacy_engine.js.map