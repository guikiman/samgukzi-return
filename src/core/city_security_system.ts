/**
 * [148][401] 도시 안정/전장 물리 — City Security & Debris (Python city_manager.py + battle_physics.py 포팅)
 *
 * Python 원본: src/systems/city_manager.py (riot_risk [148]) / battle_physics.py (debris ZOC [401])
 *
 * 설계 스펙:
 * - [148] 민란 위험도 — 징병 피로도, 군량 부족, 치안 저하로 축적 → 임계 도달 시 반란
 * - 아사 판정 — 군량 0 도달 시 병력 5% 소모 (Python: soldiers // 20)
 * - [401][408] 잔해(Debris) — 성벽 붕괴 등으로 생성, 헥스 ZOC 부여 및 이동 페널티
 */

import type { HexCoord } from './render_queue_types.js';

// ============================================================
// 1. 민란 위험도 [148]
// ============================================================

/** 민란 발생 임계 위험도 */
export const RIOT_THRESHOLD = 100;
/** 징병 1회당 피로도 증가 (Python: riot_risk += 5) */
export const RECRUIT_RIOT_INCREMENT = 5;
/** 굶주림 라운드당 위험도 증가 */
const STARVE_RIOT_INCREMENT = 15;
export const BANKRUPT_RIOT_INCREMENT = 15;
/** 치안 100 기준 매월 감소량 */
const ORDER_DECAY_MONTHLY = 3;

export interface CitySecurityState {
    cityId: string;
    /** 민란 위험도 0~100+ (Python riot_risk) */
    riotRisk: number;
    /** 민란 진압 직후 리셋 기준 */
    publicOrder: number;
}

/**
 * 징병에 따른 민란 위험도 축적 [148] — Python recruit_soldiers 이식.
 * @returns 갱신된 위험도
 */
export function accumulateRecruitFatigue(state: CitySecurityState, recruits: number): number {
    if (recruits <= 0) return state.riotRisk;
    // 대규모 징병일수록 피로도 가중 (기본 5 + 500명 초과분 보정)
    const fatigue = RECRUIT_RIOT_INCREMENT + (recruits > 500 ? 5 : 0);
    state.riotRisk += fatigue;
    return state.riotRisk;
}

/**
 * 월세 미납에 따른 위험도 누적 [C-3] — processStarvation 과 같은 가중치.
 * 굶주림이 "먹이를 못 줬다"면 이건 "값을 못 줬다"다. 결과는 같은 파이프라인
 * (checkRiot → 도시 이탈 → 세력 멸망)으로 흘러가므로 별도 패배 경로가 필요 없다.
 */
export function accumulateUnpaidWages(state: CitySecurityState): number {
    state.riotRisk += BANKRUPT_RIOT_INCREMENT;
    return state.riotRisk;
}

/**
 * 굶주림에 따른 위험도 급등 + 병력 아사 [148] — Python process_turn 이식.
 * 군량 0 도달 시 병력 5% 소모 (Python: soldiers // 20) 및 위험도 +15.
 */
export function processStarvation(
    state: CitySecurityState,
    food: number,
    soldiers: number,
): { starveLoss: number; soldiersAfter: number; riotRisk: number } {
    if (food > 0) {
        return { starveLoss: 0, soldiersAfter: soldiers, riotRisk: state.riotRisk };
    }
    const starveLoss = Math.floor(soldiers / 20);
    const soldiersAfter = Math.max(0, soldiers - starveLoss);
    state.riotRisk += STARVE_RIOT_INCREMENT;
    return { starveLoss, soldiersAfter, riotRisk: state.riotRisk };
}

/**
 * 월간 위험도 자연 감소 — 치안이 높을수록 빠르게 진정.
 * @returns 갱신된 위험도
 */
export function decayRiotRisk(state: CitySecurityState, publicOrder: number): number {
    const decay = ORDER_DECAY_MONTHLY + Math.floor(publicOrder / 25);
    state.riotRisk = Math.max(0, state.riotRisk - decay);
    return state.riotRisk;
}

/** 민란 판정 결과 */
export interface RiotOutcome {
    occurred: boolean;
    /** 반란으로 이탈한 소속 세력 ID (occurred 시) */
    fromFactionId?: string;
    message?: string;
}

/**
 * [148] 민란 발생 판정 — 위험도 ≥ 임계 && 치안 미달 시 반란.
 * 반란 시 위험도는 40으로 부분 리셋 (근원 제거되지 않으면 재발 여지).
 */
export function checkRiot(
    state: CitySecurityState,
    ownerId: string | null,
    roll: number = Math.random(),
): RiotOutcome {
    if (ownerId === null) return { occurred: false };
    if (state.riotRisk < RIOT_THRESHOLD) return { occurred: false };
    // 치안이 높으면 100 위험도라도 억제 (30 이상이면 50% 이상 억제)
    const suppression = Math.min(0.8, state.publicOrder / 125);
    if (roll < suppression) {
        // 억제됨 — 위험도 일부 소각
        state.riotRisk = Math.max(0, state.riotRisk - 30);
        return { occurred: false, message: '민심이 흉흉하나 치안 기관이 선제 진압했다' };
    }
    state.riotRisk = 40; // 반란 후 부분 리셋
    return {
        occurred: true,
        fromFactionId: ownerId,
        message: '🔥 민란이 일어나 도시가 소속 세력에서 이탈했다!',
    };
}

// ============================================================
// 2. 잔해(Debris) ZOC [401][408]
// ============================================================

/** 잔해 타일 — 성벽 붕괴/공성 후 생성 */
export interface DebrisTile {
    /** 헥스 키 "q,r" */
    key: string;
    q: number;
    r: number;
    /** 생성 턴 — 자연 소거(청소) 판정용 */
    createdAtTurn: number;
    /** 이동 비용 배율 (잔해 지대는 통과 비용 큼) */
    moveCostMultiplier: number;
}

const DEBRIS_MOVE_COST = 2.0;
const DEBRIS_DURATION_TURNS = 3;
const DEBRIS_SPREAD_RADIUS = 1;

export class DebrisField {
    private tiles: Map<string, DebrisTile> = new Map();

    /** 잔해 생성 [401] — 성벽 붕괴물 물리. 중심 타일 + 1 반경 인접 헥스에 퍼짐 */
    createDebris(center: HexCoord, turn: number): DebrisTile[] {
        const created: DebrisTile[] = [];
        const coords: Array<[number, number]> = [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        for (const [dq, dr] of coords) {
            const q = center.q + dq;
            const r = center.r + dr;
            const key = `${q},${r}`;
            if (this.tiles.has(key)) continue;
            const tile: DebrisTile = {
                key, q, r,
                createdAtTurn: turn,
                moveCostMultiplier: DEBRIS_MOVE_COST,
            };
            this.tiles.set(key, tile);
            created.push(tile);
        }
        return created;
    }

    /** 해당 헥스가 잔해인지 */
    hasDebris(q: number, r: number): boolean {
        return this.tiles.has(`${q},${r}`);
    }

    /** 잔해 타일의 이동 비용 배율 — 비잔해는 1.0 */
    getMoveCostMultiplier(q: number, r: number): number {
        return this.tiles.get(`${q},${r}`)?.moveCostMultiplier ?? 1.0;
    }

    /**
     * [401] 잔해 ZOC — 잔해 타일에 인접한 헥스 집합 반환 (이동 제약 경계).
     * A* 패스파인더의 isPassable/getMoveCost에 결합하여 사용.
     */
    getDebrisZocKeys(): Set<string> {
        const zoc = new Set<string>();
        const dirs: Array<[number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        for (const tile of this.tiles.values()) {
            for (const [dq, dr] of dirs) {
                zoc.add(`${tile.q + dq},${tile.r + dr}`);
            }
        }
        return zoc;
    }

    /** 잔해가 ZOC 경계에 있는지 */
    isInDebrisZoc(q: number, r: number): boolean {
        if (this.tiles.has(`${q},${r}`)) return true;
        const dirs: Array<[number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        for (const [dq, dr] of dirs) {
            if (this.tiles.has(`${q + dq},${r + dr}`)) return true;
        }
        return false;
    }

    /** 수명 종료 잔해 자동 소거 [408] — 청소/붕괴 안정화 */
    cleanupExpired(currentTurn: number): number {
        let removed = 0;
        for (const [key, tile] of this.tiles) {
            if (currentTurn - tile.createdAtTurn >= DEBRIS_DURATION_TURNS) {
                this.tiles.delete(key);
                removed++;
            }
        }
        return removed;
    }

    /** 세이브/로드 */
    serialize(): DebrisTile[] {
        return [...this.tiles.values()];
    }

    restore(tiles: DebrisTile[]): void {
        this.tiles = new Map(tiles.map(t => [t.key, t]));
    }

    get size(): number {
        return this.tiles.size;
    }
}

/** 잔해 확산 반경 상수 노출 (테스트/모딩용) */
export const DEBRIS_CONFIG = {
    MOVE_COST: DEBRIS_MOVE_COST,
    DURATION_TURNS: DEBRIS_DURATION_TURNS,
    SPREAD_RADIUS: DEBRIS_SPREAD_RADIUS,
} as const;
