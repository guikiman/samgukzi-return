/**
 * 삼국지 8 리메이크 — AI 스트리밍 매니저 (메인 스레드 사이드)
 * 파일: src/ai/ai_stream_manager.ts
 *
 * Web Worker를 스폰하고 AI 턴을 위임하며, 세력 단위 연산 결과를
 * 실시간 스트리밍으로 수신해 UI/관계망에 즉시 반영한다.
 *
 * [201] Web Worker 비동기 AI 연산
 * [202] 메인 스레드 블로킹 방지
 *
 * 스냅샷 압축: 대용량 전체 상태를 넘기지 않고 AI 연산에 필요한
 * 최소 데이터셋(Officer/City/Faction Snapshot)만 직렬화하여 전달.
 */
export class AIStreamManager {
    constructor(callbacks) {
        this.worker = null;
        this.isTurnRunning = false;
        this.pendingResolve = null;
        this.callbacks = callbacks;
    }
    // ============================================================
    // 워커 라이프사이클
    // ============================================================
    /** 워커를 지연 스폰한다 (첫 AI 턴 호출 시점에 생성) */
    ensureWorker() {
        if (this.worker)
            return this.worker;
        // TS 빌드 산출물(dist) 기준 URL 스폰 — game_engine.ts와 동일 패턴
        this.worker = new Worker(new URL('./ai_stream_worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event) => this.handleMessage(event.data);
        this.worker.onerror = (event) => {
            // 스크립트 로드 실패 등 치명 오류 — 대기 중인 턴 프로미스를 해제해 교착 방지
            this.isTurnRunning = false;
            this.pendingResolve?.();
            this.pendingResolve = null;
            this.callbacks.onError?.(event.message ?? 'AI worker unknown error');
        };
        return this.worker;
    }
    handleMessage(message) {
        switch (message.type) {
            case 'STREAM_FACTION_DECISION':
                // 실시간 스트리밍 데이터 수신: UI 및 관계망 DB 즉시 업데이트
                this.callbacks.onFactionUpdate(message.data);
                break;
            case 'AI_TURN_COMPLETE':
                this.isTurnRunning = false;
                this.pendingResolve?.();
                this.pendingResolve = null;
                this.callbacks.onTurnComplete?.(message.data);
                break;
            case 'ERROR':
                this.isTurnRunning = false;
                this.pendingResolve?.();
                this.pendingResolve = null;
                this.callbacks.onError?.(message.data);
                break;
        }
    }
    // ============================================================
    // 스냅샷 변환 — 최소 데이터셋 직렬화
    // ============================================================
    /**
     * 게임 상태에서 AI 연산에 필요한 최소 데이터셋만 추출한다.
     * 도시 병량은 월 식량 수입 × 10으로 추정하고, 주둔 병력은 방어도로 프록시한다.
     */
    static buildSnapshot(source, playerFactionId) {
        const gs = source.getGlobalState();
        const cities = {};
        for (const c of source.getAllCities()) {
            cities[c.id] = {
                id: c.id,
                name: c.name,
                ownerId: c.ownerId,
                defense: Math.max(0, Math.min(100, c.defense)),
                population: c.population,
                funds: c.funds,
                foodStores: c.foodIncome * 10,
                development: Math.max(0, Math.min(100, c.development)),
                maxTroops: Math.floor(c.population / 100),
            };
        }
        const factions = {};
        for (const f of source.getAllFactions()) {
            // 군주 성향 유도: 정책 가중치 중 최대 축으로 판정
            const p = f.policy;
            const temperament = p.militaryFocus >= Math.max(p.economyFocus, p.diplomacyFocus) ? 'HEGEMON'
                : p.diplomacyFocus >= p.economyFocus ? 'RIGHTEOUS'
                    : 'KINGLY';
            const atWarWith = [];
            const alliedWith = [];
            for (const [targetId, diplo] of Object.entries(f.diplomacy)) {
                if (diplo.treaty === 'WAR')
                    atWarWith.push(targetId);
                else if (diplo.treaty === 'ALLIANCE')
                    alliedWith.push(targetId);
            }
            factions[f.id] = {
                id: f.id,
                name: f.name,
                leaderId: f.leaderId,
                temperament,
                gold: f.gold,
                food: f.food,
                cityCount: f.cities.length,
                atWarWith,
                alliedWith,
            };
        }
        const officers = source.getAllOfficers().map(o => ({
            id: o.id,
            name: o.name,
            factionId: o.factionId,
            cityId: o.cityId,
            ambition: o.ambition,
            loyalty: o.loyalty,
            morality: o.morality,
            infamy: o.infamy,
            stats: { ...o.stats },
            isPlayer: playerFactionId !== null && o.factionId === playerFactionId,
        }));
        return { year: gs.year, month: gs.month, turn: gs.turnCount, factions, officers, cities };
    }
    // ============================================================
    // AI 턴 실행
    // ============================================================
    /** 매달 평정 페이즈 시작 시 호출 — AI 턴을 워커에 위임 */
    startMonthlyTurn(payload) {
        if (this.isTurnRunning) {
            return Promise.reject(new Error('AI turn already running'));
        }
        this.isTurnRunning = true;
        const worker = this.ensureWorker();
        return new Promise((resolve) => {
            this.pendingResolve = resolve;
            worker.postMessage({ type: 'START_AI_TURN', payload });
        });
    }
    /** AI 턴 진행 여부 */
    isBusy() {
        return this.isTurnRunning;
    }
    /** 워커를 종료하고 대기 중인 턴을 안전하게 해제한다. */
    terminate() {
        this.worker?.terminate();
        this.worker = null;
        this.isTurnRunning = false;
        this.pendingResolve?.();
        this.pendingResolve = null;
    }
}
//# sourceMappingURL=ai_stream_manager.js.map