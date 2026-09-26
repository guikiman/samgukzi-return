import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAW = JSON.parse(
    readFileSync(resolve(__dirname, '../src/data/scenarios/events/index.json'), 'utf-8'),
) as { chains: ChainShape[] };

interface ChainShape {
    scenarioId: string;
    chainId: string;
    chainName: string;
    nodes: Array<{
        eventId: string;
        eventName: string;
        priority: number;
        conditions: Array<Record<string, unknown>>;
        result: { eventType: string; dialogueLines: string[] };
    }>;
}

const ALL = RAW.chains.flatMap(c => c.nodes.map(n => ({ chain: c, node: n })));
const CONTAMINATED = /[A-Za-zЀ-ӿ぀-ヿ�□]/;

describe('연의전 체인 데이터 [300][106-114]', () => {
    it('체인이 비어 있지 않다', () => {
        expect(RAW.chains.length).toBeGreaterThan(0);
        expect(ALL.length).toBeGreaterThan(0);
    });

    it('eventId 와 chainId 가 전부 유일하다', () => {
        const evIds = ALL.map(x => x.node.eventId);
        expect(new Set(evIds).size).toBe(evIds.length);
        const chainIds = RAW.chains.map(c => c.chainId);
        expect(new Set(chainIds).size).toBe(chainIds.length);
    });

    it('대화에 라틴·키릴·가나·네모박자가 섞여 들어가지 않는다', () => {
        const bad: string[] = [];
        for (const { node } of ALL) {
            for (const line of node.result.dialogueLines) {
                if (CONTAMINATED.test(line)) bad.push(`${node.eventId}: ${line}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('대사는 화자를 밝히고, 서술은 화자 없이 끝맺는다', () => {
        // 기존 데이터는 발화("왕윤: ...")와 서술(발화자 없음)을 섞어 쓴다.
        // 둘 다 허용하되, 발화라면 화자 이름은 짧아야 하고 문장은 마침표로 끝나야 한다.
        for (const { node } of ALL) {
            for (const line of node.result.dialogueLines) {
                expect(line.trim(), node.eventId).not.toBe('');
                expect(line, node.eventId).toMatch(/[.!?。]$/);
                const m = line.match(/^([^:]{1,12}): /);
                if (m) {
                    expect(m[1], node.eventId).not.toBe('사자');
                    expect(m[1].length, node.eventId).toBeLessThanOrEqual(8);
                }
            }
        }
    });

    it('신규로 추가된 대사는 모두 화자를 밝힌다', () => {
        const NEW_IDS = new Set([
            'ev_02_lianhuan_wangyun', 'ev_02_dongzhuo_fall', 'ev_02_hair_oath',
            'ev_04_yidaizhao', 'ev_04_guojia_plan',
            'ev_05_zhugeliang', 'ev_05_chibi', 'ev_05_nanman_surrender',
            'ev_05_kongcheng', 'ev_05_yiling',
            'ev_07_gaopingling', 'ev_07_lebusishu',
        ]);
        for (const { node } of ALL) {
            if (!NEW_IDS.has(node.eventId)) continue;
            for (const line of node.result.dialogueLines) {
                expect(line, node.eventId).toMatch(/^[^:]{1,8}: .+/);
            }
        }
    });

    it('노드마다 대화가 최소 2줄 있다', () => {
        for (const { node } of ALL) {
            expect(node.result.dialogueLines.length, node.eventId).toBeGreaterThanOrEqual(2);
        }
    });

    it('조건 타입과 이벤트 타입은 엔진이 아는 값만 쓴다', () => {
        const COND = new Set(['year', 'faction', 'warlord_alive']);
        const EVT = new Set(['SCENE', 'BATTLE_SCENE']);
        for (const { node } of ALL) {
            expect(node.conditions.length, node.eventId).toBeGreaterThan(0);
            for (const c of node.conditions) {
                expect(COND.has(c.type as string), `${node.eventId}: ${c.type}`).toBe(true);
            }
            expect(EVT.has(node.result.eventType), node.eventId).toBe(true);
        }
    });

    it('연도 조건은 해당 시나리오 시작연도 이내에 걸려 있다', () => {
        const START: Record<string, number> = {
            '01': 184, '02': 190, '03': 194, '04': 200, '05': 207, '07': 220,
        };
        for (const { chain, node } of ALL) {
            const start = START[chain.scenarioId];
            if (start === undefined) continue;
            for (const c of node.conditions) {
                if (c.type !== 'year') continue;
                const min = c.minValue as number;
                const max = c.maxValue as number | null;
                // 발동 창이 시나리오 시작보다 앞설 수 없다
                expect(min, `${node.eventId} min`).toBeGreaterThanOrEqual(start);
                // max 는 생략되면 연말까지 열린 조건이므로 있을 때만 검증한다
                if (max === null || max === undefined) continue;
                expect(max, `${node.eventId} max`).toBeGreaterThanOrEqual(min);
            }
        }
    });

    it('우선순위가 정수다', () => {
        for (const { node } of ALL) {
            expect(Number.isInteger(node.priority), node.eventId).toBe(true);
        }
    });

    it('rewards 를 싣지 않는다 — 적용 경로가 없다', () => {
        // scanAndActivate 는 조건 평가와 큐 적재만 하고 국고·사기에 손대지 않는다.
        // 보상 데이터를 넣어 두면 아무 일도 일어나지 않으면서 구현된 것처럼 보인다.
        const withRewards = ALL.filter(x => 'rewards' in (x.node.result as object));
        expect(withRewards.map(x => x.node.eventId)).toEqual([]);
    });
});
