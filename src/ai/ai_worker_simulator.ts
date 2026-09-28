/**
 * 삼국지 8 리메이크 — AI 워커 시뮬레이터 (Worker 사이드)
 * 파일: src/ai/ai_worker_simulator.ts
 *
 * Web Worker 내부에서 실행되는 1,000명 무장 AI 의사결정 엔진.
 * 세력 단위로 연산을 분할하여 결과를 스트리밍 전송하며,
 * 야망/충성도/군주 성향/도시 자원 가중치로 행동을 결정한다.
 *
 * [201] Web Worker 비동기 AI 연산
 * [121-130] 고급 AI 및 NPC 행동 패턴
 * Python 원본: src/systems/ai_strategy_manager.py → TypeScript 포팅 + 확장
 */

import type { AIDecision, CommandType, OfficerID } from '../core/types.js';

// ============================================================
// 경량 스냅샷 타입 (Worker 전송 최소 데이터셋)
// ============================================================

/** 메인 스레드 → Worker 전송용 경량 무장 스냅샷 (직렬화 가능) */
export interface OfficerSnapshot {
    id: OfficerID;
    name: string;
    factionId: string | null;
    cityId: string | null;
    /** 야망 0~100 */
    ambition: number;
    /** 충성도 0~100 */
    loyalty: number;
    /** 도덕성 0~100 */
    morality: number;
    /** 악명 0~100 */
    infamy: number;
    /** 능력치 5종 */
    stats: {
        leadership: number;
        might: number;
        intelligence: number;
        politics: number;
        charisma: number;
    };
    /** 플레이어 세력 소속 여부 — true면 AI 제외 */
    isPlayer: boolean;
}

/** 메인 스레드 → Worker 전송용 경량 도시 스냅샷 */
export interface CitySnapshot {
    id: string;
    name: string;
    ownerId: string | null;
    /** 방어도 0~100 — 주둔 병력 비율 프록시로도 사용 (garrison ≈ maxTroops × defense/100) */
    defense: number;
    /** 인구 */
    population: number;
    /** 도시 자금 (City.funds) */
    funds: number;
    /** 병량 추정치 — 월 식량 수입 × 10 (City 도메인에 병량 필드가 없어 프록시 사용) */
    foodStores: number;
    /**
     * 도시 병력 수 (명) — City.development 과 같은 값.
     * [결함 수정] 예전엔 "개발도 0~100" 이라 주석과 스트리밍 전송 시
     * 100 으로 잘려 병력이 사라졌다. AI 는 이 값을 병력(명)으로 본다.
     */
    development: number;
    /** 징병 가능 최대 병력 — 인구/100 추정 */
    maxTroops: number;
}

/** 메인 스레드 → Worker 전송용 경량 세력 스냅샷 */
export interface FactionSnapshot {
    id: string;
    name: string;
    leaderId: string;
    /** 군주 성향: 패도(정복) / 왕도(균형) / 의리(수성) — 정책 가중치에서 유도 */
    temperament: 'HEGEMON' | 'KINGLY' | 'RIGHTEOUS';
    gold: number;
    food: number;
    cityCount: number;
    /** 전쟁 중인 세력 ID 목록 */
    atWarWith: string[];
    /** 동맹 세력 ID 목록 */
    alliedWith: string[];
}

/** AI 턴 시작 페이로드 */
export interface AITurnPayload {
    year: number;
    month: number;
    turn: number;
    /** 신규 게임 초기 12개월 AI 난이도 배율 (미지정 시 기존 동작 1.0) */
    aiDifficultyMultiplier?: number;
    /** 플레이어 세력 ID — AI 공격 대상에서 보호 */
    protectedFactionId?: string | null;
    factions: Record<string, FactionSnapshot>;
    officers: OfficerSnapshot[];
    cities: Record<string, CitySnapshot>;
}

// ============================================================
// 스트리밍 메시지 프로토콜
// ============================================================

/** 세력 단위 스트리밍 결과 */
export interface FactionDecisionBatch {
    factionId: string;
    decisions: AIDecision[];
    /** 배치 연산 소요 ms (성능 진단용) */
    elapsedMs: number;
}

export type WorkerOutboundMessage =
    | { type: 'STREAM_FACTION_DECISION'; data: FactionDecisionBatch }
    | { type: 'AI_TURN_COMPLETE'; data: { totalDecisions: number; elapsedMs: number } }
    | { type: 'ERROR'; data: string };

// ============================================================
// 가중치 상수 — 삼국지 8 리메이크 기획서 기준
// ============================================================

/** 군주 성향별 행동 가중치 배율 */
const TEMPERAMENT_WEIGHTS: Record<FactionSnapshot['temperament'], {
    DRAFT: number; CONQUEST: number; DOMESTIC: number; DIPLOMACY: number;
}> = {
    HEGEMON:   { DRAFT: 1.4, CONQUEST: 1.8, DOMESTIC: 0.7, DIPLOMACY: 0.6 },  // 조조형 패도
    KINGLY:    { DRAFT: 1.1, CONQUEST: 1.2, DOMESTIC: 1.2, DIPLOMACY: 1.1 },  // 유비형 왕도
    RIGHTEOUS: { DRAFT: 0.8, CONQUEST: 0.5, DOMESTIC: 1.5, DIPLOMACY: 1.4 },  // 유표형 의리/수성
};

// ============================================================
// 개별 무장 AI 의사결정 — 가중치 알고리즘
// ============================================================

/**
 * 단일 무장의 행동을 결정한다.
 *
 * 의사결정 계층:
 *   1. 위기 대응   — 충성도 붕괴(하야 검토)
 *   2. 정복 타겟팅 — 공격 성향 × 야망 × 전쟁 중 최약 도시
 *   3. 병량 위기   — 개간 시급
 *   4. 군주 성향   — 세력 temperament 가중치로 징병 배율 조정
 *   5. 도시 상황   — 최약 내정치 기반 내정
 *   6. 외교 성향   — 정치 높은 무장의 친선 강화
 *   7. 기본 행동   — 휴식
 */
export function calculateOfficerDecision(
    officer: OfficerSnapshot,
    cities: Record<string, CitySnapshot>,
    factions: Record<string, FactionSnapshot>,
    options: { aiDifficultyMultiplier?: number; protectedFactionId?: string | null } = {},
): AIDecision | null {
    if (officer.isPlayer) return null;

    const homeCity = officer.cityId ? cities[officer.cityId] : null;
    const faction = officer.factionId ? factions[officer.factionId] : null;
    const temperament = faction?.temperament ?? 'KINGLY';
    const tw = TEMPERAMENT_WEIGHTS[temperament];

    // ── 1. 위기 대응: 충성도 붕괴 → 하야 검토 [121-130] ──
    if (officer.loyalty < 30 && officer.ambition > 50) {
        return makeDecision(officer, 'REST', 0.99,
            `충성도 ${officer.loyalty} 붕괴 — 하야 검토`, {});
    }

    // ── 2. 정복 타겟팅 [123] — 공격성향 × 병량 여유 ──
    const baseAggression = (officer.ambition / 100) * 0.6 + (officer.stats.leadership / 100) * 0.4;
    const difficultyMultiplier = options.aiDifficultyMultiplier ?? 1;
    const aggression = Math.min(1, baseAggression * difficultyMultiplier);
    const warTarget = findWeakestEnemyCity(faction, cities, options.protectedFactionId ?? null);
    if (warTarget && aggression > 0.62 && homeCity && homeCity.foodStores > 500) {
        const priority = Math.min(0.95, 0.7 + aggression * 0.25) * tw.CONQUEST;
        return makeDecision(officer, 'BATTLE', Math.min(0.99, priority),
            `${warTarget.name} 공격 검토 (공격성향 ${aggression.toFixed(2)}, 병량 충분)`,
            { targetCityId: warTarget.id });
    }

    // ── 3. 병량 위기 — 보급 우선 [121-130] ──
    if (homeCity && homeCity.foodStores < 200 && faction && faction.food < 500) {
        return makeDecision(officer, 'DOMESTIC', 0.9,
            `${homeCity.name} 병량 위기 — 개간 시급`, { targetCityId: homeCity.id });
    }

    // ── 4. 군주 성향 가중 징병 ──
    if (homeCity && shouldDraft(officer, homeCity, tw)) {
        return makeDecision(officer, 'RECRUITMENT', Math.min(0.9, 0.8 * tw.DRAFT),
            `${homeCity.name} 징병 (방어도 ${homeCity.defense})`,
            { targetCityId: homeCity.id });
    }

    // ── 5. 도시 상황 기반 내정 분기 ──
    if (homeCity) {
        const domestic = chooseDomesticAction(officer, homeCity, tw);
        if (domestic) return domestic;
    }

    // ── 6. 외교 성향 무장 — 동맹 세력 친선 강화 ──
    if (faction && faction.alliedWith.length > 0 && officer.stats.politics > 70) {
        return makeDecision(officer, 'DIPLOMACY', Math.min(0.7, 0.5 * tw.DIPLOMACY),
            `동맹 세력 친선 강화 (정치 ${officer.stats.politics})`,
            { targetFactionId: faction.alliedWith[0], action: 'GIFT' });
    }

    // ── 7. 기본: 휴식 ──
    return makeDecision(officer, 'REST', 0.2, '특별한 이슈 없음 — 휴식', {});
}

/** 징병 필요성 판정 — 군주 성향 × 도시 방어도/주둔률 */
function shouldDraft(
    officer: OfficerSnapshot,
    city: CitySnapshot,
    tw: { DRAFT: number },
): boolean {
    // 패도 성향일수록 높은 방어도에서도 징병 (임계치 = 60 × DRAFT 배율)
    const draftThreshold = 60 * tw.DRAFT;
    if (city.defense < draftThreshold && officer.stats.leadership > 55) return true;
    // 주둔 병력 비율 프록시: garrison ≈ maxTroops × defense/100
    const garrisonRatio = city.defense / 100;
    return garrisonRatio < 0.4;
}

/** 도시 내정 행동 선택 — 최약 내정치 기준 */
function chooseDomesticAction(
    officer: OfficerSnapshot,
    city: CitySnapshot,
    tw: { DOMESTIC: number },
): AIDecision | null {
    // [결함 수정] 세 지표를 0~100 으로 정규화해 비교한다.
    // 예전엔 병력(수천~수만)을 그대로 0~100 지표와 나란히 Math.min 으로
    // 섞었다. 그 결과 weakest 는 언제나 "병력" 이 되어 funds/foodStores 와
    // 무관하게 weakest >= 85 가 성립했고, 내정 행동이 사실상 선택되지 않았다.
    // 최대 병력(maxTroops = 인구/100) 대비 비율로 바꾼다.
    const troops = Math.min(100, (city.development / Math.max(1, city.maxTroops)) * 100);
    const weakest = Math.min(
        troops,                            // 병력 (최대 병력 대비 비율)
        Math.min(100, city.funds / 10),    // 상업 환산
        Math.min(100, city.foodStores / 10), // 농업 환산
    );
    if (weakest >= 85) return null; // 내정 여유 — 다른 행동 기회

    const priority = Math.min(0.8, (0.4 + (100 - weakest) / 200) * tw.DOMESTIC);
    return makeDecision(officer, 'DOMESTIC', priority,
        `${city.name} 내정 (최약 지표 ${weakest.toFixed(0)})`, { targetCityId: city.id });
}

/** 가장 약한 적대 도시 탐색 — 전쟁 중 세력 기준 */
function findWeakestEnemyCity(
    faction: FactionSnapshot | null,
    cities: Record<string, CitySnapshot>,
    protectedFactionId: string | null = null,
): CitySnapshot | null {
    if (!faction || faction.atWarWith.length === 0) return null;
    const warSet = new Set(faction.atWarWith);
    let weakest: CitySnapshot | null = null;
    for (const city of Object.values(cities)) {
        if (!city.ownerId || !warSet.has(city.ownerId)) continue;
        if (protectedFactionId && city.ownerId === protectedFactionId) continue;
        if (!weakest || city.defense < weakest.defense) weakest = city;
    }
    return weakest;
}

function makeDecision(
    officer: OfficerSnapshot,
    actionType: CommandType,
    priority: number,
    reasoning: string,
    payload: Record<string, unknown>,
): AIDecision {
    return {
        officerId: officer.id,
        actionType,
        priority: Math.max(0, Math.min(1, priority)),
        reasoning,
        payload: { ...payload },
    };
}

// ============================================================
// 세력 단위 배치 처리 + 스트리밍
// ============================================================

/**
 * 전체 AI 턴을 세력 단위로 분할 처리한다.
 * 각 세력 연산이 끝날 때마다 onFactionBatch 콜백으로 즉시 스트리밍 전송하고,
 * UI 부하 분산을 위해 다음 배치 전에 yield (마이크로 태스크 양보) 한다.
 *
 * @returns 총 결정 수와 전체 소요 시간
 */
export async function runAITurn(
    payload: AITurnPayload,
    onFactionBatch: (batch: FactionDecisionBatch) => void,
    yieldIntervalMs = 5,
): Promise<{ totalDecisions: number; elapsedMs: number }> {
    const startAll = Date.now();
    let totalDecisions = 0;

    // 세력 버킷 분할 — 재야 무장은 마지막 버킷에 묶어 처리
    const factionBuckets = new Map<string, OfficerSnapshot[]>();
    for (const factionId of Object.keys(payload.factions)) {
        factionBuckets.set(factionId, []);
    }
    factionBuckets.set('__FREE__', []);

    for (const officer of payload.officers) {
        if (officer.isPlayer) continue;
        const bucketId = officer.factionId && factionBuckets.has(officer.factionId)
            ? officer.factionId
            : '__FREE__';
        factionBuckets.get(bucketId)!.push(officer);
    }

    for (const [factionId, officers] of factionBuckets) {
        const startBatch = Date.now();
        const decisions: AIDecision[] = [];

        for (const officer of officers) {
            const decision = calculateOfficerDecision(
                officer,
                payload.cities,
                payload.factions,
                { aiDifficultyMultiplier: payload.aiDifficultyMultiplier, protectedFactionId: payload.protectedFactionId },
            );
            if (decision) decisions.push(decision);
        }

        totalDecisions += decisions.length;
        onFactionBatch({
            factionId,
            decisions,
            elapsedMs: Date.now() - startBatch,
        });

        // 메인 스레드 인터리빙 — 마이크로 태스크 양보 (UI 부하 분산)
        if (yieldIntervalMs > 0) {
            await new Promise(resolve => setTimeout(resolve, yieldIntervalMs));
        }
    }

    return { totalDecisions, elapsedMs: Date.now() - startAll };
}
