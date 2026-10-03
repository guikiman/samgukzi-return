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
    /** 선물 아이템 목록을 등록한다(게임 데이터). */
    setGiftItems(items: readonly DialogueGiftItem[]): void;
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
    const closeBtn = must<HTMLButtonElement>(modal, '#dialogue-close');
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
    let revealSource = '';
    let forceInstant = false;
    let giftItems: readonly DialogueGiftItem[] = [];
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

        const sep = page.text.indexOf('\n\n');
        if (sep >= 0) {
            // 타이포그래피는 대사만 조금씩 드러낸다 — 참고는 정보이므로 한 번에 보여준다.
            startReveal(page.text.slice(0, sep));
            notes.textContent = page.text.slice(sep + 2);
            notes.style.display = 'block';
        } else {
            startReveal(page.text);
            notes.textContent = '';
            notes.style.display = 'none';
        }
        // TTS: 화면 조각이 아니라 통으로 읽는다 — 소리가 끊겨 들리면 안 된다.
        hooks.speak?.({ speaker: page.speaker, text: planReveal(page.text, 0).spoken });

        detail.innerHTML = (page.detail ?? []).map(line => `<span>${line}</span>`).join('');
        detail.style.display = page.detail && page.detail.length > 0 ? 'grid' : 'none';
        stepLabel.textContent = state.pages.length > 1 ? `단계 ${state.index + 1} / ${state.pages.length}` : '';

        choices.innerHTML = (page.choices ?? []).map((choice, i) =>
            `<button class="dlg-choice" data-choice="${choice.id}" ${choice.disabled ? 'disabled' : ''}>`
            + `<span class="dlg-choice-idx">${i + 1}</span>`
            + `<span class="dlg-choice-label">${choice.label}</span>`
            + `<span class="dlg-choice-desc">${choice.description}</span></button>`).join('');
        if (page.giftComposer) renderGiftComposer(page.giftComposer);

        result.style.display = 'none';
        result.textContent = '';
        prevBtn.disabled = state.index <= 0;
        nextBtn.disabled = state.index >= state.pages.length - 1;
        pageLabel.textContent = `${state.index + 1} / ${state.pages.length}`;
        if (cont) { cont.disabled = true; cont.classList.remove('dlg-bouncing'); }

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
        renderPage();
        modal.style.display = 'flex';
        modal.focus({ preventScroll: true });
    }

    function close(): void {
        const onClose = state?.onClose;
        state = null;
        modal.style.display = 'none';
        // 타이포그래피 타이머와 음성을 반드시 정리한다.
        // 남겨두면 다음 대화가 열렸는데 옛 대사가 깜빡이거나 읽힌다.
        stopRevealTimer();
        reveal = null;
        revealSource = '';
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
        if (delta === 1 && state.index >= state.pages.length - 1) return;
        if (delta === -1 && state.index <= 0) return;
        state = { ...state, index: state.index + delta };
        renderPage();
    }

    // ------------------------------------------------------------ 핸들러 (한 번만 등록)

    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
    closeBtn.addEventListener('click', () => close());
    if (cont) cont.addEventListener('click', () => { if (!cont.disabled) step(1); });
    // 대사 본문을 클릭하면 글자를 다 보여준다(가상Novel 관습).
    text.addEventListener('click', () => { skipReveal(); });

    modal.addEventListener('keydown', (event) => {
        if (!state) return;
        const t = event.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        // 스페이스/엔터: 글자가 다 안 나왔으면 먼저 끝낸다.
        if (event.key === ' ' || event.key === 'Enter') {
            if (skipReveal()) { event.preventDefault(); return; }
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
        if (!choice?.onSelect) return;
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
    };
}
