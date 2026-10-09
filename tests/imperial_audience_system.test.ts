/**
 * 황제 알현 — 도시 제한·수락 판정·기한·승진 보상 검증.
 *
 * [왜 순수 로직을 브라우저 없이 검증하는가]
 * 이 모듈은 스토어/DOM 에 의존하지 않는다. 그래서 "기한 회차에 딱 목표를 채우면
 * 성공" 같은 경계 규칙을 roll 을 주입해 결정적으로 검증할 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { OfficerRank } from '../src/core/types.js';
import type { Officer, ImperialCourt, ImperialMission } from '../src/core/types.js';
import {
    RANK_TOP, AUDIENCE_COOLDOWN_TURNS, MISSION_SPECS,
    isAudienceCity, checkAudienceEligibility, audienceScore, judgeAudience,
    createMission, respondToMission, monthlyProgress, advanceMission, checkMissionExpiry,
    resolveRewardRank, computeAudienceReward, createCourt,
} from '../src/core/imperial_audience_system.js';

function officer(over: Partial<Officer> = {}): Officer {
    return {
        id: 'o1', name: '감자', courtesyName: '', gender: 'M',
        birthYear: 170, deathYear: null,
        stats: { leadership: 80, might: 70, intelligence: 60, politics: 50, charisma: 90 },
        exp: { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 },
        rank: OfficerRank.UNRANKED, status: 'OFFICER', factionId: 'f1', cityId: 'luoyang',
        personality: 'CALM', loyalty: 80, ambition: 50, morality: 50, greed: 30,
        actionPoints: 100, maxActionPoints: 100, stamina: 100, maxStamina: 100,
        fame: 50, infamy: 0, merit: 50, salary: 20,
        skills: [], specialty: null,
        inventory: { weapons: [], mounts: [], treasures: [], books: [] },
        isFemaleBattleEnabled: false, hasActedThisTurn: false,
        hp: 100, maxHp: 100, injuries: 0,
        runtime: { isAlive: true, factionId: 'f1', locationId: 'luoyang', loyalty: 80 },
        ...over,
    };
}

function court(over: Partial<ImperialCourt> = {}): ImperialCourt {
    return { ...createCourt('헌제', 'luoyang'), ...over };
}

function mission(over: Partial<ImperialMission> = {}): ImperialMission {
    return {
        id: 'm1', kind: 'SUBDUE_BANDITS', officerId: 'o1', cityId: 'shangqiu',
        startTurn: 10, deadlineTurn: 14, targetAmount: 900, progress: 0,
        accepted: true, status: 'ACTIVE', rewardRank: OfficerRank.RANK7, rewardGold: 800,
        ...over,
    };
}

describe('알현 도시 제한', () => {
    it('황제가 머무는 도시에서만 열린다', () => {
        expect(isAudienceCity(court(), 'luoyang')).toBe(true);
        expect(isAudienceCity(court(), 'chengde')).toBe(false);
    });

    it('황제가 없으면 아예 열리지 않는다', () => {
        expect(isAudienceCity(null, 'luoyang')).toBe(false);
    });

    it('다른 도시면 사유를 알려준다', () => {
        const r = checkAudienceEligibility(court(), officer(), 'chengde', 10);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('머물고 있지');
    });

    it('황제 도시이고 임유가 없으면 열린다', () => {
        expect(checkAudienceEligibility(court(), officer(), 'luoyang', 10).ok).toBe(true);
    });
});

describe('알현 자격 판정', () => {
    it('진행 중인 임무가 있으면 막는다', () => {
        const c = court({ activeMissionId: 'm1', missions: { m1: mission({ status: 'ACTIVE' }) } });
        expect(checkAudienceEligibility(c, officer(), 'luoyang', 20).ok).toBe(false);
    });

    it('대기 중인 임무(PENDING)도 막는다', () => {
        const c = court({ activeMissionId: 'm1', missions: { m1: mission({ status: 'PENDING' }) } });
        expect(checkAudienceEligibility(c, officer(), 'luoyang', 20).ok).toBe(false);
    });

    it('쿨다운이 지나면 다시 열린다', () => {
        const c = court({ lastAudienceTurn: 10 });
        expect(checkAudienceEligibility(c, officer(), 'luoyang', 10 + AUDIENCE_COOLDOWN_TURNS).ok).toBe(true);
    });

    it('쿨다운이 안 지나면 막는다', () => {
        const c = court({ lastAudienceTurn: 10 });
        expect(checkAudienceEligibility(c, officer(), 'luoyang', 11).ok).toBe(false);
    });

    it('세력 없는 무장은 막는다', () => {
        expect(checkAudienceEligibility(court(), officer({ factionId: null }), 'luoyang', 20).ok).toBe(false);
    });
});

describe('황제의 수락 판정', () => {
    it('공이 높으면 열린다', () => {
        const v = judgeAudience(officer({ merit: 100, fame: 100, loyalty: 100 }), () => 0.5);
        expect(v.granted).toBe(true);
    });

    it('공이 없으면 막힌다', () => {
        const v = judgeAudience(officer({ merit: 0, fame: 0, loyalty: 0 }), () => 0.5);
        expect(v.granted).toBe(false);
    });

    it('판정은 결정론적이다 — 같은 roll 은 같은 결과', () => {
        const o = officer();
        expect(judgeAudience(o, () => 0.3).granted).toBe(judgeAudience(o, () => 0.3).granted);
    });

    it('점수는 공·명성·충성의 가중합이다', () => {
        const o = officer({ merit: 100, fame: 0, loyalty: 0 });
        expect(audienceScore(o)).toBeCloseTo(50);
    });
});

describe('임무 부여와 수락', () => {
    it('기한은 종류별 durationTurns 로 정해진다', () => {
        const m = createMission('SUBDUE_BANDITS', officer(), 'shangqiu', 10, 'm1');
        expect(m.deadlineTurn).toBe(10 + MISSION_SPECS.SUBDUE_BANDITS.durationTurns);
    });

    it('처음에는 수락 대기다', () => {
        expect(createMission('SECURE_BORDER', officer(), 'shangqiu', 10, 'm1').status).toBe('PENDING');
    });

    it('수락하면 수행 중이 된다', () => {
        const m = respondToMission(mission({ status: 'PENDING', accepted: false }), true);
        expect(m.status).toBe('ACTIVE');
        expect(m.accepted).toBe(true);
    });

    it('거절하면 거절 상태가 된다', () => {
        const m = respondToMission(mission({ status: 'PENDING' }), false);
        expect(m.status).toBe('DECLINED');
    });
});

describe('월간 진행과 기한', () => {
    it('진척도가 쌓인다', () => {
        const r = advanceMission(mission(), 100);
        expect(r.mission.progress).toBe(100);
        expect(r.settled).toBe(false);
    });

    it('목표 달성 즉시 성공한다', () => {
        const r = advanceMission(mission({ progress: 850 }), 100);
        expect(r.settled).toBe(true);
        expect(r.succeeded).toBe(true);
        expect(r.mission.status).toBe('SUCCEEDED');
    });

    it('목표를 넘겨도 목표값에서 멈춘다', () => {
        expect(advanceMission(mission({ progress: 880 }), 500).mission.progress).toBe(900);
    });

    it('완료된 임무는 더 진행되지 않는다', () => {
        const done = mission({ status: 'SUCCEEDED', progress: 900 });
        const r = advanceMission(done, 500);
        expect(r.settled).toBe(false);
        expect(r.mission.progress).toBe(900);
    });

    it('기한 회차 직전까지는 만료되지 않는다', () => {
        expect(checkMissionExpiry(mission({ deadlineTurn: 14 }), 14).expired).toBe(false);
    });

    it('기한을 넘기면 실패한다', () => {
        const r = checkMissionExpiry(mission({ deadlineTurn: 14 }), 15);
        expect(r.expired).toBe(true);
        expect(r.mission.status).toBe('FAILED');
    });

    it('매출은 종류와 능력에 따라 다르다', () => {
        const o = officer({ stats: { leadership: 80, might: 70, intelligence: 60, politics: 50, charisma: 90 } });
        expect(monthlyProgress(o, 'SUBDUE_BANDITS')).toBeGreaterThan(0);
        expect(monthlyProgress(o, 'SECURE_BORDER')).toBe(1);
    });
});

describe('보상 — 승진 관직과 금 하사', () => {
    it('보상 등급보다 낮으면 그 등급으로 올린다', () => {
        expect(resolveRewardRank(OfficerRank.UNRANKED, OfficerRank.RANK7)).toBe(OfficerRank.RANK7);
    });

    it('이미 높은 등급이면 한 단계 더 올린다', () => {
        expect(resolveRewardRank(OfficerRank.RANK7, OfficerRank.RANK7)).toBe(OfficerRank.RANK8);
    });

    it('최상위면 더 올리지 않는다', () => {
        expect(resolveRewardRank(RANK_TOP, OfficerRank.RANK7)).toBe(RANK_TOP);
    });

    it('금과 승진 여부를 함께 준다', () => {
        const r = computeAudienceReward(officer({ rank: OfficerRank.UNRANKED }), mission());
        expect(r.gold).toBe(800);
        expect(r.rank).toBe(OfficerRank.RANK7);
        expect(r.promoted).toBe(true);
    });

    it('이미 최상위면 승진이 아니다', () => {
        const r = computeAudienceReward(officer({ rank: RANK_TOP }), mission());
        expect(r.promoted).toBe(false);
        expect(r.gold).toBe(800);
    });
});

describe('황제 재관', () => {
    it('빈 임무 목록으로 시작한다', () => {
        const c = createCourt('헌제', 'luoyang');
        expect(c.missions).toEqual({});
        expect(c.activeMissionId).toBeNull();
        expect(c.lastAudienceTurn).toBeNull();
    });
});
