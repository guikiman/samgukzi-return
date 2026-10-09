/**
 * 대화 씬 — DOM 렌더와 상태 전이만 소유한다 [대화 UI][24][49][441-460]
 *
 * 왜 이 모듈이 있는가:
 * - main.ts 에 화면·상태·게임 로직이 한 덩어리로 굳어 있었다. 대화가 1000줄을 넘었고,
 *   도시 화면을 고치려면 대화창까지 같은 파일을 열어야 했다.
 * - 여기서는 **화면과 상태만** 다룬다. 스토어·로그·무장 상세는 주입받은 훅으로 부른다.
 *   → 게임 로직을 모르게 되면(노드/jsdom에서) 대화창을 그대로 단위 테스트할 수 있다.
 *
 * 설계 원칙:
 * 1. 스토어를 직접 만지지 않는다. `hooks` 로 주입받는다.
 * 2. import 시점에 DOM 을 찾지 않는다. `createDialogueScene(root, hooks)` 로 명시적으로 만든다.
 * 3. 핸들러 등록은 `createDialogueScene` 이 한 번만 한다. 선택지를 누를 때마다 늘어난다.
 *
 * 의존성 방향: main.ts → 이 모듈. 역방향 금지.
 */

import {
    createTranscriptEntry, recordChoice, renderTranscriptHtml, type TranscriptEntry,
    createRevealMachine, advanceReveal, completeReveal, renderReveal,
    planReveal,
    type DialogueScenePage, type DialogueSceneState, type DialogueSceneChoice,
    type OpenSceneOptions,
} from '../../core/dialogue_transcript.js';
import { stopSpeech } from '../../core/ai_tts_pipeline.js';

/** 글자가 몇 글자씩 드러나는지. 1 틱 = 이 밀리초. */
export const REVEAL_INTERVAL_MS = 22;
/** 무조작 자동 종료까지의 밀리초. 창 안의 모든 조작(클릭·키)이 타이머를 리셋한다. */
export const AUTO_CLOSE_MS = 30_000;

/** 대화창이 무장 슬롯에 그리는 최소 정보. */
export interface DialogueSceneOfficer {
    readonly id: string;
    readonly name: string;
    readonly gender: 'M' | 'F';
    readonly rank: number;
    readonly status: string;
    readonly factionName: string;
    readonly factionColor: string;
}

/** 선물 구성기에 보여줄 아이템. 게임 데이터이므로 주입받는다. */
export interface DialogueGiftItem {
    readonly id: string;
    readonly name: string;
    readonly gradeLabel: string;
    readonly affinity: number;
}

/**
 * 게임 쪽에서 주입하는 훅. 전부 선택 사항이다 — 없는 훅은 그 기능이 비활성인 것으로 본다.
 */
export interface DialogueSceneHooks {
    readonly lookupOfficer?: (officerId: string) => DialogueSceneOfficer | null;
    readonly renderPortrait?: (args: { id: string; name: string; gender: 'M' | 'F'; grade: number }) => string;
    readonly log?: (text: string) => void;
    readonly sendGift?: (args: { actorId: string; targetId: string; itemId: string; gold: number }) => { readonly ok: boolean; readonly message: string };
    readonly refreshOfficer?: (officerId: string) => void;
    /** 대사를 읽는다(TTS). */
    readonly speak?: (args: { readonly speaker: string; readonly text: string }) => void;
    /** 타이포그래피가 도는지. false 면 한 번에 다 보여준다. */
    readonly typewriter?: () => boolean;
    /** 교역 매입/매도. */
    readonly runTrade?: (goodId: string, mode: 'buy' | 'sell') => void;
}

/** 대화창이 main.ts 에 노출하는 공개 표면. */
export interface DialogueScene {
    open(state: DialogueSceneState, opts?: OpenSceneOptions): void;
    close(): void;
    /** 창이 열려 있는가 — 전역 키보드 핸들러가 이걸 본다. */
    isOpen(): boolean;
    /** 현재 장면. 테스트와 디버그용. */
    currentPage(): DialogueScenePage | null;
    /** 창이 닫힌 뒤 실행할 콜백을 건다(알현 → 교섭처럼 창을 이어서 띄울 때). */
    queueAfterClose(fn: () => void): void;
    /**
     * 대기 콜백을 이어 붙인다 — 앞서 걸린 것이 있으면 먼저 돌리고 그 다음 새 콜백을 실행한다.
     * 순서가 뒤집히면 엉뚱한 창이 먼저 열리므로 '한 번만' 덮어쓰지 않는다.
     */
    queueAfterCloseChained(fn: () => void): void;
    /** 대기 콜백을 버린다 — 다른 도시의 창이 먼저 열리지 않도록. */
    clearQueuedClose(): void;
    /** 타이포그래피를 즉시 보여준다(E2E/디버그). */
    setForceInstant(on: boolean): void;
    /** 타이포그래피가 지금 끝났는가. */
    isRevealDone(): boolean;
    /** 지금 타임아웃까지 몇 글자를 보여줬는지 — E2E/디버그 확인용. */
    revealProgress(): { readonly cursor: number; readonly total: number } | null;
    /**
     * 연쇄 대화용 내비게이션 표시를 갱신한다.
     * 게임이 "다음 장면이 있는가" 를 결정하고, 그 사실만 씬에 알린다.
     */
    setNavState(state: DialogueNavState): void;
    /**
     * 교역 패널의 내용을 갈아끼운다.
     * 게임이 물자 수치를 만들고, 씬은 그리기만 한다.
     */
    renderTrade(html: string): void;
    /** 교역 패널을 감춘다. */
    hideTrade(): void;
    /** 결과줄에 한 줄 띄운다. */
    showResult(message: string): void;
    /**
     * 창과 그 닫기 버튼을 돌려준다 — 최상위 오버레이 순회(Esc 처리)가 이걸 본다.
     * 창을 직접 만지지 않고도 "열려 있는가/닫을 수 있는가" 를 알 수 있다.
     */
    surface(): DialogueSurface;
    /** 선물 아이템 목록을 등록한다(게임 데이터). */
    setGiftItems(items: readonly DialogueGiftItem[]): void;
}

/** 연쇄 대화 내비게이션 표시 — 게임이 결정하고 씬이 그린다. */
export interface DialogueNavState {
    /** 계속 화살표를 살려 두고 흔든다(다음 장면이 있을 때). */
    readonly canAdvance: boolean;
    /** ◀ 버튼을 살려 둔다(뒤로 갈 장면이 있을 때). */
    readonly canGoBack: boolean;
    /** 페이지 표시(예: "방문 2"). 빈 문자열이면 표시를 비운다. */
    readonly pageLabel: string;
}

/** 오버레이 순회가 필요한 최소한의 창 정보. */
export interface DialogueSurface {
    readonly panel: HTMLElement;
    readonly closeButton: HTMLElement;
}

/**
 * 진행도 판정 — 씬 밖에서 상태를 들여다볼 때 쓴다(E2E 프로브).
 * 씬 내부와 같은 규칙을 쓴다(규칙이 두 벌이면 서로 어긋난다).
 */
function isDone(state: { readonly cursor: number; readonly total: number } | null): boolean {
    return state === null || state.cursor >= state.total;
}

/** 씬 밖에서 쓰는 진행도 판정 — 위와 같은 규칙. */
export function isRevealDone(state: { readonly cursor: number; readonly total: number } | null): boolean {
    return isDone(state);
}

type El = HTMLElement;

function must<T extends Element>(root: ParentNode, selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`대화창 요소가 없습니다: ${selector}`);
    return found;
}
/**
 * 대화창을 만든다. 핸들러 등록도 여기서 끝난다.
 * @param root `#dialogue-modal` 요소(또는 이를 포함하는 컨테이너)
 */
export function createDialogueScene(root: ParentNode, hooks: DialogueSceneHooks = {}): DialogueScene {
    const modal = root instanceof Element && root.id === 'dialogue-modal'
        ? (root as HTMLElement)
        : must<HTMLElement>(root, '#dialogue-modal');
    // 나머지 요소는 '창 안에 있다'는 전제를 기준으로 찾는다.
    // root 가 body 여도, dialogue-modal 여도 결과가 같아야 한다.
    const stage = must<HTMLElement>(modal, '.dlg-stage');
    const title = must<El>(modal, '#dialogue-title');
    const text = must<El>(modal, '#dialogue-text');
    const notes = must<El>(modal, '#dialogue-notes');
    const detail = must<El>(modal, '#dialogue-detail');
    const choices = must<El>(modal, '#dialogue-choices');
    const result = must<El>(modal, '#dialogue-result');
    const stepLabel = must<El>(modal, '#dialogue-progress-label');
    const pageLabel = must<El>(modal, '#dialogue-page');
    const prevBtn = must<HTMLButtonElement>(modal, '#dialogue-prev');
    const nextBtn = must<HTMLButtonElement>(modal, '#dialogue-next');
    /** 하단 이동 바 — hideFooter 페이지에서 숨긴다. 없으면(구 고정본) 그냥 둔다. */
    const foot = modal.querySelector<HTMLElement>('.dlg-foot');
    const closeBtn = must<HTMLButtonElement>(modal, '#dialogue-close');
    /** 본문 왼쪽 작은 화상 — speakerId 실존 무장일 때만 씬이 채운다. 없으면(구 고정본) 그냥 둔다. */
    const speakerFace = modal.querySelector<HTMLElement>('#dlg-speaker-face');
    const bandSpeaker = modal.querySelector<El>('#dlg-band-speaker');
    const leftFigure = must<El>(modal, '#dlg-left-figure');
    const rightFigure = must<El>(modal, '#dlg-right-figure');
    const leftName = must<El>(modal, '#dlg-left-name');
    const rightName = must<El>(modal, '#dlg-right-name');
    const leftOrg = must<El>(modal, '#dlg-left-org');
    const rightOrg = must<El>(modal, '#dlg-right-org');
    const leftRank = must<El>(modal, '#dlg-left-rank');
    const rightRank = must<El>(modal, '#dlg-right-rank');
    const placePortrait = modal.querySelector<El>('#dlg-place-portrait');
    const history = modal.querySelector<El>('#dialogue-history');
    const trade = modal.querySelector<El>('#dialogue-trade');
    const cont = modal.querySelector<HTMLButtonElement>('#dlg-continue');

    let state: DialogueSceneState | null = null;
    let transcript: TranscriptEntry[] = [];
    let transcriptTopIndex = -1;
    let pendingAfter: (() => void) | null = null;
    let reveal: { cursor: number; total: number } | null = null;
    let revealTimer: ReturnType<typeof setInterval> | null = null;
    /** 무조작 자동 종료 타이머 — 열려 있는 동안만 돈다. */
    let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
    let revealSource = '';
    let forceInstant = false;
    let giftItems: readonly DialogueGiftItem[] = [];
    /** 마지막으로 밀어넣은 페이지 표시 — 스크립트 노드가 갈 때 다시 그려지도록 기억한다. */
    let pageLabel_ = '';
    /** steps 모드에서 현재 드러난 조각 인덱스 */
    let revealStep = 0;
    /** steps 모드에서 본문이 마지막 조각까지 드러났는가 */
    let bodyDone = false;
    /** 선택 확정 모드에서 고른 선택지 id — ▶ 가 확정할 때까지 보관한다. */
    let selectedChoiceId: string | null = null;
// ------------------------------------------------------------ 기록 / 타이포그래피

    function resetTranscript(): void {
        transcript = [];
        transcriptTopIndex = -1;
        if (history) { history.innerHTML = ''; history.style.display = 'none'; }
    }

    function renderTranscript(): void {
        if (!history) return;
        history.innerHTML = renderTranscriptHtml(transcript);
        history.style.display = transcript.length >= 2 ? 'block' : 'none';
    }

    function recordTranscript(speaker: string, body: string): void {
        const entry = createTranscriptEntry(speaker, body);
        if (!entry) return;
        transcript = [...transcript, entry];
        renderTranscript();
    }

    function typewriterOn(): boolean {
        if (forceInstant) return false;
        return hooks.typewriter?.() ?? false;
    }

    function stopRevealTimer(): void {
        if (revealTimer === null) return;
        clearInterval(revealTimer);
        revealTimer = null;
    }

    function stopAutoClose(): void {
        if (autoCloseTimer === null) return;
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
    }

    /** 자동 종료 타이머를 처음부터 다시 잰다. 닫혀 있으면 아무 일도 하지 않는다. */
    function pokeAutoClose(): void {
        stopAutoClose();
        if (!state) return;
        const ms = state.pages[state.index]?.autoCloseMs ?? AUTO_CLOSE_MS;
        if (ms <= 0) return;
        autoCloseTimer = setTimeout(() => { close(); }, ms);
    }

    /** 글자를 다 보여준다. 이번에 실제로 건너뛰었으면 true. */
    function skipReveal(): boolean {
        if (!reveal || isDone(reveal)) return false;
        reveal = completeReveal(reveal);
        stopRevealTimer();
        text.textContent = renderReveal(revealSource, reveal);
        return true;
    }

    function startReveal(body: string): void {
        stopRevealTimer();
        revealSource = body;
        const { total } = planReveal(body, 0);
        reveal = createRevealMachine(total);
        if (!typewriterOn() || total === 0) {
            reveal = completeReveal(reveal);
            text.textContent = renderReveal(body, reveal);
            return;
        }
        text.textContent = '';
        revealTimer = setInterval(() => {
            if (!reveal) { stopRevealTimer(); return; }
            reveal = advanceReveal(reveal, 2);
            text.textContent = renderReveal(revealSource, reveal);
            if (isDone(reveal)) stopRevealTimer();
        }, REVEAL_INTERVAL_MS);
    }

    // ------------------------------------------------------------ 무대

    function syncPlaceGlyph(side: 'left' | 'right', visible: boolean): void {
        const fig = side === 'left' ? leftFigure : rightFigure;
        const slot = fig.closest('.dlg-slot') as HTMLElement | null;
        if (slot) slot.dataset.glyph = visible ? '1' : '0';
    }

    function setSlotName(side: 'left' | 'right', value: string): void {
        (side === 'left' ? leftName : rightName).textContent = value;
        if (side === 'left' && bandSpeaker) bandSpeaker.textContent = value;
    }

    function paintSlot(side: 'left' | 'right', spec: {
        speaker: string; officerId?: string; placeMark?: string; org?: string; rank?: string; speakerPortrait?: boolean;
    }): void {
        const fig = side === 'left' ? leftFigure : rightFigure;
        const slot = fig.closest('.dlg-slot') as HTMLElement | null;
        const orgEl = side === 'left' ? leftOrg : rightOrg;
        const rankEl = side === 'left' ? leftRank : rightRank;
        // 자리를 채울 상대가 없으면 슬롯을 비운다 — 빈 자리에 표식이 서 있으면 이상하다.
        if (!spec.officerId && !spec.placeMark) {
            fig.classList.remove('dlg-place');
            fig.innerHTML = '';
            setSlotName(side, '');
            orgEl.textContent = '';
            rankEl.textContent = '';
            if (slot) slot.dataset.empty = '1';
            return;
        }
        if (slot) delete slot.dataset.empty;
        const officer = spec.officerId ? hooks.lookupOfficer?.(spec.officerId) ?? null : null;
        if (officer) {
            fig.classList.remove('dlg-place');
            fig.innerHTML = hooks.renderPortrait?.({
                id: officer.id, name: officer.name, gender: officer.gender,
                grade: Math.max(0, Math.min(9, officer.rank)),
            }) ?? '';
            setSlotName(side, officer.name);
            orgEl.textContent = officer.factionName;
            rankEl.textContent = officer.status === 'FREE' ? '재야' : `${officer.rank}품`;
            if (side === 'left') stage.style.setProperty('--dlg-accent', officer.factionColor);
            if (side === 'left' && placePortrait) placePortrait.innerHTML = '';
            syncPlaceGlyph(side, false);
            return;
        }
        // 시설·장소 등 사람이 아닌 화자
        fig.classList.add('dlg-place');
        fig.textContent = spec.placeMark ?? '址';
        setSlotName(side, spec.speaker);
        orgEl.textContent = spec.org ?? '';
        rankEl.textContent = spec.rank ?? '';
        if (side === 'left' && placePortrait) {
            placePortrait.innerHTML = spec.speakerPortrait && hooks.renderPortrait
                ? hooks.renderPortrait({ id: `place_${spec.placeMark ?? '址'}`, name: spec.speaker, gender: 'M', grade: 4 })
                : '';
        }
        syncPlaceGlyph(side, !spec.speakerPortrait);
    }

    function paintStage(page: DialogueScenePage): void {
        paintSlot('left', {
            speaker: page.speaker,
            officerId: page.speakerId,
            placeMark: page.placeMark,
            org: page.subtitle,
            speakerPortrait: page.speakerPortrait,
        });
        paintSlot('right', {
            speaker: page.rightSpeaker ?? '',
            officerId: page.rightOfficerId,
            placeMark: page.rightPlaceMark,
            org: page.rightOrg,
        });
        // 세력 색은 판 전체를 칠하지 않고 테두리/강조에만 쓴다.
        if (!page.speakerId) stage.style.setProperty('--dlg-accent', '#4a5160');
    }

    // ------------------------------------------------------------ 선물 구성기

    function renderGiftComposer(gift: NonNullable<DialogueScenePage['giftComposer']>): void {
        choices.insertAdjacentHTML('beforeend',
            '<div class="gift-composer" data-gift-composer>'
            + '<div class="gift-composer-title">선물 구성</div>'
            + '<label class="gift-row gift-row-wide"><span class="gift-label">아이템</span>'
            + `<select data-gift-item>${giftItems.map(i => `<option value="${i.id}">${i.name} · ${i.gradeLabel} (+${i.affinity})</option>`).join('')}</select>`
            + '</label>'
            + '<label class="gift-row"><span class="gift-label">금화</span>'
            + '<input data-gift-gold type="number" min="0" step="100" value="200" inputmode="numeric" /></label>'
            + '<div class="gift-preview" data-gift-preview aria-live="polite"></div>'
            + '<button class="dlg-choice gift-send-choice" data-gift-send>'
            + '<span class="dlg-choice-idx">✦</span><span class="dlg-choice-label">선물 보내기</span>'
            + '<span class="dlg-choice-desc">선택한 구성으로 우호도 상승</span></button>'
            + '</div>');
        const giftRoot = choices.querySelector('[data-gift-composer]');
        if (!giftRoot) return;
        const itemSel = giftRoot.querySelector('[data-gift-item]') as HTMLSelectElement;
        const goldInput = giftRoot.querySelector('[data-gift-gold]') as HTMLInputElement;
        const preview = giftRoot.querySelector('[data-gift-preview]') as HTMLElement;
        const update = (): void => {
            const item = giftItems.find(i => i.id === itemSel.value) ?? { name: '', gradeLabel: '', affinity: 0 };
            const gold = Math.max(0, Math.floor(Number(goldInput.value) || 0));
            const delta = item.affinity + Math.min(30, Math.floor(gold / 100));
            const after = Math.max(-100, Math.min(100, gift.currentAffinity + delta));
            preview.innerHTML = `<span>${item.name} · ${item.gradeLabel}</span>`
                + `<b>금화 +${delta - item.affinity}</b>`
                + `<strong>예상 우호도 ${gift.currentAffinity >= 0 ? '+' : ''}${gift.currentAffinity} → ${after >= 0 ? '+' : ''}${after} (+${delta})</strong>`;
        };
        itemSel.addEventListener('input', update);
        goldInput.addEventListener('input', update);
        update();
    }

    // ------------------------------------------------------------ 그리기

    function renderPage(): void {
        if (!state) return;
        const page = state.pages[state.index];
        if (!page) return;
        title.textContent = page.title;
        paintStage(page);
        // 본문 왼쪽 작은 화상 — speakerId 실존 무장일 때만 채운다.
        if (speakerFace) {
            const faceOfficer = page.speakerId ? hooks.lookupOfficer?.(page.speakerId) ?? null : null;
            const faceSvg = faceOfficer && hooks.renderPortrait
                ? hooks.renderPortrait({
                    id: faceOfficer.id, name: faceOfficer.name, gender: faceOfficer.gender,
                    grade: Math.max(0, Math.min(9, faceOfficer.rank)),
                })
                : '';
            speakerFace.innerHTML = faceSvg;
            speakerFace.style.display = faceSvg !== '' ? '' : 'none';
        }

        if (page.steps && page.steps.length > 0) {
            // 단계 모드: 현재 단계 하나만 보여준다. 클릭·◀▶ 로 교체한다(누적하지 않는다).
            text.textContent = page.steps[revealStep - 1] ?? '';
            notes.textContent = '';
            notes.style.display = 'none';
            bodyDone = revealStep >= page.steps.length;
        } else {
            const sep = page.text.indexOf('\n\n');
            if (sep >= 0) {
                startReveal(page.text.slice(0, sep));
                notes.textContent = page.text.slice(sep + 2);
                notes.style.display = 'block';
            } else {
                startReveal(page.text);
                notes.textContent = '';
                notes.style.display = 'none';
            }
            bodyDone = true;
        }
        // TTS: 화면 조각이 아니라 통으로 읽는다 — 소리가 끊겨 들리면 안 된다.
        // 단계 모드에서는 지금 보여준 단계만 읽는다.
        const speechSource = page.steps && page.steps.length > 0
            ? (page.steps[revealStep - 1] ?? '')
            : page.text;
        hooks.speak?.({ speaker: page.speaker, text: planReveal(speechSource, 0).spoken });

        detail.innerHTML = (page.detail ?? []).map(line => `<span>${line}</span>`).join('');
        detail.style.display = page.detail && page.detail.length > 0 ? 'grid' : 'none';
        stepLabel.textContent = page.steps && page.steps.length > 0
            ? `대화 ${revealStep} / ${page.steps.length}`
            : (state.pages.length > 1 ? `단계 ${state.index + 1} / ${state.pages.length}` : '');

        choices.innerHTML = (page.choicePrompt ? `<div class="dlg-choice-prompt">${page.choicePrompt}</div>` : '')
            + (page.choices ?? []).map((choice, i) =>
            `<button class="dlg-choice" data-choice="${choice.id}" ${choice.disabled ? 'disabled' : ''}>`
            + `<span class="dlg-choice-idx">${i + 1}</span>`
            + `<span class="dlg-choice-label">${choice.label}</span>`
            + `<span class="dlg-choice-desc">${choice.description}</span></button>`).join('');
        if (page.giftComposer) renderGiftComposer(page.giftComposer);

        result.style.display = 'none';
        result.textContent = '';
        // 단계 모드에서는 ◀▶ 가 장면이 아니라 대화 단계를 옮긴다.
        const hasSteps = !!(page.steps && page.steps.length > 0);
        prevBtn.disabled = hasSteps ? revealStep <= 1 : state.index <= 0;
        nextBtn.disabled = hasSteps ? revealStep >= page.steps.length : state.index >= state.pages.length - 1;
        // hideFooter 장면에서는 하단 바째로 숨긴다 — 본문 클릭·키보드로 이동한다.
        if (foot) foot.style.display = page.hideFooter ? 'none' : '';
        // 연쇄 대화는 게임이 '방문 N' 같은 자체 표시를 밀어넣는다 — 덮어쓰면 안 된다.
        // 단계 모드에서는 푸터 표시도 대화 단계(1/3·2/3·3/3)를 따른다.
        pageLabel.textContent = pageLabel_ !== ''
            ? pageLabel_
            : (hasSteps ? `${revealStep} / ${page.steps.length}` : `${state.index + 1} / ${state.pages.length}`);
        if (cont) {
            if (page.selectChoice) {
                // 선택 확정 모드: ▶ 는 '고른 선택지를 확정' 하는 버튼이다.
                // 고르기 전엔 잠겨 있고, 단계 대사를 다 봐야 살린다.
                const ready = selectedChoiceId !== null && (bodyDone || !hasSteps);
                cont.disabled = !ready;
                cont.classList.toggle('dlg-bouncing', ready);
            } else if (pageLabel_ === '') {
                cont.disabled = true;
                cont.classList.remove('dlg-bouncing');
            }
        }
        // 단계 사이를 오가도 고른 선택지는 유지한다 — 다시 표시한다.
        if (page.selectChoice && selectedChoiceId) {
            const sel = choices.querySelector(`[data-choice="${selectedChoiceId}"]`) as HTMLButtonElement | null;
            if (sel && !sel.disabled) sel.classList.add('dlg-choice-selected');
        }

        // 지나온 장면을 기록에 싣는다.
        // 앞 페이지가 통째로 누락되지 않도록 0..index 를 순서대로 돌며 쌓는다.
        // 되돌아가기(◀)로는 늘어나지 않으므로 같은 장면이 중복 담기지 않는다.
        for (let i = transcriptTopIndex + 1; i <= state.index; i++) {
            const past = state.pages[i];
            if (past) recordTranscript(past.speaker, past.text);
        }
        if (state.index > transcriptTopIndex) transcriptTopIndex = state.index;
        renderTranscript();
    }

    // ------------------------------------------------------------ 전이

    function open(next: DialogueSceneState, opts?: OpenSceneOptions): void {
        if (next.pages.length === 0) return;
        state = next;
        // 새 대화면 기록을 비운다.
        // 연쇄 대화(keepTranscript)는 기록을 이어받되, 방금 열 창은 '새 대사의 시작' 이다.
        // transcriptTopIndex 를 -1 로 되돌리면 그 장면이 또 쌓여 중복된다.
        if (!opts?.keepTranscript) {
            resetTranscript();
            transcriptTopIndex = -1;
        }
        revealStep = 1;
        bodyDone = false;
        selectedChoiceId = null;
        renderPage();
        modal.style.display = 'flex';
        modal.focus({ preventScroll: true });
        pokeAutoClose();
    }

    function close(): void {
        const onClose = state?.onClose;
        state = null;
        modal.style.display = 'none';
        // 연쇄 대화가 밀어넣은 표시를 지운다 — 다음 대화에 '방문 N' 이 남으면 안 된다.
        pageLabel_ = '';
        if (cont) { cont.disabled = true; cont.classList.remove('dlg-bouncing'); }
        // 타이포그래피 타이머와 음성을 반드시 정리한다.
        // 남겨두면 다음 대화가 열렸는데 옛 대사가 깜빡이거나 읽힌다.
        stopRevealTimer();
        reveal = null;
        revealSource = '';
        stopAutoClose();
        stopSpeech();
        resetTranscript();
        onClose?.();
        // 큐를 먼저 비운다 — queued() 안에서 새 대화가 열려 그쪽이 다시 닫힐 때
        // 같은 큐를 두 번 실행하지 않게 하기 위함이다.
        const queued = pendingAfter;
        if (queued) { pendingAfter = null; queued(); }
    }

    function step(delta: 1 | -1): void {
        if (!state) return;
        const page = state.pages[state.index];
        if (page?.steps && page.steps.length > 0) {
            // 단계 모드: ◀▶ 는 장면이 아니라 대화 단계를 옮긴다.
            const next = Math.max(1, Math.min(revealStep + delta, page.steps.length));
            if (next === revealStep) return;
            revealStep = next;
            bodyDone = revealStep >= page.steps.length;
            renderPage();
            return;
        }
        if (delta === 1 && state.index >= state.pages.length - 1) return;
        if (delta === -1 && state.index <= 0) return;
        state = { ...state, index: state.index + delta };
        renderPage();
    }

    /** 선택 확정 뒤 다음 장면으로 넘어간다. 단계 모드를 무시하고 장면을 옮긴다. */
    function advancePage(): void {
        if (!state) return;
        if (state.index >= state.pages.length - 1) return;
        state = { ...state, index: state.index + 1 };
        renderPage();
    }

    // ------------------------------------------------------------ 핸들러 (한 번만 등록)

    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
    closeBtn.addEventListener('click', () => close());
    // 창 안의 모든 조작이 무조작 타이머를 리셋한다.
    modal.addEventListener('pointerdown', () => pokeAutoClose());
    if (cont) cont.addEventListener('click', () => {
        if (cont.disabled) return;
        const page = state?.pages[state.index];
        if (page?.selectChoice && selectedChoiceId) {
            // 선택 확정: 고른 선택지의 onSelect 를 실행한다.
            const choice = page.choices?.find((item: DialogueSceneChoice) => item.id === selectedChoiceId);
            if (!choice) return;
            const message = choice.onSelect?.() ?? '';
            transcript = recordChoice(transcript, choice.label, message);
            renderTranscript();
            selectedChoiceId = null;
            choices.querySelectorAll('.dlg-choice-selected').forEach(b => b.classList.remove('dlg-choice-selected'));
            if (choice.advanceOnConfirm) {
                // ▶ 확정 뒤 다음 화면으로 넘어간다.
                advancePage();
                return;
            }
            if (message) {
                result.textContent = message;
                result.style.display = 'block';
            }
            // 확정한 선택지는 다시 눌리지 않는다 (중복 실행 방지).
            const done = choices.querySelector(`[data-choice="${choice.id}"]`) as HTMLButtonElement | null;
            if (done) done.disabled = true;
            cont.disabled = true;
            cont.classList.remove('dlg-bouncing');
            return;
        }
        step(1);
    });
    // 대사 본문을 클릭하면 글자를 다 보여준다(가상Novel 관습).
    text.addEventListener('click', () => {
        if (!state) { skipReveal(); return; }
        const page = state.pages[state.index];
        if (!page) { skipReveal(); return; }
        // 닫기 전용 인사말 — 볼 것도 고를 것도 없으면 클릭이 곧 닫기다.
        if (page.dismissOnClick) { close(); return; }
        if (page.steps && page.steps.length) {
            const next = Math.min(revealStep + 1, page.steps.length);
            if (next === revealStep) return; // 마지막 단계에선 멈춘다
            revealStep = next;
            bodyDone = revealStep >= page.steps.length;
            renderPage();
            return;
        }
        skipReveal();
    });

    modal.addEventListener('keydown', (event) => {
        if (!state) return;
        pokeAutoClose();
        const t = event.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        // 스페이스/엔터: 글자가 다 안 나왔으면 먼저 끝낸다.
        if (event.key === ' ' || event.key === 'Enter') {
            if (skipReveal()) { event.preventDefault(); return; }
            // 단계 모드: 스페이스/엔터로 다음 단계로. 버튼에 포커스가 있으면 버튼이 먼저 처리한다.
            const page = state.pages[state.index];
            if (page?.steps && page.steps.length > 0 && revealStep < page.steps.length
                && t?.tagName !== 'BUTTON') {
                revealStep += 1;
                bodyDone = revealStep >= page.steps.length;
                renderPage();
                event.preventDefault();
                return;
            }
            // 선택 확정 모드: 단계를 다 보이고 선택이 있으면 스페이스/엔터가 ▶ 확정과 같다.
            if (page?.selectChoice && selectedChoiceId && (bodyDone || !(page.steps && page.steps.length > 0))
                && t?.tagName !== 'BUTTON') {
                cont?.click();
                event.preventDefault();
                return;
            }
        }
        if (event.key === 'ArrowRight') {
            if (nextBtn.disabled) return;
            event.preventDefault(); nextBtn.click(); return;
        }
        if (event.key === 'ArrowLeft') {
            if (prevBtn.disabled) return;
            event.preventDefault(); prevBtn.click(); return;
        }
        if (!/^[1-9]$/.test(event.key)) return;
        const buttons = choices.querySelectorAll<HTMLButtonElement>('.dlg-choice:not([data-gift-send])');
        const target = buttons[Number(event.key) - 1];
        if (!target || target.disabled) return;
        event.preventDefault();
        target.click();
    });

    if (trade) {
        trade.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            const buyBtn = target.closest('[data-trade-buy]') as HTMLElement | null;
            if (buyBtn) { hooks.runTrade?.(buyBtn.dataset.tradeBuy!, 'buy'); return; }
            const sellBtn = target.closest('[data-trade-sell]') as HTMLElement | null;
            if (sellBtn) { hooks.runTrade?.(sellBtn.dataset.tradeSell!, 'sell'); return; }
        });
    }

    choices.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (!state) return;
        const giftSend = target.closest('[data-gift-send]') as HTMLButtonElement | null;
        if (giftSend) {
            const gift = state.pages[state.index]?.giftComposer;
            if (!gift || !hooks.sendGift) return;
            const giftRoot = giftSend.closest('[data-gift-composer]');
            if (!giftRoot) return;
            const itemId = (giftRoot.querySelector('[data-gift-item]') as HTMLSelectElement).value;
            const gold = Math.max(0, Math.floor(Number((giftRoot.querySelector('[data-gift-gold]') as HTMLInputElement).value) || 0));
            const outcome = hooks.sendGift({ actorId: gift.actorId, targetId: gift.targetId, itemId, gold });
            result.textContent = outcome.message;
            result.style.display = 'block';
            if (outcome.ok) { hooks.log?.(outcome.message); hooks.refreshOfficer?.(gift.targetId); }
            return;
        }
        const button = target.closest('.dlg-choice') as HTMLButtonElement | null;
        if (!button || button.disabled) return;
        const page = state.pages[state.index];
        const choice = page.choices?.find((item: DialogueSceneChoice) => item.id === button.dataset.choice);
        if (!choice) return;
        if (page.selectChoice) {
            // 선택 확정 모드: 고르기만 한다. 실행은 ▶(계속) 에서 한다.
            selectedChoiceId = choice.id;
            choices.querySelectorAll('.dlg-choice').forEach(b =>
                b.classList.toggle('dlg-choice-selected', b === button));
            const ready = bodyDone || !(page.steps && page.steps.length > 0);
            if (cont) { cont.disabled = !ready; cont.classList.toggle('dlg-bouncing', ready); }
            return;
        }
        if (!choice.onSelect) return;
        const message = choice.onSelect();
        result.textContent = message;
        result.style.display = 'block';
        // 방금 고른 선택과 결과를 기록 마지막 줄에 남긴다.
        transcript = recordChoice(transcript, choice.label, message);
        renderTranscript();
        button.disabled = true;
    });

    return {
        open,
        close,
        isOpen: () => state !== null,
        currentPage: () => (state ? state.pages[state.index] ?? null : null),
        queueAfterClose: (fn: () => void) => { pendingAfter = fn; },
        queueAfterCloseChained: (fn: () => void) => {
            const previous = pendingAfter;
            pendingAfter = () => { previous?.(); fn(); };
        },
        clearQueuedClose: () => { pendingAfter = null; },
        setForceInstant: (on: boolean) => { forceInstant = on; },
        isRevealDone: () => isDone(reveal),
        revealProgress: () => reveal,
        setGiftItems: (items: readonly DialogueGiftItem[]) => { giftItems = items; },
        setNavState: ({ canAdvance, canGoBack, pageLabel: label }) => {
            if (cont) {
                cont.disabled = !canAdvance;
                cont.classList.toggle('dlg-bouncing', canAdvance);
            }
            prevBtn.disabled = !canGoBack;
            pageLabel_ = label;
            pageLabel.textContent = label;
        },
        renderTrade: (html: string) => {
            if (!trade) return;
            trade.innerHTML = html;
            trade.style.display = html === '' ? 'none' : 'flex';
        },
        hideTrade: () => {
            if (!trade) return;
            trade.innerHTML = '';
            trade.style.display = 'none';
        },
        showResult: (message: string) => {
            result.textContent = message;
            result.style.display = 'block';
        },
        surface: () => ({ panel: modal, closeButton: closeBtn }),
    };
}
