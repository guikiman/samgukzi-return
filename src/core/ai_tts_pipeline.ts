/**
 * [D37] AI TTS 파이프라인 — Text-to-Speech Pipeline
 *
 * TTSEngine:
 *   1. Web Speech API 래퍼 (SpeechSynthesis)
 *   2. 대사 큐 관리 (DialogueQueue)
 *   3. 음성 속도/피치/볼륨 제어
 *   4. 한국어/중국어/일본어 음성 지원
 *   5. 대사 우선순위 및 인터럽트 처리
 */

export interface TTSVoiceConfig {
    readonly rate: number;
    readonly pitch: number;
    readonly volume: number;
}

export interface TTSDialogue {
    readonly id: string;
    readonly text: string;
    readonly speaker: string;
    readonly lang: 'ko-KR' | 'zh-CN' | 'ja-JP';
    readonly priority: number;
    readonly timestamp: number;
}

export type QueueState = 'PENDING' | 'SPEAKING' | 'COMPLETED' | 'CANCELLED';

export interface TTSQueueItem {
    readonly dialogue: TTSDialogue;
    state: QueueState;
}

export interface TTSState {
    readonly isSpeaking: boolean;
    readonly queueLength: number;
    readonly currentDialogue: TTSDialogue | null;
    readonly history: TTSDialogue[];
}

export class AITTSPipeline {
    private queue: TTSQueueItem[] = [];
    private currentItem: TTSQueueItem | null = null;
    private history: TTSDialogue[] = [];
    private speechSynthesis: SpeechSynthesis | null = null;
    private voiceCache: Map<string, SpeechSynthesisVoice> = new Map();
    private _isSpeaking = false;

    private readonly LANG_VOICE_MAP: Record<string, string> = {
        'ko-KR': 'ko-KR',
        'zh-CN': 'zh-CN',
        'ja-JP': 'ja-JP',
    };

    get isSpeaking(): boolean {
        return this._isSpeaking || (this.speechSynthesis?.speaking ?? false);
    }

    init(): boolean {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            return false;
        }
        this.speechSynthesis = window.speechSynthesis;
        this.cacheVoices();
        return true;
    }

    private cacheVoices(): void {
        const voices = this.speechSynthesis!.getVoices();
        for (const voice of voices) {
            for (const lang of Object.values(this.LANG_VOICE_MAP)) {
                if (voice.lang.startsWith(lang)) {
                    if (!this.voiceCache.has(lang)) {
                        this.voiceCache.set(lang, voice);
                    }
                }
            }
        }
    }

    getAvailableVoices(): SpeechSynthesisVoice[] {
        if (!this.speechSynthesis) return [];
        return this.speechSynthesis.getVoices();
    }

    speak(text: string, lang: 'ko-KR' | 'zh-CN' | 'ja-JP' = 'ko-KR', config?: Partial<TTSVoiceConfig>): boolean {
        if (!this.speechSynthesis) return false;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = config?.rate ?? 1.0;
        utterance.pitch = config?.pitch ?? 1.0;
        utterance.volume = config?.volume ?? 1.0;
        const voice = this.voiceCache.get(lang);
        if (voice) utterance.voice = voice;
        this.speechSynthesis.speak(utterance);
        return true;
    }

    speakDialogue(dialogue: TTSDialogue): boolean {
        return this.speak(dialogue.text, dialogue.lang);
    }

    enqueueDialogue(dialogue: TTSDialogue): void {
        this.queue.push({
            dialogue,
            state: 'PENDING',
        });
    }

    processQueue(): number {
        let processed = 0;
        while (this.queue.length > 0 && !this._isSpeaking) {
            const item = this.queue.shift()!;
            this.currentItem = item;
            item.state = 'SPEAKING';
            this._isSpeaking = true;
            this.speak(item.dialogue.text, item.dialogue.lang);
            item.state = 'COMPLETED';
            this.history.push(item.dialogue);
            this.currentItem = null;
            this._isSpeaking = false;
            processed++;
        }
        return processed;
    }

    cancelAll(): void {
        if (this.speechSynthesis) {
            this.speechSynthesis.cancel();
        }
        for (const item of this.queue) {
            item.state = 'CANCELLED';
        }
        this.queue = [];
        this.currentItem = null;
        this._isSpeaking = false;
    }

    pause(): void {
        if (this.speechSynthesis?.speaking) {
            this.speechSynthesis.pause();
        }
    }

    resume(): void {
        if (this.speechSynthesis?.paused) {
            this.speechSynthesis.resume();
        }
    }

    getState(): TTSState {
        return {
            isSpeaking: this.isSpeaking,
            queueLength: this.queue.length,
            currentDialogue: this.currentItem?.dialogue ?? null,
            history: [...this.history],
        };
    }

    clearHistory(): void {
        this.history = [];
    }
}

/* ============================================================
   대화 음성 연동 — 씬 → TTS 어댑터
   ============================================================ */

/**
 * 왜 이 래퍼가 따로 있는가:
 * - `AITTSPipeline` 은 어디에서도 인스턴스화되지 않았다(고아 코드).
 *   그대로 main.ts 에 붙이면 화면 코드와 음성 코드가 한 덩어리로 굳는다.
 * - 이 래퍼는 '대화 한 줄'을 읽으라는 요구만 표현한다. 큐·음성 목록·언어 선택을
 *   밖으로 내보내지 않는다. 나중에 음성을 갈아끼울 때 이 파일만 바꾸면 된다.
 *
 * 알려진 결함 (기존 `processQueue` 의 문제):
 * - `processQueue()` 는 while 루프 안에서 `_isSpeaking` 을 true 로 세우고 바로 false 로
 *   돌려놓기 때문에, **큐에 몇 개를 넣어도 한 번에 '전부 처리'된 것처럼** 돌아간다.
 *   실제로 소리가 나가는지와 무관하게 큐가 비워진다.
 * - 여기서는 그 함수를 쓰지 않는다. 한 줄씩 `speakLine` 으로 읽는다.
 */

/** SpeechSynthesis 이 이 브라우저/환경에 있는지 확인한다. */
export function isSpeechSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

export interface SpeakLineInput {
    /** 화면에 있는 화자 이름 — 읽지 않는다(중복 방지). */
    readonly speaker: string;
    /** 읽을 대사. 화면 조각이 아니라 **전체 문장**이어야 한다. */
    readonly text: string;
}

/**
 * 화면 대사를 음성으로 읽는다.
 *
 * 규칙:
 * - 사용자가 끄면 아무것도 하지 않는다(기본값이 꺼짐이다).
 * - SpeechSynthesis 를 못 쓰는 환경이면 조용히 실패한다(게임은 계속 돌아간다).
 * - 텍스트가 비면 읽지 않는다.
 * - 직전 읽기가 남아 있으면 먼저 끊는다 — 대화가 바뀌었는데 옛말이 계속 들리면 안 된다.
 *
 * @returns 실제로 읽기를 시도했으면 true
 */
export function speakLine(input: SpeakLineInput, enabled: boolean): boolean {
    if (!enabled) return false;
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (text === '') return false;
    if (!isSpeechSupported()) return false;
    try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ko-KR';
        // 삼국지 톤에 맞게 조금 느리게, 조금 낮게 읽는다.
        utterance.rate = 0.95;
        utterance.pitch = 0.9;
        synth.speak(utterance);
        return true;
    } catch {
        // 음성 엔진을 못 쓰는 환경이어도 대화는 계속돼야 한다.
        return false;
    }
}

/** 지금 읽는 것을 멈춘다. 대화가 닫힐 때 부른다. */
export function stopSpeech(): void {
    if (!isSpeechSupported()) return;
    try {
        window.speechSynthesis.cancel();
    } catch {
        // 무시 — 멈추지 못해도 게임은 계속된다.
    }
}
