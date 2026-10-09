/**
 * 턴 실행 트레이스 — 1턴 동안 AI 가 수행한 전체 과정을 계층 구조로 기록한다.
 *
 * [목적]
 * executeTurn() 은 30개가 넘는 단계를 순차 실행하는데, 그게 콘솔에는 흩어진
 * console.log 로만 남고 어떤 단계가 왜 돌아갔는지·얼마나 걸렸는지는 안 보인다.
 * 이 모듈은 그 과정을 "번호가 붙은 트리" 로 만든다.
 *
 * [설계]
 * - 계층은 step() 호출의 중첩 깊이다. executeTurn 이 최상위 단계를 열고,
 *   그 안에서 세력별 AI 가 또 하위 단계를 연다.
 * - 번호는 깊이별 단조 증가한다(1, 1.1, 1.1.1 …). 순서가 바뀌지 않으므로
 *   두 번 실행한 트리를 눈으로 비교할 수 있다.
 * - 계측이 기본 경로를 바꾸지 않아야 한다. 비활성 상태에서 step() 은
 *   즉시 반환하는 no-op 핸들을 준다.
 *
 * [사용]
 *   const trace = new TurnTrace();
 *   trace.beginTurn(0, 190, 1);
 *   const s = trace.step('AI 턴 결정', 'ai');
 *   ...작업...
 *   s.end('결정 42건');
 *   trace.endTurn();
 *   console.log(trace.toText());
 */

export type TraceStatus = 'running' | 'ok' | 'error' | 'skipped';

export interface TraceNode {
    /** 화면에 그릴 번호 — "1", "1.2", "1.2.3" */
    readonly id: string;
    /** 단계 이름(한국어) */
    readonly label: string;
    /** 분류 — 색 구분용 */
    readonly category: string;
    readonly status: TraceStatus;
    /** 결과 요약 ("결정 42건", "12 → 14명") */
    readonly detail: string;
    /** 시작 시각 */
    readonly startedAt: number;
    /** 소요 시간(ms). 미완료면 null */
    readonly durationMs: number | null;
    readonly children: TraceNode[];
}

export interface TraceHandle {
    /** 결과를 기록하고 단계를 닫는다 */
    end(detail?: string, status?: TraceStatus): void;
    /** 예외를 기록하고 단계를 닫는다 */
    fail(detail: string): void;
    /** 열지 않고 결과만 나중에 채운다 */
    endLazy(fn: () => string | null): void;
}

const MAX_CHILDREN_PER_STEP = 200;

const INERT_HANDLE: TraceHandle = {
    end: () => { }, fail: () => { }, endLazy: () => { },
};

export class TurnTrace {
    private root: TraceNode;
    private stack: TraceNode[] = [];
    private counters: number[] = [];
    private turn = 0;
    private year = 0;
    private month = 0;
    private active = false;
    private startedAt = 0;
    /** 자식 수 상한을 넘은 단계 수 — 잘려나간 항목을 세기 위함 */
    private truncated = 0;

    constructor(private readonly now: () => number = () => Date.now()) {
        this.root = this.makeNode('0', '게임 시작', 'root', 'ok', '', 0, 0);
    }

    private makeNode(
        id: string, label: string, category: string,
        status: TraceStatus, detail: string, startedAt: number, durationMs: number | null,
    ): TraceNode {
        return { id, label, category, status, detail, startedAt, durationMs, children: [] };
    }

    /** 턴 트레이스를 시작한다. 이전 턴의 트리는 버려진다. */
    beginTurn(turn: number, year: number, month: number): void {
        this.turn = turn;
        this.year = year;
        this.month = month;
        this.truncated = 0;
        this.startedAt = this.now();
        this.root = this.makeNode(
            '0', `턴 ${turn + 1} · ${year}년 ${month}월`, 'root', 'ok', '', this.startedAt, 0,
        );
        this.stack = [this.root];
        this.counters = [0];
        this.active = true;
    }

    get isActive(): boolean { return this.active; }

    /**
     * 단계를 연다. 반환된 핸들로 결과를 기록하고 닫는다.
     *
     * 재진입(비동기 중 다른 단계가 끼어드는 경우)을 막기 위해 현재 열린
     * 단계를 기억하고, 엉뚱한 닫힘이 오면 그 단계에 붙인다.
     * 조용히 무시하면 트리가 조용히 틀어지므로 그때만 경고를 남긴다.
     */
    step(label: string, category = 'general'): TraceHandle {
        if (!this.active) return INERT_HANDLE;

        const parent = this.stack[this.stack.length - 1];
        const depth = this.stack.length;
        this.counters[depth - 1] += 1;
        this.counters[depth] = 0;
        const id = this.counters.slice(0, depth).join('.');

        const node = this.makeNode(id, label, category, 'running', '', this.now(), null);
        if (parent.children.length >= MAX_CHILDREN_PER_STEP) {
            // 한 단계에 자식이 수백 개 찍히면 트리가 읽을 수 없게 된다.
            // 초과는 세기만 하고 버린다 — 무장 단위로 펼치면 수만 줄이 된다.
            this.truncated += 1;
            return INERT_HANDLE;
        }
        parent.children.push(node);
        this.stack.push(node);
        return this.makeHandle(node);
    }

    private makeHandle(node: TraceNode): TraceHandle {
        let closed = false;
        const close = (detail: string, status: TraceStatus) => {
            if (closed) return;
            closed = true;
            const idx = this.stack.lastIndexOf(node);
            if (idx >= 0) this.stack.length = idx;
            (node as { status: TraceStatus }).status = status;
            (node as { detail: string }).detail = detail;
            (node as { durationMs: number | null }).durationMs =
                Math.max(0, this.now() - node.startedAt);
        };
        return {
            end: (detail = '', status: TraceStatus = 'ok') => close(detail, status),
            fail: (detail: string) => close(detail, 'error'),
            endLazy: (fn) => close(fn() ?? '', 'ok'),
        };
    }

    /** 현재 깊이에 하위 항목 하나만 덧붙인다(중첩 없이). */
    note(label: string, detail = '', category = 'general'): void {
        this.step(label, category).end(detail);
    }

    endTurn(): void {
        if (!this.active) return;
        const ms = Math.max(0, this.now() - this.startedAt);
        (this.root as { durationMs: number | null }).durationMs = ms;
        (this.root as { detail: string }).detail = this.truncated > 0
            ? `${(ms / 1000).toFixed(2)}초 · 잘린 항목 ${this.truncated}건`
            : `${(ms / 1000).toFixed(2)}초`;
        this.active = false;
        this.stack = [this.root];
    }

    getTurn(): number { return this.turn; }
    getTime(): { year: number; month: number } { return { year: this.year, month: this.month }; }
    getTree(): TraceNode { return this.root; }

    /** 번호가 붙은 트리를 들여쓰기 텍스트로 렌더링한다 — 콘솔·E2E용. */
    toText(maxDepth = 2): string {
        const lines: string[] = [];
        const walk = (node: TraceNode, depth: number) => {
            if (depth > maxDepth) return;
            const mark = node.status === 'error' ? ' ✗'
                : node.status === 'skipped' ? ' –'
                    : node.status === 'running' ? ' …' : '';
            const time = node.durationMs === null ? '' : ` (${node.durationMs}ms)`;
            const detail = node.detail ? ` — ${node.detail}` : '';
            lines.push(`${'  '.repeat(depth)}${node.id} ${node.label}${detail}${mark}${time}`);
            for (const child of node.children) walk(child, depth + 1);
        };
        walk(this.root, 0);
        return lines.join('\n');
    }
}
