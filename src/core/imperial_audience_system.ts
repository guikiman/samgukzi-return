/**
 * 황제 알현(皇帝覲見) — 황제가 머무는 도시에서만 열리는 임무 수락·보상 시스템.
 *
 * [무엇을 하는가]
 * 황제의 도시에 있는 무장이 알현을 요청하면 황제가 수락 여부를 정하고, 수락하면
 * 임무를 준다. 기한 안에 목표를 채우면 관직 임명(승진 포함)과금을 하사한다.
 *
 * [왜 순수 로직인가]
 * 스토어·DOM에 의존하지 않는다. 확률은 주입 가능해 테스트가 결정적이고,
 * 황제의 수락 판정이나 기한 계산 같은 사양을 브라우저 없이 검증할 수 있다.
 */

import { OfficerRank } from './types.js';
import type {
    CityID, Officer, OfficerID,
    ImperialCourt, ImperialMission, ImperialMissionKind,
} from './types.js';

// ============================================================
// 상수
// ============================================================

/** 최고 관직. 이 위로는 승진하지 않는다. */
export const RANK_TOP = OfficerRank.RANK9;

/** 알현 후 다음 알현까지 필요한 최소 회차. */
export const AUDIENCE_COOLDOWN_TURNS = 2;

/** 황제가 알현을 열어주는 최소 점수. */
export const AUDIENCE_ACCEPT_BASE = 45;

/** 이 회차 안에 임무 성립을 확인할 대기 회차. */
export const MISSION_PENDING_TURNS = 1;

export interface MissionSpec {
    label: string;
    /** 목표 수치 — 종류마다 단위가 다르다(세력/금/개월). */
    target: number;
    /** 수행 기한(턴). */
    durationTurns: number;
    rewardRank: OfficerRank;
    rewardGold: number;
    /** 임무 요약문 — 대화창에 그대로 쓴다. */
    brief: string;
}

export const MISSION_SPECS: Record<ImperialMissionKind, MissionSpec> = {
    SUBDUE_BANDITS: {
        label: '산적 토벌',
        target: 900,
        durationTurns: 4,
        rewardRank: OfficerRank.RANK7,
        rewardGold: 800,
        brief: '낙방 산적 무리를 토벌하라.',
    },
    RECOVER_TRIBUTE: {
        label: '진남세 회수',
        target: 1500,
        durationTurns: 5,
        rewardRank: OfficerRank.RANK6,
        rewardGold: 1500,
        brief: '탈취된 진남세를 회수하라.',
    },
    SECURE_BORDER: {
        label: '국경 경비',
        target: 3,
        durationTurns: 3,
        rewardRank: OfficerRank.RANK8,
        rewardGold: 600,
        brief: '변방 요소를 3개월간 경비하라.',
    },
};

export type Roll = () => number;

// ============================================================
// 알현 개시 조건
// ============================================================

/** 알현은 황제가 머무는 도시에서만 열린다. */
export function isAudienceCity(court: ImperialCourt | null, cityId: CityID): boolean {
    return !!court && court.cityId === cityId;
}

export interface AudienceEligibility {
    ok: boolean;
    reason: string;
}

/**
 * 알현을 요청할 수 있는지 판정한다.
 *
 * [왜 여러 가지를 한 번에 판정하는가]
 * 도시·쿨다운·임무 중복을 각각 따로 확인하면 UI 나 바깥에서 하나를 빠뜨릴 때마다
 * "창은 열렸는데 아무것도 안 되는" 상태가 된다. 사유를 문자열로 돌려 주면
 * 호출부가 그대로 메시지로 쓸 수 있다.
 */
export function checkAudienceEligibility(
    court: ImperialCourt | null,
    officer: Officer,
    cityId: CityID,
    turn: number,
): AudienceEligibility {
    if (!court) return { ok: false, reason: '황제의 행재가 확인되지 않는다.' };
    if (!isAudienceCity(court, cityId)) {
        return { ok: false, reason: '황제는 이 도시에 머물고 있지 않다.' };
    }
    if (officer.factionId === null) {
        return { ok: false, reason: '아무 세력에도 소속되지 않았다.' };
    }
    const active = court.activeMissionId ? court.missions[court.activeMissionId] : null;
    if (active && (active.status === 'ACTIVE' || active.status === 'PENDING')) {
        return { ok: false, reason: '이미 황제의 임무를 수행 중이다.' };
    }
    if (court.lastAudienceTurn !== null && turn - court.lastAudienceTurn < AUDIENCE_COOLDOWN_TURNS) {
        return { ok: false, reason: '아직 다음 알현 시기가 되지 않았다.' };
    }
    return { ok: true, reason: '' };
}

// ============================================================
// 황제의 수락 판정
// ============================================================

/** 공로(fame)·공적(merit)·충성으로 알현 점수를 매긴다. */
export function audienceScore(officer: Officer): number {
    return officer.merit * 0.5 + officer.fame * 0.3 + officer.loyalty * 0.2;
}

export interface AudienceVerdict {
    granted: boolean;
    score: number;
    threshold: number;
    message: string;
}

/**
 * 황제가 알현을 받아주는지 결정한다.
 *
 * [왜 확률인가]
 * 점수가 같아도 황제의 마음은 매번 같지 않다. 완전히 결정적이면 "merit 를 올리면
 * 무조건 열린다" 는 공략으로 수렴해 재미가 사라진다.
 */
export function judgeAudience(officer: Officer, roll: Roll = Math.random): AudienceVerdict {
    const score = audienceScore(officer);
    // 심지에 따라 허용선이 흔들린다 — 성군이면 관대, 왜건이면 엄격.
    const threshold = AUDIENCE_ACCEPT_BASE + (officer.morality - 50) * 0.2;
    const rollPct = roll() * 100;
    // 점수에 판정 흔들림(±10)을 더해 한계선을 만든다.
    const granted = score + (rollPct - 50) * 0.2 >= threshold;
    return {
        granted,
        score,
        threshold,
        message: granted
            ? `${officer.name}의 공이 황제에게 귀납니다.`
            : `${officer.name}, 아직 그 공으로는 알현이 허락되지 않는다.`,
    };
}

// ============================================================
// 임무 부여 / 응답
// ============================================================

export function createMission(
    kind: ImperialMissionKind,
    officer: Officer,
    cityId: CityID,
    turn: number,
    id: string,
): ImperialMission {
    const spec = MISSION_SPECS[kind];
    return {
        id,
        kind,
        officerId: officer.id,
        cityId,
        startTurn: turn,
        deadlineTurn: turn + spec.durationTurns,
        targetAmount: spec.target,
        progress: 0,
        accepted: false,
        status: 'PENDING',
        rewardRank: spec.rewardRank,
        rewardGold: spec.rewardGold,
    };
}

/** 무장의 수락/거절을 반영한다. 거절하면 다음 알현이 다시 열려야 한다. */
export function respondToMission(mission: ImperialMission, accepted: boolean): ImperialMission {
    if (accepted) {
        return { ...mission, accepted: true, status: 'ACTIVE' };
    }
    return { ...mission, accepted: false, status: 'DECLINED' };
}

// ============================================================
// 월간 진행 / 기한
// ============================================================

/** 한 회차에 쌓이는 진척도 — 무장 능력과 임무 종류에 따라 정해진다. */
export function monthlyProgress(officer: Officer, kind: ImperialMissionKind): number {
    switch (kind) {
        case 'SUBDUE_BANDITS': return Math.round(120 + officer.stats.might * 3);
        case 'RECOVER_TRIBUTE': return Math.round(150 + officer.stats.politics * 3);
        case 'SECURE_BORDER': return 1;
    }
}

export interface MissionAdvance {
    mission: ImperialMission;
    /** 이번 회차에 목표를 채웠거나 기한이 지났는지. */
    settled: boolean;
    succeeded: boolean;
    message: string;
}

/**
 * 한 회차만큼 임무를 진전시키고, 완료 또는 기한 만료를 판정한다.
 *
 * [왜 성공을 기한보다 먼저 검사하는가]
 * 기한 회차에 딱 목표를 채우면 '성공' 이다. 만료를 먼저 보면 성공분을 버린다.
 */
export function advanceMission(mission: ImperialMission, gained: number): MissionAdvance {
    if (mission.status !== 'ACTIVE') {
        return { mission, settled: false, succeeded: false, message: '' };
    }
    const progress = Math.min(mission.targetAmount, mission.progress + Math.max(0, gained));
    if (progress >= mission.targetAmount) {
        const done: ImperialMission = { ...mission, progress, status: 'SUCCEEDED' };
        return { mission: done, settled: true, succeeded: true, message: '임무를 완수했다.' };
    }
    return { mission: { ...mission, progress }, settled: false, succeeded: false, message: '' };
}

export interface MissionExpiry {
    mission: ImperialMission;
    expired: boolean;
    message: string;
}

/** 기한을 넘겼는지 판정한다. */
export function checkMissionExpiry(mission: ImperialMission, turn: number): MissionExpiry {
    if (mission.status !== 'ACTIVE' || turn <= mission.deadlineTurn) {
        return { mission, expired: false, message: '' };
    }
    return {
        mission: { ...mission, status: 'FAILED' },
        expired: true,
        message: '기한을 넘겨 임무가 실패했다.',
    };
}

// ============================================================
// 보상 — 승진 관직 + 금 하사
// ============================================================

/**
 * 보상 관직을 정한다.
 *
 * [왜 두 갈래인가]
 * "관직 임명과 승진" 이 요구사항이다. 보상 등급보다 낮으면 그 등급으로 올리고,
 * 이미 그 이상이면 한 단계 더 올린다. 최상위면 그대로 둔다.
 */
export function resolveRewardRank(currentRank: OfficerRank, rewardRank: OfficerRank): OfficerRank {
    if (currentRank < rewardRank) return rewardRank;
    return Math.min(RANK_TOP, currentRank + 1) as OfficerRank;
}

export interface AudienceReward {
    rank: OfficerRank;
    gold: number;
    promoted: boolean;
    message: string;
}

/** 성공 보상을 계산한다. 승진 여부와 하사금을 함께 돌려준다. */
export function computeAudienceReward(officer: Officer, mission: ImperialMission): AudienceReward {
    const rank = resolveRewardRank(officer.rank, mission.rewardRank);
    const promoted = rank > officer.rank;
    return {
        rank,
        gold: mission.rewardGold,
        promoted,
        message: promoted
            ? `${officer.name}을(를) 임명하고 ${mission.rewardGold}金을 하사한다.`
            : `${officer.name}에게 ${mission.rewardGold}金을 하사한다.`,
    };
}

// ============================================================
// 황제 재관 설정
// ============================================================

/** 황제가 머무는 도시를 정한다. 도시가 없으면 court 가 null 이 된다. */
export function createCourt(emperorName: string, cityId: CityID): ImperialCourt {
    return { emperorName, cityId, activeMissionId: null, lastAudienceTurn: null, missions: {} };
}
