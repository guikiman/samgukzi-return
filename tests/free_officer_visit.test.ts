import { describe, it, expect, vi } from 'vitest';
import { GameStore } from '../src/core/game_store.js';
import { GameEngine } from '../src/core/game_engine.js';
import { buildWorld } from '../src/core/scenario_system.js';
import {
    processMonthlyFreeOfficerVisits,
    acceptVisit,
    declineVisit,
    BASE_VISIT_CHANCE,
} from '../src/core/free_officer_visit_system.js';
import { OfficerStatus } from '../src/core/types.js';
import scenarioIndex from '../src/data/scenarios/index.json';

describe('재야 무장 방문 시스템 [24][421-440]', () => {
    function setupWorld(playerFactionIndex: number) {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as any[]).find(s => s.id === '05')!;
        const world = buildWorld(scenario, playerFactionIndex);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        store.setGlobalState({ playerFactionId: `fac_${playerFactionIndex}` });
        return { store, engine };
    }

    it('결정적 난수(0) 주입 시 신야 재야 무장이 방문 판정에 올라온다', () => {
        const { store } = setupWorld(0); // 조조 — 신야는 AI 세력 유비 소유
        const visits = processMonthlyFreeOfficerVisits(store, () => 0);
        // 황충·방통·위연 모두 100% 방문 확률로 타진
        const names = visits.map(v => v.officerName);
        expect(names).toContain('황충');
        expect(names).toContain('방통');
        expect(names).toContain('위연');
        for (const v of visits) {
            expect(v.cityName).toBe('신야');
            expect(v.factionName).toBe('유비');
        }
    });

    it('난수 0.999 주입 시 방문이 발생하지 않는다 (확률 상한 미달)', () => {
        const { store } = setupWorld(0);
        const visits = processMonthlyFreeOfficerVisits(store, () => 0.999);
        // 최대 방문 확률 = 0.3 × 1.0(야망) × 1.5(명성) = 0.45 < 0.999
        expect(visits).toHaveLength(0);
    });

    it('AI 세력은 자동 판정 — 난수 0이면 전원 수락으로 입사한다', () => {
        const { store } = setupWorld(0);
        const visits = processMonthlyFreeOfficerVisits(store, () => 0);
        for (const v of visits) {
            expect(v.needsPlayerChoice).toBe(false);
            expect(v.joined).toBe(true);
            const officer = store.getOfficer(v.officerId)!;
            expect(officer.factionId).toBe('fac_2'); // 신야 소유 세력
            expect(officer.status).toBe(OfficerStatus.OFFICER);
        }
    });

    it('AI 세력 자동 판정 — 수락 roll 실패 시 재야로 유지된다', () => {
        const { store } = setupWorld(0);
        // 첫 호출(방문 확률)은 0으로 통과, 두 번째 호출(수락 판정)은 0.99로 실패
        let call = 0;
        const visits = processMonthlyFreeOfficerVisits(store, () => (call++ % 2 === 0 ? 0 : 0.99));
        expect(visits.length).toBeGreaterThan(0);
        for (const v of visits) {
            expect(v.joined).toBe(false);
            const officer = store.getOfficer(v.officerId)!;
            expect(officer.status).toBe(OfficerStatus.FREE);
        }
    });

    it('플레이어 세력 도시 방문은 선택지 대기 상태로 반환된다', () => {
        const { store } = setupWorld(2); // 유비 — 신야가 플레이어 도시
        const visits = processMonthlyFreeOfficerVisits(store, () => 0);
        expect(visits.length).toBeGreaterThan(0);
        for (const v of visits) {
            expect(v.needsPlayerChoice).toBe(true);
            expect(v.joined).toBe(false);
            // 스토어에는 아직 반영되지 않음
            expect(store.getOfficer(v.officerId)!.status).toBe(OfficerStatus.FREE);
        }
    });

    it('acceptVisit — 맞이하면 입사 + 충성도 초기화(군주 명성 비례)', () => {
        const { store } = setupWorld(2);
        const visits = processMonthlyFreeOfficerVisits(store, () => 0);
        const visit = visits[0];
        acceptVisit(store, visit);

        const officer = store.getOfficer(visit.officerId)!;
        expect(officer.factionId).toBe('fac_2');
        expect(officer.status).toBe(OfficerStatus.OFFICER);
        expect(officer.loyalty).toBeGreaterThanOrEqual(60);
        expect(officer.loyalty).toBeLessThanOrEqual(100);
        // 세력/도시 목록 동기화
        expect(store.getFaction('fac_2')!.officers).toContain(visit.officerId);
        expect(store.getCity(visit.cityId)!.officerIds).toContain(visit.officerId);
    });

    it('declineVisit — 사절하면 재야 유지', () => {
        const { store } = setupWorld(2);
        const visits = processMonthlyFreeOfficerVisits(store, () => 0);
        const visit = visits[0];
        declineVisit(visit);
        expect(visit.joined).toBe(false);
        expect(store.getOfficer(visit.officerId)!.status).toBe(OfficerStatus.FREE);
    });

    it('방문 확률 상수는 명세 범위 내다', () => {
        expect(BASE_VISIT_CHANCE).toBe(0.3);
    });

    // ─────────────────────────────────────────────────────────────
    // [회귀] FREE_OFFICER_VISIT 이벤트 payload 무결성
    //
    // 배경: 엔진이 payload 에 일부 필드만 실어 보내면 UI 의 openVisitModal 이
    // visit.stats.leadership 에서 TypeError 를 던진다. 그 예외는 executeTurn 의
    // 이벤트 큐 안에서 동기 전파되므로 그 달 전체 처리가 중단되어
    // 「턴 진행 실패」 로그와 함께 게임이 멈춘 것처럼 보인다.
    // payload 는 UI 가 FreeOfficerVisit 전체로 캐스팅해 쓰므로 빠짐없이 실려야 한다.
    // ─────────────────────────────────────────────────────────────
    it('[회귀] FREE_OFFICER_VISIT payload 에 UI 가 읽는 필드가 모두 실린다', async () => {
        // 엔진이 Math.random 을 직접 쓰므로 방문 발생을 확정시켜야 결정적이다.
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const { engine } = setupWorld(2); // 유비(플레이어) — 신야 재야 무장이 방문해 선택 모달이 열린다
            const payloads: Array<Record<string, unknown>> = [];
            engine.subscribe('FREE_OFFICER_VISIT', (e: any) => { payloads.push(e.payload); });

            await engine.executeTurn();

            expect(payloads.length).toBeGreaterThan(0);
            for (const p of payloads) {
                // openVisitModal 이 합산/막대 렌더에 쓰는 능력치 5종
                expect(p.stats).toBeDefined();
                const stats = p.stats as Record<string, number>;
                for (const key of ['leadership', 'might', 'intelligence', 'politics', 'charisma']) {
                    expect(typeof stats[key]).toBe('number');
                }
                // 카드 문구용 메타
                expect(typeof p.ambition).toBe('number');
                expect(typeof p.fame).toBe('number');
                expect(typeof p.personalityLabel).toBe('string');
                // acceptVisit 이 군주 조회에 쓰는 식별자
                expect(p.factionId === null || typeof p.factionId === 'string').toBe(true);
                expect(typeof p.cityId).toBe('string');
            }
        } finally {
            randomSpy.mockRestore();
        }
    });

    it('[회귀] 플레이어 세력 방문으로 executeTurn 이 예외 없이 끝난다', async () => {
        // 엔진이 Math.random 을 직접 쓰므로 방문 발생을 확정시켜야 결정적이다.
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const { engine } = setupWorld(2);
            // payload 를 그대로 소비하는 UI 와 같은 형태 — 여기서 터지면 안 된다.
            let consumed = 0;
            engine.subscribe('FREE_OFFICER_VISIT', (e: any) => {
                const visit = e.payload;
                const sum = visit.stats.leadership + visit.stats.might + visit.stats.intelligence
                    + visit.stats.politics + visit.stats.charisma;
                expect(sum).toBeGreaterThan(0);
                consumed++;
            });

            await expect(engine.executeTurn()).resolves.toBeUndefined();
            expect(consumed).toBeGreaterThan(0);
        } finally {
            randomSpy.mockRestore();
        }
    });
});
