/**
 * 대화 씬 — DOM 렌더와 상태 전이만 소유한다 [대화 UI][24][49][441-460]
 *
 * 왜 이 모듈이 있는가:
 * - main.ts 에 화면·상태·게임 로직이 한 덩어리로 굳어 있었다. 대화가 1000줄을 넘었고,
 *   도시 화면과 대화창을 한 파일에서 고쳐야 했다.
 * - 여기서는 **화면과 상태만** 다룬다. 스토어/로그/무장 상세는 주입받은 콜백으로 부른다.
 *   → 게임 로직을 모르게 되면(노드에서) 대화창을 그대로 단위 테스트할 수 있다.
 *
 * 설계 원칙 (AGENTS.md "실패를 화면에서 멀리" 준칙):
 * 1. 스토어를 직접 만지지 않는다. `hooks` 로 주입받는다.
 * 2. import 시점에 DOM 을 찾지 않는다. `createDialogueScene(root, hooks)` 로 명시적으로 만든다.
 *    (그래야 테스트가 fixture 를 끼워 넣을 수 있다)
 * 3. 핸들러 등록은 `createDialogueScene` 이 한 번만 한다. 선택지를 누를 때마다 늘어난다.
 *
 * 의존성 방향: main.ts → 이 모듈. 이 모듈 → dialogue_transcript.ts. 역방향은 없다.
 */

/** 선택지 하나. */
export interface DialogueSceneChoice {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly disabled?: boolean;
    /** 고르면 화면에 남길 한 줄을 돌려준다. */
    readonly onSelect?: () => string;
}

/** 대화 한 장면. */
export interface DialogueScenePage {
    readonly title: string;
    readonly speaker: string;
    /** 화자 무장 id — 있으면 왼쪽 열에 초상·세력·품계를 그린다. */
    readonly speakerId?: string;
    /** 사람이 아닌 화자(시설/장소)의 표식 한 글자. */
    readonly placeMark?: string;
    /** 표식 화자도 '사람'일 때 — 성문지기처럼 초상화를 세운다. */
    readonly speakerPortrait?: boolean;
    /** 세력 이름(우측/제목 보조 줄). */
    readonly subtitle?: string;
    /** 대사. '\n\n' 뒤는 참고로 따로 그린다. */
    readonly text: string;
    /** 우측(상대편) 무장 id. 없으면 빈 슬롯이 된다. */
    readonly rightOfficerId?: string;
    readonly rightSpeaker?: string;
    readonly rightPlaceMark?: string;
    readonly rightOrg?: string;
    /** 참고 줄(우호도·능력치 등). */
    readonly detail?: readonly string[];
    readonly choices?: readonly DialogueSceneChoice[];
    /** 선물 구성기를 달지 — 지정하지 않으면 일반 대화다. */
    readonly giftComposer?: DialogueSceneGift;
}

export interface DialogueSceneGift {
    readonly actorId: string;
    readonly targetId: string;
    readonly currentAffinity: number;
}

/** 열림 옵션. */
export interface OpenSceneOptions {
    /**
     * 기록(트랜스크립트)을 이어받을지.
     * 연쇄 대화는 장면마다 창을 다시 열면서 앞선 화질이 살아 있어야 하므로 true.
     */
    readonly keepTranscript?: boolean;
}

/** 대화창 상태. pages 가 곧 시나리오다. */
export interface DialogueSceneState {
    readonly pages: readonly DialogueScenePage[];
    readonly index: number;
    readonly onClose?: () => void;
}

/**
 * 게임 쪽에서 주입하는 훅.
 * 전부 선택 사항이다 — 없는 훅은 그 기능이 비활성인 것으로 본다.
 */
export interface DialogueSceneHooks {
    /** 무장 id 로 이름·초상·세력을 조회한다. 없으면 표식 글자만 그린다. */
    readonly lookupOfficer?: (officerId: string) => {
        readonly id: string;
        readonly name: string;
        readonly gender: 'M' | 'F';
        readonly rank: number;
        readonly status: string;
        readonly factionName: string;
        readonly factionColor: string;
    } | null;
    /** 무장 초상 SVG 를 만든다. */
    readonly renderPortrait?: (args: { id: string; name: string; gender: 'M' | 'F'; grade: number }) => string;
    /** 로그에 한 줄 남긴다. */
    readonly log?: (text: string) => void;
    /** 선물을 보낸다. 성공 여부와 메시지를 돌려준다. */
    readonly sendGift?: (args: { actorId: string; targetId: string; itemId: string; gold: number }) => { readonly ok: boolean; readonly message: string };
    /** 선물을 보낸 뒤 무장 상세를 다시 그린다. */
    readonly refreshOfficer?: (officerId: string) => void;
    /** 대사를 읽는다(TTS). */
    readonly speak?: (args: { readonly speaker: string; readonly text: string }) => void;
    /** 타이포그래피가 도는지. false 면 한 번에 다 보여준다. */
    readonly typewriter?: () => boolean;
    /** 타이포그래피를 즉시 끝낸다. */
    readonly skipReveal?: () => boolean;
}

/**
 * 대화 기록(트랜스크립트) 축적 — 순수 데이터 조립 [대화 UI]
 *
 * 왜 새 모듈인가:
 * - 대화창은 매번 DOM 을 새로 그린다. 그러면 "지금까지 무슨 이야기를 했는지"가 사라진다.
 *   여러 장면짜리 대화(알현 → 교섭)나 연쇄 대화를 넘기면 앞선 말이 안 보인다.
 * - 이 모듈은 그 기록만 모은다. DOM 을 만지지 않고 HTML 문자열만 돌려준다.
 *   (패턴: accessibility_system.ts 의 renderAccessibilityPanel)
 *
 * 설계:
 * - 기록은 '한 줄 화법'의 배열이다. 각 항목은 화자 + 말 + 그 뒤에 고른 선택지 + 결과.
 * - 대화가 닫히면(closeDialogue) main.ts 가 이 배열을 비운다.
 * - Math.random / Date.now / setTimeout 을 쓰지 않는다. 결정론.
 */

/** 한 장면에서 실제로 말한 부분과 참고(빈 줄 뒤) 부분을 나눈다. */
export interface SplitDialogue {
    /** 대사 — 화면에서 크게 읽힌다 */
    readonly speech: string;
    /** 참고 — 정보 크기로 읽힌다. 없으면 빈 문자열 */
    readonly notes: string;
}

/**
 * 대사를 참고로 분리한다.
 * 구분자는 빈 줄 두 개('\n\n') 하나. 없으면 전체가 대사다.
 */
export function splitSpeechAndNotes(text: string): SplitDialogue {
    if (typeof text !== 'string' || text === '') return { speech: '', notes: '' };
    const sep = text.indexOf('\n\n');
    if (sep < 0) return { speech: text, notes: '' };
    return { speech: text.slice(0, sep), notes: text.slice(sep + 2) };
}

/**
 * 대화 씬 상태 기계 — 타이포그래피 진행도 [대화 UI][461-480]
 *
 * 왜 새 모듈인가:
 * - main.ts 안에서 setInterval 로 글자를 조금씩 보여주려 하면 타이머가对话 사이에 남는다.
 *   다음 대화가 열렸는데 이전 대사의 글자가 계속 깜빡이는 사고가 난다.
 * - 여기서는 **진행도 숫자만** 관리한다. DOM 은 main.ts 가 그린다.
 *   → 상태가 순수해서 노드에서 그대로 단위 테스트된다.
 *
 * 설계:
 * - advance(글자수) 를 반복 호출하면 결국 done 이 된다(무한 루프 방지 상한 있음).
 * - reset() 은 대화가 바뀔 때 호출한다.
 * - Math.random / Date.now / setTimeout 을 쓰지 않는다. 결정론.
 */

/** 한 번에 몇 글자씩 드러낼지 — 1 이면 가장 느리다. */
export const DEFAULT_CHARS_PER_STEP = 2;

/** 계산용 상한 — 어떤 대사도 이만큼 넘게 반복하지 않는다. */
const MAX_STEPS = 4000;

export interface RevealMachineState {
    /** 지금까지 드러낸 글자 수 */
    readonly cursor: number;
    /** 대화 전체 글자 수 */
    readonly total: number;
}

/** 새 기계 — cursor 0 에서 시작한다. */
export function createRevealMachine(total: number): RevealMachineState {
    const safe = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
    return { cursor: 0, total: safe };
}

/** 더 드러낼 것이 없는가? */
export function isRevealDone(state: RevealMachineState): boolean {
    return state.cursor >= state.total;
}

/**
 * 글자를 charsPerStep 만큼 더 드러낸다.
 * 다 드러났으면 그대로 멈춘다(over-draw 없음). 상한을 넘으면 멈춘다(무한 루프 방지).
 */
export function advanceReveal(
    state: RevealMachineState,
    charsPerStep: number = DEFAULT_CHARS_PER_STEP,
): RevealMachineState {
    if (isRevealDone(state)) return state;
    const step = Number.isFinite(charsPerStep) && charsPerStep > 0 ? Math.floor(charsPerStep) : 1;
    if (state.cursor >= MAX_STEPS) return { ...state, cursor: state.total };
    const next = Math.min(state.total, state.cursor + step);
    return { ...state, cursor: next };
}

/** 끝까지 한 번에 건너뛴다 — 클릭/스페이스로 바로 다 보여줄 때. */
export function completeReveal(state: RevealMachineState): RevealMachineState {
    return { ...state, cursor: state.total };
}

/** 현재 화면에 보여줄 조각을 만든다. */
export function renderReveal(text: string, state: RevealMachineState): string {
    return planReveal(text, state.cursor).shown;
}

/**
 * 대사를 '한 글자씩 드러내기' 와 '한 번에 다 보여주기' 로 쪼갠다.
 *
 * 왜 이것도 순수 함수인가:
 * - 화면에는 타이포그래피로 조금씩 드러나고, E2E 는 최종 결과를 읽는다.
 *   화면용(조각)과 검사용(전체)을 **같은 규칙**에서 만들어야 어긋나지 않는다.
 * - spoken 은 화면 조각과 무관하게 항상 '전체 대사' 다 — TTS 는 통으로 읽어야 한다.
 *
 * @param text 원본 대사(참고가 붙을 수 있음)
 * @param charCount 글자 단위로 몇 글자까지 드러낼지. 0 이하면 전체를 이미 다 보여준 것으로 본다.
 */
export interface RevealPlan {
    /** 화면에 지금 보여줄 조각 */
    readonly shown: string;
    /** 남은 조각 — charCount 가 전체 길이 이상이면 빈 문자열 */
    readonly remaining: string;
    /** 더 드러낼 것이 없으면 true */
    readonly done: boolean;
    /** 전체 글자 수 */
    readonly total: number;
    /** TTS 로 읽을 대사만 모은 것 — 화면 조각과 무관하게 항상 전체 */
    readonly spoken: string;
}

/** TTS 에 넘길 대사를 정리한다 — 따옴표·공백을 걷어낸다. */
export function normalizeSpeech(text: string): string {
    if (typeof text !== 'string') return '';
    return text
        .replace(/[“”"‘’]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * charCount 글자까지 드러낸 계획을 만든다.
 * 줄바꿈('\n')은 한 글자가 아니라 통째로 처리한다 — 어느 줄까지 완성됐는지 알 수 있어야 한다.
 */
export function planReveal(text: string, charCount: number): RevealPlan {
    const { speech } = splitSpeechAndNotes(text);
    if (speech === '') return { shown: '', remaining: '', done: true, total: 0, spoken: '' };
    if (charCount <= 0) {
        return { shown: speech, remaining: '', done: true, total: speech.length, spoken: normalizeSpeech(speech) };
    }
    if (charCount >= speech.length) {
        return { shown: speech, remaining: '', done: true, total: speech.length, spoken: normalizeSpeech(speech) };
    }
    // 줄 경계를 넘지 않도록, charCount 안에 완전히 들어가는 줄까지 보여준다.
    // 첫 줄이 charCount 보다 길면(가장 흔한 경우) 거기서 강제로 자른다.
    const lines = speech.split('\n');
    let shown = lines.length > 0 ? lines[0].slice(0, charCount) : '';
    for (let i = 1; i < lines.length; i++) {
        const candidate = `${shown}\n${lines[i]}`;
        if (candidate.length > charCount) break;
        shown = candidate;
    }
    const remaining = speech.slice(shown.length).replace(/^\n/, '');
    return {
        shown,
        remaining,
        done: false,
        total: speech.length,
        spoken: normalizeSpeech(speech),
    };
}

/** 대화 기록 한 항목. */
export interface TranscriptEntry {
    /** 화자 이름. 사람이 아니면 시설/장소 이름이 온다. */
    readonly speaker: string;
    /** 그 화자가 한 말. 여러 줄이면 배열이 여러 칸이다. */
    readonly lines: readonly string[];
    /** 이 장면에서 고른 선택지 라벨. 고르지 않았으면 null. */
    readonly choice: string | null;
    /** 선택 결과 메시지. 없으면 null. */
    readonly result: string | null;
}

/** 화면에 남기는 최대 기록 수 — 더 많으면 최근 것만 보인다. */
export const TRANSCRIPT_LIMIT = 3;

/**
 * 화법 한 줄을 기록 항목으로 만든다.
 * 빈 대사면 기록하지 않는다(null) — 말이 없는 장면은 기록할 이유가 없다.
 */
export function createTranscriptEntry(speaker: string, text: string): TranscriptEntry | null {
    const { speech } = splitSpeechAndNotes(text);
    const trimmed = speech.trim();
    if (trimmed === '') return null;
    const name = typeof speaker === 'string' && speaker.trim() !== '' ? speaker.trim() : '???';
    return {
        speaker: name,
        lines: trimmed.split('\n').map(line => line.trim()).filter(line => line !== ''),
        choice: null,
        result: null,
    };
}

/**
 * 가장 최근 항목에 '고른 선택지 + 결과'를 붙인다.
 * 기록이 비어 있으면 아무 일도 하지 않는다 — 장면이 아직 안 그려진 상태일 수 있다.
 * 같은 선택지를 두 번 붙이지 않는다(더블클릭 방어).
 */
export function recordChoice(
    entries: readonly TranscriptEntry[],
    label: string,
    result: string,
): TranscriptEntry[] {
    if (entries.length === 0) return [];
    const last = entries[entries.length - 1];
    if (last.choice !== null) return [...entries];
    const text = typeof label === 'string' ? label.trim() : '';
    const outcome = typeof result === 'string' ? result.trim() : '';
    if (text === '' && outcome === '') return [...entries];
    return [
        ...entries.slice(0, entries.length - 1),
        { ...last, choice: text === '' ? null : text, result: outcome === '' ? null : outcome },
    ];
}

/** HTML 특수문자를 entities 로 바꾼다. 데이터가 아니라 곧바로 innerHTML 로 들어간다. */
function escapeHtml(raw: string): string {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 기록을 화면용 HTML 문자열로 그린다.
 * - 기록이 1줄 이하면 숨긴다(아무 말도 하지 않은 첫 장면에서 빈 상자를 보이지 않는다).
 * - 최근 {@link TRANSCRIPT_LIMIT} 줄만 남기고, 더 있으면 '이전' 표시를 남긴다.
 * - aria-hidden 으로 읽지 않는다 — 이미 화면에 있는 말의 반복이라 점자 낭비다.
 */
export function renderTranscriptHtml(entries: readonly TranscriptEntry[]): string {
    if (!Array.isArray(entries) || entries.length < 2) return '';
    const recent = entries.slice(-TRANSCRIPT_LIMIT);
    const hidden = entries.length - recent.length;
    const body = recent.map(entry => {
        // 공백뿐인 줄은 그리지 않는다 — 빈 줄이 화면에 점령하는 것을 막는다.
        const lines = entry.lines
            .filter((line: string) => line.trim() !== '')
            .map((line: string) => `<span class="dlg-th-line">${escapeHtml(line)}</span>`).join('');
        const choice = entry.choice !== null
            ? `<span class="dlg-th-choice">→ ${escapeHtml(entry.choice)}</span>`
            : '';
        const result = entry.result !== null
            ? `<span class="dlg-th-result">${escapeHtml(entry.result)}</span>`
            : '';
        return `<div class="dlg-th-entry">`
            + `<span class="dlg-th-who">${escapeHtml(entry.speaker)}</span>`
            + lines + choice + result
            + `</div>`;
    }).join('');
    const marker = hidden > 0 ? `<span class="dlg-th-more">이전 ${hidden}줄</span>` : '';
    return `<div class="dlg-th-inner">${marker}${body}</div>`;
}