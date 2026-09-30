/**
 * 삼국지리턴 — 심층 AI 무장 심리 및 의사결정 엔진
 * 파일: src/core/officer_ai_controller.ts
 *
 * FSM(유한상태기계) + Behavior Tree(행동 트리) 하이브리드
 * 배신 판정, 사직/가출, 원수 추적 로직 포함
 *
 * 핵심 수학 공식:
 * - 배신 확률: P(betray) = (Ambition×1.5 - Loyalty×2.0 - Affection_Ruler×0.5 + BadRulerReputation) / 100
 * - 사직 트리거: 도덕성 가중 충성도 급락
 * - 원수 추적: 관계 그래프 기반 행동 트리
 */

import {
    Officer, OfficerID, FactionID, Faction, City,
    OfficerStatus, Personality, IGameStore,
    RelationshipEdge, RelationType, AIDecision, CommandType,
    OfficerStats, GamePhase,
} from './types.js';

// ============================================================
// 무장 심리 상태 스키마 (OfficerPsychologyState)
// ============================================================

export enum PsycheState {
    LOYAL = 'LOYAL',
    DISGRUNTLED = 'DISGRUNTLED',
    CONTEMPLATING_BETRAYAL = 'CONTEMPLATING_BETRAYAL',
    SEEKING_RESIGNATION = 'SEEKING_RESIGNATION',
    VENGEFUL = 'VENGEFUL',
    REBELLIOUS = 'REBELLIOUS',
}

export interface OfficerPsychologyState {
    officerId: OfficerID;
    state: PsycheState;
    loyalty: number;
    stability: number;
    stress: number;
    affectionRuler: number;
    affectionAllies: number;
    fearRuler: number;
    greedSatisfaction: number;
    betrayProbability: number;
    resignProbability: number;
    vengeanceTargetId: OfficerID | null;
    lastBetrayCheckTurn: number;
    lastResignCheckTurn: number;
    moodLog: { turn: number; event: string; delta: number }[];
}

export function createInitialPsychology(officer: Officer): OfficerPsychologyState {
    return {
        officerId: officer.id,
        state: PsycheState.LOYAL,
        loyalty: officer.loyalty,
        stability: 70,
        stress: 0,
        affectionRuler: officer.loyalty * 0.6,
        affectionAllies: 50,
        fearRuler: 0,
        greedSatisfaction: 50,
        betrayProbability: 0,
        resignProbability: 0,
        vengeanceTargetId: null,
        lastBetrayCheckTurn: 0,
        lastResignCheckTurn: 0,
        moodLog: [],
    };
}

// ============================================================
// 관계 그래프 노드 (RelationshipGraph)
// ============================================================

export interface RelationshipNode {
    officerId: OfficerID;
    edges: Map<OfficerID, RelationshipEdge>;
    affectionCache: Map<OfficerID, number>;
}

export class RelationshipGraph {
    private nodes: Map<OfficerID, RelationshipNode>;
    private store: IGameStore;

    constructor(store: IGameStore) {
        this.nodes = new Map();
        this.store = store;
        this.rebuildGraph();
    }

    rebuildGraph(): void {
        this.nodes.clear();
        const allOfficers = this.store.getAllOfficers();
        for (const officer of allOfficers) {
            this.addNode(officer.id);
        }
        for (const officer of allOfficers) {
            const edges = this.store.getRelationships(officer.id);
            for (const edge of edges) {
                this.addEdge(edge);
            }
        }
    }

    addNode(officerId: OfficerID): void {
        if (!this.nodes.has(officerId)) {
            this.nodes.set(officerId, {
                officerId,
                edges: new Map(),
                affectionCache: new Map(),
            });
        }
    }

    addEdge(edge: RelationshipEdge): void {
        this.addNode(edge.source);
        this.addNode(edge.target);
        const sourceNode = this.nodes.get(edge.source)!;
        sourceNode.edges.set(edge.target, edge);
        sourceNode.affectionCache.set(edge.target, edge.affinity);
    }

    getAffection(sourceId: OfficerID, targetId: OfficerID): number {
        const node = this.nodes.get(sourceId);
        if (!node) return 50;
        return node.affectionCache.get(targetId) ?? 50;
    }

    getEdges(officerId: OfficerID): RelationshipEdge[] {
        const node = this.nodes.get(officerId);
        if (!node) return [];
        return Array.from(node.edges.values());
    }

    getRelationType(sourceId: OfficerID, targetId: OfficerID): RelationType | null {
        const node = this.nodes.get(sourceId);
        if (!node) return null;
        return node.edges.get(targetId)?.type ?? null;
    }

    getSwornBrothers(officerId: OfficerID): OfficerID[] {
        const edges = this.getEdges(officerId);
        return edges
            .filter(e => e.type === 'SWORN_BROTHER')
            .map(e => e.target);
    }

    getNemeses(officerId: OfficerID): OfficerID[] {
        const edges = this.getEdges(officerId);
        return edges
            .filter(e => e.type === 'NEMESIS')
            .map(e => e.target);
    }

    getFamily(officerId: OfficerID): OfficerID[] {
        const edges = this.getEdges(officerId);
        return edges
            .filter(e => e.type === 'FAMILY')
            .map(e => e.target);
    }

    getSpouse(officerId: OfficerID): OfficerID | null {
        const edges = this.getEdges(officerId);
        const spouseEdge = edges.find(e => e.type === 'SPOUSE');
        return spouseEdge?.target ?? null;
    }
}

// ============================================================
// 행동 트리 노드 타입
// ============================================================

export type BehaviorStatus = 'SUCCESS' | 'FAILURE' | 'RUNNING';

export interface BehaviorContext {
    officer: Officer;
    psyche: OfficerPsychologyState;
    store: IGameStore;
    graph: RelationshipGraph;
    turn: number;
}

export abstract class BTNode {
    abstract execute(ctx: BehaviorContext): BehaviorStatus;
}

export class BTSequence extends BTNode {
    private children: BTNode[];
    constructor(children: BTNode[]) { super(); this.children = children; }
    execute(ctx: BehaviorContext): BehaviorStatus {
        for (const child of this.children) {
            const status = child.execute(ctx);
            if (status !== 'SUCCESS') return status;
        }
        return 'SUCCESS';
    }
}

export class BTSelector extends BTNode {
    private children: BTNode[];
    constructor(children: BTNode[]) { super(); this.children = children; }
    execute(ctx: BehaviorContext): BehaviorStatus {
        for (const child of this.children) {
            const status = child.execute(ctx);
            if (status !== 'FAILURE') return status;
        }
        return 'FAILURE';
    }
}

export class BTCondition extends BTNode {
    private check: (ctx: BehaviorContext) => boolean;
    constructor(check: (ctx: BehaviorContext) => boolean) { super(); this.check = check; }
    execute(ctx: BehaviorContext): BehaviorStatus {
        return this.check(ctx) ? 'SUCCESS' : 'FAILURE';
    }
}

export class BTAction extends BTNode {
    private action: (ctx: BehaviorContext) => BehaviorStatus;
    constructor(action: (ctx: BehaviorContext) => BehaviorStatus) { super(); this.action = action; }
    execute(ctx: BehaviorContext): BehaviorStatus {
        return this.action(ctx);
    }
}

// ============================================================
// OfficerAIController — 메인 AI 제어기
// ============================================================

export class OfficerAIController {
    private store: IGameStore;
    private graph: RelationshipGraph;
    private psyches: Map<OfficerID, OfficerPsychologyState>;
    private behaviorTrees: Map<OfficerID, BTNode>;
    private fsmTransitions: Record<PsycheState, Record<string, PsycheState>>;

    constructor(store: IGameStore) {
        this.store = store;
        this.graph = new RelationshipGraph(store);
        this.psyches = new Map();
        this.behaviorTrees = new Map();
        this.fsmTransitions = this.buildFSM();
        this.initPsychologies();
    }

    // ============================================================
    // FSM 정의 — 심리 상태 전이 규칙
    // ============================================================
    private buildFSM(): Record<PsycheState, Record<string, PsycheState>> {
        return {
            [PsycheState.LOYAL]: {
                STRESS_HIGH: PsycheState.DISGRUNTLED,
                BETRAYAL_INTENT: PsycheState.CONTEMPLATING_BETRAYAL,
                MORAL_OUTRAGE: PsycheState.SEEKING_RESIGNATION,
                VENGEANCE_TRIGGER: PsycheState.VENGEFUL,
            },
            [PsycheState.DISGRUNTLED]: {
                STRESS_RECOVERED: PsycheState.LOYAL,
                BETRAYAL_INTENT: PsycheState.CONTEMPLATING_BETRAYAL,
                MORAL_OUTRAGE: PsycheState.SEEKING_RESIGNATION,
                VENGEANCE_TRIGGER: PsycheState.VENGEFUL,
                REACHED_LIMIT: PsycheState.REBELLIOUS,
            },
            [PsycheState.CONTEMPLATING_BETRAYAL]: {
                BETRAY_CONFIRM: PsycheState.REBELLIOUS,
                LOYALTY_RESTORED: PsycheState.LOYAL,
                MORAL_OUTRAGE: PsycheState.SEEKING_RESIGNATION,
            },
            [PsycheState.SEEKING_RESIGNATION]: {
                RESIGN_CONFIRM: PsycheState.LOYAL,
                CANCELLED: PsycheState.DISGRUNTLED,
            },
            [PsycheState.VENGEFUL]: {
                VENGEANCE_FULFILLED: PsycheState.DISGRUNTLED,
                TARGET_DEAD: PsycheState.LOYAL,
            },
            [PsycheState.REBELLIOUS]: {
                CAPTURED: PsycheState.LOYAL,
                EXECUTED: PsycheState.LOYAL,
            },
        };
    }

    private transitionState(psyche: OfficerPsychologyState, event: string): void {
        const transitions = this.fsmTransitions[psyche.state];
        const newState = transitions?.[event];
        if (newState) {
            psyche.state = newState;
            psyche.moodLog.push({
                turn: psyche.lastBetrayCheckTurn,
                event: `FSM: ${psyche.state} → ${newState} (${event})`,
                delta: 0,
            });
            psyche.state = newState;
        }
    }

    // ============================================================
    // 심리 상태 초기화
    // ============================================================
    private initPsychologies(): void {
        const officers = this.store.getAllOfficers();
        for (const officer of officers) {
            this.psyches.set(officer.id, createInitialPsychology(officer));
        }
    }

    getPsychology(officerId: OfficerID): OfficerPsychologyState | null {
        return this.psyches.get(officerId) ?? null;
    }

    refreshGraph(): void {
        this.graph.rebuildGraph();
    }

    // ============================================================
    // 핵심: 매달 심리 평가 (evaluateMonthlyPsychology)
    // ============================================================
    evaluateMonthlyPsychology(officerId: OfficerID, turn: number): OfficerPsychologyState | null {
        const officer = this.store.getOfficer(officerId);
        if (!officer) return null;

        let psyche = this.psyches.get(officerId);
        if (!psyche) {
            psyche = createInitialPsychology(officer);
            this.psyches.set(officerId, psyche);
        }

        psyche.lastBetrayCheckTurn = turn;
        psyche.lastResignCheckTurn = turn;

        this.evaluateStress(officer, psyche, turn);
        this.evaluateAffection(officer, psyche);
        this.evaluateGreedSatisfaction(officer, psyche);

        const betrayProb = this.calculateBetrayProbability(officer, psyche);
        psyche.betrayProbability = betrayProb;

        const resignProb = this.calculateResignProbability(officer, psyche);
        psyche.resignProbability = resignProb;

        const vengeanceTarget = this.detectVengeanceTarget(officer);
        psyche.vengeanceTargetId = vengeanceTarget;

        this.applyFSMTransitions(officer, psyche, betrayProb, resignProb, vengeanceTarget);

        this.executeBehaviorTree(officer, psyche, turn);

        this.store.updateOfficer(officerId, {
            loyalty: Math.max(0, Math.min(100, psyche.loyalty)),
        });

        return psyche;
    }

    // ============================================================
    // [1] 배신 판정 확률식
    // ============================================================
    // P(betray) = (Ambition×1.5 - Loyalty×2.0 - Affection_Ruler×0.5 + BadRulerReputation) / 100
    //
    // 변수 설명:
    // - Ambition (0~100): 무장의 야망 수치. 높을수록 배신 가능성 증가 (가중치 1.5)
    // - Loyalty (0~100): 현재 충성도. 높을수록 배신 감소 (가중치 2.0)
    // - Affection_Ruler (0~100): 군주에 대한 호감도. 높을수록 배신 감소 (가중치 0.5)
    // - BadRulerReputation (0~100): 군주의 악명(폭정/약탈/참수 횟수 가중).
    //   높을수록 배신 증가 (부호 양수)
    //
    // 추가 변수:
    // - rankFrustration: 공적 대비 관직 품계가 낮을 때의 불만 가중치
    // - bribeOffer: 타 세력의 뇌물/내응 제안 존재 여부 (0 or 1)
    // - independentOffer: 태수 독립 제안 존재 여부 (0 or 1)
    //
    // 최종 확률은 [0, 1] 범위로 clamp
    // ============================================================
    calculateBetrayProbability(officer: Officer, psyche: OfficerPsychologyState): number {
        const ambition = officer.ambition;
        const loyalty = psyche.loyalty;
        const affectionRuler = psyche.affectionRuler;

        const faction = officer.factionId ? this.store.getFaction(officer.factionId) : null;
        const ruler = faction ? this.store.getOfficer(faction.leaderId) : null;
        const badRulerReputation = ruler ? ruler.infamy : 0;

        const rankFrustration = this.calculateRankFrustration(officer);
        const bribeOffer = this.checkBribeOffers(officer) ? 1 : 0;
        const independentOffer = this.checkIndependenceOffers(officer) ? 1 : 0;

        const numerator =
            (ambition * 1.5) -
            (loyalty * 2.0) -
            (affectionRuler * 0.5) +
            badRulerReputation +
            (rankFrustration * 0.8) +
            (bribeOffer * 15) +
            (independentOffer * 20);

        const probability = numerator / 100;

        return Math.max(0, Math.min(1, probability));
    }

    /**
     * 공적(merit) 대비 관직 품계가 낮을 때의 불만도 계산
     * rank가 낮을수록(9품→1품) 높은 품계이므로, merit 대비 rank가 높으면 불만
     */
    private calculateRankFrustration(officer: Officer): number {
        const expectedRank = Math.max(1, Math.min(9, 9 - Math.floor(officer.merit / 500)));
        const actualRankValue = officer.rank;
        const frustration = (expectedRank - actualRankValue) * 5;
        return Math.max(0, frustration);
    }

    /**
     * 타 세력에서 뇌물과 함께 내응 제안이 왔는지 확인
     * 실제 구현: 외교 시스템에서 bribeOffer 플래그 확인
     */
    private checkBribeOffers(officer: Officer): boolean {
        if (!officer.factionId) return false;
        const allFactions = this.store.getAllFactions();
        for (const faction of allFactions) {
            if (faction.id === officer.factionId) continue;
            const diplomacy = faction.diplomacy[officer.factionId];
            if (diplomacy && diplomacy.treaty === 'WAR') {
                return true;
            }
        }
        return false;
    }

    /**
     * 태수(도시 지배자)로서 독립 제안이 왔는지 확인
     * 도시의 ownerId가 본인이고 충성도가 낮을 때 독립 제안 가능
     */
    private checkIndependenceOffers(officer: Officer): boolean {
        if (!officer.cityId || !officer.factionId) return false;
        const city = this.store.getCity(officer.cityId);
        if (!city) return false;
        const faction = this.store.getFaction(officer.factionId);
        if (!faction) return false;
        if (officer.status === OfficerStatus.Governor && officer.loyalty < 40) {
            return true;
        }
        return false;
    }

    // ============================================================
    // [2] 사직 및 가출 트리거 — 도덕성 기반 충성도 급락
    // ============================================================
    // 도덕성(morality)이 높은 선비형 장수가 군주의 악행을 목격했을 때:
    // - 충성도 급락 = (morality / 100) × badActionSeverity × 0.5
    // - badActionSeverity: 악행의 심각도 (약탈=10, 무고 참수=20, 폭정=15)
    //
    // 충성도가 임계치(30) 이하로 떨어지면:
    // - 사직서 제출 후 재야화 (status → FREE, factionId → null)
    // - 또는 의형제 세력으로 탈주 (의형제가 있는 세력으로 이동)
    // ============================================================
    calculateResignProbability(officer: Officer, psyche: OfficerPsychologyState): number {
        if (officer.status === OfficerStatus.LORD || officer.status === OfficerStatus.FREE) {
            return 0;
        }

        const morality = officer.morality;
        const loyalty = psyche.loyalty;
        const stress = psyche.stress;

        const faction = officer.factionId ? this.store.getFaction(officer.factionId) : null;
        const ruler = faction ? this.store.getOfficer(faction.leaderId) : null;

        let badActionSeverity = 0;
        if (ruler) {
            badActionSeverity += ruler.infamy * 0.5;
            badActionSeverity += this.detectRulerAtrocities(ruler) * 10;
        }

        const loyaltyDropFromOutrage = (morality / 100) * badActionSeverity * 0.5;
        const effectiveLoyalty = loyalty - loyaltyDropFromOutrage;

        let prob = 0;
        if (effectiveLoyalty < 30) {
            prob = (30 - effectiveLoyalty) / 30;
        }
        if (stress > 70) {
            prob += (stress - 70) / 100;
        }

        const hasSwornBrothers = this.graph.getSwornBrothers(officer.id).length > 0;
        if (hasSwornBrothers && effectiveLoyalty < 20) {
            prob += 0.2;
        }

        return Math.max(0, Math.min(1, prob));
    }

    /**
     * 군주의 악행 탐지 (백성 약탈, 무고한 장수 참수 등)
     * infamy와 fame 비율로 악행 정도 추론
     */
    private detectRulerAtrocities(ruler: Officer): number {
        const atrocityScore = Math.max(0, ruler.infamy - ruler.fame);
        return atrocityScore / 10;
    }

    /**
     * 사직 실행 — 재야화 또는 의형제 세력으로 탈주
     */
    executeResignation(officer: Officer, turn: number): 'FREE' | 'DEFECT_TO_SWORN' {
        const swornBrothers = this.graph.getSwornBrothers(officer.id);

        if (swornBrothers.length > 0) {
            for (const brotherId of swornBrothers) {
                const brother = this.store.getOfficer(brotherId);
                if (brother && brother.factionId && brother.factionId !== officer.factionId) {
                    const targetFaction = this.store.getFaction(brother.factionId);
                    if (targetFaction) {
                        this.store.updateOfficer(officer.id, {
                            factionId: brother.factionId,
                            status: OfficerStatus.OFFICER,
                            cityId: brother.cityId,
                            loyalty: 60,
                        });
                        return 'DEFECT_TO_SWORN';
                    }
                }
            }
        }

        this.store.updateOfficer(officer.id, {
            factionId: null,
            status: OfficerStatus.FREE,
            cityId: officer.cityId,
            loyalty: 50,
        });
        return 'FREE';
    }

    // ============================================================
    // [3] 원수 추적 로직 — 행동 트리 노드
    // ============================================================
    // 자신의 친족이나 의형제를 참수한 원수 장수를 탐지:
    // - 관계 그래프에서 NEMESIS 타입 엣지 조회
    // - 원수가 같은 세력 내에 등용되었거나 전장에서 대면 시:
    //   1) 주군 명령 거역 + 일기토 강제 청구
    //   2) 밤중 자객 침투
    //
    // 행동 트리 구조:
    //   Selector
    //   ├── Sequence: 원수 감지 → 같은 세력? → 일기토 청구
    //   └── Sequence: 원수 감지 → 전장 대면? → 암살 시도
    // ============================================================

    /**
     * 원수 타겟 감지 — NEMESIS 관계의 상대가 같은 세력/전장에 있는지 확인
     */
    detectVengeanceTarget(officer: Officer): OfficerID | null {
        const nemeses = this.graph.getNemeses(officer.id);
        if (nemeses.length === 0) return null;

        for (const nemesisId of nemeses) {
            const nemesis = this.store.getOfficer(nemesisId);
            if (!nemesis) continue;
            if (nemesis.factionId === officer.factionId && nemesis.factionId !== null) {
                return nemesisId;
            }
            if (this.isInSameBattle(officer, nemesis)) {
                return nemesisId;
            }
        }
        return null;
    }

    private isInSameBattle(officer: Officer, nemesis: Officer): boolean {
        if (!officer.cityId || !nemesis.cityId) return false;
        return officer.cityId === nemesis.cityId;
    }

    /**
     * 원수 추적 행동 트리 구축
     */
    private buildVengeanceTree(): BTNode {
        return new BTSelector([
            new BTSequence([
                new BTCondition(ctx => ctx.psyche.vengeanceTargetId !== null),
                new BTCondition(ctx => {
                    if (!ctx.psyche.vengeanceTargetId) return false;
                    const target = ctx.store.getOfficer(ctx.psyche.vengeanceTargetId);
                    return target !== null && target.factionId === ctx.officer.factionId;
                }),
                new BTAction(ctx => this.actionChallengeDuel(ctx)),
            ]),
            new BTSequence([
                new BTCondition(ctx => ctx.psyche.vengeanceTargetId !== null),
                new BTCondition(ctx => this.isNightTime(ctx.turn)),
                new BTAction(ctx => this.actionAssassinate(ctx)),
            ]),
        ]);
    }

    /**
     * 일기토 강제 청구 — 주군 명령 거역
     */
    private actionChallengeDuel(ctx: BehaviorContext): BehaviorStatus {
        const targetId = ctx.psyche.vengeanceTargetId!;
        const target = ctx.store.getOfficer(targetId);
        if (!target) return 'FAILURE';

        ctx.psyche.moodLog.push({
            turn: ctx.turn,
            event: `원수 ${target.name}에게 일기토 청구 (주군 명령 거역)`,
            delta: -10,
        });
        ctx.psyche.stress = Math.min(100, ctx.psyche.stress + 20);

        return 'SUCCESS';
    }

    /**
     * 밤중 자객 침투 — 암살 시도
     */
    private actionAssassinate(ctx: BehaviorContext): BehaviorStatus {
        const targetId = ctx.psyche.vengeanceTargetId!;
        const target = ctx.store.getOfficer(targetId);
        if (!target) return 'FAILURE';

        const officer = ctx.officer;
        const successRate = Math.min(0.3, (officer.stats.might / 200) + (officer.stats.intelligence / 300));
        const isSuccess = Math.random() < successRate;

        ctx.psyche.moodLog.push({
            turn: ctx.turn,
            event: isSuccess
                ? `원수 ${target.name} 암살 성공`
                : `원수 ${target.name} 암살 실패`,
            delta: isSuccess ? 30 : -5,
        });

        if (isSuccess) {
            ctx.store.updateOfficer(targetId, { hp: 0 });
            ctx.psyche.vengeanceTargetId = null;
            this.transitionState(ctx.psyche, 'VENGEANCE_FULFILLED');
        }

        return isSuccess ? 'SUCCESS' : 'FAILURE';
    }

    private isNightTime(turn: number): boolean {
        return turn % 2 === 0;
    }

    // ============================================================
    // 스트레스/호감도/물욕 만족도 평가
    // ============================================================

    private evaluateStress(officer: Officer, psyche: OfficerPsychologyState, turn: number): void {
        let stressDelta = 0;

        if (officer.actionPoints < 20) stressDelta += 5;
        if (officer.stamina < 30) stressDelta += 10;
        if (officer.injuries > 0) stressDelta += 15;

        if (turn > 0 && turn % 6 === 0) {
            stressDelta -= 10;
        }

        psyche.stress = Math.max(0, Math.min(100, psyche.stress + stressDelta));
        psyche.stability = Math.max(0, Math.min(100, 100 - psyche.stress));
    }

    private evaluateAffection(officer: Officer, psyche: OfficerPsychologyState): void {
        const faction = officer.factionId ? this.store.getFaction(officer.factionId) : null;
        const ruler = faction ? this.store.getOfficer(faction.leaderId) : null;

        if (ruler) {
            const baseAffection = this.graph.getAffection(officer.id, ruler.id);
            const loyaltyFactor = psyche.loyalty / 100;
            psyche.affectionRuler = Math.max(0, Math.min(100, baseAffection * loyaltyFactor));

            if (ruler.infamy > 50) {
                psyche.fearRuler = Math.min(100, ruler.infamy * 0.6);
            } else {
                psyche.fearRuler = 0;
            }
        }

        const allies = this.graph.getSwornBrothers(officer.id);
        if (allies.length > 0) {
            let totalAllyAffection = 0;
            for (const allyId of allies) {
                totalAllyAffection += this.graph.getAffection(officer.id, allyId);
            }
            psyche.affectionAllies = totalAllyAffection / allies.length;
        }
    }

    private evaluateGreedSatisfaction(officer: Officer, psyche: OfficerPsychologyState): void {
        const expectedSalary = officer.merit * 2 + officer.rank * 50;
        const salaryRatio = officer.salary / Math.max(1, expectedSalary);
        psyche.greedSatisfaction = Math.max(0, Math.min(100, salaryRatio * 50));

        const treasureBonus = officer.inventory.treasures.length * 5;
        psyche.greedSatisfaction = Math.min(100, psyche.greedSatisfaction + treasureBonus);

        if (officer.greed > 70 && psyche.greedSatisfaction < 40) {
            psyche.loyalty = Math.max(0, psyche.loyalty - 3);
        }
    }

    // ============================================================
    // FSM 전이 적용
    // ============================================================
    private applyFSMTransitions(
        officer: Officer,
        psyche: OfficerPsychologyState,
        betrayProb: number,
        resignProb: number,
        vengeanceTarget: OfficerID | null,
    ): void {
        if (psyche.state === PsycheState.LOYAL) {
            if (psyche.stress > 70) {
                this.transitionState(psyche, 'STRESS_HIGH');
            } else if (vengeanceTarget) {
                this.transitionState(psyche, 'VENGEANCE_TRIGGER');
            } else if (resignProb > 0.5 && officer.morality > 70) {
                this.transitionState(psyche, 'MORAL_OUTRAGE');
            } else if (betrayProb > 0.5) {
                this.transitionState(psyche, 'BETRAYAL_INTENT');
            }
        } else if (psyche.state === PsycheState.DISGRUNTLED) {
            if (psyche.stress < 30) {
                this.transitionState(psyche, 'STRESS_RECOVERED');
            } else if (vengeanceTarget) {
                this.transitionState(psyche, 'VENGEANCE_TRIGGER');
            } else if (betrayProb > 0.7) {
                this.transitionState(psyche, 'REACHED_LIMIT');
            } else if (betrayProb > 0.4) {
                this.transitionState(psyche, 'BETRAYAL_INTENT');
            } else if (resignProb > 0.5 && officer.morality > 70) {
                this.transitionState(psyche, 'MORAL_OUTRAGE');
            }
        } else if (psyche.state === PsycheState.CONTEMPLATING_BETRAYAL) {
            if (betrayProb > 0.8) {
                this.transitionState(psyche, 'BETRAY_CONFIRM');
                this.executeBetrayal(officer);
            } else if (betrayProb < 0.2) {
                this.transitionState(psyche, 'LOYALTY_RESTORED');
            }
        } else if (psyche.state === PsycheState.SEEKING_RESIGNATION) {
            if (resignProb > 0.7) {
                this.transitionState(psyche, 'RESIGN_CONFIRM');
                this.executeResignation(officer, psyche.lastBetrayCheckTurn);
            } else if (resignProb < 0.2) {
                this.transitionState(psyche, 'CANCELLED');
            }
        } else if (psyche.state === PsycheState.VENGEFUL) {
            if (!vengeanceTarget) {
                const target = this.store.getOfficer(psyche.vengeanceTargetId ?? '');
                if (!target || target.hp <= 0) {
                    this.transitionState(psyche, 'TARGET_DEAD');
                }
            }
        }
    }

    /**
     * 배신 실행 — 반란 또는 타 세력 내응
     */
    private executeBetrayal(officer: Officer): void {
        if (!officer.factionId) return;

        const isGovernor = officer.status === OfficerStatus.Governor;
        const hasArmy = officer.merit > 500;

        if (isGovernor && officer.cityId) {
            this.store.updateOfficer(officer.id, {
                status: OfficerStatus.REBEL,
                loyalty: 50,
            });
            const city = this.store.getCity(officer.cityId);
            if (city) {
                this.store.updateCity(officer.cityId, { ownerId: null });
            }
        } else {
            this.store.updateOfficer(officer.id, {
                factionId: null,
                status: OfficerStatus.FREE,
                loyalty: 30,
            });
        }
    }

    // ============================================================
    // 행동 트리 실행
    // ============================================================
    private executeBehaviorTree(officer: Officer, psyche: OfficerPsychologyState, turn: number): void {
        let tree = this.behaviorTrees.get(officer.id);
        if (!tree) {
            tree = this.buildBehaviorTreeForOfficer(officer, psyche);
            this.behaviorTrees.set(officer.id, tree);
        }

        const ctx: BehaviorContext = {
            officer,
            psyche,
            store: this.store,
            graph: this.graph,
            turn,
        };

        tree.execute(ctx);
    }

    private buildBehaviorTreeForOfficer(officer: Officer, psyche: OfficerPsychologyState): BTNode {
        return new BTSelector([
            new BTSequence([
                new BTCondition(ctx => ctx.psyche.state === PsycheState.VENGEFUL),
                new BTCondition(ctx => ctx.psyche.vengeanceTargetId !== null),
                this.buildVengeanceTree(),
            ]),
            new BTSequence([
                new BTCondition(ctx => ctx.psyche.state === PsycheState.CONTEMPLATING_BETRAYAL),
                new BTAction(ctx => this.actionContemplateBetrayal(ctx)),
            ]),
            new BTSequence([
                new BTCondition(ctx => ctx.psyche.state === PsycheState.SEEKING_RESIGNATION),
                new BTAction(ctx => this.actionSeekResignation(ctx)),
            ]),
            new BTSequence([
                new BTCondition(ctx => ctx.psyche.state === PsycheState.REBELLIOUS),
                new BTAction(ctx => this.actionRebel(ctx)),
            ]),
            new BTSequence([
                new BTCondition(ctx => ctx.psyche.state === PsycheState.LOYAL),
                new BTAction(ctx => this.actionLoyal(ctx)),
            ]),
        ]);
    }

    private actionContemplateBetrayal(ctx: BehaviorContext): BehaviorStatus {
        ctx.psyche.moodLog.push({
            turn: ctx.turn,
            event: '배신 고민 중...',
            delta: -2,
        });
        return 'RUNNING';
    }

    private actionSeekResignation(ctx: BehaviorContext): BehaviorStatus {
        ctx.psyche.moodLog.push({
            turn: ctx.turn,
            event: '사직서 작성 중...',
            delta: -5,
        });
        return 'RUNNING';
    }

    private actionRebel(ctx: BehaviorContext): BehaviorStatus {
        ctx.psyche.moodLog.push({
            turn: ctx.turn,
            event: '반란 실행!',
            delta: -20,
        });
        return 'SUCCESS';
    }

    private actionLoyal(ctx: BehaviorContext): BehaviorStatus {
        if (ctx.psyche.stress > 50) {
            ctx.psyche.loyalty = Math.max(0, ctx.psyche.loyalty - 1);
        }
        return 'SUCCESS';
    }

    // ============================================================
    // 전체 평가 — 모든 무장의 월간 심리 갱신
    // ============================================================
    evaluateAllOfficers(turn: number): Map<OfficerID, OfficerPsychologyState> {
        this.refreshGraph();
        const results = new Map<OfficerID, OfficerPsychologyState>();
        const officers = this.store.getAllOfficers();
        for (const officer of officers) {
            const psyche = this.evaluateMonthlyPsychology(officer.id, turn);
            if (psyche) results.set(officer.id, psyche);
        }
        return results;
    }

    /**
     * 심리 상태 기반 AI 결정 생성 (턴 스케줄러와 연동)
     */
    generateDecisionFromPsychology(officer: Officer, psyche: OfficerPsychologyState): AIDecision {
        switch (psyche.state) {
            case PsycheState.VENGEFUL:
                return {
                    officerId: officer.id,
                    actionType: 'BATTLE' as CommandType,
                    priority: 0.95,
                    reasoning: `원수 ${psyche.vengeanceTargetId} 추적`,
                    payload: { targetId: psyche.vengeanceTargetId ?? '' },
                };
            case PsycheState.REBELLIOUS:
                return {
                    officerId: officer.id,
                    actionType: 'BATTLE' as CommandType,
                    priority: 0.9,
                    reasoning: '반란/배신 실행',
                    payload: { rebellion: true },
                };
            case PsycheState.SEEKING_RESIGNATION:
                return {
                    officerId: officer.id,
                    actionType: 'REST' as CommandType,
                    priority: 0.7,
                    reasoning: '사직 고민 중',
                    payload: { resignIntent: true },
                };
            case PsycheState.CONTEMPLATING_BETRAYAL:
                return {
                    officerId: officer.id,
                    actionType: 'DIPLOMACY' as CommandType,
                    priority: 0.6,
                    reasoning: '배신 모색 중',
                    payload: { betrayIntent: true },
                };
            case PsycheState.DISGRUNTLED:
                return {
                    officerId: officer.id,
                    actionType: 'REST' as CommandType,
                    priority: 0.4,
                    reasoning: '불만 상태 — 휴식',
                    payload: {},
                };
            case PsycheState.LOYAL:
            default:
                return {
                    officerId: officer.id,
                    actionType: 'DOMESTIC' as CommandType,
                    priority: 0.5,
                    reasoning: '충성 상태 — 내정 수행',
                    payload: {},
                };
        }
    }
}
