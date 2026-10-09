/**
 * 턴 실행 트레이스 패널 렌더러 [디버그]
 *
 * TurnTrace(순수 데이터)를 번호가 붙은 HTML 트리로 바꾼다.
 * main.ts 는 이 함수만 호출하고 트리 구조를 알지 않는다 —
 * 계측(데이터)과 표시(UI)를 분리해 둘 수 있어야 어느 쪽을 독립적으로
 * 고칠 수 있다.
 */
import type { TraceNode } from '../core/turn_trace.js';

/** HTML 이스케이프 — 무장 이름·사건 메시지가 그대로 들어온다 */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 밀리초를 사람이 읽기 좋게 — 0ms 는 의미 없는 잡음이므로 접힌다 */
function fmtTime(ms: number | null): string {
    if (ms === null) return '';
    if (ms < 1) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function renderNode(node: TraceNode, depth: number, maxDepth: number): string {
    if (depth > maxDepth) return '';
    // 깊이별로 들여쓰기 — 번호(1.2.3)가 이미 계층을 말하지만, 시각적으로도
    // 어긋나야 어느 줄이 어디에 속하는지 한눈에 들어온다.
    const indent = '　'.repeat(depth);
    const time = fmtTime(node.durationMs);
    const mark = node.status === 'error' ? ' ✗' : node.status === 'running' ? ' …' : '';
    const children = node.children
        .map(child => renderNode(child, depth + 1, maxDepth))
        .join('');
    return `<div class="trace-row" data-cat="${esc(node.category)}" data-status="${esc(node.status)}"`
        + ` role="treeitem" aria-level="${depth + 1}">`
        + `<span class="trace-num">${esc(node.id)}</span>`
        + `<span class="trace-label">${esc(node.label)}${mark}</span>`
        + (node.detail ? `<span class="trace-detail">${esc(node.detail)}</span>` : '')
        + (time ? `<span class="trace-time">${esc(time)}</span>` : '')
        + `</div>${children}`;
}

/**
 * 트리 노드 → HTML 문자열.
 *
 * @param root  턴 트리 루트(0번). 루트는 제목이므로 본문에서는 제외한다 —
 *   제목은 패널 상단 요약줄에 이미 나온다.
 * @param maxDepth 몇 단계까지 그릴지. 1 이면 최상위(단계)만, 3 이면
 *   세력별 행동까지 내려간다.
 */
export function renderTraceTreeHtml(root: TraceNode, maxDepth = 1): string {
    if (root.children.length === 0) {
        return '<div class="trace-detail">표시할 단계가 없습니다.</div>';
    }
    return root.children
        .map(child => renderNode(child, 1, maxDepth))
        .join('');
}
