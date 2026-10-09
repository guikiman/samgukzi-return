/**
 * 삼국지리턴 — AI Worker 엔진
 * 파일: src/core/ai_worker.ts
 *
 * Web Worker 기반 1,000명 AI 의사결정 엔진
 * 메인 스레드와 분리되어 백그라운드에서 AI 턴 연산 수행
 */

import {
    WorkerRequest, WorkerResponse, AIWorkerPayload, AIWorkerResult,
    AIDecision, AIDecisionContext, Officer, Faction, City,
    OfficerID, NormalizedState, GlobalState, CommandType, RelationType,
    GamePhase,
} from './types.js';
import { simulateAutoBattle, type AutoBattleSides } from './auto_battle_simulator.js';
import { AStarHexPathfinder } from './astar_hex_pathfinder.js';
import type { HexCoord } from './render_queue_types.js';

// ============================================================
// AI 의사결정 코어 로직 (Worker 내부에서 실행)
// ============================================================
class AIDecisionEngine {
    private state: NormalizedState;
    private globalState: GlobalState;
    /** Worker 턴 동안 반복 Object.values 할당을 피하기 위한 읽기 전용 스냅샷 [201][202] */
    private readonly officers: Officer[];
    private readonly cities: City[];

    constructor(state: NormalizedState, globalState: GlobalState) {
        this.state = state;
        this.globalState = globalState;
        this.officers = Object.values(state.officers);
        this.cities = Object.values(state.cities);
    }

    processOfficer(officer: Officer): AIDecision | null {
        if (officer.hasActedThisTurn) return null;
        if (officer.status === 'FREE' || officer.status === 'REBEL') return null;
        if (officer.actionPoints < 10) return null;

        const context = this.buildContext(officer);
        if (!context) return null;

        const actionType = this.selectAction(officer, context);
        if (!actionType) return null;

        return {
            officerId: officer.id,
            actionType,
            priority: this.calculatePriority(officer, actionType),
            reasoning: this.generateReasoning(officer, actionType, context),
            payload: this.buildPayload(officer, actionType, context),
        };
    }

    private buildContext(officer: Officer): AIDecisionContext | null {
        const faction = officer.factionId
            ? this.state.factions[officer.factionId] ?? null
            : null;
        const city = officer.cityId
            ? this.state.cities[officer.cityId] ?? null
            : null;
        if (!faction || !city) return null;

        const nearbyCities = this.cities
            .filter(c => c.id !== city.id &&
                Math.abs(c.hexCoord.q - city.hexCoord.q) +
                Math.abs(c.hexCoord.r - city.hexCoord.r) <= 3)
            .slice(0, 10);

        const enemyFactions: Faction[] = [];
        const allyFactions: Faction[] = [];

        for (const [targetId, diplo] of Object.entries(faction.diplomacy)) {
            const targetFaction = this.state.factions[targetId];
            if (!targetFaction) continue;
            if (diplo.treaty === 'WAR' || diplo.treaty === 'NONE') {
                enemyFactions.push(targetFaction);
            } else if (diplo.treaty === 'ALLIANCE' || diplo.treaty === 'CEASEFIRE') {
                allyFactions.push(targetFaction);
            }
        }

        const relationships = this.state.byOfficer.relationships[officer.id] ?? [];

        return {
            officerId: officer.id,
            officer,
            faction,
            city,
            nearbyCities,
            enemyFactions,
            allyFactions,
            relationships,
            gameTime: this.globalState.time,
            season: this.globalState.season,
            weather: this.globalState.weather,
        };
    }

    private selectAction(officer: Officer, ctx: AIDecisionContext): CommandType | null {
        const scores: Record<CommandType, number> = {
            DOMESTIC: 0, TRAINING: 0, RECRUITMENT: 0,
            MOVEMENT: 0, DIPLOMACY: 0, BATTLE: 0,
            REST: 0, SOCIAL: 0, SEARCH: 0,
        };

        const p = officer.personality;
        const statP = officer.stats;

        scores.DOMESTIC = (statP.politics / 100) * 0.4 +
                          (p === 'CALM' ? 0.2 : p === 'LOYAL' ? 0.15 : 0.1);
        scores.TRAINING = (statP.intelligence / 100) * 0.3 +
                          (p === 'CAUTIOUS' ? 0.2 : 0.1);
        scores.RECRUITMENT = (statP.charisma / 100) * 0.4 +
                             (p === 'AMBITIOUS' ? 0.25 : 0.1);
        scores.MOVEMENT = (ctx.enemyFactions.length > 0 ? 0.2 : 0.1) +
                          (p === 'AGGRESSIVE' ? 0.2 : 0.05);
        scores.DIPLOMACY = (statP.intelligence / 100) * 0.3 +
                          (statP.charisma / 100) * 0.2;
        scores.BATTLE = (statP.might / 100) * 0.4 +
                       (statP.leadership / 100) * 0.2 +
                       (p === 'AGGRESSIVE' ? 0.3 : p === 'AMBITION' as unknown ? 0.2 : 0.05);
        scores.REST = officer.stamina < 30 ? 0.5 : 0.05;
        scores.SOCIAL = (statP.charisma / 100) * 0.3;
        scores.SEARCH = (statP.intelligence / 100) * 0.2;

        if (officer.actionPoints < 20) {
            return officer.stamina < 30 ? 'REST' : 'DOMESTIC';
        }

        let best: CommandType = 'DOMESTIC';
        let bestScore = 0;
        for (const [action, score] of Object.entries(scores)) {
            if (score > bestScore) {
                bestScore = score;
                best = action as CommandType;
            }
        }
        return best;
    }

    private calculatePriority(officer: Officer, actionType: CommandType): number {
        const basePriority = officer.stats.leadership / 100 + officer.ambition / 100;
        const actionMultiplier: Record<CommandType, number> = {
            BATTLE: 1.2, RECRUITMENT: 1.1, DIPLOMACY: 1.0,
            DOMESTIC: 0.9, MOVEMENT: 0.8, TRAINING: 0.7,
            SOCIAL: 0.6, SEARCH: 0.5, REST: 0.3,
        };
        return basePriority * (actionMultiplier[actionType] ?? 1.0);
    }

    private generateReasoning(officer: Officer, actionType: CommandType, ctx: AIDecisionContext): string {
        const actionNames: Record<CommandType, string> = {
            DOMESTIC: '내정', TRAINING: '훈련', RECRUITMENT: '등용',
            MOVEMENT: '이동', DIPLOMACY: '외교', BATTLE: '전투',
            REST: '휴양', SOCIAL: '교류', SEARCH: '탐색',
        };
        return `${officer.name} → ${actionNames[actionType]} (성향: ${officer.personality}, 도시: ${ctx.city?.name ?? '미설정'})`;
    }

    private buildPayload(officer: Officer, actionType: CommandType, ctx: AIDecisionContext): Record<string, unknown> {
        const cityId = ctx.city?.id ?? '';
        switch (actionType) {
            case 'DOMESTIC':
                return { cityId, facilityType: 'FARM' };
            case 'TRAINING':
                return { statKey: officer.stats.might > officer.stats.intelligence ? 'might' : 'intelligence' };
            case 'RECRUITMENT': {
                const freeOfficers = this.officers
                    .filter(o => o.factionId === null && o.cityId === officer.cityId)
                    .slice(0, 1);
                return freeOfficers.length > 0 ? { targetOfficerId: freeOfficers[0].id } : {};
            }
            case 'MOVEMENT':
                return ctx.nearbyCities.length > 0
                    ? { fromCityId: cityId, toCityId: ctx.nearbyCities[0].id }
                    : {};
            case 'DIPLOMACY':
                return ctx.enemyFactions.length > 0
                    ? { targetFactionId: ctx.enemyFactions[0].id }
                    : {};
            case 'BATTLE':
                return ctx.enemyFactions.length > 0
                    ? { targetFactionId: ctx.enemyFactions[0].id }
                    : {};
            case 'REST':
            case 'SOCIAL':
            case 'SEARCH':
            default:
                return {};
        }
    }
}

// ============================================================
// Web Worker 메인 루프 (Worker 컨텍스트에서 실행)
// ============================================================
const workerSelf = self as unknown as {
    onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
    postMessage: (msg: WorkerResponse) => void;
};

workerSelf.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const request = e.data;
    if (!request || !request.id) return;

    try {
        switch (request.type) {
            case 'AI_DECISION': {
                handleAIDecision(request);
                break;
            }
            case 'BATTLE_SIM': {
                handleBattleSim(request);
                break;
            }
            case 'PATHFIND': {
                handlePathfind(request);
                break;
            }
            default: {
                workerSelf.postMessage({
                    id: request.id, success: false, error: `Unknown request type: ${request.type}`,
                });
            }
        }
    } catch (err) {
        workerSelf.postMessage({
            id: request.id, success: false, error: err instanceof Error ? err.message : String(err),
        });
    }
};

function handleAIDecision(request: WorkerRequest): void {
    const payload = request.payload as unknown as AIWorkerPayload;
    if (!payload.officerIds || !payload.stateSnapshot) {
        workerSelf.postMessage({ id: request.id, success: false, error: 'Invalid AI payload' });
        return;
    }

    const engine = new AIDecisionEngine(payload.stateSnapshot, payload.globalState);
    const decisions: AIDecision[] = [];

    for (const officerId of payload.officerIds) {
        const officer = payload.stateSnapshot.officers[officerId];
        if (!officer) continue;
        const decision = engine.processOfficer(officer);
        if (decision) decisions.push(decision);
    }

    const result: AIWorkerResult = { decisions };
    workerSelf.postMessage({ id: request.id, success: true, result });
}

function handleBattleSim(request: WorkerRequest): void {
    const payload = request.payload as { sides?: AutoBattleSides };
    if (!payload.sides?.attacker || !payload.sides?.defender) {
        workerSelf.postMessage({ id: request.id, success: false, error: 'Invalid battle simulation payload' });
        return;
    }
    // [295] 고정된 더미 결과 대신 전투력·지형·보급·사기 규칙을 실제 적용한다.
    const result = simulateAutoBattle(payload.sides);
    workerSelf.postMessage({ id: request.id, success: true, result });
}

function readHexCoord(value: unknown): HexCoord | null {
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.q !== 'number' || typeof record.r !== 'number' ||
        !Number.isFinite(record.q) || !Number.isFinite(record.r)) {
        return null;
    }
    return { q: Math.trunc(record.q), r: Math.trunc(record.r) };
}

function handlePathfind(request: WorkerRequest): void {
    const payload = request.payload as {
        start?: unknown;
        end?: unknown;
        blocked?: unknown;
        moveCosts?: unknown;
        maxSteps?: unknown;
    };
    const start = readHexCoord(payload.start);
    const end = readHexCoord(payload.end);
    if (!start || !end) {
        workerSelf.postMessage({ id: request.id, success: false, error: 'Invalid pathfinding payload' });
        return;
    }

    const blocked = new Set<string>();
    if (Array.isArray(payload.blocked)) {
        for (const value of payload.blocked) {
            const coord = readHexCoord(value);
            if (coord) blocked.add(`${coord.q},${coord.r}`);
        }
    }

    const moveCosts = payload.moveCosts && typeof payload.moveCosts === 'object'
        ? payload.moveCosts as Record<string, unknown>
        : {};
    const maxSteps = typeof payload.maxSteps === 'number' && Number.isFinite(payload.maxSteps)
        ? Math.max(1, Math.trunc(payload.maxSteps))
        : 100;
    const pathfinder = new AStarHexPathfinder();
    const path = pathfinder.findPath(
        start,
        end,
        coord => !blocked.has(`${coord.q},${coord.r}`),
        coord => {
            const raw = moveCosts[`${coord.q},${coord.r}`];
            return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0.1, raw) : 1;
        },
        maxSteps,
    );
    workerSelf.postMessage({
        id: request.id,
        success: true,
        result: { path, distance: Math.max(0, path.length - 1), found: path.length > 0 },
    });
}

export {};
