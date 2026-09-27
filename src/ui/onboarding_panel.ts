/**
 * [461-480] 마이크로 UX · 온보딩 패널 렌더러 (순수 HTML 문자열)
 * 파일: src/ui/onboarding_panel.ts   (4-PR 분할 2/4 — 소유 파일)
 *
 * ─────────────────────────────────────────────────────────────────────
 * 이 모듈의 계약 (Ownership: src/ui/onboarding_panel.ts 단독 소유)
 * ─────────────────────────────────────────────────────────────────────
 * 1. DOM 접근 금지. document / window / querySelector / addEventListener 를
 *    한 번도 호출하지 않는다. import 시점 부작용도 없다(최상위 코드 없음).
 *    → 노드 환경에서 그대로 import 되어 단위 테스트된다.
 *    (패턴: src/core/accessibility_system.ts 의 renderAccessibilityPanel)
 * 2. 렌더 결과는 항상 HTML "문자열"이다. 패널을 여는/닫는 일은 하지 않는다.
 * 3. 결정론: Math.random() / Date.now() / setTimeout 없음.
 *    같은 상태 + 같은 카피 => 언제나 같은 문자열.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠ 코디네이터가 아직 배선해야 하는 것 (이 파일이 해주지 않는 것)
 * ─────────────────────────────────────────────────────────────────────
 *  ① innerHTML 주입      : index.html 의 #tut-step-content 에 반환 문자열을 넣는다.
 *  ② 버튼 클릭 바인딩    : [data-onboarding-action] 요소에 핸들러를 붙인다
 *                          (prev / next / skip / defer / finish).
 *  ③ 상태 전이 연결      : 클릭 시 src/core/onboarding_state.ts 의
 *                          goToStep / nextStep / prevStep / completeOnboarding /
 *                          deferOnboarding / dismissOnboarding 을 호출한 뒤
 *                          다시 렌더한다.
 *  ④ 스포트라이트 적용   : data-onboarding-spotlight 셀렉터로 요소를 찾아
 *                          .tut-spotlight 클래스를 토글한다. index.html 의
 *                          #tut-spotlight-note 는 폴백 문구 표시용이다.
 *  ⑤ 버튼 표시/숨김 제어 : #tut-prev 의 disabled, #tut-next·#tut-skip 의 숨김,
 *                          #tut-finish 노출은 index.html 쪽 버튼에 적용하는 게 빠르다
 *                          (data-onboarding-first / -last 값으로 판단).
 *  ⑥ 포커스 이동         : 열 때 #tutorial-panel 에 focus, Esc 로 닫기.
 *                          role="dialog" / tabindex="-1" 은 index.html 에 이미 있다.
 *
 *  이 파일은 위 어느 것도 하지 않는다. 순수 계산만 한다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 상태 타입에 대한 결정 (PR 병합 순서 때문)
 * ─────────────────────────────────────────────────────────────────────
 *  아래 OnboardingPanelState 는 로컬 최소 구조 타입이며, PR1 의
 *  OnboardingState (src/core/onboarding_state.ts) 와 구조적으로 호환된다.
 *  병합 후에는 아래 import 한 줄로 교체하면 된다:
 *
 *      import type { OnboardingState } from '../core/onboarding_state.js';
 *      export type OnboardingPanelState = OnboardingState;
 *
 *  지금 type-only import 를 걸면 그 파일이 아직 이 브랜치에 없어서
 *  tsc 가 TS2307 로 깨진다(병합되면 사라질 이유 없는 실패).
 *  그래서 지금은 로컬 선언을 쓴다.
 *  모든 필드를 optional 로 두어 일부만 채워진 객체도 받아들인다.
 */

export type OnboardingPanelStatus = 'active' | 'completed' | 'deferred' | 'dismissed';

/**
 * 온보딩 상태의 최소 구조 타입.
 * PR1 의 OnboardingState 와 구조적으로 호환(위 주석 참고). 전부 선택 사항.
 */
export interface OnboardingPanelState {
    readonly stepIndex?: number;
    readonly status?: OnboardingPanelStatus;
    readonly visitedStepIndexes?: readonly number[];
    readonly difficulty?: number;
    readonly startingFaction?: string | null;
    readonly deferredAtStep?: number | null;
    readonly dismissed?: boolean;
}

/** 카피 카탈로그 1건 — src/data/onboarding_copy.json 항목과 같은 모양 */
export interface OnboardingStepCopy {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    /** 하이라이트 대상 CSS 셀렉터. 없으면 속성 자체를 생략한다 */
    readonly spotlightSelector?: string | null;
}

/** 패널 고정 문구 — 코디네이터가 다른 카피로 덮어쓸 수 있다 */
export interface OnboardingPanelLabels {
    readonly hintPrefix: string;
    readonly progressPrefix: string;
    readonly difficultyLabel: string;
    readonly factionLabel: string;
    readonly factionUnset: string;
    readonly prev: string;
    readonly next: string;
    readonly skip: string;
    readonly defer: string;
    readonly finish: string;
    readonly fallbackTitle: string;
    readonly fallbackBody: string;
}

/** 렌더 옵션 — 전부 선택 사항. 생략하면 이 파일의 기본 카피/문구를 쓴다. */
export interface OnboardingPanelOptions {
    /** 단계 카피 목록. 인덱스가 stepIndex 에 대응한다 */
    readonly steps?: readonly OnboardingStepCopy[];
    /** 전체 단계 수. 기본값은 ONBOARDING_PANEL_TOTAL_STEPS(=10) */
    readonly totalSteps?: number;
    /** 버튼/진행 표시 문구 */
    readonly labels?: Partial<OnboardingPanelLabels>;
    /** 시작 세력 표시명. 없으면 옛한자 1자 표시로 대체 */
    readonly factionNames?: Readonly<Record<string, string>>;
}

/** 바인딩 대상이 되는 data-onboarding-action 값 */
export type OnboardingPanelAction = 'prev' | 'next' | 'skip' | 'defer' | 'finish';

/** parseOnboardingPanel 가 되돌리는 값 — 코디네이터 배선용 */
export interface OnboardingPanelBindings {
    readonly stepId: string;
    readonly step: number;
    readonly total: number;
    readonly isFirst: boolean;
    readonly isLast: boolean;
    readonly status: OnboardingPanelStatus;
    /** 스포트라이트 셀렉터. 지정된 단계가 아니면 null */
    readonly spotlight: string | null;
    readonly progressPercent: number;
    readonly deferredAtStep: number | null;
    /** 방문한 단계 인덱스 (오름차순, 중복 없음) */
    readonly visited: readonly number[];
    /** 버튼 동작 목록 — value 는 전이에 필요한 인자(목표 단계 등) */
    readonly actions: readonly { readonly action: OnboardingPanelAction; readonly value: string }[];
}

// ─────────────────────────────────────────── 기본 카피 (폴백)
// PR3 의 src/data/onboarding_copy.json 을 넘기지 않아도 패널이 열리도록
// 이 파일 자체가 최소 카피를 갖는다. json 이 오면 그것이 우선한다.
const DEFAULT_STEPS: readonly OnboardingStepCopy[] = [
    {
        id: 'welcome',
        title: '환영합니다 — 指南',
        body: '이곳은 삼국지 8 리메이크 안내입니다. 여러 화면을 천천히 살펴보세요. 언제든 다시 불러올 수 있습니다.',
    },
    {
        id: 'turn',
        title: '다음 月 — ターン',
        body: '화면 위 「▸ 다음 月」이 한 달을 넘깁니다. 명령을 내리고 나면 다음 달로 넘어가세요.',
        spotlightSelector: '#btn-next-month',
    },
    {
        id: 'report',
        title: '월간 보고 — 月報',
        body: '「📊 보고」에서 그달의 재정과 도시 동향을 되돌아봅니다.',
        spotlightSelector: '#btn-report',
    },
    {
        id: 'map',
        title: '전도 — 地图',
        body: '가운데 전도에서 도시를 누르면 그 도시의 상세 패널이 열립니다.',
        spotlightSelector: '#game-canvas',
    },
    {
        id: 'city',
        title: '도시 내정 — 內政',
        body: '도시 안에서 징병·훈련·개발 명령을 내릴 수 있습니다.',
        spotlightSelector: '#cdp-actions',
    },
    {
        id: 'diplomacy',
        title: '외교 — 外交',
        body: '이웃 세력과 증정·동맹을 주고받습니다.',
        spotlightSelector: '#btn-diplomacy',
    },
    {
        id: 'battle',
        title: '전투 — 出陣',
        body: '출진을 준비해 헥사곤 전장에서 승리합니다.',
        spotlightSelector: '#btn-battle',
    },
    {
        id: 'save',
        title: '저장 — 存檔',
        body: '「저장」은 1번 슬롯에 바로 담습니다.',
        spotlightSelector: '#btn-save',
    },
    {
        id: 'settings',
        title: '설정 — 設定',
        body: '글꼴과 글자 크기, 화면 흔들림을 여기서 바꿉니다.',
        spotlightSelector: '#btn-settings',
    },
    {
        id: 'ending',
        title: '통일 — 天下',
        body: '모든 도시를 점령하면 천하 통일에 이릅니다. 즐거운 플레이 되시길 바랍니다.',
    },
];

/** 기본 전체 단계 수 — PR1 의 ONBOARDING_TOTAL_STEPS(=TUTORIAL_STEPS.length=10)와 동일 */
export const ONBOARDING_PANEL_TOTAL_STEPS = 10;

const DEFAULT_LABELS: OnboardingPanelLabels = {
    hintPrefix: '▸ 관련 UI',
    progressPrefix: '온보딩 진행',
    difficultyLabel: '난이도',
    factionLabel: '시작 세력',
    factionUnset: '미선택',
    prev: '◀ 이전',
    next: '다음 ▶',
    skip: '건너뛰기',
    defer: '나중에 보기',
    finish: '시작하기',
    fallbackTitle: '안내',
    fallbackBody: '이 단계에 대한 설명을 준비하고 있습니다.',
};

const DEFAULT_FACTION_NAMES: Readonly<Record<string, string>> = {
    wei: '魏',
    shu: '蜀',
    wu: '吳',
    custom: '自定',
};

// ─────────────────────────────────────────── 정규화 (방어 코드)

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    const int = Math.trunc(value);
    if (int < min) return min;
    if (int > max) return max;
    return int;
}

/** 정규식 캡처(문자열)를 정수로 — 실패하면 null. 숫자 변환을 빠뜨리면 clamp 가 0 으로 조용히 떨어진다. */
function toInt(raw: string | undefined): number | null {
    if (raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** HTML 이스케이프 — 카피에 & < > " 가 섞여도 속성이 깨지지 않게 */
function esc(raw: string): string {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 숫자를 안전하게 문자열로 — undefined/NaN 이 HTML에 새지 않게 하는 유일한 통로 */
function num(value: unknown, fallback: number): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(fallback);
    return String(Math.trunc(value));
}

/** 불리언 속성값 — 항상 "true"/"false" 두 갈래뿐 */
function flag(value: boolean): string {
    return value ? 'true' : 'false';
}

function isPanelStatus(value: unknown): value is OnboardingPanelStatus {
    return value === 'active' || value === 'completed' || value === 'deferred' || value === 'dismissed';
}

function normalizeVisited(raw: unknown, current: number, total: number): readonly number[] {
    const list = Array.isArray(raw) ? raw : [];
    const set = new Set<number>([current]);
    for (const n of list) {
        if (typeof n === 'number' && Number.isFinite(n)) set.add(clampInt(n, 0, total - 1, 0));
    }
    return [...set].sort((a, b) => a - b);
}

/** 난이도 1~5를 ★ 문자열로 — 범위 밖이면 가운데로 보정 */
function stars(raw: unknown): string {
    const d = clampInt(raw, 1, 5, 3);
    return `${'★'.repeat(d)}${'☆'.repeat(5 - d)}`;
}

function factionName(raw: unknown, names: Readonly<Record<string, string>>, unset: string): string {
    if (typeof raw !== 'string' || raw.trim() === '') return unset;
    const key = raw.trim();
    const hit = names[key];
    return typeof hit === 'string' && hit.trim() !== '' ? hit : key;
}

// ─────────────────────────────────────────── 순수 렌더

/**
 * 온보딩 패널 본문 HTML — 순수 문자열 반환, DOM 접근 없음.
 *
 * @param state 온보딩 상태. PR1 의 OnboardingState 와 구조적으로 호환(전부 optional).
 * @param options 단계 카피/문구 등. 생략하면 이 파일의 기본값.
 * @returns #tut-step-content 에 그대로 넣을 수 있는 HTML 문자열.
 */
export function renderOnboardingPanel(
    state: OnboardingPanelState,
    options: OnboardingPanelOptions = {},
): string {
    const steps = options.steps && options.steps.length > 0 ? options.steps : DEFAULT_STEPS;
    const labels: OnboardingPanelLabels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
    const factionNames = options.factionNames ?? DEFAULT_FACTION_NAMES;

    const total = Math.max(1, clampInt(options.totalSteps, 1, 9999, ONBOARDING_PANEL_TOTAL_STEPS));
    const step = clampInt(state?.stepIndex, 0, total - 1, 0);
    const isFirst = step === 0;
    const isLast = step === total - 1;
    const status: OnboardingPanelStatus = isPanelStatus(state?.status) ? state.status : 'active';

    // 카피가 단계 수보다 짧아도 새지 않게 — 범위 밖이면 폴백 항목을 쓴다.
    const entry: OnboardingStepCopy = steps[step] ?? {
        id: '',
        title: labels.fallbackTitle,
        body: labels.fallbackBody,
    };
    const stepId = entry.id.trim() !== '' ? entry.id : `step-${step}`;
    const spotlight =
        typeof entry.spotlightSelector === 'string' && entry.spotlightSelector.trim() !== ''
            ? entry.spotlightSelector.trim()
            : null;

    const visited = normalizeVisited(state?.visitedStepIndexes, step, total);
    const progressPercent = Math.round(((step + 1) / total) * 100);

    // 진행 점 — 방문한 단계는 done, 현재는 active (index.html 의 .tut-dot 규약)
    const dots = Array.from({ length: total }, (_, i) => {
        const cls = ['tut-dot'];
        const done = visited.includes(i) && i !== step;
        if (i === step) cls.push('active');
        else if (done) cls.push('done');
        const mark = i === step ? '현재 단계' : (done ? '지난 단계' : '아직 남은 단계');
        return (
            `<span class="${cls.join(' ')}" data-onboarding-dot="${i}"` +
            ` data-onboarding-visited="${visited.includes(i) ? 'true' : 'false'}"` +
            ` role="presentation" aria-label="${mark}"></span>`
        );
    }).join('');

    // 진행률 — 접근성: role=progressbar + aria-valuenow [461-480]
    const progress =
        `<div class="tut-progress" data-onboarding-progress="${progressPercent}"` +
        ` role="progressbar" aria-valuemin="0" aria-valuemax="100"` +
        ` aria-valuenow="${progressPercent}" aria-label="${esc(labels.progressPrefix)}">` +
        `<span class="tut-progress-text">${num(step + 1, 1)} / ${num(total, 1)}` +
        ` (${num(progressPercent, 0)}%)</span></div>`;

    const hint =
        `<div class="tut-hint">${esc(labels.hintPrefix)}: ` +
        `${esc(spotlight ?? entry.title)}</div>`;

    // 온보딩 중 고른 값 — 코디네이터가 여기 값을 읽어 게임 설정에 넘긴다.
    const prefs =
        `<div class="tut-prefs" data-onboarding-prefs>` +
        `<span class="tut-pref"><span class="tut-pref-label">${esc(labels.difficultyLabel)}</span>` +
        `<span class="tut-pref-value" data-onboarding-difficulty="${num(state?.difficulty, 3)}">` +
        `${esc(stars(state?.difficulty))}</span></span>` +
        `<span class="tut-pref"><span class="tut-pref-label">${esc(labels.factionLabel)}</span>` +
        `<span class="tut-pref-value" data-onboarding-faction="${esc(String(state?.startingFaction ?? ''))}">` +
        `${esc(factionName(state?.startingFaction, factionNames, labels.factionUnset))}</span></span>` +
        `</div>`;

    // 동작 버튼 — 코디네이터가 [data-onboarding-action] 에 클릭을 붙인다.
    const btn = (action: OnboardingPanelAction, label: string, value: string, primary = false) =>
        `<button type="button" class="game-btn${primary ? ' primary' : ''}` +
        `${action === 'skip' || action === 'defer' ? ' tut-skip' : ''}"` +
        ` data-onboarding-action="${action}" data-onboarding-value="${esc(value)}"` +
        ` aria-label="${esc(label)}">${esc(label)}</button>`;

    const actions =
        `<div class="tut-controls" data-onboarding-actions>` +
        btn('prev', labels.prev, String(step - 1)) +
        (isLast ? '' : btn('next', labels.next, String(step + 1), true)) +
        (isLast ? '' : btn('defer', labels.defer, String(step))) +
        btn('skip', labels.skip, String(step)) +
        (isLast ? btn('finish', labels.finish, 'done', true) : '') +
        `</div>`;

    // 루트 요소가 배선 정보를 모두 싣는다. 속성 순서는 고정(결정론).
    const deferredAt = state?.deferredAtStep;
    const attrs =
        `data-onboarding-id="${esc(stepId)}"` +
        ` data-onboarding-step="${num(step, 0)}"` +
        ` data-onboarding-total="${num(total, 1)}"` +
        ` data-onboarding-first="${flag(isFirst)}"` +
        ` data-onboarding-last="${flag(isLast)}"` +
        ` data-onboarding-status="${esc(status)}"` +
        (spotlight ? ` data-onboarding-spotlight="${esc(spotlight)}"` : '') +
        (typeof deferredAt === 'number' && Number.isFinite(deferredAt)
            ? ` data-onboarding-deferred-at="${num(deferredAt, 0)}"`
            : '') +
        (state?.dismissed ? ' data-onboarding-dismissed="true"' : '');

    return (
        `<div class="tut-step" ${attrs} role="group" aria-label="${esc(labels.progressPrefix)}">` +
        `<div class="tut-title">${esc(entry.title)}</div>` +
        `<div class="tut-body" aria-live="polite">${esc(entry.body)}</div>` +
        hint +
        prefs +
        progress +
        `<div class="tut-dots" data-onboarding-dots>${dots}</div>` +
        actions +
        `</div>`
    );
}

// ─────────────────────────────────────────── 파서 (DOM 없이 속성 추출)

const ATTR_RE = {
    id: /data-onboarding-id="([^"]*)"/,
    step: /data-onboarding-step="(-?\d+)"/,
    total: /data-onboarding-total="(\d+)"/,
    first: /data-onboarding-first="(true|false)"/,
    last: /data-onboarding-last="(true|false)"/,
    status: /data-onboarding-status="([^"]*)"/,
    spotlight: /data-onboarding-spotlight="([^"]*)"/,
    progress: /data-onboarding-progress="(\d+)"/,
    deferredAt: /data-onboarding-deferred-at="(-?\d+)"/,
} as const;

/**
 * renderOnboardingPanel 이 낸 HTML 에서 코디네이터가 배선에 필요한
 * data-* 속성을 뽑아낸다. 정규식 전용 — DOM 파서를 쓰지 않으므로 jsdom 없이도
 * 동작하고, 순수 문자열 입력만 받는다.
 *
 * @param html renderOnboardingPanel 의 반환값.
 * @returns 배선 정보. 루트 data-onboarding-step 을 못 찾으면 null.
 */
export function parseOnboardingPanel(html: string): OnboardingPanelBindings | null {
    if (typeof html !== 'string' || html === '') return null;

    const stepMatch = ATTR_RE.step.exec(html);
    if (!stepMatch) return null;

    const totalRaw = ATTR_RE.total.exec(html);
    const total = clampInt(toInt(totalRaw?.[1]), 1, 9999, ONBOARDING_PANEL_TOTAL_STEPS);
    const step = clampInt(toInt(stepMatch[1]), 0, total - 1, 0);

    const statusRaw = ATTR_RE.status.exec(html);
    const deferredRaw = ATTR_RE.deferredAt.exec(html);
    const spotlightRaw = ATTR_RE.spotlight.exec(html);

    const actions: { action: OnboardingPanelAction; value: string }[] = [];
    for (const m of html.matchAll(
        /data-onboarding-action="([a-z]+)"\s+data-onboarding-value="([^"]*)"/g,
    )) {
        const act = m[1] as OnboardingPanelAction;
        actions.push({ action: act, value: m[2] });
    }

    const dots = new Set<number>();
    for (const m of html.matchAll(
        /data-onboarding-dot="(\d+)"\s+data-onboarding-visited="true"/g,
    )) {
        dots.add(toInt(m[1]) as number);
    }

    return {
        stepId: (ATTR_RE.id.exec(html)?.[1] ?? '').trim(),
        step,
        total,
        isFirst: ATTR_RE.first.exec(html)?.[1] === 'true' || step === 0,
        isLast: ATTR_RE.last.exec(html)?.[1] === 'true' || step === total - 1,
        status: statusRaw && isPanelStatus(statusRaw[1]) ? statusRaw[1] : 'active',
        spotlight: spotlightRaw?.[1] ?? null,
        progressPercent: clampInt(toInt(ATTR_RE.progress.exec(html)?.[1]), 0, 100, 0),
        deferredAtStep: deferredRaw ? toInt(deferredRaw[1]) : null,
        visited: [...dots].sort((a, b) => a - b),
        actions,
    };
}

