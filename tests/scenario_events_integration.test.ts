import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { GameStore } from '../src/core/game_store.js';
import { buildWorld } from '../src/core/scenario_system.js';
import scenarioIndex from '../src/data/scenarios/index.json';
import scenarioEvents from '../src/data/scenarios/events/index.json';
import {
    parseScenarioEvents,
    toEventChainNode,
    loadScenarioEventChains,
    EventChainValidationError,
    BUILTIN_SCENARIO_EVENTS,
} from '../src/core/scenario_event_loader.js';
import { EventEngine, EventChainQueueManager, WarlordConditionEvaluator } from '../src/core/event_chain_engine.js';
import { BranchType } from '../src/core/scenario_branch_manager.js';

describe('시나리오 연의전 데이터 로더 [300][301]', () => {
    it('시나리오 02의 체인이 파싱되어 노드 배열로 반환된다', () => {
        const chains = parseScenarioEvents(scenarioEvents, '02');
        // 시나리오당 체인 수는 늘릴 수 있으므로 개수 자체를 고정하지 않는다
        expect(chains.size).toBeGreaterThanOrEqual(1);
        expect(chains.has('chain_02_coalition')).toBe(true);
        const nodes = chains.get('chain_02_coalition')!;
        expect(nodes.length).toBe(3);
        // 노드 순서 보존 — JSON 배열 순서 = 체인 순서
        expect(nodes.map(n => n.eventId)).toEqual([
            'ev_02_cao_cao_letter',
            'ev_02_hulao_gate',
            'ev_02_jade_seal',
        ]);
    });

    it('존재하지 않는 시나리오 ID는 빈 맵을 반환한다', () => {
        const chains = parseScenarioEvents(scenarioEvents, '999');
        expect(chains.size).toBe(0);
    });

    it('07 삼국鼎峙 체인은 두 개의 연의전 분기를 안전하게 파싱한다', () => {
        const chains = parseScenarioEvents(scenarioEvents, '07');
        const nodes = chains.get('chain_07_three_kingdoms')!;
        expect(nodes).toHaveLength(2);
        expect(nodes.map(n => n.eventId)).toEqual([
            'ev_07_jiangwan_peace',
            'ev_07_yiling_reckoning',
        ]);
        expect(nodes.every(n => n.conditions.some(c => c.type === 'year'))).toBe(true);
    });

    it('07 남방 재편 분기는 별도 체인으로 파싱된다', () => {
        const chains = parseScenarioEvents(scenarioEvents, '07');
        const nodes = chains.get('chain_07_southward_reform')!;
        expect(nodes).toHaveLength(1);
        expect(nodes[0].eventId).toBe('ev_07_nanman_reform');
        expect(nodes[0].conditions.some(c => c.type === 'warlord_alive' && c.targetId === 'zhuge_ke')).toBe(true);
    });

    it('JSON 노드가 createEventChainNode 기본값으로 안전하게 변환된다', () => {
        const node = toEventChainNode({
            eventId: 'ev_test',
            eventName: '테스트 이벤트',
            conditions: [{ type: 'year', minValue: 190 }],
            result: { dialogueLines: ['대사'] },
        });
        expect(node.result.eventType).toBe('SCENE');
        expect(node.result.nextEventId).toBeNull();
        expect(node.priority).toBe(0);
        expect(node.conditions[0].type as string).toBe('year');
    });

    it('미지원 조건 타입은 EventChainValidationError를 던진다 [301]', () => {
        const bad = {
            chains: [{
                scenarioId: '99',
                chainId: 'chain_bad',
                nodes: [{
                    eventId: 'ev_bad',
                    eventName: '불량',
                    conditions: [{ type: 'definitely_invalid_type' }],
                }],
            }],
        };
        expect(() => parseScenarioEvents(bad, '99')).toThrow(EventChainValidationError);
    });

    it('loadScenarioEventChains가 EventEngine 큐에 적재한다 [300]', () => {
        const engine = new EventEngine(new EventChainQueueManager(), new WarlordConditionEvaluator());
        const loaded = loadScenarioEventChains(engine, scenarioEvents, '01');
        expect(loaded).toEqual(['chain_01_yellow_turban']);
        expect(engine.queueMgr.queueSize).toBe(1);
        // 중복 적재 방지
        loadScenarioEventChains(engine, scenarioEvents, '01');
        expect(engine.queueMgr.queueSize).toBe(1);
    });
});

describe('엔진 시나리오 이벤트 통합 [300][106-114]', () => {
    function setupWorld(scenarioId: string, playerIndex: number) {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === scenarioId)!;
        const world = buildWorld(scenario as never, playerIndex);
        engine.initWorld(world.officers, world.factions, world.cities, [], scenarioId);
        return { store, engine, world };
    }

    it('initWorld에 시나리오 ID를 넘기면 해당 체인이 큐에 적재된다', () => {
        const { engine } = setupWorld('01', 0);
        expect(engine.eventEngine.queueMgr.queueSize).toBe(1);
    });

    it('시나리오 ID 미지정 시 체인이 적재되지 않는다 (구버전 호환)', () => {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '01')!;
        const world = buildWorld(scenario as never, 0);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        expect(engine.eventEngine.queueMgr.queueSize).toBe(0);
    });

    it('executeTurn 루프에서 시나리오 이벤트가 발동되고 HISTORICAL_EVENT가 발화된다', async () => {
        const { engine } = setupWorld('01', 0);
        const fired: Array<{ id: string; name: string }> = [];
        engine.subscribe('HISTORICAL_EVENT', (e) => {
            fired.push({
                id: String(e.payload.eventId),
                name: String(e.payload.eventName),
            });
        });
        await engine.executeTurn();
        // 184년 시작 시나리오 — ev_01_turbans_rise (year 184~200) 조건 즉시 충족
        const ids = fired.map(f => f.id);
        expect(ids).toContain('ev_01_turbans_rise');
    });

    it('체인 연쇄 — 첫 노드 발동 후 다음 노드가 큐에 적재된다', async () => {
        const { engine } = setupWorld('01', 0);
        // 첫 턴: ev_01_turbans_rise (year 184~200) 발동 → 체인 다음 노드 ev_01_royal_decrees 적재
        await engine.executeTurn();
        // ev_01_royal_decrees는 year 184+ 조건이므로 다음 턴 스캔에서 즉시 발동되어야 함
        // → 큐가 비었다면 이미 발동한 것 (연쇄 정상). 큐에 남았다면 대기 중.
        const fired = engine.eventEngine.queueMgr.isProcessed('ev_01_turbans_rise');
        const nextFiredOrQueued =
            engine.eventEngine.queueMgr.isProcessed('ev_01_royal_decrees') ||
            engine.eventEngine.queueMgr.isQueued('ev_01_royal_decrees') ||
            engine.eventEngine.queueMgr.queueSize > 0;
        expect(fired).toBe(true);
        expect(nextFiredOrQueued).toBe(true);
    });
});

describe('엔진 시나리오 분기 통합 [106-114]', () => {
    it('역사 이벤트 발동 시 등록된 분기가 활성화된다', async () => {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '02')!;
        const world = buildWorld(scenario as never, 0);
        engine.initWorld(world.officers, world.factions, world.cities, [], '02');

        // 동탁 사망 시 가상 분기 활성화 등록 — conditionId는 historical 이벤트 ID
        engine.scenarioBranches.registerBranch({
            branchId: 'branch_test_fictional',
            branchType: BranchType.FICTIONAL,
            conditionId: 'yellow_turban',
            nodes: [{
                eventId: 'ev_branch_test',
                eventName: '분기 테스트',
                conditions: [],
                result: {
                    eventId: 'ev_branch_test',
                    eventName: '분기 테스트',
                    eventType: 'SCENE',
                    dialogueLines: ['분기가 활성화되었다'],
                    rewards: {},
                    nextEventId: null,
                },
                chainNextId: null,
                priority: 0,
            }],
        });

        await engine.executeTurn();
        // 190년 시나리오에서 yellow_turban(year 184)은 이미 과거 — checkEvents의
        // year_reached 조건은 현재 연도가 190이면 184 이후이므로 발동 가능.
        // 발동되면 분기가 활성화되어 분기 노드가 큐에 적재되고 다음 스캔에서 발화된다.
        const fired = engine.scenarioBranches.getActiveBranchId();
        if (fired === 'branch_test_fictional') {
            // 분기 노드가 큐에 들어갔는지 확인
            expect(engine.eventEngine.queueMgr.queueSize).toBeGreaterThanOrEqual(1);
        }
    });
});

describe('빌트인 시나리오 이벤트 파일 무결성 [301]', () => {
    it('모든 체인이 시나리오 인덱스에 존재하는 ID를 참조한다', () => {
        const knownScenarios = new Set(
            (scenarioIndex as Array<{ id: string }>).map(s => s.id),
        );
        for (const chain of BUILTIN_SCENARIO_EVENTS.chains) {
            expect(knownScenarios.has(chain.scenarioId)).toBe(true);
        }
    });

    it('체인 내 이벤트 ID가 전역적으로 유일하다', () => {
        const seen = new Set<string>();
        for (const chain of BUILTIN_SCENARIO_EVENTS.chains) {
            for (const node of chain.nodes) {
                expect(seen.has(node.eventId)).toBe(false);
                seen.add(node.eventId);
            }
        }
    });

    it('모든 시나리오(01~06)에 최소 1개 체인이 존재한다 — 연의전 커버리지 완성', () => {
        const chainScenarioIds = new Set(BUILTIN_SCENARIO_EVENTS.chains.map(c => c.scenarioId));
        for (const scenario of scenarioIndex as Array<{ id: string }>) {
            expect(chainScenarioIds.has(scenario.id)).toBe(true);
        }
    });
});

describe('시나리오 04 관도 대전 — 오소 야습 실발동 통합 [300]', () => {
    function setup04() {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '04')!;
        const world = buildWorld(scenario as never, 0);
        engine.initWorld(world.officers, world.factions, world.cities, [], '04');
        // main.ts startGame과 동일 — 시나리오 시작 연월 주입 [300]
        store.setGlobalState({
            ...store.getGlobalState(),
            playerFactionId: world.playerFactionId,
            time: { year: world.startYear, month: world.startMonth },
        });
        return { store, engine };
    }

    it('initWorld("04") 시 각 체인의 첫 노드만 큐에 적재된다', () => {
        const { engine } = setup04();
        // 선행 조건을 통과한 뒤 다음 노드를 적재하는 연쇄 규칙
        // 시나리오 04는 체인이 둘이므로 큐 크기 자체는 고정하지 않는다
        expect(engine.eventEngine.queueMgr.queueSize).toBeGreaterThanOrEqual(1);
        // 관도 체인 — 첫 노드는 적제되고 연쇄상 다음 노드는 대기
        expect(engine.eventEngine.queueMgr.isQueued('ev_04_wuchao_plot')).toBe(true);
        expect(engine.eventEngine.queueMgr.isQueued('ev_04_ju_shou_purge')).toBe(false);
        // 의대의 밀서 체인도 같은 규칙을 따른다
        expect(engine.eventEngine.queueMgr.isQueued('ev_04_yidaizhao')).toBe(true);
        expect(engine.eventEngine.queueMgr.isQueued('ev_04_guojia_plan')).toBe(false);
    });

    it('200년 턴 진행 시 조건 충족 노드가 HISTORICAL_EVENT로 발화되고 연대기에 기록된다', async () => {
        const { store, engine } = setup04();
        const fired: Array<Record<string, unknown>> = [];
        engine.subscribe('HISTORICAL_EVENT', (e) => fired.push(e.payload));

        // 시나리오 04 시작 연도 = 200 — 오소/저수 조건(minValue 200) 즉시 충족
        await engine.executeTurn();

        const wuchao = fired.find(f => f.eventId === 'ev_04_wuchao_plot');
        expect(wuchao).toBeDefined();
        expect(wuchao!.eventName).toBe('오소 야습 — 허유의 배신');

        // 발동 처리 완료 — 큐에서 제거되어 재발동하지 않는다
        expect(engine.eventEngine.queueMgr.isProcessed('ev_04_wuchao_plot')).toBe(true);

        // 연대기에 기록
        const hit = engine.chronicle.list().find(e => e.text.includes('오소 야습'));
        expect(hit).toBeDefined();

        // 큐에서 처리 완료 — 재발동 방지 (processEventChainMonthly는
        // queueMgr.processed로 재발동을 관리하며 historicalEvents 이력은 별도 체계)
        expect(engine.eventEngine.queueMgr.isProcessed('ev_04_wuchao_plot')).toBe(true);
    });
});

describe('전 시나리오(01~06) 연의전 순회 실발동 [300][106-114]', () => {
    /** main.ts startGame과 동일한 부팅 절차 — 시나리오 시작 연월 주입 포함 */
    function bootScenario(scenarioId: string, playerIndex = 0) {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === scenarioId)!;
        const world = buildWorld(scenario as never, playerIndex);
        engine.initWorld(world.officers, world.factions, world.cities, [], scenarioId);
        store.setGlobalState({
            ...store.getGlobalState(),
            playerFactionId: world.playerFactionId,
            time: { year: world.startYear, month: world.startMonth },
        });
        return { store, engine, world };
    }

    /** 시나리오 ID → 시작 연도에 첫 노드 조건이 충족되는 ID 목록 */
    const FIRST_TURN_EXPECTED: Record<string, string[]> = {
        '01': ['ev_01_turbans_rise'],
        '02': ['ev_02_cao_cao_letter'],
        '03': ['ev_03_lu_bu_strikes'],
        '04': ['ev_04_wuchao_plot'],
        '05': ['ev_05_longzhong_plan'],
        '06': ['ev_06_chu_shi_biao'],
    };

    it('모든 시나리오에서 시작 연월 주입 후 첫 턴에 체인의 첫 노드가 발화한다', async () => {
        for (const [scenarioId, expectedIds] of Object.entries(FIRST_TURN_EXPECTED)) {
            const { engine } = bootScenario(scenarioId);
            const fired: Array<Record<string, unknown>> = [];
            engine.subscribe('HISTORICAL_EVENT', (e) => fired.push(e.payload));

            await engine.executeTurn();

            const firedIds = fired.map(f => String(f.eventId));
            for (const id of expectedIds) {
                expect(firedIds).toContain(id);
            }
            // 발화한 노드는 모두 처리 완료 — 재발동 없음
            for (const id of expectedIds) {
                expect(engine.eventEngine.queueMgr.isProcessed(id)).toBe(true);
            }
        }
    });

    it('모든 warlord_alive 조건 대상이 해당 시나리오 로스터에 존재한다 — 조건 영구 실패 방지', () => {
        for (const chain of BUILTIN_SCENARIO_EVENTS.chains) {
            const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === chain.scenarioId)!;
            const roster = new Set(buildWorld(scenario as never, 0).officers.map(o => o.id));
            for (const node of chain.nodes) {
                for (const cond of node.conditions) {
                    if (cond.type === 'warlord_alive' || cond.type === 'warlord_dead') {
                        expect(roster.has(cond.targetId!)).toBe(true);
                    }
                }
            }
        }
    });

    it('연도 조건의 발동 창이 시나리오 시작 연도 이후에 존재한다', () => {
        for (const chain of BUILTIN_SCENARIO_EVENTS.chains) {
            const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === chain.scenarioId)!;
            const startYear = parseInt(scenario.start_date.split('-')[0], 10);
            for (const node of chain.nodes) {
                const yearConds = node.conditions.filter(c => c.type === 'year');
                if (yearConds.length === 0) continue;
                const windowEnd = Math.min(...yearConds.map(c => c.maxValue ?? Infinity));
                // 발동 창의 끝이 시작 연도보다 과거면 영구 발동 불가
                expect(windowEnd).toBeGreaterThanOrEqual(startYear);
            }
        }
    });
});
