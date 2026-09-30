import { describe, it, expect } from 'vitest';
import { GameStore } from '../src/core/game_store.js';
import { GameEngine } from '../src/core/game_engine.js';
import { buildWorld } from '../src/core/scenario_system.js';
import { TurnTrace } from '../src/core/turn_trace.js';
import { renderTraceTreeHtml } from '../src/ui/turn_trace_panel.js';
import scenarioIndex from '../src/data/scenarios/index.json';

function setup(): { engine: GameEngine; store: GameStore } {
    const store = new GameStore();
    const engine = new GameEngine(store);
    const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
    const world = buildWorld(scenario as never, 0);
    engine.initWorld(world.officers, world.factions, world.cities, []);
    store.setGlobalState({ playerFactionId: 'fac_0' });
    return { engine, store };
}

describe('TurnTrace — 번호가 붙은 계층 트리', () => {
    it('번호는 깊이별로 단조 증가한다 (1, 2, 3 … / 1.1, 1.2 …)', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 190, 1);
        t.step('A').end();
        t.step('B').end();
        t.step('C').end();
        t.endTurn();
        expect(t.getTree().children.map(k => k.id)).toEqual(['1', '2', '3']);
    });

    it('하위 단계는 점 표기로 부모 아래에 붙는다', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 190, 1);
        t.step('세력 AI').endLazy(() => {
            t.step('조조').endLazy(() => {
                t.step('잠양 징병 (+320)').end();
                t.step('잠양 출진').end();
            });
            t.step('유비').end();
            return '2개 세력';
        });
        t.endTurn();

        const faction = t.getTree().children[0];
        expect(faction.id).toBe('1');
        expect(faction.children.map(c => c.id)).toEqual(['1.1', '1.2']);
        expect(faction.children[0].children.map(c => c.id)).toEqual(['1.1.1', '1.1.2']);
    });

    it('형을 닫으면 다음 단계는 새 번호를 받는다 (번호가 옆으로만 자라지 않는다)', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 190, 1);
        t.step('첫').end();
        t.step('둘').end();
        t.endTurn();
        expect(t.getTree().children.map(c => c.id)).toEqual(['1', '2']);
    });

    it('같은 단계를 두 번 닫아도 결과가 뒤집히지 않는다', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 190, 1);
        const h = t.step('X');
        h.end('첫');
        h.end('두번째');
        t.step('Y').end();
        t.endTurn();
        expect(t.getTree().children[0].detail).toBe('첫');
    });

    it('비활성 상태에서는 no-op 이다 — 계측이 기본 경로를 바꾸지 않는다', () => {
        const t = new TurnTrace();
        t.step('무시될 단계').end('무시');
        t.endTurn();
        expect(t.getTree().children).toHaveLength(0);
    });

    it('자식이 상한을 넘으면 잘리고 그 사실이 보고된다', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 190, 1);
        t.step('많은 항목').endLazy(() => {
            for (let i = 0; i < 500; i++) t.note(`무장 ${i}`);
            return '';
        });
        t.endTurn();
        expect(t.getTree().children[0].children.length).toBeLessThanOrEqual(200);
        expect(t.getTree().detail).toContain('잘린 항목');
    });

    it('toText 는 번호·결과·소요 시간을 담아 들여쓰기 텍스트를 낸다', () => {
        let clock = 0;
        const t = new TurnTrace(() => clock);
        t.beginTurn(0, 190, 1);
        const h = t.step('AI 턴 결정');
        clock += 42;
        h.end('결정 7건');
        t.endTurn();
        const text = t.toText();
        expect(text).toContain('1 AI 턴 결정');
        expect(text).toContain('결정 7건');
        expect(text).toContain('42ms');
    });
});

describe('트레이스 HTML 렌더러', () => {
    it('번호·결과·시간이 HTML 에 들어간다', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 192, 1);
        t.step('AI 턴 결정').end('결정 18건');
        t.endTurn();
        const html = renderTraceTreeHtml(t.getTree(), 1);
        expect(html).toContain('1');
        expect(html).toContain('AI 턴 결정');
        expect(html).toContain('결정 18건');
        expect(html).toContain('trace-row');
    });

    it('깊이를 제한하면 하위 단계가 빠진다', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 192, 1);
        t.step('세력 AI').endLazy(() => {
            t.step('조조').endLazy(() => { t.step('잠양 징병').end(); return '1행동'; });
            return '1개 세력';
        });
        t.endTurn();
        // maxDepth 1 → 최상위만. 하위 '조조'는 없어야 한다.
        expect(renderTraceTreeHtml(t.getTree(), 1)).not.toContain('조조');
        // maxDepth 3 → 하위까지.
        expect(renderTraceTreeHtml(t.getTree(), 3)).toContain('잠양 징병');
    });

    it('무장 이름 등 사용자 문자열을 이스케이프한다', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 192, 1);
        t.step('공격').end('<script>alert(1)</script>');
        t.endTurn();
        const html = renderTraceTreeHtml(t.getTree(), 1);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('빈 트리는 안내 문구를 뱉는다', () => {
        const t = new TurnTrace();
        t.beginTurn(0, 192, 1);
        t.endTurn();
        expect(renderTraceTreeHtml(t.getTree(), 2)).toContain('표시할 단계가 없습니다');
    });
});

describe('executeTurn — 트레이스가 실제 턴 전체를 기록한다', () => {
    it('1턴을 돌리면 번호가 붙은 트리에 단계가 쌓인다', async () => {
        const { engine } = setup();
        await engine.executeTurn();
        const tree = engine.getTurnTrace().getTree();

        expect(tree.label).toContain('192년');
        expect(tree.children.length).toBeGreaterThan(10);

        // 번호가 위에서부터 1, 2, 3 … 으로 매겨져 있어야 한다.
        const ids = tree.children.map(c => c.id);
        expect(ids[0]).toBe('1');
        expect(ids).toEqual(ids.map((_, i) => String(i + 1)));
    });

    it('모든 단계가 완료 상태다 — 턴이 끝났는데 running 이 남으면 안 된다', async () => {
        const { engine } = setup();
        await engine.executeTurn();
        const walk = (n: { status: string; children: unknown[] }): void => {
            expect(n.status).not.toBe('running');
            for (const c of n.children as Array<{ status: string; children: unknown[] }>) walk(c);
        };
        walk(engine.getTurnTrace().getTree() as never);
    });

    it('핵심 단계가 이름으로 identifiable 하다', async () => {
        const { engine } = setup();
        await engine.executeTurn();
        const labels = engine.getTurnTrace().getTree().children.map(c => c.label);
        // 이 셋이 없으면 "AI 가 무엇을 했나" 를 볼 수 없다.
        expect(labels).toContain('AI 턴 결정');
        expect(labels).toContain('세력 AI 월간 행동');
        expect(labels).toContain('명령 일괄 실행');
    });

    it('세력 AI 하위에는 실제로 행동한 세력이 보인다', async () => {
        const { engine } = setup();
        await engine.executeTurn();
        const factionStep = engine.getTurnTrace().getTree().children
            .find(c => c.label === '세력 AI 월간 행동');
        expect(factionStep).toBeDefined();
        expect(factionStep!.children.length).toBeGreaterThan(0);
    });

    it('단계별 소요 시간이 기록된다', async () => {
        const { engine } = setup();
        await engine.executeTurn();
        const tree = engine.getTurnTrace().getTree();
        expect(tree.durationMs).toBeGreaterThanOrEqual(0);
        for (const c of tree.children) {
            expect(c.durationMs).not.toBeNull();
        }
    });

    it('다음 턴을 돌리면 지난 턴의 트리는 버려지고 새 턴이 된다', async () => {
        const { engine } = setup();
        await engine.executeTurn();
        const first = engine.getTurnTrace().getTree().label;
        await engine.executeTurn();
        const second = engine.getTurnTrace().getTree();
        expect(second.label).not.toBe(first);
        expect(second.label).toContain('192년 2월');
    });
});

