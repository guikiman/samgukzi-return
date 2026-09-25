/**
 * [1] 내정 자동 위임 스케줄러 — 일괄 파견 알고리즘
 * [9] 도시 개발 완료 시 자동 전환
 *
 * ── 아키텍처 ──
 * DomesticScheduler:
 *   Score(officer, task) = politics × 0.4 + charisma × 0.3 + loyalty × 0.2 + leadership × 0.1
 *   → 상위 N명을 빈 내정 슬롯에 자동 매핑
 *
 * ExecutionEngine:
 *   calculateTaskEffect():
 *     baseIncrement = ⌊(primaryStatSum / 12) × budgetModifier × synergyBonus⌋
 *     budgetModifier  = min(1.5, allocatedFunds / 100)
 *     synergyBonus    = 1.0 + (officerCount - 1) × 0.15
 *     successLevel    = roll > 0.9 → CRITICAL (×1.5)
 *                     = roll < 0.1 → FAILURE  (×0.6)
 *                     = else       → SUCCESS  (×1.0)
 *
 * AutoTransitionGuard:
 *   시장/농지 개발도 ≥ max → 자동으로 다른 분야로 전환
 *
 * ── 메모리 안전성 ──
 *   - executeAll() 호출 후 assignments 큐 즉시 clear()
 *   - 무장 행동력 20 차감, 부족 시 등록 단계에서 throw
 *   - 도시 보유 자금(funds) 검증 → 부족 시 throw
 *   - 최대 개발 도달 시 increment clamping
 */

import type {
    Officer, OfficerID, CityID, City, IGameStore,
    CityDevelopmentStats,
} from './types.js';

// ============================================================
// [0] 타입 정의
// ============================================================

/** 내정 분야 열거형 */
export enum DomesticTaskType {
    COMMERCE = 'COMMERCE',
    FARMING = 'FARMING',
    TECHNOLOGY = 'TECHNOLOGY',
    PUBLIC_ORDER = 'PUBLIC_ORDER',
    REPAIR = 'REPAIR',
}

/** 내정 임시 약칭 (autoAssign 호환) */
export type DomesticTask = 'agriculture' | 'commerce' | 'public_order' | 'training' | 'fortify';

/** 자동 추천 결과 */
export interface DomesticAssignment {
    readonly cityId: CityID;
    readonly officerId: OfficerID;
    readonly task: DomesticTask;
    readonly score: number;
}

/** 자동 전환 규칙 */
export interface AutoTransitionRule {
    readonly sourceTask: DomesticTask;
    readonly sourceThreshold: number;
    readonly targetTask: DomesticTask;
}

/** 다중 무장 임무 할당 */
export interface TaskAssignment {
    taskType: DomesticTaskType;
    officerIds: OfficerID[];
    allocatedFunds: number;
}

/** 내정 실행 결과 */
export interface ExecutionResult {
    taskType: DomesticTaskType;
    statChanged: string;
    increment: number;
    currentValue: number;
    fundsConsumed: number;
    successLevel: 'CRITICAL' | 'SUCCESS' | 'FAILURE';
    log: string;
}

// ============================================================
// [1] DomesticScheduler — 메인 클래스
// ============================================================

export class DomesticScheduler {
    private readonly store: IGameStore;
    private assignments: Map<string, TaskAssignment> = new Map();

    /** 최소 할당 비용 */
    private static readonly MIN_FUNDS = 50;
    /** 행동력 소모량 */
    private static readonly AP_COST = 20;
    /** 기본 성공 확률 문턱 */
    private static readonly CRITICAL_THRESHOLD = 0.9;
    private static readonly FAILURE_THRESHOLD = 0.1;

    constructor(store: IGameStore) {
        this.store = store;
    }

    // ============================================================
    // [1] 일괄 추천 파견
    // ============================================================

    /**
     * [1] 일괄 추천 파견: 정치/통솔 점수 기반 자동 매핑
     *
     * 점수 = politics × 0.4 + charisma × 0.3 + loyalty × 0.2 + leadership × 0.1
     * → 반환된 상위 N명을 빈 내정 슬롯에 자동 매핑
     */
    autoAssign(cityId: CityID, slots: DomesticTask[], excludeIds?: Set<OfficerID>): DomesticAssignment[] {
        const officers = this.store.getOfficersByCity(cityId)
            .filter(o => o.status === 'OFFICER' && !excludeIds?.has(o.id))
            .sort((a, b) => {
                const scoreA = this.calculateScore(a);
                const scoreB = this.calculateScore(b);
                return scoreB - scoreA;
            });

        return slots.map((task, i) => {
            const o = officers[i];
            if (!o) return null;
            return { cityId, officerId: o.id, task, score: this.calculateScore(o) };
        }).filter((a): a is DomesticAssignment => a !== null);
    }

    /** 무장의 내정 적성 점수 계산 */
    private calculateScore(o: Officer): number {
        return o.stats.politics * 0.4 + o.stats.charisma * 0.3 + o.loyalty * 0.2 + o.stats.leadership * 0.1;
    }

    get pendingCount(): number {
        return this.assignments.size;
    }

    // ============================================================
    // [1] 내정 임무 등록
    // ============================================================

    /**
     * 도시 내정 임무 등록 및 검증
     *
     * @throws 최소 비용 미달, 도시 자금 부족, 무장 행동력 부족
     */
    registerAssignment(cityId: CityID, assignment: TaskAssignment): void {
        const city = this.store.getCity(cityId);
        if (!city) throw new Error(`[Scheduler] 도시(ID: ${cityId})가 존재하지 않습니다.`);

        // 1. 최소 비용 검증
        if (assignment.allocatedFunds < DomesticScheduler.MIN_FUNDS) {
            throw new Error(
                `[Scheduler] 최소 할당 비용(${DomesticScheduler.MIN_FUNDS}금)이 부족합니다. (할당: ${assignment.allocatedFunds})`,
            );
        }

        // 2. 도시 자원 검증
        if (city.funds < assignment.allocatedFunds) {
            throw new Error(
                `[Scheduler] 도시(${city.name})의 보유 금(${city.funds})이 할당 비용(${assignment.allocatedFunds})보다 부족합니다.`,
            );
        }

        // 3. 무장 행동력 검증
        for (const id of assignment.officerIds) {
            const officer = this.store.getOfficer(id);
            if (!officer) {
                throw new Error(`[Scheduler] 무장(ID: ${id})이 존재하지 않습니다.`);
            }
            if (officer.actionPoints < DomesticScheduler.AP_COST) {
                throw new Error(
                    `[Scheduler] 무장(${officer.name})의 행동력(${officer.actionPoints})이 ${DomesticScheduler.AP_COST} 미만입니다.`,
                );
            }
        }

        // 도시 ID 자체에 underscore가 포함될 수 있으므로 task 구분자는 분리 unambiguous한 '::'를 사용한다. [49]
        this.assignments.set(`${cityId}::${assignment.taskType}`, assignment);
    }

    // ============================================================
    // [1] 내정 임무 일괄 실행
    // ============================================================

    /**
     * 등록된 모든 내정 임무 일괄 실행 및 결과 도출 (턴 엔드 시 호출)
     *
     * 각 임무는 calculateTaskEffect()를 통해:
     *   - 도시 자금 차감
     *   - 내정 능력치 상승
     *   - 무장 행동력 차감
     *   - 개발도 상한 도달 시 clamping
     *
     * @returns 실행 결과 배열 (빈 큐이면 [])
     */
    executeAll(): ExecutionResult[] {
        const results: ExecutionResult[] = [];

        for (const [key, assignment] of this.assignments.entries()) {
            const cityId = key.slice(0, key.indexOf('::'));
            const city = this.store.getCity(cityId);
            if (!city) continue;

            const officers = assignment.officerIds
                .map(id => this.store.getOfficer(id))
                .filter((o): o is Officer => o !== null);

            if (officers.length === 0) continue;

            // 실제 내정 연산 수행
            const result = this.calculateTaskEffect(city, assignment, officers);

            // 도시 자원 반영
            this.store.updateCity(city.id, { funds: city.funds - result.fundsConsumed });
            this.applyStatChange(city, result.taskType, result.increment);
            this.store.updateCity(city.id, { developmentStats: { ...city.developmentStats } });

            // 무장 행동력 차감
            for (const officer of officers) {
                this.store.updateOfficer(officer.id, {
                    actionPoints: officer.actionPoints - DomesticScheduler.AP_COST,
                });
            }

            results.push(result);
        }

        // 실행 후 큐 초기화
        this.assignments.clear();
        return results;
    }

    // ============================================================
    // [1] 정밀 내정 상승량 계산
    // ============================================================

    /**
     * 원작 삼국지 8 공식 기반 정밀 내정 상승량 계산기
     *
     * 공식:
     *   baseIncrement = ⌊(primaryStatSum / 12) × budgetModifier × synergyBonus⌋
     *   budgetModifier = min(1.5, allocatedFunds / 100)
     *   synergyBonus   = 1.0 + (officerCount - 1) × 0.15
     *   roll > 0.9  → CRITICAL (×1.5)
     *   roll < 0.1  → FAILURE  (×0.6)
     *   else        → SUCCESS  (×1.0)
     */
    private calculateTaskEffect(
        city: City,
        assignment: TaskAssignment,
        officers: Officer[],
    ): ExecutionResult {
        let primaryStatSum = 0;
        const synergyBonus = 1.0 + (officers.length - 1) * 0.15;

        // 분야별 주 능력치 합산
        for (const officer of officers) {
            switch (assignment.taskType) {
                case DomesticTaskType.COMMERCE:
                case DomesticTaskType.FARMING:
                    primaryStatSum += officer.stats.politics;
                    break;
                case DomesticTaskType.TECHNOLOGY:
                    primaryStatSum += officer.stats.intelligence;
                    break;
                case DomesticTaskType.PUBLIC_ORDER:
                    primaryStatSum += officer.stats.charisma;
                    break;
                case DomesticTaskType.REPAIR:
                    primaryStatSum += (officer.stats.politics + officer.stats.intelligence) / 2;
                    break;
            }
        }

        // 기본 상승량 공식
        const budgetModifier = Math.min(1.5, assignment.allocatedFunds / 100);
        let baseIncrement = Math.floor((primaryStatSum / 12) * budgetModifier * synergyBonus);

        // 난수 요소 (대성공 / 성공 / 실패)
        const roll = Math.random();
        let successLevel: 'CRITICAL' | 'SUCCESS' | 'FAILURE' = 'SUCCESS';

        if (roll > DomesticScheduler.CRITICAL_THRESHOLD) {
            baseIncrement = Math.floor(baseIncrement * 1.5);
            successLevel = 'CRITICAL';
        } else if (roll < DomesticScheduler.FAILURE_THRESHOLD) {
            baseIncrement = Math.floor(baseIncrement * 0.6);
            successLevel = 'FAILURE';
        }

        baseIncrement = Math.max(1, baseIncrement);

        // 개발 상한 도달 시 clamping
        const { targetStat, maxValue } = this.getTargetStatDetails(city, assignment.taskType);
        const actualIncrement = Math.min(baseIncrement, Math.max(0, maxValue - targetStat));

        const names = officers.map(o => o.name).join(', ');
        const logMessage =
            `[${city.name}] ${names} 무장이 ${assignment.taskType} 임무 수행. ` +
            `결과: ${successLevel} (상승량: +${actualIncrement})`;

        return {
            taskType: assignment.taskType,
            statChanged: assignment.taskType.toLowerCase(),
            increment: actualIncrement,
            currentValue: targetStat + actualIncrement,
            fundsConsumed: assignment.allocatedFunds,
            successLevel,
            log: logMessage,
        };
    }

    // ============================================================
    // [1] 개발 수치 조회 헬퍼
    // ============================================================

    /** 지정된 분야의 현재 수치와 최대 제한 수치를 반환 */
    private getTargetStatDetails(
        city: City,
        type: DomesticTaskType,
    ): { targetStat: number; maxValue: number } {
        const ds: CityDevelopmentStats = city.developmentStats;
        switch (type) {
            case DomesticTaskType.COMMERCE:
                return { targetStat: ds.commerce, maxValue: ds.maxCommerce };
            case DomesticTaskType.FARMING:
                return { targetStat: ds.farming, maxValue: ds.maxFarming };
            case DomesticTaskType.TECHNOLOGY:
                return { targetStat: ds.technology, maxValue: ds.maxTechnology };
            case DomesticTaskType.PUBLIC_ORDER:
                return { targetStat: ds.publicOrder, maxValue: ds.maxPublicOrder };
            case DomesticTaskType.REPAIR:
                return { targetStat: city.defense, maxValue: city.maxDefense };
        }
    }

    /** 실제 도시 객체에 계산된 상승 수치를 안전하게 반영 */
    private applyStatChange(city: City, type: DomesticTaskType, increment: number): void {
        const ds = city.developmentStats;
        switch (type) {
            case DomesticTaskType.COMMERCE:
                ds.commerce = Math.min(ds.maxCommerce, ds.commerce + increment);
                break;
            case DomesticTaskType.FARMING:
                ds.farming = Math.min(ds.maxFarming, ds.farming + increment);
                break;
            case DomesticTaskType.TECHNOLOGY:
                ds.technology = Math.min(ds.maxTechnology, ds.technology + increment);
                break;
            case DomesticTaskType.PUBLIC_ORDER:
                ds.publicOrder = Math.min(ds.maxPublicOrder, ds.publicOrder + increment);
                break;
            case DomesticTaskType.REPAIR:
                city.defense = Math.min(city.maxDefense, city.defense + increment);
                break;
        }
    }

    // ============================================================
    // [9] 도시 개발 완료 시 자동 전환
    // ============================================================

    /**
     * [9] 도시 개발 완료 시 자동 전환
     *
     * COMMERCE ≥ maxCommerce → PUBLIC_ORDER
     * FARMING  ≥ maxFarming  → TRAINING (fortify 역할)
     * TECHNOLOGY ≥ maxTechnology → REPAIR
     * PUBLIC_ORDER ≥ maxPublicOrder → COMMERCE
     */
    checkAutoTransition(cityId: CityID): AutoTransitionRule | null {
        const city = this.store.getCity(cityId);
        if (!city || !city.developmentStats) return null;

        const ds = city.developmentStats;

        if (ds.farming >= ds.maxFarming) {
            return { sourceTask: 'agriculture', sourceThreshold: ds.maxFarming, targetTask: 'fortify' };
        }
        if (ds.commerce >= ds.maxCommerce) {
            return { sourceTask: 'commerce', sourceThreshold: ds.maxCommerce, targetTask: 'public_order' };
        }
        if (ds.technology >= ds.maxTechnology) {
            return { sourceTask: 'training', sourceThreshold: ds.maxTechnology, targetTask: 'fortify' };
        }
        if (ds.publicOrder >= ds.maxPublicOrder) {
            return { sourceTask: 'public_order', sourceThreshold: ds.maxPublicOrder, targetTask: 'commerce' };
        }
        return null;
    }

    /**
     * 모든 도시의 자동 전환 규칙을 일괄 스캔
     *
     * @returns { cityId, rule }[] 전환이 필요한 도시 목록
     */
    scanAllAutoTransitions(): { cityId: CityID; rule: AutoTransitionRule }[] {
        const results: { cityId: CityID; rule: AutoTransitionRule }[] = [];
        for (const city of this.store.getAllCities()) {
            const rule = this.checkAutoTransition(city.id);
            if (rule) results.push({ cityId: city.id, rule });
        }
        return results;
    }

}
