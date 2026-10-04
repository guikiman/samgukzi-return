/**
 * 삼국지리턴 — 브라우저 엔트리 포인트
 *
 * GameEngine + BootstrapContext 초기화,
 * Canvas 렌더링 루프, UI 바인딩.
 */

import { GameEngine, getGameEngine } from './core/game_engine.js';
import { BootstrapContext, getBootstrap } from './core/bootstrap.js';
import { HexMapCanvasRenderer, HexTile } from './core/hex_map_canvas_renderer.js';
import { ChinaMapRenderer, MapCityView } from './core/china_map_renderer.js';
import { City3DRenderer, type CityBuilding, dayNightPhase, generateDecorations } from './core/city_3d_renderer.js';
import { createAmbientTicker, shouldRedrawAmbient, CITY_AMBIENT_INTERVAL_MS, type AmbientTicker } from './core/city_ambient_loop.js';
import { CITY_SCENE_ART_PATH, anchorFor, clampAnchorToCover, mapAnchorToStage, resolveVisibleAnchor, separateOverlaps, toStageInset, isVisibleRect, renderStatBar, type SceneInset } from './core/city_scene_art.js';
import { mergeCityAndFreeOfficers, isFreeOfficer, isFreeOfficerInCity, officerRoleLabel } from './core/city_officer_roster.js';
import { BattleFrontend, DeployableUnit, BattlePhase } from './core/battle_frontend.js';
import { TitleScreen } from './core/title_screen.js';
import { loadScenarios, getCachedScenarios, buildWorld, getKnownOfficerName, resolveProtagonistId } from './core/scenario_system.js';
import type { BuiltWorld, ScenarioData } from './core/scenario_system.js';
import {
    buildTribeRoster, tribesNearCity, quoteGrainForGold, grainPricePerUnit,
    requestGrainAid, requestTroopAid, demandRetraction, tradeGrainForGold, tradeGoldForGrain,
    troopAidPayout, activeDemands,
} from './core/migration_tribe_system.js';
import type { TribeState, MapFeature } from './core/types.js';
import {
    createCourt, isAudienceCity, checkAudienceEligibility, judgeAudience,
    createMission, respondToMission, MISSION_SPECS,
} from './core/imperial_audience_system.js';
import {
    startSiege, checkSiegeEligibility,
    DEFAULT_SIEGE_MONTHS, SIEGE_MIN_COMMIT_TROOPS,
} from './core/map_feature_siege_system.js';
import { buildCustomOfficerWorld, validateCustomOfficer, rollCustomStats, hashSeed, buildExistingOfficerWorld } from './core/custom_officer_start.js';
import { evaluateScenarios, playableScenarios } from './core/officer_editor_scenarios.js';
import type { EditableOfficer } from './core/officer_editor_scenarios.js';
import { searchRoster, countRoster, toEditable, randomProfile } from './core/officer_roster_picker.js';
import { getOfficerProfile } from './core/officer_profile_schema.js';
import { randomField, rollWholeOfficer } from './core/officer_editor_random.js';
import type { EditorField } from './core/officer_editor_random.js';
import { renderPortraitSvg } from './core/officer_portrait.js';
import { renderRadarSvg } from './core/officer_radar.js';
import { composeDialogue, composeResponse } from './core/dialogue_composer.js';
import type { DialogueTopic } from './core/dialogue_composer.js';
import {
    ScriptRunner,
    buildMarketScript,
    buildTradeOffer,
    buildTradeScript,
    hasTradePost,
} from './core/dialogue_script.js';
import type { DialogueEffect, ScriptNode, TradeOfferRow } from './core/dialogue_script.js';
import { MonthlyReportSystem } from './core/monthly_report.js';
// 턴 실행 트레이스 패널 렌더러 [디버그] — 번호가 붙은 트리를 HTML 로
import { renderTraceTreeHtml } from './ui/turn_trace_panel.js';
import { assembleReinforcements } from './core/reinforcement_system.js';
import { garrisonCap, computeRecruitGain } from './core/faction_ai_monthly.js';
import { SaveSlotManager } from './core/save_slot_manager.js';
import type { SlotId } from './core/save_slot_manager.js';
import { FactionRelation } from './core/diplomacy_engine.js';
import type { DiplomacyEngine } from './core/diplomacy_engine.js';
import { processBattleSpoils } from './core/battle_spoils_system.js';
import { BattleCommand } from './core/command_system.js';
// [312] 전투 리플레이 URL 공유 / [309] 모드 창작 마당 / [303] 다중 탭 뮤텍스
import { ReplayShareManager } from './core/replay_share_manager.js';
import type { ReplayActionLog, ReplayCommandEvent } from './core/replay_share_manager.js';
import { ReplayViewer } from './core/replay_viewer.js';
import { ReplaySpeedControls } from './ui/replay_speed_controls.js';
import { RuntimeModLoader } from './core/runtime_mod_loader.js';
import { MultiTabMutexCoordinator } from './core/multi_tab_mutex_coordinator.js';
import { checkInteraction, executeInteraction, getAffinityBetween, GIFT_ITEMS, calculateGiftAffinity, type GiftItemId, type GiftOptions } from './core/officer_interaction_system.js';
import { ConversationSystem } from './core/conversation_system.js';
import { shouldInspectAtGate, resolveGateChoice, gateBribeCost, gateSneakThreshold } from './core/city_gate_system.js';
import { describeTravelPlan } from './core/travel_transport.js';
import type { GateChoiceId } from './core/city_gate_system.js';
import { StrategicOptionSystem } from './core/strategic_option_system.js';
import type { DialogueContext } from './core/dialogue_engine.js';
// [Auth/officers] 정적 도장 데이터 연결 — 이름으로만 조회한다(동명이인 73그룹 안전).
import {
    resolveOfficerIdByName,
    getBridgeDossierParagraphs,
} from './core/officer_biography_bridge.js';
import { OFFICER_PROFILES } from './core/officer_profile_schema.js';
import { judgeVengeanceOnly, startVengeanceGame, finishVengeance, tryVengeanceOnEncounter, applyVengeanceToUnits } from './core/vengeance_system.js';
import * as vengeance_system from './core/vengeance_system.js';
import * as free_officer_visit_system from './core/free_officer_visit_system.js';
import * as captive_escape_system from './core/captive_escape_system.js';
import * as roaming_event_system from './core/roaming_event_system.js';
// 로밍 대화 + 재야 방문 시스템 [25][461-480]
import { getRoamingDialogue, resolveRoamingDialogue, type RoamingDialogueData } from './core/roaming_dialogue_system.js';
import {
    type DialogueSceneState, type DialogueScenePage, type DialogueSceneChoice,
    type OpenSceneOptions,
} from './core/dialogue_transcript.js';
import {
    createDialogueScene, isRevealDone,
} from './ui/scenes/dialogue_scene.js';
import { speakLine, stopSpeech } from './core/ai_tts_pipeline.js';

// 게임이 결정하고, 화면은 씬이 그린다.
// 여기서 더 이상 대화창의 DOM 을 직접 만지지 않는다.
/** 이전 이름 호환 — 씬 타입이 화면 구현을 그대로 물려받았다. */
type DialogueChoice = DialogueSceneChoice;
type DialoguePage = DialogueScenePage;
type DialogueState = DialogueSceneState;
import { acceptVisit, declineVisit, type FreeOfficerVisit } from './core/free_officer_visit_system.js';
import { getReputationDiplomacyModifier, describeReputationModifier } from './core/reputation_effect_system.js';
import { getLeaderReputationVisual, getOfficerReputationVisual } from './core/reputation_visuals.js';
import { EventFeedbackEffects, type FeedbackKind } from './core/event_feedback_effects.js';
import { ChronicleManager } from './core/chronicle_system.js';
import { resolveCityClimateRegion } from './core/monthly_report.js';
import { computeVagrantStrength } from './core/vagrant_monthly_actions.js';
import { DIFFICULTY_MULTIPLIERS } from './core/difficulty_balance_system.js';
// [2026-10-03 제거] 튜토리얼·온보딩 안내를 완전 삭제했다(사용자 요청).
//   없어진 것: 첫 플레이 자동 안내, 「❓ 도움말」버튼(H), 안내 패널, 스포트라이트.
//   함께 사라진 파일: core/tutorial_system.ts · core/onboarding_state.ts ·
//   ui/onboarding_panel.ts · data/onboarding_copy.json (+ 테스트 5종).
//   "설정"(a11y-panel)과 관계망 그래프는 안내가 아니라 기능이라 그대로 남겼다.
import { RelationshipGraphViewer } from './core/relationship_graph_viewer.js';
import {
    loadAccessibilitySettings, saveAccessibilitySettings, accessibilityAttributes,
    renderAccessibilityPanel, type AccessibilitySettings,
} from './core/accessibility_system.js';
import {
    convertFactionColor, factionSymbol, factionBadgeStyle,
    COLORBLIND_MODE_LABELS, PATTERN_LABELS, PATTERN_OPTIONS,
    type ColorblindMode, type PatternOption,
} from './core/colorblind_palette.js';
import { computeSettlement, diffSettlement } from './core/settlement_summary_system.js';
// 연대기 인스턴스는 engine 초기화 이후 참조 (hoisting 회피용 래퍼)
const engineRef: { current: import('./core/game_engine.js').GameEngine | null } = { current: null };
import { DuelMinigame } from './core/duel_minigame.js';
import type { DebateMinigame } from './core/debate_minigame.js';
import {
    shouldTriggerRuffian,
    buildThugStats,
    applyRuffianDuelOutcome,
    applyRuffianBribe,
    RUFFIAN_BRIBE_COST,
} from './core/ruffian_event_system.js';
import { getCaptivesInCity } from './core/captive_escape_system.js';
import { FacilityType, type CityBuildingState, type OfficerID, type CityID } from './core/types.js';
import type { GameStore } from './core/game_store.js';
import { DomesticTaskType } from './core/domestic_scheduler.js';
// [Auth] 계약 + 백엔드 스토어 + UI 흐름을 조립하는 통합 글루
import { bootstrapAuth, type AuthRuntime } from './integration/auth_bootstrap.js';
import type { AuthChangeEvent, AuthSession } from './auth/contracts.js';

// ============================================================
// DOM References
// ============================================================

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const turnDisplay = document.getElementById('turn-display')!;
const dateDisplay = document.getElementById('date-display')!;
const statusText = document.getElementById('status-text')!;
const fpsDisplay = document.getElementById('fps-display')!;
const logContent = document.getElementById('log-content')!;
const officerDetail = document.getElementById('officer-detail')!;
const factionDetail = document.getElementById('faction-detail')!;
/**
 * 일시정지 버튼의 아이콘·이름·제목을 한 번에 바꾼다.
 * 상단 바가 아이콘 전용(2026-09-30)이므로 textContent 를 쓰면 아이콘이 지워진다.
 */
function setPauseButton(paused: boolean): void {
    btnPause.dataset.icon = paused ? '▶' : '⏸';
    btnPause.setAttribute('aria-label', paused ? '재개' : '일시정지');
    btnPause.title = paused ? '재개 (P)' : '일시정지 (P)';
}

const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const btnSlots = document.getElementById('btn-slots') as HTMLButtonElement;
const btnBattle = document.getElementById('btn-battle') as HTMLButtonElement;
const btnMapVisibility = document.getElementById('btn-map-visibility') as HTMLButtonElement;
const btnReport = document.getElementById('btn-report') as HTMLButtonElement;
const btnDiplomacy = document.getElementById('btn-diplomacy') as HTMLButtonElement;
const btnNextMonth = document.getElementById('btn-next-month') as HTMLButtonElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const btnAuth = document.getElementById('btn-auth') as HTMLButtonElement;
const btnGraph = document.getElementById('btn-graph') as HTMLButtonElement;
const btnTrace = document.getElementById('btn-trace') as HTMLButtonElement;

// ============================================================
// Engine State
// ============================================================

let engine: GameEngine;
let bootstrap: BootstrapContext;
let isRunning = false;
const conversationSystem = new ConversationSystem();

// [312] 전투 리플레이 기록기 — 전투마다 초기화, 액션을 실시간 누적
const replayManager = new ReplayShareManager();
// [309] 모드 창작 마당 — 엔진 초기화 후 store 주입 (init에서 설정)
let modLoader: RuntimeModLoader | null = null;
// [303] 다중 탭 세이브 뮤텍스 — 세이브 전 락 획득, 데드락/충돌 방지
const mutexCoordinator = new MultiTabMutexCoordinator();
let isPaused = false;
let animFrameId: number | null = null;
let lastFrameTime = 0;
let frameCount = 0;
let fpsTimer = 0;
let currentFps = 0;

// ============================================================
// Hex Map State
// ============================================================

let hexRenderer: HexMapCanvasRenderer;
let chinaMap: ChinaMapRenderer;
let worldCities: MapCityView[] = [];
/** [49] 방문한 도시와 현재 플레이어 세력 도시를 지도에서 발견 상태로 관리한다. */
const visitedCityIds = new Set<string>();
type CityVisibilityMode = 'all' | 'discovered';
let cityVisibilityMode: CityVisibilityMode = 'all';
let hexTiles: HexTile[] = [];
let isDragging = false;
let activePointerId: number | null = null;
let dragMoved = false;
let dragStartX = 0;
let dragStartY = 0;
let selectedHex: { q: number; r: number } | null = null;

// ============================================================
// Battle State
// ============================================================

let battleFrontend: BattleFrontend;
let isBattleMode = false;

// 이벤트 연출 [191-200] — 흔들림 + 합성 사운드
const feedbackEffects = new EventFeedbackEffects();
let ctxRestorePending = false;

/** 게임 이벤트에 맞는 연출 발화 */
function fireFeedback(kind: FeedbackKind): void {
    feedbackEffects.fire(kind);
}

// ============================================================
// Logging
// ============================================================

function addLog(msg: string): void {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
}

/** 배관 메시지 — 기록창이 아니라 개발자 콘솔로. 단, 오류는 반드시 addLog 를 쓴다. */
function debugLog(msg: string): void {
    console.debug(`[samgukzi] ${msg}`);
}

// ============================================================
// 복수 미니게임 모달 [32][33] — 플레이어 관여 일기토/설전
// ============================================================

interface VengeanceModalState {
    store: import('./core/game_store.js').GameStore;
    actorId: string;
    targetId: string;
    kind: 'DUEL' | 'DEBATE';
    game: DuelMinigame | DebateMinigame;
    enemyUnits: import('./core/vengeance_system.js').VengeanceUnit[];
    deployable: DeployableUnit[];
    done: boolean;
    /** 설정되면 복수 후처리 대신 호출된다 (불량배 결투 등). */
    onFinish?: (actorWon: boolean) => void;
    /** 결투 모달을 닫을 때 이어서 실행한다 (시장 대화 복귀 등). */
    afterClose?: (() => void) | null;
}

let vmState: VengeanceModalState | null = null;

function openVengeanceModal(
    store: import('./core/game_store.js').GameStore,
    actorId: string,
    targetId: string,
    kind: 'DUEL' | 'DEBATE',
    deployable: DeployableUnit[],
    enemyUnits: import('./core/vengeance_system.js').VengeanceUnit[],
): void {
    const game = startVengeanceGame(store, actorId, targetId, kind);
    vmState = { store, actorId, targetId, kind, game, enemyUnits, deployable, done: false };

    const modal = document.getElementById('vengeance-modal')!;
    const actor = store.getOfficer(actorId)!;
    const target = store.getOfficer(targetId)!;
    document.getElementById('vm-title')!.textContent = kind === 'DUEL' ? '復讐 — 단기접전' : '復讐 — 설전';
    document.getElementById('vm-subtitle')!.textContent = `${actor.name}의 복수 — 원수 ${target.name} 조우`;
    document.getElementById('vm-player-name')!.textContent = actor.name;
    document.getElementById('vm-enemy-name')!.textContent = target.name;
    document.getElementById('vm-close')!.style.display = 'none';
    modal.style.display = 'flex';
    addLog(`⚔️ 복수의 기회! ${actor.name}이(가) 원수 ${target.name}을(를) 조우했습니다`);
    renderVengeanceModal();
}

function renderVengeanceModal(): void {
    if (!vmState) return;
    const { kind, game } = vmState;
    const logEl = document.getElementById('vm-log')!;
    const cardsEl = document.getElementById('vm-cards')!;

    if (kind === 'DUEL') {
        const s = (game as DuelMinigame).getState();
        setVmBar('player', s.playerHp, s.playerMaxHp);
        setVmBar('enemy', s.enemyHp, s.enemyMaxHp);
        document.getElementById('vm-player-num')!.textContent = `HP ${s.playerHp}/${s.playerMaxHp}`;
        document.getElementById('vm-enemy-num')!.textContent = `HP ${s.enemyHp}/${s.enemyMaxHp}`;
        document.getElementById('vm-player-spirit')!.textContent = `氣 ${'◆'.repeat(Math.max(0, s.playerSpirit))}`;
        logEl.innerHTML = s.log.map(l => `<div class="vm-log-line">${l}</div>`).join('');
        logEl.scrollTop = logEl.scrollHeight;

        if (s.phase === 'DONE') {
            finishVengeanceModal((game as DuelMinigame).getWinner() === vmState.actorId);
            return;
        }
        const cards = (game as DuelMinigame).getAvailableCards(s.playerSpirit);
        cardsEl.innerHTML = cards.map(c =>
            `<button class="vm-card" data-card="${c.type}" ${c.spiritCost > s.playerSpirit ? 'disabled' : ''}>
                <span class="vm-card-label">${c.label}${c.spiritCost > 0 ? ` (氣${c.spiritCost})` : ''}</span>
                <span class="vm-card-desc">${c.description}</span>
            </button>`).join('');
    } else {
        const s = (game as DebateMinigame).getState();
        setVmBar('player', Math.max(0, s.playerScore), 100);
        setVmBar('enemy', Math.max(0, s.enemyScore), 100);
        document.getElementById('vm-player-num')!.textContent = `논점 ${Math.max(0, s.playerScore)}`;
        document.getElementById('vm-enemy-num')!.textContent = `논점 ${Math.max(0, s.enemyScore)}`;
        document.getElementById('vm-player-spirit')!.textContent = `氣 ${'◆'.repeat(Math.max(0, s.playerSpirit))}`;
        logEl.innerHTML = s.log.map(l => `<div class="vm-log-line">${l}</div>`).join('');
        logEl.scrollTop = logEl.scrollHeight;

        if (s.phase === 'DONE') {
            const result = (game as DebateMinigame).getDebateResult();
            finishVengeanceModal(result.winner === vmState.actorId);
            return;
        }
        const cards = (game as DebateMinigame).getAvailableCards(s.playerSpirit, s.playerMood);
        cardsEl.innerHTML = cards.map(c =>
            `<button class="vm-card" data-card="${c.type}" ${c.spiritCost > s.playerSpirit ? 'disabled' : ''}>
                <span class="vm-card-label">${c.label}${c.spiritCost > 0 ? ` (氣${c.spiritCost})` : ''}</span>
                <span class="vm-card-desc">${c.description}</span>
            </button>`).join('');
    }
}

function setVmBar(side: 'player' | 'enemy', value: number, max: number): void {
    const bar = document.getElementById(`vm-${side}-bar`)!;
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    bar.style.width = `${pct}%`;
}

function finishVengeanceModal(actorWon: boolean): void {
    if (!vmState || vmState.done) return;
    vmState.done = true;
    const { store, actorId, targetId, kind, enemyUnits, onFinish } = vmState;

    if (onFinish) {
        onFinish(actorWon);
    } else {
        finishVengeancePath(store, actorId, targetId, actorWon, vmState.deployable);
    }

    // 종료 로그
    const logEl = document.getElementById('vm-log')!;
    const resultLine = kind === 'DUEL'
        ? (actorWon ? '🏆 단기접전 승리!' : '💀 단기접전 패배...')
        : (actorWon ? '🏆 설전 승리!' : '💀 설전 패배...');
    logEl.innerHTML += `<div class="vm-log-line"><b>${resultLine}</b></div>`;
    document.getElementById('vm-cards')!.innerHTML = '';
    document.getElementById('vm-close')!.style.display = 'inline-block';
}

function finishVengeancePath(
    store: import('./core/game_store.js').GameStore,
    actorId: string,
    targetId: string,
    actorWon: boolean,
    deployable: DeployableUnit[],
): void {
    // 후처리: 우호도 + 명성 [C-인간관계][11]
    const outcome = finishVengeance(store, actorId, targetId, actorWon);
    addLog(outcome.message);
    // 연출 [191-200] — 성패에 따른 흔들림 + 사운드
    fireFeedback(actorWon ? 'VENGEANCE_SUCCESS' : 'VENGEANCE_FAIL');

    // 복수 성공 시 전투 유닛 임팩트 [32][131-145] — 적군 사기 − / 아군 사기 + / 주도자 공격 보정
    if (outcome.targetMoraleHit > 0 || outcome.success) {
        const state = vmState;
        const impact = applyVengeanceToUnits(outcome, deployable, state?.enemyUnits ?? []);
        if (impact.enemyLog) addLog('🪫 적군 병력 사기가 크게 흔들립니다!');
        if (impact.allyLog) addLog(impact.allyLog);
    }
}

// 카드 클릭 — 플레이어 선택으로 턴 진행
document.getElementById('vm-cards')!.addEventListener('click', (e) => {
    if (!vmState || vmState.done) return;
    const btn = (e.target as HTMLElement).closest('.vm-card') as HTMLElement | null;
    if (!btn || btn.hasAttribute('disabled')) return;
    const card = btn.dataset.card;
    if (!card) return;
    if (vmState.kind === 'DUEL') {
        (vmState.game as DuelMinigame).playCard(card as never);
    } else {
        (vmState.game as DebateMinigame).playCard(card as never);
    }
    renderVengeanceModal();
});

document.getElementById('vm-close')!.addEventListener('click', () => {
    const after = vmState?.afterClose ?? null;
    document.getElementById('vengeance-modal')!.style.display = 'none';
    vmState = null;
    if (after) after();
});

// ============================================================
// 로밍 이벤트 대화 모달 [25][461-480] — 방문객 응대 선택지
// ============================================================
interface RoamingModalState {
    data: RoamingDialogueData;
    cityId: string;
    resolved: boolean;
}
let rmState: RoamingModalState | null = null;

function openRoamingModal(cityId: string, visitorType: string, cityName: string, factionName: string | null): void {
    rmState = { data: getRoamingDialogue(visitorType, cityName, factionName), cityId, resolved: false };
    const modal = document.getElementById('roaming-modal')!;
    document.getElementById('rm-title')!.textContent = rmState.data.title;
    document.getElementById('rm-description')!.textContent = rmState.data.description;
    renderRoamingOptions();
    document.getElementById('rm-result')!.style.display = 'none';
    document.getElementById('rm-close')!.style.display = 'none';
    modal.style.display = 'flex';
}

function renderRoamingOptions(): void {
    if (!rmState) return;
    const optsEl = document.getElementById('rm-options')!;
    optsEl.innerHTML = rmState.data.options.map(o =>
        `<button class="rm-option" data-option="${o.id}">
            <span class="rm-option-label">${o.label}</span>
            <span class="rm-option-desc">${o.description}</span>
        </button>`).join('');
}

function finishRoamingOption(optionId: string): void {
    if (!rmState || rmState.resolved) return;
    rmState.resolved = true;
    const engineNow = engine!;
    const storeNow = engineNow['store'] as import('./core/game_store.js').GameStore;
    const resolution = resolveRoamingDialogue(storeNow, rmState.data.visitorType, rmState.cityId, optionId);
    addLog(resolution.message);
    // 연출 — 산적 진압 실패/약탈 계열은 경고 톤, 나머지는 밝은 톤 [191-200]
    fireFeedback(rmState.data.visitorType === 'BANDIT' && optionId !== 'suppress' ? 'VENGEANCE_FAIL' : 'RESCUE');

    const optsEl = document.getElementById('rm-options')!;
    optsEl.innerHTML = '';
    const resultEl = document.getElementById('rm-result')!;
    resultEl.textContent = resolution.message + (resolution.effects.length ? `  (${resolution.effects.join(', ')})` : '');
    resultEl.style.display = 'block';
    document.getElementById('rm-close')!.style.display = 'inline-block';
}

document.getElementById('rm-options')!.addEventListener('click', (e) => {
    if (!rmState || rmState.resolved) return;
    const btn = (e.target as HTMLElement).closest('.rm-option') as HTMLElement | null;
    if (!btn) return;
    finishRoamingOption(btn.dataset.option ?? '');
});

document.getElementById('rm-close')!.addEventListener('click', () => {
    document.getElementById('roaming-modal')!.style.display = 'none';
    rmState = null;
    // 대기열의 다음 재야 방문 모달 표시 [461-480]
    if (pendingVisits.length > 0) {
        openVisitModal(pendingVisits[0]);
    }
});

// 재야 무장 출사 타진 — 플레이어 세력 도시 방문 시 선택 모달 [24][421-440]
let pendingVisits: FreeOfficerVisit[] = [];

// 연대기 관리자 [Y-메타][441-460] — 엔진 내장 인스턴스 게으른 참조 (세이브에 포함됨)
const chronicle = {
    add(kind: import('./core/chronicle_system.js').ChronicleKind, text: string): void {
        engineRef.current?.chronicle.add(kind, text);
    },
    list() { return engineRef.current?.chronicle.list() ?? []; },
};

// 월말 정산 요약 [E1-361][461-480] — 이전 스냅샷 대비 증감 패널
let prevSettlement: import('./core/settlement_summary_system.js').SettlementReport | null = null;
let latestSettlement: import('./core/settlement_summary_system.js').SettlementReport | null = null;

function updateSettlementPanel(): void {
    const engine = engineRef.current;
    if (!engine) return;
    const report = computeSettlement(engine['store']);
    const gs = engine['store'].getGlobalState();
    const pid = gs.playerFactionId;
    const mine = report.factions.find(f => f.factionId === pid);
    if (mine) {
        const prevMine = prevSettlement?.factions.find(f => f.factionId === pid);
        const d = diffSettlement(prevMine, mine);
        const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toLocaleString()}`;
        addLog(
            `💰 정산 — 金 ${mine.gold.toLocaleString()} (${fmt(d.gold)}) · 穀 ${mine.food.toLocaleString()} (${fmt(d.food)})` +
            ` · 兵 ${mine.troops.toLocaleString()} (${fmt(d.troops)}) · 무장 ${mine.officerCount} (${fmt(d.officerCount)})` +
            ` · 월수입 金${mine.goldIncome}/穀${mine.foodIncome}`
        );
    }
    prevSettlement = report;
    latestSettlement = report;
}

/** 정산 패널 렌더 — 세력 비교 표 (수입/국고/병력/증감) [E1-361][461-480] */
function renderSettlementPanel(): void {
    const el = document.getElementById('settlement-content');
    const engine = engineRef.current;
    if (!el || !engine) return;
    if (!latestSettlement) {
        // 첫 턴 전이라도 현재 상태를 즉시 산출해 표시
        latestSettlement = computeSettlement(engine['store']);
    }
    const gs = engine['store'].getGlobalState();
    const pid = gs.playerFactionId;
    const rows = latestSettlement.factions.map(f => {
        const prevF = prevSettlement && prevSettlement !== latestSettlement
            ? prevSettlement.factions.find(x => x.factionId === f.factionId)
            : undefined;
        const d = diffSettlement(prevF, f);
        const isPlayer = f.factionId === pid;
        const delta = (v: number) => v === 0 ? '<span class="st-delta zero">-</span>'
            : `<span class="st-delta ${v > 0 ? 'up' : 'down'}">${v > 0 ? '▲' : '▼'}${Math.abs(v).toLocaleString()}</span>`;
        return `<tr class="${isPlayer ? 'st-player' : ''}">` +
            `<td class="st-name">${isPlayer ? '👑 ' : ''}${f.factionName}</td>` +
            `<td>${f.cityCount}</td>` +
            `<td>${f.gold.toLocaleString()}${delta(d.gold)}</td>` +
            `<td>${f.food.toLocaleString()}${delta(d.food)}</td>` +
            `<td>${f.goldIncome}</td>` +
            `<td>${f.troops.toLocaleString()}${delta(d.troops)}</td>` +
            `<td>${f.officerCount}${delta(d.officerCount)}</td>` +
            `<td>${f.avgMorale}</td></tr>`;
    }).join('');
    el.innerHTML =
        `<div class="st-title">💰 ${latestSettlement.year}년 ${latestSettlement.month}월 정산 (턴 ${latestSettlement.turn})</div>` +
        `<table class="st-table"><thead><tr>` +
        `<th>세력</th><th>도시</th><th>국고</th><th>병량</th><th>월수입</th><th>병력</th><th>무장</th><th>사기</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>` +
        `<div class="st-note">▲▼ = 지난달 대비 증감 · 턴이 지나야 증감이 집계됩니다</div>`;
}

/** 연대기 탭 렌더 — 최신순으로 아이콘+연도+문구 표시 */
// 연대기 필터 상태 [Y-메타][441-460]
let chronicleKindFilter: string | null = null;
let chronicleFactionFilter: string | null = null;
let chronicleCollapsedYears = new Set<number>();

const CHRONICLE_FILTERS: Array<{ kind: string | null; label: string }> = [
    { kind: null, label: '전체' },
    { kind: 'VENGEANCE', label: '⚔️ 복수' },
    { kind: 'FREE_VISIT', label: '🚶 출사' },
    { kind: 'PACT', label: '🤝 결의' },
    { kind: 'RESCUE', label: '🛡️ 구출' },
    { kind: 'CAPTURE', label: '⛓️ 포로' },
    { kind: 'DESTROYED', label: '💀 멸망' },
];

function renderChronicle(): void {
    const el = document.getElementById('chronicle-content');
    if (!el) return;
    const all = chronicle.list();
    if (all.length === 0) {
        el.innerHTML = '<div class="chronicle-empty">아직 기록된 사건이 없다…</div>';
        return;
    }
    // 종별·세력별 필터 적용
    let entries = chronicleKindFilter ? all.filter(e => e.kind === chronicleKindFilter) : all;
    if (chronicleFactionFilter) entries = entries.filter(e => e.factionId === chronicleFactionFilter);
    // 연도별 그룹화 (최신 연도가 위)
    const yearGroups = new Map<number, typeof entries>();
    for (const e of entries) {
        if (!yearGroups.has(e.year)) yearGroups.set(e.year, []);
        yearGroups.get(e.year)!.push(e);
    }
    const majorKinds = new Set(['DESTROYED', 'ENDING', 'RESCUE', 'PACT']);
    const filterChips = CHRONICLE_FILTERS.map(f =>
        `<button class="ch-filter${chronicleKindFilter === f.kind ? ' active' : ''}" data-kind="${f.kind ?? ''}">${f.label}</button>`
    ).join('');
    const factionIds = [...new Set(all.map(e => e.factionId).filter((id): id is string => !!id))];
    const factionChips = factionIds.map(id => {
        const faction = engine?.['store'].getFaction(id);
        return `<button class="ch-filter ch-faction-filter${chronicleFactionFilter === id ? ' active' : ''}" data-faction="${id}">${faction?.name ?? id}</button>`;
    }).join('');
    const groupsHtml = Array.from(yearGroups.entries()).map(([year, list]) => {
        const collapsed = chronicleCollapsedYears.has(year);
        return `<div class="ch-year-group">` +
            `<button class="ch-year-toggle" data-year="${year}">` +
            `<span class="ch-year-arrow">${collapsed ? '▶' : '▼'}</span> ${year}년 <span class="ch-year-count">(${list.length})</span></button>` +
            (collapsed ? '' : list.map(e =>
                `<div class="chronicle-entry${majorKinds.has(e.kind) ? ' ch-major' : ''}">` +
                `<span class="ch-icon">${e.icon}</span>` +
                `<span class="ch-date">${e.month}월</span>` +
                `<span class="ch-text">${e.text}</span></div>`
            ).join('')) +
            `</div>`;
    }).join('');
    el.innerHTML = `<div class="ch-filters">${filterChips}</div>` +
        (factionChips ? `<div class="ch-filters ch-faction-filters">${factionChips}</div>` : '') +
        (entries.length === 0 ? '<div class="chronicle-empty">해당 조건의 기록이 없다…</div>' : groupsHtml);
}

// 연대기 필터 칩 + 연도 토글 이벤트 위임
document.getElementById('chronicle-content')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const factionChip = target.closest('.ch-faction-filter') as HTMLElement | null;
    if (factionChip) {
        const factionId = factionChip.dataset.faction || null;
        chronicleFactionFilter = chronicleFactionFilter === factionId ? null : factionId;
        renderChronicle();
        return;
    }
    const chip = target.closest('.ch-filter') as HTMLElement | null;
    if (chip) {
        const kind = chip.dataset.kind || null;
        chronicleKindFilter = chronicleKindFilter === kind ? null : kind;
        renderChronicle();
        return;
    }
    const yearBtn = target.closest('.ch-year-toggle') as HTMLElement | null;
    if (yearBtn) {
        const year = Number(yearBtn.dataset.year);
        if (chronicleCollapsedYears.has(year)) chronicleCollapsedYears.delete(year);
        else chronicleCollapsedYears.add(year);
        renderChronicle();
    }
});

// 기록 탭 전환 (로그 ↔ 연대기)
document.getElementById('tab-log')?.addEventListener('click', () => {
    document.getElementById('tab-log')!.classList.add('active');
    document.getElementById('tab-chronicle')!.classList.remove('active');
    document.getElementById('tab-settlement')!.classList.remove('active');
    document.getElementById('log-content')!.style.display = '';
    document.getElementById('chronicle-content')!.style.display = 'none';
    document.getElementById('settlement-content')!.style.display = 'none';
});
document.getElementById('tab-chronicle')?.addEventListener('click', () => {
    document.getElementById('tab-chronicle')!.classList.add('active');
    document.getElementById('tab-log')!.classList.remove('active');
    document.getElementById('tab-settlement')!.classList.remove('active');
    document.getElementById('log-content')!.style.display = 'none';
    document.getElementById('settlement-content')!.style.display = 'none';
    renderChronicle();
    document.getElementById('chronicle-content')!.style.display = '';
});
document.getElementById('tab-settlement')?.addEventListener('click', () => {
    document.getElementById('tab-settlement')!.classList.add('active');
    document.getElementById('tab-log')!.classList.remove('active');
    document.getElementById('tab-chronicle')!.classList.remove('active');
    document.getElementById('log-content')!.style.display = 'none';
    document.getElementById('chronicle-content')!.style.display = 'none';
    renderSettlementPanel();
    document.getElementById('settlement-content')!.style.display = '';
});

function openVisitModal(visit: FreeOfficerVisit): void {
    rmState = null;
    const modal = document.getElementById('roaming-modal')!;
    document.getElementById('rm-title')!.textContent = `🚶 출사 타진 — ${visit.cityName}`;
    // 방문 무장 상세 카드 [461-480] — 입사 판단 근거 제공
    // 이벤트 payload 가 불완전해도 턴을 죽이지 않는다 — 이 핸들러는 executeTurn 의
    // 이벤트 큐 안에서 동기 호출되므로 여기서 던지면 그 달 전체 처리가 중단된다.
    const s = visit.stats
        ?? { leadership: 50, might: 50, intelligence: 50, politics: 50, charisma: 50 };
    const sum = s.leadership + s.might + s.intelligence + s.politics + s.charisma;
    const statBar = (label: string, v: number, max = 100) => {
        const pct = Math.min(100, Math.round((v / max) * 100));
        const tier = v >= 90 ? 'excel' : v >= 75 ? 'great' : v >= 60 ? 'good' : 'avg';
        return `<div class="visit-stat"><span class="visit-stat-label">${label}</span><span class="visit-stat-bar"><span class="visit-stat-fill visit-stat-${tier}" style="width:${pct}%"></span></span><span class="visit-stat-val">${v}</span></div>`;
    };
    document.getElementById('rm-description')!.innerHTML =
        `<div class="visit-card">` +
        `<div class="visit-card-head"><span class="visit-card-name">${visit.officerName}</span>` +
        `<span class="visit-card-tags"><span class="visit-card-tag">${visit.personalityLabel}</span>` +
        `<span class="visit-card-tag">종합 ${sum}</span>` +
        (visit.fame >= 100 ? `<span class="visit-card-tag visit-card-fame">✨ 명성 ${visit.fame}</span>` : '') +
        `</span></div>` +
        `<div class="visit-card-stats">` +
        statBar('統率', s.leadership) + statBar('武力', s.might) + statBar('知力', s.intelligence) + statBar('政治', s.politics) + statBar('魅力', s.charisma) +
        `</div>` +
        `<div class="visit-card-ambition">야망 ${visit.ambition}/100 — ${visit.ambition >= 70 ? '천하에 큰 뜻이 있다' : visit.ambition >= 40 ? '무난한 대장부다' : '조용히 지내기를 바란다'}</div>` +
        `</div>` +
        `"천하가 어지럽으니 명주를 찾아 나서고자 하노라." — 문객의 전언 (수락 시 충성도 ${Math.round(visit.chance * 100)}% 계열 초기화)`;
    const optsEl = document.getElementById('rm-options')!;
    optsEl.innerHTML = `
        <button class="rm-option" data-visit="accept">
            <span class="rm-option-label">🤝 맞이한다</span>
            <span class="rm-option-desc">${visit.officerName} 입사 (충성도 명성 비례)</span>
        </button>
        <button class="rm-option" data-visit="decline">
            <span class="rm-option-label">🚪 사절한다</span>
            <span class="rm-option-desc">재야 유지 — 다음 달 재타진 가능</span>
        </button>`;
    document.getElementById('rm-result')!.style.display = 'none';
    document.getElementById('rm-close')!.style.display = 'none';
    modal.style.display = 'flex';
    (window as any).__pendingVisit = visit;
}

document.getElementById('rm-options')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.rm-option') as HTMLElement | null;
    if (!btn || !btn.dataset.visit) return;
    const visit = (window as any).__pendingVisit as FreeOfficerVisit | undefined;
    if (!visit) return;
    pendingVisits.shift(); // 대기열에서 제거 — 다음 방문 모달이 열릴 수 있도록
    const engineNow = engine!;
    const storeNow = engineNow['store'] as import('./core/game_store.js').GameStore;
    if (btn.dataset.visit === 'accept') {
        acceptVisit(storeNow, visit);
        addLog(visit.message);
        fireFeedback('RESCUE');
    } else {
        declineVisit(visit);
        addLog(visit.message);
    }
    (window as any).__pendingVisit = null;
    const optsEl = document.getElementById('rm-options')!;
    optsEl.innerHTML = '';
    const resultEl = document.getElementById('rm-result')!;
    resultEl.textContent = visit.message;
    resultEl.style.display = 'block';
    document.getElementById('rm-close')!.style.display = 'inline-block';
});

// ============================================================
// Demo Hex Map Data
// ============================================================

function generateDemoHexTiles(): HexTile[] {
    const tiles: HexTile[] = [];
    const radius = 4;

    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            const s = -q - r;
            if (Math.abs(s) > radius) continue;

            const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
            let terrain: string;
            let label: string | undefined;
            let ownerColor: string | undefined;

            if (q === 0 && r === 0) {
                terrain = 'city';
                label = '성도';
                ownerColor = '#e94560';
            } else if (q === 2 && r === -1) {
                terrain = 'city';
                label = '장안';
                ownerColor = '#e94560';
            } else if (q === -2 && r === 1) {
                terrain = 'city';
                label = '허창';
                ownerColor = '#e94560';
            } else if (q === 1 && r === 2) {
                terrain = 'city';
                label = '건업';
                ownerColor = '#e94560';
            } else if (q === -1 && r === -2) {
                terrain = 'city';
                label = '낙양';
                ownerColor = '#e94560';
            } else if (q === 3 && r === -2) {
                terrain = 'city';
                label = '업';
                ownerColor = '#e94560';
            } else if (q === -3 && r === 2) {
                terrain = 'city';
                label = '장안';
                ownerColor = '#e94560';
            } else if (q === 0 && r === 3) {
                terrain = 'city';
                label = '건업';
                ownerColor = '#e94560';
            } else if (q === 0 && r === -3) {
                terrain = 'city';
                label = '북평';
                ownerColor = '#e94560';
            } else if (q === 3 && r === 0) {
                terrain = 'city';
                label = '수춘';
                ownerColor = '#e94560';
            } else if (q === -3 && r === 0) {
                terrain = 'city';
                label = '낙양';
                ownerColor = '#e94560';
            } else if (Math.abs(q) <= 1 && Math.abs(r) <= 1) {
                terrain = 'plain';
            } else if (Math.abs(q) === 2 && Math.abs(r) <= 2) {
                terrain = Math.random() > 0.6 ? 'forest' : 'plain';
            } else if (Math.abs(q) === 3 && Math.abs(r) <= 3) {
                terrain = Math.random() > 0.5 ? 'mountain' : 'forest';
            } else if (Math.abs(q) === 4 && Math.abs(r) <= 4) {
                terrain = Math.random() > 0.4 ? 'water' : 'swamp';
            } else {
                terrain = 'water';
            }

            tiles.push({ q, r, terrain, label, ownerColor });
        }
    }
    return tiles;
}

// ============================================================
// Map Pointer Interaction — 월드: 중국 전도 / 전투: 헥사곤
// Pointer Events를 사용해 마우스·터치·펜 입력을 하나의 경로로 처리한다.
// [461-480] 모바일 터치 팬/도시 선택 대응
// ============================================================

/** 뷰포트 좌표를 캔버스 backing-store 좌표로 변환한다. */
function clientToCanvasPoint(clientX: number, clientY: number): { px: number; py: number } {
    const rect = canvas.getBoundingClientRect();
    return {
        px: (clientX - rect.left) * canvas.width / Math.max(1, rect.width),
        py: (clientY - rect.top) * canvas.height / Math.max(1, rect.height),
    };
}

canvas.addEventListener('pointerdown', (e) => {
    if (activePointerId !== null) return;
    isDragging = true;
    dragMoved = false;
    activePointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 구형 브라우저 무시 */ }
});

canvas.addEventListener('pointermove', (e) => {
    if (activePointerId !== e.pointerId) return;
    const { px, py } = clientToCanvasPoint(e.clientX, e.clientY);

    if (isDragging) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.hypot(dx, dy) > 4) dragMoved = true;
        if (dx !== 0 || dy !== 0) {
            if (isBattleMode) hexRenderer.pan(dx, dy);
            else chinaMap.pan(dx, dy);
        }
        dragStartX = e.clientX;
        dragStartY = e.clientY;
    } else if (!isBattleMode) {
        const city = chinaMap.cityAt(px, py);
        chinaMap.setHoveredCity(city?.id ?? null);
        canvas.style.cursor = city ? 'pointer' : 'default';
    }
});

/** 좌측 정보 단이 마지막으로 고른 도시 id — 두 번 클릭 규칙의 상태. */
let sidebarSelectedCityId: string | null = null;

/**
 * 좌측 정보 단에 도시를 싣는다 — 세력 정보 · 도시 정보 · 무장 목록.
 *
 * [두 번 클릭 규칙]
 * 지도에서 도시를 누르면 먼저 여기가 차고, *같은* 도시를 한 번 더 누르면 그때 진입한다
 * (성문 검문 → 도시 진입). 2026-09-30 사용자 요청. 이전에는 한 번 눌러 바로 진입했는데
 * 그 consequent 아무 도시 정보도 볼 수 없었다.
 */
function renderSidebarCitySelection(cityId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const city = store.getCity(cityId);
    const cityEl = document.getElementById('city-detail');
    const listEl = document.getElementById('city-officers');
    const countEl = document.getElementById('sidebar-officer-count');
    if (!city || !cityEl || !listEl) return;

    const faction = city.ownerId ? store.getFaction(city.ownerId) : null;
    const ds = city.developmentStats;

    factionDetail.textContent = faction
        ? `${faction.name} · 군주 ${store_getOfficerSafe(faction.leaderId)?.name ?? '—'} · 수도 ${faction.capitalCityId ? store.getCity(faction.capitalCityId)?.name ?? '—' : '—'}`
        : '무주공산 — 이 도시는 세력 어느 곳도 점령하지 않았다';

    cityEl.innerHTML = `
        <div class="cdp-faction-name">${city.name}${city.isCapital ? ' 🏯 首都' : ''}</div>
        <div class="cdp-faction-meta">점령 세력 ${faction?.name ?? '무주'}</div>
        <div class="cdp-stat-line">인구 ${city.population.toLocaleString()} · 병력 ${city.development.toLocaleString()} / ${garrisonCap(city).toLocaleString()}</div>
        <div class="cdp-stat-line">자금 ${city.funds.toLocaleString()}金 · 월입 金+${city.goldIncome} · 粮+${city.foodIncome}</div>
        <div class="cdp-stat-line">상업 ${ds.commerce} · 농업 ${ds.farming} · 기술 ${ds.technology} · 치안 ${ds.publicOrder}</div>
        <div class="cdp-stat-line">방어 ${city.defense}/${city.maxDefense} · 충성 ${city.loyalty}</div>
        <div class="cdp-hint">${visitedCityIds.has(cityId) ? '한 번 더 누르면 이 도시로 진입한다' : '미방문 — 한 번 더 누르면 성문 검문'}</div>`;

    const officers = city.officerIds
        .map(id => store_getOfficerSafe(id))
        .filter((o): o is NonNullable<typeof o> => o !== null)
        .sort((a, b) => (b.stats.leadership + b.stats.might) - (a.stats.leadership + a.stats.might));
    if (countEl) countEl.textContent = `(${officers.length})`;
    listEl.innerHTML = officers.length > 0
        ? officers.map(o => `<div class="cdp-officer-row cdp-officer-clickable" data-sidebar-officer="${o.id}">
            <div>
                <div class="cdp-officer-name">${o.name}</div>
                <div class="cdp-officer-stats">統${o.stats.leadership} 武${o.stats.might} 智${o.stats.intelligence}</div>
            </div>
            <span class="cdp-officer-role">${city.ownerId && store.getFaction(city.ownerId)?.leaderId === o.id ? '군주' : o.rank >= 5 ? '장군' : '무관'}</span>
        </div>`).join('')
        : '<div class="cdp-expedition-info">이 도시에 주둔한 무장이 없다</div>';

    listEl.querySelectorAll<HTMLElement>('[data-sidebar-officer]').forEach(row => {
        row.addEventListener('click', () => {
            const id = row.dataset.sidebarOfficer;
            if (id) renderOfficerDetail(id);
        });
    });
}

/** 상단 바 실제 높이를 CSS 변수로 물려 sidebar 가 겹치지 않게 한다. */
function syncSidebarTopOffset(): void {
    const topBar = document.getElementById('top-bar');
    const main = document.getElementById('main-area');
    if (!topBar || !main) return;
    main.style.setProperty('--sidebar-top', `${Math.round(topBar.getBoundingClientRect().height)}px`);
}

function selectCityAtClientPoint(clientX: number, clientY: number): boolean {
    if (isBattleMode) return false;
    const { px, py } = clientToCanvasPoint(clientX, clientY);
    const city = chinaMap.cityAt(px, py);
    for (const c of worldCities) c.isSelected = (c.id === city?.id);
    if (!city) {
        sidebarSelectedCityId = null;
        return false;
    }
    // [2026-10-04] 이동 모드에서는 한 번의 클릭으로 바로 이동한다.
    //   지도 클릭 계약(1회=선적, 2회=진입)은 이동 모드가 아닐 때만 적용된다 —
    //   browser_smoke 가 그 계약을 검증하므로 두 경로를 섞지 않는다.
    if (travelModeActive) {
        if (!city) return false;
        const dest = engine?.['store'].getCity(city.id);
        if (!dest) return false;
        confirmTravelTo(dest);
        return true;
    }
    // 같은 도시를 다시 누른 두 번째 클릭 — 진입(성문 검문 → 도시 진입).
    if (sidebarSelectedCityId === city.id) {
        sidebarSelectedCityId = null;
        return enterCityGate(city.id);
    }
    sidebarSelectedCityId = city.id;
    renderSidebarCitySelection(city.id);
    addLog(`도시 선택: ${city.name}`);
    return true;
}

/** 성문 검문 — 미방문·중립 도시와 적대 도시는 검문 이벤트를 먼저 치른다. */
function enterCityGate(cityId: string): boolean {
    const store = engine['store'];
    const city = store.getCity(cityId);
    if (!city) return false;
    const gs = store.getGlobalState();
    const ownerName = city.ownerId ? store.getFaction(city.ownerId)?.name ?? null : null;
    let atWar = false;
    if (city.ownerId && gs.playerFactionId && city.ownerId !== gs.playerFactionId) {
        try {
            atWar = engine.diplomacyEngine.getRelation(gs.playerFactionId, city.ownerId) === FactionRelation.WAR;
        } catch { atWar = false; }
    }
    const inspection = shouldInspectAtGate({
        cityName: city.name,
        ownerId: city.ownerId,
        ownerName,
        playerFactionId: gs.playerFactionId,
        atWar,
        visited: visitedCityIds.has(cityId),
    });
    if (inspection.kind === 'none') {
        enterCity(cityId);
        return true;
    }
    openGateDialogue(cityId, inspection.kind === 'strict');
    return true;
}

function enterCity(cityId: string): void {
    // [49] 도시를 실제로 방문하면 이후 '발견 도시' 필터에서 계속 visible하다.
    visitedCityIds.add(cityId);
    // [49] 방문 기록을 GlobalState에 즉시 반영해 세이브/로드 후에도 복원한다.
    engine['store'].setGlobalState({
        ...engine['store'].getGlobalState(),
        visitedCityIds: [...visitedCityIds],
    });
    syncChinaMapCities();
    showCityInfo(cityId);
    // 알현과 부족 교섭은 둘 다 대화창을 띄운다. 순서대로 두 번 열면 나중 것이 앞 것을 덮어써서
    // 하나가 통째로 사라진다(황제 도시=세력 수도는 부족 배치지와 겹칠 때가 있다).
    // 알현이 떴으면 그 선택이 끝나고 부족 창을 띄운다.
    if (maybeOpenImperialAudience(cityId)) {
        queueCityWindowsAfterDialogue(cityId);
    } else if (!maybeOpenTribeNegotiation(cityId)) {
        maybeOpenFeatureSiege(cityId);
    } else {
        queueCityWindowsAfterDialogue(cityId, true);
    }
}

/**
 * 알현 창이 닫힌 뒤 이어서 열 도시 창들을 띄운다.
 *
 * @param skipTribe 부족 교섭을 건너뛸 때 true (요충지 출진 창만 연다)
 */
function queueCityWindowsAfterDialogue(cityId: CityID, skipTribe = false): void {
    const run = (): void => {
        if (skipTribe) { maybeOpenFeatureSiege(cityId); return; }
        if (!maybeOpenTribeNegotiation(cityId)) maybeOpenFeatureSiege(cityId);
    };
    // 앞선 대기 콜백이 있으면 먼저 돌린 뒤 우리 것을 건다 — 순서가 뒤집히면 엉뚱한 창이 먼저 열린다.
    queueAfterDialogueChained(run);
}

/** 황제 알현 — 황제가 머무는 도시에서만 열고, 황제가 수락한 뒤 임무를 준다. @returns 창을 띄웠으면 true */
function maybeOpenImperialAudience(cityId: CityID): boolean {
    const store = engine['store'];
    const court = store.getImperialCourt();
    if (!isAudienceCity(court, cityId)) return false;
    const gs = store.getGlobalState();
    const officer = store.getOfficer(gs.selectedOfficerId ?? '')
        ?? (gs.playerFactionId
            ? store.getAllOfficers().find(o => o.factionId === gs.playerFactionId && o.runtime.isAlive)
            : null);
    if (!officer) return false;

    const turn = gs.turnCount;
    if (!checkAudienceEligibility(court, officer, cityId, turn).ok) return false;

    const emperor = court!.emperorName;
    const verdict = judgeAudience(officer);
    store.updateImperialCourt({ lastAudienceTurn: turn });

    if (!verdict.granted) {
        openDialogue({
            pages: [{
                title: `${emperor} 알현 — 거절`,
                speaker: `${emperor}제`,
                placeMark: '漢',
                speakerPortrait: true,
                text: verdict.message,
                choices: [{ id: 'leave', label: '물러난다', description: '알현을 포기한다', onSelect: () => '물러나겠소.' }],
            }],
            index: 0,
        });
        return true;
    }

    const kinds = Object.keys(MISSION_SPECS) as Array<keyof typeof MISSION_SPECS>;
    openDialogue({
        pages: [{
            title: `${emperor} 알현`,
            subtitle: `${officer.name} · 공 ${Math.round(verdict.score)}`,
            speaker: `${emperor}제`,
            placeMark: '漢',
            speakerPortrait: true,
            text: `${verdict.message} 하명이 있다. 한 임무를 맡아라.`,
            choices: [
                ...kinds.map(kind => ({
                    id: `mission_${kind}`,
                    label: MISSION_SPECS[kind].label,
                    description: `${MISSION_SPECS[kind].brief} · ${MISSION_SPECS[kind].durationTurns}개월 내 완료 · 관직 ${MISSION_SPECS[kind].rewardRank} · ${MISSION_SPECS[kind].rewardGold}金`,
                    onSelect: () => {
                        const mission = createMission(kind, officer, cityId, turn, `mission_${officer.id}_${turn}`);
                        store.putAudienceMission(mission);
                        store.updateImperialCourt({ activeMissionId: mission.id });
                        return `「${MISSION_SPECS[kind].label}」 임무를 받았습니다. ${MISSION_SPECS[kind].durationTurns}개월 안에 완수하라.`;
                    },
                })),
                { id: 'decline', label: '사양한다', description: '아무 임무도 받지 않는다', onSelect: () => '사양하였다.' },
            ],
        }],
        index: 0,
    });
    return true;
}

/**
 * 이민족 교섭 — 그 도시에 부족이 머물면 교섭 창을 연다.
 *
 * [E2E 안전]
 * 테스트 훅은 openCity → showCityInfo 로 직접 도시를 열기 때문에 이 경로를 타지 않는다
 * (openCity 훅은 enterCity 를 부르지 않는다). 그래서 지도 클릭/성문 검문 프로브를
 * 건드리지 않는다.
 */
/** @returns 창을 띄웠으면 true */
function maybeOpenTribeNegotiation(cityId: CityID): boolean {
    const store = engine['store'];
    const playerFactionId = store.getGlobalState().playerFactionId;
    if (!playerFactionId) return false;
    // 부족은 세력의 영토가 아니라 '그 도시에 머무는' 주체다. byCity 인덱스가 정답이다.
    const near = store.getTribesByCity(cityId);
    if (near.length === 0) return false;
    const tribeId = near[0].id;
    // 한 달에 한 번만 열린다 — 두 번 열면 지원 을 몇 달이고 받는다.
    if (near[0].negotiatedThisMonth) return false;

    /**
     * 매 선택마다 스토어에서 다시 읽는다.
     *
     * [왜 이렇게 했는가]
     * 교섭 창을 열 때 한 번 읽어 둔 스냅샷을 모든 선택이 공유하면, 한 번 거래한 뒤
     * 우호도·가격·재고가 전부 옛 값으로 계산된다. 실제로 지원/거래를 몇 번씩 받고도
     * 호가가 평생 안 내려가는 버그가 났다. 창은 다시 그리지 않더라도 계산 근거만 최신으로
     * 읽으면 다음 선택이 맞아떨어진다.
     */
    const fresh = (): TribeState => store.getMigrationTribe(tribeId) ?? near[0];
    const current = fresh();
    const faction = store.getFaction(playerFactionId);
    const unitPrice = grainPricePerUnit(current.affinity);
    const cost100 = quoteGrainForGold(100, current.affinity);
    // 이 부족이 등 뒤에 두고 있는, 아직 철회되지 않은 침략 요구.
    const retractable = activeDemands(store.getAllInvasionDemands())
        .filter(d => current.backingDemandIds.includes(d.id));

    /** 거래 결과만큼 부족 재고도 같이 움직인다 — 파는 쪽만 줄인다. */
    const applyTrade = (
        fn: typeof tradeGrainForGold | typeof tradeGoldForGrain,
        qty: number,
        direction: 'buy' | 'sell',
    ): string => {
        const f0 = store.getFaction(playerFactionId);
        if (!f0) return '세력을 찾을 수 없습니다.';
        const tribe = fresh();
        const res = fn({ playerGold: f0.gold, playerFood: f0.food, tribe }, qty);
        if (!res.success) return res.message;
        // goldSpent/grainMoved 는 방향에 따라 금과 粮 중 하나가 '지출' 이다.
        // goldSpent 은 양방향 모두 '평.player 가 낸 양' 이고, grainMoved 는 방향마다
        // 뜻이 다르다(구입=받은 糧, 매도=받은 金). 그래서 지출을 방향별로 계산한다.
        const spentGold = direction === 'buy' ? res.goldSpent : 0;
        const spentFood = direction === 'buy' ? 0 : res.goldSpent;
        const gainedFood = direction === 'buy' ? qty : 0;
        const gainedGold = direction === 'sell' ? res.grainMoved : 0;
        store.updateFaction(playerFactionId, {
            gold: f0.gold - spentGold + gainedGold,
            food: f0.food - spentFood + gainedFood,
        });
        store.updateMigrationTribe(tribe.id, {
            affinity: res.newAffinity,
            grainStock: Math.max(0, direction === 'buy' ? tribe.grainStock - qty : tribe.grainStock + qty),
            negotiatedThisMonth: true,
        });
        return res.message;
    };

    openDialogue({
        pages: [{
            title: `${current.name} 교섭`,
            subtitle: `우호도 ${current.affinity} · 1糧 ${unitPrice.toFixed(2)}金`,
            speaker: `${current.name} 태장`,
            placeMark: '胡',
            speakerPortrait: true,
            text: '이곳에 이주한 부족과 말을 건다. 공물을 주고 지원이나 거래를 청할 수 있다.',
            choices: [
                {
                    id: 'buy_grain',
                    label: `糧 100 사다 (${cost100}金)`,
                    description: `우호도가 높을수록 싸진다 · 보유 ${faction?.gold ?? 0}金`,
                    disabled: (faction?.gold ?? 0) < cost100,
                    onSelect: () => applyTrade(tradeGrainForGold, 100, 'buy'),
                },
                {
                    id: 'sell_grain',
                    label: '糧 100 팔다',
                    description: `糧을 주고 金을 받는다 · 보유 ${faction?.food ?? 0}糧`,
                    disabled: (faction?.food ?? 0) < 100,
                    onSelect: () => applyTrade(tradeGoldForGrain, 100, 'sell'),
                },
                {
                    id: 'aid_grain',
                    label: '군량미 지원 요청',
                    description: `${current.name}에게 糧 지원을 요청한다`,
                    onSelect: () => {
                        const tribe = fresh();
                        const res = requestGrainAid(tribe);
                        const f = store.getFaction(playerFactionId);
                        if (res.success && f) store.updateFaction(playerFactionId, { food: f.food + res.grain });
                        store.updateMigrationTribe(tribe.id, {
                            affinity: res.newAffinity,
                            negotiatedThisMonth: true,
                            grainStock: Math.max(0, tribe.grainStock - res.grain),
                        });
                        return res.message;
                    },
                },
                {
                    id: 'aid_troops',
                    label: '병력 지원 요청',
                    description: `${current.name}에게 용병을 요청한다`,
                    onSelect: () => {
                        const tribe = fresh();
                        const res = requestTroopAid(tribe);
                        const city = store.getCity(cityId);
                        const payout = res.success && city
                            ? troopAidPayout(res.soldiers, city.development, garrisonCap(city))
                            : { granted: 0, capped: false };
                        if (payout.granted > 0 && city) {
                            store.updateCity(city.id, { development: city.development + payout.granted });
                        }
                        store.updateMigrationTribe(tribe.id, {
                            affinity: res.newAffinity,
                            negotiatedThisMonth: true,
                            troopStock: Math.max(0, tribe.troopStock - payout.granted),
                        });
                        return payout.capped
                            ? `${res.message} (수용 한도로 ${payout.granted}병만 입병)`
                            : res.message;
                    },
                },
                {
                    id: 'retract_demand',
                    label: '침략 요구 철회 요구',
                    description: retractable.length > 0
                        ? `${retractable.length}건을 철회시킨다 · 우호도가 높을수록 쉽다`
                        : '철회시킬 침략 요구가 없다',
                    disabled: retractable.length === 0,
                    onSelect: () => {
                        const tribe = fresh();
                        const target = retractable[0];
                        if (!target) return '철회시킬 침략 요구가 없다.';
                        const res = demandRetraction(tribe, target);
                        if (res.withdrawnDemandId) {
                            store.updateInvasionDemand(res.withdrawnDemandId, { withdrawn: true });
                        }
                        store.updateMigrationTribe(tribe.id, {
                            affinity: res.newAffinity,
                            negotiatedThisMonth: true,
                        });
                        return res.message;
                    },
                },
                { id: 'leave', label: '물러난다', description: '교섭을 끝낸다', onSelect: () => '돌아갔다.' },
            ],
        }],
        index: 0,
    });
    return true;
}

/** 요충지 인접 판정 거리 — 도시 인접 판정(ADJACENT_DIST)과 같은 기준을 쓴다. */
const FEATURE_ADJACENT_DIST = 0.16;

/**
 * 인접 요충지 포위 개시 — 도시 병력을 묶어 인접 요충지로 보낸다.
 *
 * [E2E 안전]
 * 테스트 훅은 openCity → showCityInfo 로 직접 도시를 열기 때문에 이 경로를 타지 않는다.
 */
function maybeOpenFeatureSiege(cityId: CityID): void {
    const store = engine['store'];
    const gs = store.getGlobalState();
    const playerFactionId = gs.playerFactionId;
    if (!playerFactionId) return;
    const city = store.getCity(cityId);
    if (!city) return;
    if (store.getSiege(playerFactionId)) return;
    const candidates = store.getAllMapFeatures().filter(f => f.ownerId !== playerFactionId);
    if (candidates.length === 0) return;

    const rows = candidates.map(f => {
        const elig = checkSiegeEligibility(f, playerFactionId, {
            ownerId: f.ownerId,
            cityMapX: city.mapX ?? 0,
            cityMapY: city.mapY ?? 0,
            adjacentDist: FEATURE_ADJACENT_DIST,
        });
        const dist = Math.hypot((f.mapX ?? 0) - (city.mapX ?? 0), (f.mapY ?? 0) - (city.mapY ?? 0));
        const spec = DEFAULT_SIEGE_MONTHS[f.kind];
        return {
            feature: f,
            ok: elig.ok,
            reason: elig.reason,
            adjacent: dist <= FEATURE_ADJACENT_DIST,
            label: `${f.name} · ${f.kind} · 수비군 ${f.garrison}명 · 포위 ${spec}개월 · 거리 ${dist.toFixed(3)}`,
        };
    });
    const adjacent = rows.filter(r => r.adjacent);
    if (adjacent.length === 0) return;

    const hasSupply = (target: MapFeature): boolean =>
        store.getMapFeaturesByFaction(playerFactionId).some(
            owned => owned.id !== target.id
                && Math.hypot((owned.mapX ?? 0) - (target.mapX ?? 0), (owned.mapY ?? 0) - (target.mapY ?? 0)) <= (owned.supplyRadius ?? 0.09),
        );

    openDialogue({
        pages: [{
            title: `${city.name} — 요충지 출진`,
            speaker: '군사',
            text: `어느 요충지로 보낼지 고른다. 병력은 도시 병력을 넘길 수 없다 (현재 ${city.development}명).`,
            choices: [
                ...adjacent.map(row => ({
                    id: `siege_${row.feature.id}`,
                    label: row.feature.name,
                    description: `${row.label} · 출진 가능 병력 ${Math.min(city.development, SIEGE_MIN_COMMIT_TROOPS)}+`,
                    disabled: city.development < SIEGE_MIN_COMMIT_TROOPS,
                    onSelect: () => {
                        const committed = Math.min(city.development, Math.max(SIEGE_MIN_COMMIT_TROOPS, Math.round(city.development * 0.5)));
                        const started = startSiege(
                            row.feature, playerFactionId, city.id, committed,
                            gs.turnCount, { hasSupplyFeature: hasSupply(row.feature), maxTroops: city.development },
                            `siege_${playerFactionId}_${row.feature.id}`,
                        );
                        store.setSiege(started.operation);
                        store.updateMapFeature(row.feature.id, started.feature);
                        return started.message;
                    },
                })),
                { id: 'leave', label: '출진하지 않는다', description: '병력을 움직이지 않는다', onSelect: () => '병력은 그대로 둔다.' },
            ],
        }],
        index: 0,
    });
}

/** 성문 검문 대화 — 뇌물·잠입·철수 중 선택, 통과하면 입장한다. */
function openGateDialogue(cityId: string, strict: boolean): void {
    const store = engine['store'];
    const city = store.getCity(cityId);
    if (!city) return;
    const gs = store.getGlobalState();
    const faction = gs.playerFactionId ? store.getFaction(gs.playerFactionId) : null;
    const selected = store.getOfficer(gs.selectedOfficerId ?? '');
    const actor = (selected && selected.factionId === gs.playerFactionId)
        ? selected
        : faction ? store.getOfficer(faction.leaderId) : null;
    const officerInt = actor?.stats.intelligence ?? 50;
    const cost = gateBribeCost(strict);
    const chance = Math.max(0, Math.min(100, gateSneakThreshold(officerInt, strict)));
    const ownerName = city.ownerId ? store.getFaction(city.ownerId)?.name ?? '낯선 세력' : '무주공산';
    const text = strict
        ? `“멈춰라! 여기는 ${ownerName}의 영역이다. ${city.name} 성문은 적에게 열리지 않는다. 목숨이 아깝거든 당장 돌아가라.”`
        : `“처음 보는 얼굴이군. ${city.name}에 무슨 볼일이냐? 수상쩍은 자는 성문에서 돌려보낸다는 엄명이다.”`;
    const applyChoice = (choiceId: GateChoiceId): string => {
        const result = resolveGateChoice(choiceId, {
            factionGold: faction?.gold ?? 0,
            officerIntelligence: officerInt,
            strict,
        });
        if (result.goldSpent > 0 && faction) {
            store.updateFaction(faction.id, { gold: Math.max(0, faction.gold - result.goldSpent) });
        }
        if (result.infamyDelta !== 0 && actor) {
            store.updateOfficer(actor.id, { infamy: actor.infamy + result.infamyDelta });
        }
        addLog(result.message);
        if (result.entered) {
            // 큐를 먼저 비운다. closeDialogue() 가 남아 있는 큐를 실행하면,
            // enterCity 가 새로 등록할 '이 도시' 교섭이 이전 도시 것으로 먼저 열린다.
            clearQueuedDialogue();
            closeDialogue();
            enterCity(cityId);
        }
        return result.message;
    };
    openDialogue({
        pages: [{
            title: `성문 검문 — ${city.name}`,
            subtitle: strict ? `${ownerName} · 적대 세력의 성문` : `${ownerName} · 미방문 도시의 성문`,
            speaker: '성문지기',
            placeMark: '門',
            // 문지기는 사람이라 표식 글자 대신 초상화를 세운다.
            speakerPortrait: true,
            text,
            choices: [
                {
                    id: 'bribe',
                    label: `뇌물을 건넨다 (${cost}金)`,
                    description: faction && faction.gold >= cost ? '문지기를 매수해 통과한다' : `자금 부족 (보유 ${faction?.gold ?? 0}金)`,
                    disabled: !faction || faction.gold < cost,
                    onSelect: () => applyChoice('bribe'),
                },
                {
                    id: 'sneak',
                    label: '몰래 잠입한다',
                    description: `${actor?.name ?? '斥候'} 지력 ${officerInt} · 성공률 약 ${chance}%`,
                    onSelect: () => applyChoice('sneak'),
                },
                {
                    id: 'leave',
                    label: '돌아간다',
                    description: '검문을 포기하고 물러난다',
                    onSelect: () => applyChoice('leave'),
                },
            ],
        }],
        index: 0,
    });
}

// ============================================================
// 성문 — 성문지기 대화 / 다른 도시 방문 [2026-10-04]
// ============================================================

// [2026-10-04] 이동 모드 — 성문에서 "다른 도시 방문"을 고른 뒤 지도가 뜨는 구간.
//   군단(Army) 위치 모델은 아직 없다(3단계). 지금은 출발지/목적지 좌표만
//   보관해 경로 선을 그리고, 애니메이션이 끝나면 목적지 도시를 연다.
let travelModeActive = false;
let travelModeOriginId: string | null = null;
let travelReturnCityId: string | null = null;
let travelRoute: { from: string; to: string } | null = null;
let travelAnimToken = 0;
/** [2026-10-04] 지도 위 마커의 현재 진행도 — 턴 이동에서 애니메이션의 시작점이 된다. */
let travelProgressCurrent = 0;

/**
 * 이동 대상 도시 목록 (현재 도시 제외).
 *
 * 정렬은 이름 순이다. 이동 경로를 아직 상태로 갖고 있지 않으므로(2단계는 시각
 * 표시만), 가까운 순으로 보여주면 도착 시간을 예측할 수 없는 순서로 보게 된다.
 */
function travelTargetCities(): Array<import('./core/types.js').City> {
    if (!engine) return [];
    return engine['store'].getAllCities()
        .filter(c => c.id !== citySceneCityId)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/**
 * 성문지기 대화 — 선택지 2개.
 *
 * 1) 성문지기와 이야기한다 (현재 도시 정보)
 * 2) 다른 도시 방문하기 (지도 활성화 → 도시 선택)
 *
 * [왜 기존 openGateDialogue 와 다른가]
 * openGateDialogue 는 **타 도시로 들어갈 때** 문지기를 통과하는 절차라 선택지가
 * 뇌물·잠입·철수로 게임 규칙(금화·악명)을 건드린다. 여기서는 **내 도시 성문에서
 * 떠나는** 대화라 규칙 변화 없이 정보 제공과 이동 선택만 한다. 성문지기를 공유할
 * 뿐 목적이 다르므로 분리했다.
 */
function openCityGatekeeperDialogue(city: import('./core/types.js').City | null | undefined): void {
    if (!engine || !city) return;
    const store = engine['store'];
    const gs = store.getGlobalState();
    const faction = gs.playerFactionId ? store.getFaction(gs.playerFactionId) : null;
    const officerCount = countCityOfficers(city);
    const text = `“문은 열려 있소. ${city.name}의 일은 언제든 말씀하시지. `
        + `지금 치안은 ${city.developmentStats.publicOrder}이고, 병영에 무장 ${officerCount}명이 있습니다. `
        + `바깥은 넓으니 다른 도시로도 얼마든지 다닐 수 있지요.”`;

    openDialogue({
        pages: [{
            title: `성문 — ${city.name}`,
            subtitle: faction ? `${faction.name} · ${city.name} 성문` : `${city.name} 성문`,
            speaker: '성문지기',
            placeMark: '門',
            speakerPortrait: true,
            text,
            choices: [
                {
                    id: 'talk',
                    label: '성문지기와 이야기한다',
                    description: `치안 ${city.developmentStats.publicOrder} · 무장 ${officerCount}명 · 식량 수입 ${city.foodIncome.toLocaleString()}`,
                    onSelect: () => `“${city.name}은 지금 크게 번영하고 있소. 무장들 얼굴도 다 알고 있지.”`,
                },
                {
                    id: 'travel',
                    label: '다른 도시 방문하기',
                    description: '전국 지도를 열어 다른 도시로 향한다',
                    onSelect: () => {
                        // 결과를 창에 보여준 뒤 지도를 연다. 곧바로 닫으면 눌린감이 없다.
                        closeDialogue();
                        setTimeout(openWorldMapForTravel, 180);
                        return `${city.name} 성문을 나선다.`;
                    },
                },
            ],
        }],
        index: 0,
    });
}

/** 이 도시에 주둔한 무장 수 — 시트의 무장 목록과 **같은 기준**을 쓴다. */
function countCityOfficers(city: import('./core/types.js').City): number {
    if (!engine) return 0;
    const store = engine['store'];
    const cityOfficers = city.officerIds
        .map(id => store_getOfficerSafe(id))
        .filter((o): o is NonNullable<typeof o> => o !== null);
    return mergeCityAndFreeOfficers(cityOfficers, store.getAllOfficers(), city.id).length;
}

/**
 * 이동 모드 — 전국 지도를 열어 목적지 도시를 고르게 한다.
 *
 * [E2E 계약에 대한 주의]
 * 지도 클릭은 이미 "1회=선적, 2회=진입" 계약을 쓰고 browser_smoke 가 그것을
 * 검증한다. 이동 모드에서는 그 계약과 무관하게 **한 번의 클릭**으로 이동이
 * 성사되도록 별도 분기를 둔다.
 */
function openWorldMapForTravel(): void {
    const targets = travelTargetCities();
    if (targets.length === 0) {
        addLog('이 세계에는 방문할 다른 도시가 없다.');
        return;
    }
    // 도시 화면을 먼저 닫는다 — 닫지 않으면 지도 위에 도시 패널이 겹친다.
    closeCityPanel();
    travelModeOriginId = citySceneCityId;
    travelModeActive = true;
    travelReturnCityId = travelModeOriginId;
    addLog('어느 도시로 갈까? 지도의 도시를 누르면 이동한다.');
    renderTravelHint(targets.length);
    requestAnimationFrame(() => {
        syncChinaMapCities();
        chinaMap?.render();
    });
}

/** 이동 모드 안내 — 지도 위 토스트. 취소할 수 있어야 한다. */
function renderTravelHint(count: number): void {
    const hint = document.getElementById('travel-hint');
    if (!hint) return;
    hint.innerHTML = `<span class="travel-hint-text">이동할 도시를 고르시오 — ${count}개 도시</span>`
        + '<button type="button" class="travel-hint-cancel">취소</button>';
    hint.hidden = false;
    hint.querySelector('.travel-hint-cancel')?.addEventListener('click', cancelTravel);
}

/** 이동 모드를 끝내고 원래 도시 화면으로 돌아간다. */
function cancelTravel(): void {
    if (!travelModeActive) return;
    travelModeActive = false;
    travelModeOriginId = null;
    travelRoute = null;
    chinaMap?.clearTravelRoute();
    document.getElementById('travel-hint')?.setAttribute('hidden', '');
    const back = travelReturnCityId;
    travelReturnCityId = null;
    if (back) showCityInfo(back);
    addLog('이동을 취소했다.');
}

/**
 * 목적지 확정 — 경로를 그리고(시각 표시 전용) 목적지 도시를 연다.
 *
 * 여기까지는 **상태를 만들지 않는다.** 군단(Army) 위치 모델은 3단계에서 넣고,
 * 지금은 출발지→목적지 선을 그렸다가 도착 도시 화면을 여는 것까지만 한다.
 */
function confirmTravelTo(dest: import('./core/types.js').City): void {
    const originId = travelModeOriginId;
    travelModeActive = false;
    document.getElementById('travel-hint')?.setAttribute('hidden', '');
    if (!originId) {
        addLog(`${dest.name}(으)로 향한다.`);
        enterCity(dest.id);
        return;
    }
    travelRoute = { from: originId, to: dest.id };
    chinaMap?.setTravelRoute(originId, dest.id);
    // 새 이동은 출발점에서 시작한다 — 이전 이동의 진행도가 남아 있으면
    // 두 번째 도시가 출발하자마자 중간 지점에 있는 것처럼 보인다.
    travelProgressCurrent = 0;
    chinaMap?.setTravelProgress(0);

    // [2026-10-04] 이동 시간을 계산한다. 육로는 말, 바다는 배 — 배가 더 느리다.
    //   단위는 **개월** 이다. 게임 1턴 = 1개월 이므로 이 값이 곧 소요 턴 수다.
    const plan = chinaMap?.getTravelPlan() ?? null;
    const months = plan?.totalMonths ?? 0;
    const how = plan ? describeTravelPlan(plan) : '이동 경로 없음';
    addLog(`${dest.name}(으)로 이동한다 — ${how}`);

    // 경로가 없거나 0 개월이면 턴을 쓰지 않고 즉시 도착한다.
    if (months <= 0) {
        playTravelAnimation(originId, dest.id, () => {
            travelRoute = null;
            chinaMap?.clearTravelRoute();
            enterCity(dest.id);
        });
        return;
    }

    // 턴이 필요한 이동 — 상태에 넣고 "이동 중" 지도 모드로 둔다.
    const store = engine['store'];
    store.setGlobalState({
        ...store.getGlobalState(),
        activeTravel: {
            fromCityId: originId,
            toCityId: dest.id,
            monthsRemaining: months,
            monthsTotal: months,
        },
    });
    travelReturnCityId = null; // 이동 중에는 원래 도시로 돌아가지 않는다
    renderActiveTravelHint(dest, months);
    // [2026-10-04] 턴을 기다리지 않고 계속 움직인다 — 실시간 이동 모습.
    startTravelLoop();
}

/**
 * 이동 중 안내 — "목적지까지 N개월" 을 보여주고 취소를 제공한다.
 *
 * [왜 map 위가 아니라 지도 위 토스트인가]
 * 이동 중에는 도시 화면이 닫혀 있고 지도가 보인다. 진행 상태를 지도 위에 두는
 * 것이 사용자가 자연스럽게 보는 곳이다.
 */
function renderActiveTravelHint(dest: import('./core/types.js').City, months: number): void {
    const hint = document.getElementById('travel-hint');
    if (!hint) return;
    hint.innerHTML = `<span class="travel-hint-text">${dest.name}로 이동 중 — 남은 ${months}개월</span>`
        + '<button type="button" class="travel-hint-cancel">이동 중지</button>';
    hint.hidden = false;
    hint.querySelector('.travel-hint-cancel')?.addEventListener('click', cancelActiveTravel);
}

/** 이동 중지 — 출발 도시로 돌아간다. 도착한 것처럼 행동한 적은 없다. */
function cancelActiveTravel(): void {
    const store = engine?.['store'];
    const active = store?.getGlobalState().activeTravel;
    if (!store || !active) return;
    stopTravelLoop();
    store.setGlobalState({ ...store.getGlobalState(), activeTravel: undefined });
    travelRoute = null;
    chinaMap?.clearTravelRoute();
    document.getElementById('travel-hint')?.setAttribute('hidden', '');
    addLog('이동을 중지했다.');
    showCityInfo(active.fromCityId);
}

/**
 * 턴 경계마다 이동 1개월 경과 — 턴이 끝날 때마다 부른다.
 *
 * [단위가 개월인 이유]
 * 1턴 = 1개월 이므로 "1개월 경과" 와 "턴 1회" 는 같은 사건이다. 여기서 1 을 빼는
 * 것이 곧 한 달을 보내는 것이다.
 *
 * [3단계로 이어지는 자리]
 * 지금은 "한 달씩 줄이고 0 이 되면 도착" 만 한다. 군단(Army) 이 붙으면 여기에
 * 행군 사건(식량 고갈·길목 교전·날씨 페널티)을 끼워 넣으면 된다. 지금 넣으면
 * Army 가 없는 상태에서 규칙이 죽으므로 넣지 않는다.
 *
 * @returns 도착했으면 목적지 도시 id, 아니면 null
 */
export function advanceActiveTravelOneTurn(): string | null {
    const store = engine?.['store'];
    const active = store?.getGlobalState().activeTravel;
    if (!store || !active) return null;
    const left = active.monthsRemaining - 1;
    if (left > 0) {
        store.setGlobalState({
            ...store.getGlobalState(),
            activeTravel: { ...active, monthsRemaining: left },
        });
        const dest = store.getCity(active.toCityId);
        if (dest) renderActiveTravelHint(dest, left);
        // [2026-10-04] 지도 위에서 실제로 한 칸 앞으로 이동시킨다.
        //   진행도를 **날짜 비율**이 아니라 **경로 거리 비율**로 환산해야 한다.
        //   말 구간과 배 구간의 월 이동 거리가 다르므로, 개월 비율을 그대로 쓰면
        //   빠른 말 구간에서 마커가 지형을 뚫고 앞질러 나간다.
        syncTravelProgressToMonths(active.monthsTotal, left);
        return null;
    }
    // 도착 — 상태를 비우고 경로를 지운다.
    stopTravelLoop();
    store.setGlobalState({ ...store.getGlobalState(), activeTravel: undefined });
    travelRoute = null;
    chinaMap?.clearTravelRoute();
    document.getElementById('travel-hint')?.setAttribute('hidden', '');
    const dest = store.getCity(active.toCityId);
    addLog(`${dest?.name ?? '목적지'}(으)로 도착했다.`);
    return active.toCityId;
}

/**
 * 남은 개월 수 → 지도 위 진행도(0~1).
 *
 * [왜 개월 비율이 아니라 거리 비율인가]
 * 이동 계획의 구간마다 소요 개월 수가 다르다(말은 빠르고 배는 느리다). 개월 비율을
 * 그대로 진행도에 쓰면, 3개월 걸리는 구간을 한 달 만에 지나가 버린다 — 지형을 무시하고
 * 순간이동하는 것처럼 보인다. 그래서 **해당 개월 지점에서 실제로 어디쯤인지** 를
 * 거리로 환산해야 한다.
 *
 * 렌더러가 구간별 누적 거리를 갖고 있으므로 그쪽에서 계산한다. 여기서는 목표
 * 진행도만 넘긴다.
 *
 * @param monthsTotal 총 소요 개월 수 (= 소요 턴 수)
 * @param monthsLeft  남은 개월 수
 */
function syncTravelProgressToMonths(monthsTotal: number, monthsLeft: number): void {
    if (monthsTotal <= 0) return;
    // [2026-10-04] 실시간 루프가 떠 있는 동안은 루프가 그린다. 턴 경계에서만
    //   진행도를 정확히 되감을 뿐( re-align ), 그 사이에 애니메이션을 새로 띄우면
    //   루프와 부딪혀 두 애니메이션이 같은 값을 놓고 다툰다.
    if (travelLoopHandle) { realignToTurnProgress(monthsTotal, monthsLeft); return; }
    // 루프가 없는 경우(감소 모드)만 부드러운 점프 애니메이션을 쓴다.
    const target = chinaMap?.progressForDays(monthsLeft, monthsTotal) ?? 0;
    animateTravelProgressTo(target);
}

/**
 * 진행도를 한 프레임씩 부드럽게 만든다.
 *
 * [즉시 set 하지 않는 이유]
 * 턴이 한 달씩 넘어가는데 마커가 순간이동하면 "이동 중"이라는 사실이 눈에 안
 * 들어온다. 약간의 부드러짐을 주면 "한 걸음 다가갔다" 는 인지가 생긴다.
 * prefers-reduced-motion 이면 즉시 이동한다 — [461-480] 접근성 축.
 */
function animateTravelProgressTo(target: number): void {
    const reduced = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { chinaMap?.setTravelProgress(target); return; }

    const token = ++travelAnimToken; // 이전 애니메이션을 취소한다
    const start = travelProgressCurrent;
    const delta = target - start;
    // 이미 그 자리면 움직일 것이 없다.
    if (Math.abs(delta) < 0.001) return;
    const startTime = performance.now();
    const DURATION = 420;
    const step = (now: number): void => {
        if (token !== travelAnimToken) return;
        const t = Math.min(1, (now - startTime) / DURATION);
        // ease-out — 출발할 때 빠르고 끝날 때 느리다(가속/감속).
        const eased = 1 - Math.pow(1 - t, 3);
        travelProgressCurrent = start + delta * eased;
        chinaMap?.setTravelProgress(travelProgressCurrent);
        if (t < 1) { requestAnimationFrame(step); return; }
        travelProgressCurrent = target;
    };
    requestAnimationFrame(step);
}

/**
 * 출발지 → 목적지 이동 연출.
 *
 * 지도 위 한 점을 시간에 따라 이동시키고 완료 콜백을 부른다. 상태를 만들지
 * 않으므로(3단계 대상) 끝난 뒤 흔적은 남지 않는다.
 * prefers-reduced-motion 을 존중해 즉시 완료한다 — [461-480] 접근성 축.
 */
function playTravelAnimation(_from: string, _to: string, done: () => void): void {
    const reduced = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { done(); return; }
    const token = ++travelAnimToken;
    const start = performance.now();
    const DURATION = 900;
    const step = (now: number): void => {
        // 새 이동이 시작되면 이전 애니메이션은 즉시 포기한다.
        if (token !== travelAnimToken) return;
        const t = Math.min(1, (now - start) / DURATION);
        chinaMap?.setTravelProgress(t);
        if (t < 1) { requestAnimationFrame(step); return; }
        chinaMap?.setTravelProgress(1);
        done();
    };
    requestAnimationFrame(step);
}


/**
 * 실시간 이동 루프 — 턴을 기다리지 않고 계속 앞으로 나아간다. [2026-10-04]
 *
 * [왜 필요한가]
 * 턴마다 한 번씩 420ms짜리 애니메이션은 "이동 중" 을 보여주지만 **멈춰 있다**.
 * 사용자가 요청한 것은 "실시간으로 이동하는 모습" 이었다. 턴이 몇 달 걸리든
 * 마커는 화면에서 계속 움직여야 한다. 그래야 "5일 걸린다" 는 숫자가
 * "지금 이렇게 느리게 간다" 는 인상으로 읽힌다.
 *
 * [속도 설계 — 왜 전체를 짧게 순회하는가]
 * 전체 경로를 N초에 한 번 순회(loop)시킨다. 몇 가지 선택지가 있었다:
 *   (a) 실제 1개월을 N초에 압축 → 하루가 몇 밀리초라 턴 길이와 무관하게 어긋남
 *   (b) 남은 구간만 천천히 — 턴마다 리셋돼 출발할 때마다 다시 느려짐
 *   (c) 전체를 일정한 속도로 순회 — "이동 중" 인 사실이 계속 보인다
 * (c) 를 택했다. 턴 경계는 진행도를 정확히 되감는 역할만 하고(아래
 * `realignToTurnProgress`), 루프는 그 위에 계속 얹힌다.
 *
 * [빠른 말 / 느린 배 구간]
 * 루프는 **거리 기준**으로 움직인다. 하루 이동 거리는 말 0.085, 배 0.051 이므로
 * 배 구간에서 마커가 실제로 느리게 간다 — 이것이 이 애니메이션의 진짜 목적이다.
 *
 * [prefers-reduced-motion]
 * 루프를 아예 띄우지 않는다. 턴마다 한 번 점프하는 방식으로 되돌린다. [461-480]
 */
let travelLoopHandle = 0;
let travelLoopLast = 0;

/** 전체 경로를 한 번 순회하는 데 걸리는 밀리초. */
const TRAVEL_LOOP_MS = 6000;

/** 실시간 이동 루프를 시작한다 — 턴이 필요한 이동을 시작할 때만 부른다. */
function startTravelLoop(): void {
    stopTravelLoop();
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return; // 감소 모드에서는 루프 대신 턴마다 점프한다.
    }
    travelLoopLast = performance.now();
    const tick = (now: number): void => {
        const store = engine?.['store'];
        if (!store || !store.getGlobalState().activeTravel) { travelLoopHandle = 0; return; }
        const dt = now - travelLoopLast;
        travelLoopLast = now;
        // 거리 기준 속도. 순회 시간은 전체 거리 기준이므로 여기서 1/6000 을 더한다.
        travelProgressCurrent += dt / TRAVEL_LOOP_MS;
        if (travelProgressCurrent >= 1) travelProgressCurrent -= 1; // 순환
        chinaMap?.setTravelProgress(travelProgressCurrent);
        travelLoopHandle = requestAnimationFrame(tick);
    };
    travelLoopHandle = requestAnimationFrame(tick);
}

/** 실시간 이동 루프를 멈춘다 — 도착·취소·이동 중지 시 부른다. */
function stopTravelLoop(): void {
    if (travelLoopHandle) cancelAnimationFrame(travelLoopHandle);
    travelLoopHandle = 0;
}

/**
 * 턴 경계에서 진행도를 그 턴의 정확한 위치로 되돌린다.
 *
 * [루프와 턴의 관계]
 * 루프는 화면을 예쁘게 만들기 위한 것이고 **진짜 상태는 아니다**. 턴이 넘어가면
 * `monthsRemaining` 이 줄어들었으므로, 진행도를 그 값에 맞는 위치로 되돌려야
 * "여기까지 왔다" 는 사실이 화면과 어긋나지 않는다. 되돌린 뒤 루프가 다시
 * 그 자리에서 계속 움직인다.
 */
function realignToTurnProgress(monthsTotal: number, monthsLeft: number): void {
    const target = chinaMap?.progressForDays(monthsLeft, monthsTotal) ?? 0;
    travelProgressCurrent = target;
    chinaMap?.setTravelProgress(target);
}

function endPointerInteraction(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    const wasDrag = dragMoved;
    isDragging = false;
    activePointerId = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* 이미 해제됨 */ }
    // pointerup에서 직접 선택한다. 일부 WebView/Tauri 터치에서는 click이
    // 합성되지 않아 canvas click만으로는 도시 선택이 누락된다. [461-480]
    if (!wasDrag) selectCityAtClientPoint(e.clientX, e.clientY);
    dragMoved = false;
}
function cancelPointerInteraction(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    isDragging = false;
    activePointerId = null;
    dragMoved = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* 이미 해제됨 */ }
}
canvas.addEventListener('pointerup', endPointerInteraction);
canvas.addEventListener('pointercancel', cancelPointerInteraction);

canvas.addEventListener('pointerleave', (e) => {
    if (activePointerId === e.pointerId && e.pointerType === 'mouse') {
        isDragging = false;
        activePointerId = null;
        dragMoved = false;
        chinaMap.setHoveredCity(null);
    }
});

canvas.addEventListener('click', (e) => {
    // 실제 포인터 입력은 pointerup에서 처리한다. click은 키보드/프로그래밍
    // synthetic click(detail=0)만 보완 처리해 중복 로그를 막는다.
    if (e.detail !== 0 || activePointerId !== null) return;
    if (dragMoved) {
        dragMoved = false;
        return;
    }
    selectCityAtClientPoint(e.clientX, e.clientY);
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { px, py } = clientToCanvasPoint(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    if (isBattleMode) {
        hexRenderer.zoomAt(factor, px, py);
    } else {
        chinaMap.zoomAt(factor, px, py);
    }
});

/** 스토어의 도시를 중국 전도 뷰로 동기화 */
function syncChinaMapCities(): void {
    try {
        const gs = engine['store'].getGlobalState();
        const store = engine['store'];
        const cityViews = store.getAllCities().map(c => {
            const fac = c.ownerId ? store.getFaction(c.ownerId) : null;
            const x = c.mapX ?? (c.hexCoord.q + 4) / 8;
            const y = c.mapY ?? (c.hexCoord.r + 4) / 8;
            // [321-340] 지도 날씨 오버레이 — 도시 기후권의 현재 날씨/수확 보정
            const regionId = resolveCityClimateRegion(c.name, c.mapX, c.mapY);
            const climate = engine.climateManager.getClimate(regionId);
            return {
                id: c.id,
                name: c.name,
                x, y,
                imageX: c.mapImageX ?? x,
                imageY: c.mapImageY ?? y,
                iconType: c.mapIconType ?? (c.isCapital ? 'CAPITAL' : 'CITY'),
                // 도성 아이콘 크기를 도시 규모에 맞춰 정하기 위해 인구를 넘긴다
                population: c.population,
                hitRadius: c.isCapital ? 22 : 16,
                ownerColor: factionColor(fac?.color),
                factionName: fac?.name,
                isPlayer: c.ownerId === gs.playerFactionId,
                isDiscovered: c.ownerId === gs.playerFactionId || visitedCityIds.has(c.id),
                // [결함 수정] 병력 수(명)를 그대로 넘긴다.
                // 예전엔 `c.development * 100` 이었고, china_map_renderer 의
                // 배지 코드도 그 100배를 전제로 `/100` 하고 있었다. 두 오프셋이
                // 서로 상쇄돼 테스트는 통과했지만 사용자에게는 병력이 100배
                // 부풀어 표시됐다(8,325명 → "832.5만").
                garrison: c.development,
                isSelected: false,
                weather: climate?.weather,
                harvestModifier: climate?.harvestModifier,
                // [461-480] 색약 무늬 — 소유 세력 패턴을 영토에 반영
                factionPattern: colorPattern,
            } as MapCityView;
        });
        const discoveredCities = cityViews.filter(city => city.isDiscovered === true || city.isPlayer);
        for (const city of cityViews) {
            if (city.isDiscovered === true || city.isPlayer) continue;
            // [49] 발견 모드에서도 방문·소유 도시의 인접 도시는 실루엣으로 남긴다.
            city.isAdjacentToDiscovered = discoveredCities.some(discovered =>
                Math.hypot(discovered.x - city.x, discovered.y - city.y) <= 0.16,
            );
        }
        worldCities = cityViews;
        chinaMap.setCities(worldCities);
    } catch {
        // 엔진 미초기화
    }
}

/** 현재 상세 패널에 열려 있는 도시 ID (전환 애니메이션 판단용) */
function updateMapVisibilityButton(): void {
    const discovered = cityVisibilityMode === 'discovered';
    btnMapVisibility.dataset.icon = discovered ? '🔎' : '🗺️';
    btnMapVisibility.setAttribute('aria-label', discovered ? '발견 도시' : '전체 도시');
    btnMapVisibility.setAttribute('aria-pressed', String(discovered));
    btnMapVisibility.title = discovered
        ? '방문했거나 플레이어 세력이 소유한 도시만 표시합니다'
        : '전국 모든 도시를 표시합니다';
}

/** [49] 초기 전체 도시 표시와 방문·소유 도시만 표시하는 모드 전환. */
function setCityVisibilityMode(mode: CityVisibilityMode): void {
    cityVisibilityMode = mode;
    chinaMap.setDiscoveredOnly(mode === 'discovered');
    updateMapVisibilityButton();
    addLog(mode === 'discovered'
        ? '🔎 지도 표시: 방문·소유 도시만'
        : '🗺️ 지도 표시: 전국 전체 도시');
}

let currentPanelCityId: string | null = null;

/** 도시 클릭 시 사이드바 + 상세 패널에 정보 표시 [49] */
function showCityInfo(cityId: string): void {
    try {
        const store = engine['store'];
        const city = store.getCity(cityId);
        if (!city) return;
        preserveCityNavigation(cityId);
        const faction = city.ownerId ? store.getFaction(city.ownerId) : null;
        // 좌측 정보 단도 같은 도시로 맞춘다 — 도시 진입 경로와 지도 클릭 경로의 화면이 달라지면 안 된다.
        sidebarSelectedCityId = null;
        renderSidebarCitySelection(cityId);
        renderOfficerDetail(null); // 도시 전환 시 무장 상세 초기화
        renderCityDetailPanel(city, faction, cityId !== currentPanelCityId);
        currentPanelCityId = cityId;
        addLog(`도시 선택: ${city.name}${faction ? ` (${faction.name})` : ''}`);
    } catch {
        // 엔진 미초기화
    }
}

// ============================================================
// 도시 상세 패널 — 내정치 바 + 무장 목록 [49]
// ============================================================

const cityDetailPanel = document.getElementById('city-detail-panel')!;
const cdpCityName = document.getElementById('cdp-city-name')!;
const cdpFactionBadge = document.getElementById('cdp-faction-badge')!;
// 內政 지표 칸은 2026-09-30 에 삭제됐다(사용자 요청). 자리에 없으므로 null 이고 아래 렌더를 건너뛴다.
const cdpStats = document.getElementById('cdp-stats');
// [2026-10-03] 좌·우 레일을 그림 위 시트로 옮겼으므로 이 요소는 도시 화면을 열어야 생긴다.
//   예전엔 상시 존재하는 레일 안에 있어서 여기서 바로 잡을 수 있었다. 지금 시트가 닫혀
//   있으면 getElementById 가 null 이라 `!` 단언이 곧바로 예외를 던져 앱 부팅이 중단됐다.
//   그래서 null 을 허용하고, 시트를 열 때 만들어지는 el 을 쓰도록 renderCityOfficerList 가
//   매번 다시 조회한다(아래 함수 참조).
const cdpOfficersContainer = document.getElementById('cdp-sheet-body');
const cdpFacilities = document.getElementById('cdp-facilities')!;
const citySceneCanvas = document.getElementById('city-scene-canvas') as HTMLCanvasElement | null;
const citySceneArt = document.getElementById('city-scene-art') as HTMLImageElement | null;
const citySceneStage = document.getElementById('city-scene-stage');

/**
 * 배경 그림 로딩 상태.
 * [실패해도 안전] 실패하면 art-ready 를 켜지 않는다. 그랬더니 절차 렌더가 그대로
 * 남아 도시 화면은 항상 나타난다 — 그림이 없어도 도시가 비면 안 된다.
 */
let citySceneArtReady = false;
if (citySceneArt) {
    citySceneArt.addEventListener('load', () => {
        citySceneArtReady = true;
        citySceneStage?.classList.add('art-ready');
        const city = citySceneCityId ? engine?.['store'].getCity(citySceneCityId) : null;
        if (city) drawCityCanvas(city);
        // 그림 크기가 이제 앵커 계산에 쓰인다(무대가 창 크기 그대로). 크기가 확정된
        // 뒤에 배지를 다시 재야 cover 보정이 적용된다.
        applyCitySceneBadgePositions();
    });
    citySceneArt.addEventListener('error', () => {
        citySceneArtReady = false;
        citySceneStage?.classList.remove('art-ready');
    });
    citySceneArt.src = CITY_SCENE_ART_PATH;
}
const citySceneSummary = document.getElementById('city-scene-summary');
const citySceneDetail = document.getElementById('city-building-detail');
const citySceneRenderer = new City3DRenderer();
let citySceneBuildings: CityBuilding[] = [];
let citySceneCityId: string | null = null;
let selectedCitySceneBuilding: CityBuilding | null = null;
let lastCityView: ReturnType<ChinaMapRenderer['getView']> | null = null;

/** 도시 전환 시 지도 카메라와 선택 상태를 보존한다. [49][D32] */
function preserveCityNavigation(cityId: string): void {
    lastCityView = chinaMap.getView();
    worldCities = worldCities.map(city => ({ ...city, isSelected: city.id === cityId }));
    chinaMap.setCities(worldCities);
}

/* ============================================================
   대화 씬 배선 — 게임은 '무엇을 보여줄지'만 정하고, 화면은 씬이 그린다.
   (2026-10-03) 이전에 여기 있던 DOM 상수·무대 페인팅·선택지 렌더는
   src/ui/scenes/dialogue_scene.ts 로 옮겼다. 그 모듈은 스토어를 모른다.
   ============================================================ */

/** 씬이 요구한 훅 — 스토어 조회와 게임 명령만 주입한다. */
const dialogueScene = createDialogueScene(document.body, {
    lookupOfficer: (officerId) => {
        if (!engine) return null;
        const store = engine['store'];
        const o = store.getOfficer(officerId);
        if (!o) return null;
        const f = o.factionId ? store.getFaction(o.factionId) : null;
        return {
            id: o.id, name: o.name, gender: o.gender === 'F' ? 'F' : 'M',
            rank: o.rank, status: o.status,
            factionName: f?.name ?? '재야', factionColor: f?.color ?? '#4a5160',
        };
    },
    renderPortrait: (args) => renderPortraitSvg(args),
    log: (text) => addLog(text),
    sendGift: ({ actorId, targetId, itemId, gold }) => {
        const result = executeInteraction(engine!['store'], actorId, targetId, 'GIFT', {
            itemId: itemId as GiftItemId, gold,
        } satisfies GiftOptions);
        return { ok: result.success, message: result.message };
    },
    refreshOfficer: (officerId) => renderOfficerDetail(officerId),
    speak: (args) => { speakLine(args, a11ySettings.speech); },
    typewriter: () => typewriterEnabled(),
    runTrade: (goodId, mode) => runTrade(goodId, mode),
});
dialogueScene.setGiftItems(Object.values(GIFT_ITEMS).map(item => ({
    id: item.id, name: item.name, gradeLabel: item.gradeLabel, affinity: item.affinity,
})));

/** 씬에 창을 연다. 블록 밖 18곳이 이 함수를 쓴다. */
function openDialogue(state: DialogueSceneState, opts?: OpenSceneOptions): void {
    dialogueScene.open(state, opts);
}
/** 창을 닫는다. */
function closeDialogue(): void {
    dialogueScene.close();
}
/** 창이 열려 있는가 — 전역 키보드/ESC 핸들러가 이걸 본다. */
function isDialogueOpen(): boolean {
    return dialogueScene.isOpen();
}
/** 창이 닫힌 뒤 실행할 콜백을 건다(알현 → 교섭처럼 창을 이어서 띄울 때). */
function queueAfterDialogue(fn: () => void): void {
    dialogueScene.queueAfterClose(fn);
}
/** 대기 콜백을 이어 붙인다 — 앞선 것이 있으면 먼저 돌린다. */
function queueAfterDialogueChained(fn: () => void): void {
    dialogueScene.queueAfterCloseChained(fn);
}
/** 대기 콜백을 버린다 — 다른 도시의 창이 먼저 열리지 않도록. */
function clearQueuedDialogue(): void {
    dialogueScene.clearQueuedClose();
}

/** 타이포그래피가 도는지 — 사용자가 끄거나 모션 최소화를 존중하면 false. */
function typewriterEnabled(): boolean {
    if (revealForceInstant) return false;
    if (!a11ySettings.typewriter) return false;
    try {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    } catch { /* matchMedia 가 없으면 설정값을 따른다. */ }
    return true;
}
/** E2E/디버그용 — 대사를 즉시 다 보여준다. */
let revealForceInstant = false;

/* ============================================================
   연쇄 대화 재생기 [신규 기능]
   스크립트(ScriptRunner)를 화면에 붙인다. 효과 적용은 여기서 한다.
   ============================================================ */

let activeRunner: ScriptRunner | null = null;

/** 값을 범위 안으로 자른다. 도시 수치와 능력치가 범위를 벗어나면 게임이 깨진다. */
function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 두 무장 사이의 우호도를 움직인다.
 * 기존 코드에 setter 가 없어서 여기서 직접 만든다.
 * a -> b 방향 엣지가 있으면 갱신하고, 없으면 새로 만든다.
 * 반대 방향 엣지만 있으면 그쪽을 갱신한다(양방향으로 읽히므로).
 */
function addAffinity(store: GameStore, aId: string, bId: string, delta: number, label = '대화'): void {
    if (!aId || !bId || aId === bId || delta === 0) return;
    const forward = store.getRelationships(aId).find(e => e.target === bId);
    const time = store.getGlobalState().time;
    if (forward) {
        forward.affinity = clamp(forward.affinity + delta, -100, 100);
        store.addRelationship(forward);
        return;
    }
    const reverse = store.getRelationships(bId).find(e => e.target === aId);
    if (reverse) {
        reverse.affinity = clamp(reverse.affinity + delta, -100, 100);
        store.addRelationship(reverse);
        return;
    }
    store.addRelationship({
        source: aId as OfficerID, target: bId as OfficerID, type: 'SUBORDINATE',
        affinity: clamp(delta, -100, 100),
        history: [{ year: time.year, month: time.month, event: label, delta }],
    });
}
let activeScriptContext: { cityId: string } | null = null;

/** 효과를 스토어에 실제로 적용한다. 실패해도 대화는 계속된다. */
function applyScriptEffects(
    effects: readonly DialogueEffect[],
    ctx: { cityId: string; officerId?: string },
): string {
    if (!engine) return '';
    const store = engine['store'];
    const gs = store.getGlobalState();
    const city = store.getCity(ctx.cityId);
    const faction = gs.playerFactionId ? store.getFaction(gs.playerFactionId) : null;
    const notes: string[] = [];

    for (const e of effects) {
        switch (e.kind) {
            case 'gold': {
                if (!faction) break;
                const before = faction.gold;
                faction.gold = Math.max(0, before + e.amount);
                notes.push(`금화 ${e.amount >= 0 ? '+' : ''}${faction.gold - before}`);
                break;
            }
            case 'city': {
                if (!city) break;
                const stats = city.developmentStats;
                const key = e.field as keyof typeof stats;
                const before = Number(stats[key] ?? 0);
                // 도시 수치는 0~100 을 넘지 않게 잘라 넣는다. 값이 새면 도시가 무너진다.
                (stats[key] as number) = clamp(before + e.amount, 0, 100);
                notes.push(`${CITY_FIELD_LABEL[e.field]} ${e.amount >= 0 ? '+' : ''}${e.amount}`);
                break;
            }
            case 'danger': {
                if (!city) break;
                city.danger = clamp(city.danger + e.amount, 0, 100);
                notes.push(`위험 ${e.amount >= 0 ? '+' : ''}${e.amount}`);
                break;
            }
            case 'affinity': {
                if (!ctx.officerId) break;
                const before = getAffinityBetween(store, gs.playerFactionId ?? '', ctx.officerId);
                addAffinity(store, gs.playerFactionId ?? '', ctx.officerId, e.amount);
                const after = getAffinityBetween(store, gs.playerFactionId ?? '', ctx.officerId);
                if (after !== before) notes.push(`우호도 ${after - before >= 0 ? '+' : ''}${after - before}`);
                break;
            }
            case 'stat': {
                if (!ctx.officerId) break;
                const o = store.getOfficer(ctx.officerId);
                if (!o) break;
                o.stats[e.stat] = clamp(o.stats[e.stat] + e.amount, 1, 100);
                notes.push(`${STAT_LABEL_KO[e.stat]} ${e.amount >= 0 ? '+' : ''}${e.amount}`);
                break;
            }
            case 'log':
                addLog(e.text);
                break;
        }
    }
    return notes.join(' · ');
}

const CITY_FIELD_LABEL: Record<string, string> = {
    publicOrder: '치안', commerce: '상업', agriculture: '농업',
    loyalty: '충성', development: '개발',
};
const STAT_LABEL_KO: Record<string, string> = {
    leadership: '통솔', might: '무력', intelligence: '지력',
    politics: '정치', charisma: '매력',
};

/** 스크립트의 현재 노드를 대화창에 그린다. */
function renderScriptNode(): void {
    const node = activeRunner?.current;
    if (!node || !activeScriptContext) return;

    // 연쇄 대화의 기록은 openDialogue() 안의 renderDialoguePage() 가 쌓는다.
    // 여기서 또 쌓으면 같은 말이 두 번 들어간다.

    openDialogue({
        pages: [{
            title: node.speaker,
            speaker: node.speaker,
            speakerId: node.speakerId,
            placeMark: node.placeMark,
            text: node.lines.join('\n'),
            detail: node.facts ? [...node.facts] : [],
            choices: node.choices.map((c, i) => ({
                id: c.id,
                label: c.label,
                description: c.desc ?? '',
                disabled: c.enabled === false,
                onSelect: () => {
                    const applied = applyScriptEffects(c.effects, {
                        cityId: activeScriptContext!.cityId,
                    });
                    if (activeRunner) activeRunner.choose(c.id);
                    return applied || c.label;
                },
            })),
        }],
        index: 0,
    }, { keepTranscript: true });

    // 계속 화살표: 선택지가 없고 다음 장면이 있을 때만 살아 있다.
    const canAdvance = node.choices.length === 0 && !!node.next && !activeRunner!.finished;
    dialogueScene.setNavState({
        canAdvance,
        canGoBack: activeRunner!.canGoBack,
        pageLabel: `방문 ${activeRunner!.visitedCount}`,
    });
    renderTradePanel();
}

/* ============================================================
   교역 패널 — 텍스트 바 아래에서 사고팔기 [신규 기능]
   대화가 이어지는 동안 계속 열려 있다.
   ============================================================ */

/** 세력별 물자 소지량. 세이브에 섞이지 않도록 samgukzi_return_ 접두 키를 쓴다. */
function tradeStockKey(factionId: string): string {
    return `samgukzi_return_trade_stock_${factionId}`;
}
function loadTradeStock(factionId: string): Record<string, number> {
    try {
        const raw = localStorage.getItem(tradeStockKey(factionId));
        const parsed = raw ? JSON.parse(raw) as unknown : {};
        if (parsed && typeof parsed === 'object') return parsed as Record<string, number>;
    } catch { /* 저장소가 깨졌으면 빈 것으로 시작한다. */ }
    return {};
}
function saveTradeStock(factionId: string, stock: Record<string, number>): void {
    try { localStorage.setItem(tradeStockKey(factionId), JSON.stringify(stock)); } catch { /* 용량 초과면 조용히 넘긴다. */ }
}

let tradeOffer: TradeOfferRow[] = [];
let tradeCityId: string | null = null;

/** 현재 대화 페이지가 교역 장면인지. */
function isTradeScene(node: ScriptNode | undefined): boolean {
    return !!node && node.placeMark === '貿';
}

function renderTradePanel(): void {
    const node = activeRunner?.current;
    if (!isTradeScene(node) || !engine || !tradeCityId) {
        dialogueScene.hideTrade();
        return;
    }
    const store = engine['store'];
    const gs = store.getGlobalState();
    const faction = gs.playerFactionId ? store.getFaction(gs.playerFactionId) : null;
    if (!faction) { dialogueScene.hideTrade(); return; }
    const stock = loadTradeStock(faction.id);

    const rows = tradeOffer.map(r => {
        const have = stock[r.good.id] ?? 0;
        return '<div class="dlg-trade-row">'
            + '<span class="dlg-trade-name">' + r.good.name
            + '<span class="dlg-trade-note"> ' + have + ' 보유</span></span>'
            + '<span class="dlg-trade-price">' + r.buy + '</span>'
            + '<span class="dlg-trade-price">' + r.sell + '</span>'
            + '<span class="dlg-trade-btns">'
            + '<button data-trade-buy="' + r.good.id + '" ' + (faction.gold < r.sell ? 'disabled' : '') + '>매입</button>'
            + '<button data-trade-sell="' + r.good.id + '" ' + (have > 0 ? '' : 'disabled') + '>매도</button>'
            + '</span></div>';
    }).join('');

    dialogueScene.renderTrade('<div class="dlg-trade-head">'
        + '<span>물자</span><span>도시 매입가</span><span>도시 매도가</span><span></span>'
        + '<span class="dlg-trade-gold">보유 ' + faction.gold.toLocaleString() + '金</span>'
        + '</div>'
        + '<div class="dlg-trade-rows">' + rows + '</div>'
        + '<div class="dlg-trade-note">10자 단위로 거래한다. 대화가 끝나도 물자는 남는다.</div>');
}
/** 매입/매도 실행. 10자 단위. */
function runTrade(goodId: string, mode: 'buy' | 'sell'): void {
    if (!engine || !tradeCityId) return;
    const row = tradeOffer.find(r => r.good.id === goodId);
    if (!row) return;
    const store = engine['store'];
    const faction = store.getFaction(store.getGlobalState().playerFactionId ?? '');
    if (!faction) return;
    const stock = loadTradeStock(faction.id);
    const unit = 10;
    const price = mode === 'buy' ? row.sell : row.buy;

    if (mode === 'buy') {
        if (faction.gold < price * unit) {
            dialogueScene.showResult('금화가 부족합니다.');
            return;
        }
        faction.gold -= price * unit;
        stock[goodId] = (stock[goodId] ?? 0) + unit;
        dialogueScene.showResult(`${row.good.name} ${unit}자 매입 (${price * unit}金)`);
    } else {
        const have = stock[goodId] ?? 0;
        if (have < unit) {
            dialogueScene.showResult('가진 물자가 부족합니다.');
            return;
        }
        stock[goodId] = have - unit;
        faction.gold += price * unit;
        dialogueScene.showResult(`${row.good.name} ${unit}자 매도 (${price * unit}金)`);
    }
    saveTradeStock(faction.id, stock);
    renderTradePanel();
}

/* ============================================================
   진입점 — 시설 클릭
   ============================================================ */

/** 시장 클릭 -> 불량배 사건 대화. */
function openMarketDialogue(cityId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const city = store.getCity(cityId);
    if (!city) return;
    const gs = store.getGlobalState();
    const isPlayerCity = city.ownerId === gs.playerFactionId;
    const seed = `${city.id}|${gs.time.year}|${gs.time.month}|ruffian`;
    if (shouldTriggerRuffian({
        publicOrder: city.developmentStats.publicOrder,
        isPlayerCity,
        seed,
    })) {
        openRuffianIntro(cityId);
        return;
    }
    openMarketScript(cityId);
}

function openMarketScript(cityId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const city = store.getCity(cityId);
    if (!city) return;
    const gs = store.getGlobalState();
    const time = gs.time;

    const script = buildMarketScript({
        cityName: city.name,
        commerce: city.developmentStats.commerce,
        publicOrder: city.developmentStats.publicOrder,
        danger: city.danger,
        gold: city.funds,
        population: city.population,
        isCapital: city.isCapital,
        seed: `${city.id}|${time.year}|${time.month}`,
    });
    activeRunner = new ScriptRunner(script);
    activeScriptContext = { cityId };
    renderScriptNode();
}

/** 시장 불량배 조우 — 연쇄 대화 1장면. 일기토 신청은 2장면으로 이어진다. */
function openRuffianIntro(cityId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const city = store.getCity(cityId);
    if (!city) return;
    const gs = store.getGlobalState();
    const faction = gs.playerFactionId ? store.getFaction(gs.playerFactionId) : null;
    const cityOfficers = city.officerIds
        .map(id => store.getOfficer(id))
        .filter(o => o !== null && o.factionId === gs.playerFactionId);
    const selected = store.getOfficer(gs.selectedOfficerId ?? '');
    const actor = (selected && selected.factionId === gs.playerFactionId && selected.cityId === cityId)
        ? selected
        : cityOfficers[0] ?? (faction ? store.getOfficer(faction.leaderId) : null);
    if (!actor) {
        openMarketScript(cityId);
        return;
    }
    const encounterText = `시장 한복판에서 불량배 두목이 상인들을 둘러싸고 삥을 뜯고 있다. ` +
        `${actor.name}을(를) 보자 비웃으며 소리친다. “이봐, ${city.name}이 네 놈들의 구역이냐?”`;
    const intelText = `두목의 패거리는 ${Math.max(3, Math.min(12, Math.floor(city.danger / 8) + 3))}명. ` +
        `치안이 낮은 틈을 타 시장을 장악하려는 속셈이다. ${actor.name}(武力 ${actor.stats.might})이 나서면 일기토로 끝낼 수 있다.`;
    openDialogue({
        pages: [
            {
                title: `시장 소동 — ${city.name}`,
                subtitle: '불량배 두목의 행패',
                speaker: '불량배 두목',
                placeMark: '惡',
                text: encounterText,
                detail: [`치안 ${city.developmentStats.publicOrder} · 상업 ${city.developmentStats.commerce}`],
                choices: [
                    {
                        id: 'ruffian-duel',
                        label: '일기토를 신청한다',
                        description: `${actor.name}이(가) 나선다`,
                        onSelect: () => {
                            openDialogue({
                                pages: [{
                                    title: `일기토 — ${actor.name} vs 불량배 두목`,
                                    subtitle: `${city.name} 시장 한복판`,
                                    speaker: actor.name,
                                    speakerId: actor.id,
                                    text: `${actor.name}이(가) 앞으로 나선다. “장사하는 사람들을 괴롭히다니, 나랑 붙어보자!” 두목이 칼을 뽑았다.`,
                                    choices: [
                                        {
                                            id: 'ruffian-fight',
                                            label: '결투 시작',
                                            description: '단기접전 미니게임으로 승부를 가린다',
                                            onSelect: () => {
                                                openRuffianDuelModal(cityId, actor.id);
                                                return '결투장으로 향한다.';
                                            },
                                        },
                                        {
                                            id: 'ruffian-flee',
                                            label: '도망친다',
                                            description: '체면을 구기지만 몸은 성하다',
                                            onSelect: () => {
                                                closeDialogue();
                                                addLog(`${actor.name}이(가) 불량배 앞에서 물러났다.`);
                                                return '물러났다.';
                                            },
                                        },
                                    ],
                                }],
                                index: 0,
                            });
                            return '두목이 칼을 뽑았다.';
                        },
                    },
                    {
                        id: 'ruffian-bribe',
                        label: `돈을 준다 (${RUFFIAN_BRIBE_COST}金)`,
                        description: '도시 자금으로 불량배를 돌려보낸다',
                        disabled: city.funds < RUFFIAN_BRIBE_COST,
                        onSelect: () => {
                            const result = applyRuffianBribe(store, cityId);
                            addLog(result.message);
                            const updated = store.getCity(cityId);
                            if (updated) renderCityDetailPanel(updated, updated.ownerId ? store.getFaction(updated.ownerId) : null, false);
                            return result.message;
                        },
                    },
                    {
                        id: 'ruffian-ignore',
                        label: '못 본 척 시장을 본다',
                        description: '사건은 덮고 장사를 계속한다',
                        onSelect: () => {
                            closeDialogue();
                            openMarketScript(cityId);
                            return '시장으로 향한다.';
                        },
                    },
                ],
            },
            {
                title: `불량배 정보 — ${city.name}`,
                subtitle: '패거리 규모와 대처법',
                speaker: '시장 상인',
                placeMark: '商',
                text: intelText,
                detail: [`치안 ${city.developmentStats.publicOrder} · 위험도 ${city.danger}`],
                choices: [
                    {
                        id: 'ruffian-duel-2',
                        label: '일기토를 신청한다',
                        description: `${actor.name}이(가) 나선다`,
                        onSelect: () => {
                            openRuffianDuelModal(cityId, actor.id);
                            return '결투장으로 향한다.';
                        },
                    },
                ],
            },
        ],
        index: 0,
    });
}

/** 불량배 결투 모달 — 승리하면 치안·무력이 오르고 시장 대화로 복귀한다. */
function openRuffianDuelModal(cityId: string, actorId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const city = store.getCity(cityId);
    const actor = store.getOfficer(actorId);
    if (!city || !actor) return;
    const game = new DuelMinigame();
    game.startDuel(actor.id, `ruffian_${city.id}`, actor.stats, buildThugStats(city.danger), actor.name, '불량배 두목');
    vmState = {
        store, actorId: actor.id, targetId: `ruffian_${city.id}`, kind: 'DUEL',
        game, enemyUnits: [], deployable: [], done: false,
        onFinish: (actorWon: boolean) => {
            const outcome = applyRuffianDuelOutcome(store, cityId, actorId, actorWon);
            addLog(outcome.message);
            fireFeedback(actorWon ? 'VENGEANCE_SUCCESS' : 'VENGEANCE_FAIL');
            if (currentPanelCityId === cityId) {
                const updated = store.getCity(cityId);
                if (updated) renderCityDetailPanel(updated, updated.ownerId ? store.getFaction(updated.ownerId) : null, false);
            }
        },
        afterClose: () => openMarketScript(cityId),
    };
    document.getElementById('vm-title')!.textContent = '市井 — 불량배 소탕';
    document.getElementById('vm-subtitle')!.textContent = `${actor.name} vs 불량배 두목 (${city.name})`;
    document.getElementById('vm-player-name')!.textContent = actor.name;
    document.getElementById('vm-enemy-name')!.textContent = '불량배 두목';
    document.getElementById('vm-close')!.style.display = 'none';
    document.getElementById('vengeance-modal')!.style.display = 'flex';
    addLog(`⚔️ ${city.name} 시장 — ${actor.name}이(가) 불량배 두목과 일기토를 벌인다!`);
    renderVengeanceModal();
}

/** 교역소/시장 클릭 -> 교역 대화. 대도시면 교역소가 있다. */
function openTradeDialogue(cityId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const city = store.getCity(cityId);
    if (!city) return;
    const gs = store.getGlobalState();
    const seed = `${city.id}|${gs.time.year}|${gs.time.month}`;
    const isTradePost = hasTradePost({
        population: city.population, isCapital: city.isCapital, seed,
    });
    const input = {
        cityName: city.name,
        commerce: city.developmentStats.commerce,
        publicOrder: city.developmentStats.publicOrder,
        month: gs.time.month,
        gold: (store.getFaction(gs.playerFactionId ?? '')?.gold) ?? 0,
        isTradePost,
        seed,
    };
    tradeOffer = buildTradeOffer(input);
    tradeCityId = cityId;
    activeRunner = new ScriptRunner(buildTradeScript(input));
    activeScriptContext = { cityId };
    renderScriptNode();
}
// === 무장 상세 표시 [27][11] ===

/**
 * 무장 상세 정보 렌더링 [27] — 사이드바 officer-detail 패널
 * 능력치 5종 + 충성도/야망 + 관계망 상위 3인 (관계 시스템 [C-인간관계] 연동)
 */
function renderOfficerDetail(officerId: string | null): void {
    if (!officerId) {
        delete officerDetail.dataset.officerId;
        officerDetail.innerHTML = '<div class="od-empty">무장을 선택하세요</div>';
        return;
    }
    if (!engine) return;
    const store = engine['store'];
    const o = store.getOfficer(officerId);
    if (!o) { delete officerDetail.dataset.officerId; officerDetail.innerHTML = '<div class="od-empty">무장을 찾을 수 없습니다</div>'; return; }
    officerDetail.dataset.officerId = officerId;

    const statBar = (label: string, val: number, color: string) =>
        `<div class="od-stat-row"><span class="od-stat-label">${label}</span>` +
        `<div class="od-stat-bar"><div class="od-stat-fill" style="width:${val}%;background:${color}"></div></div>` +
        `<span class="od-stat-val">${val}</span></div>`;

    // 관계망 [C-인간관계]: 절대 우호도 기준 상위 3인
    const relations = store.getRelationships(officerId)
        .slice()
        .sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity))
        .slice(0, 3);
    const relationRows = relations.length > 0
        ? relations.map(e => {
            const other = store.getOfficer(e.target);
            if (!other) return '';
            const icon = e.affinity >= 40 ? '💚' : e.affinity <= -40 ? '💢' : '·';
            const label = e.type === 'SWORN_BROTHER' ? '의형제' : e.type === 'NEMESIS' ? '원수' : e.type === 'RIVAL' ? '라이벌' : e.type === 'FAMILY' ? '친족' : '지인';
            return `<div class="od-relation"><span>${icon} ${other.name}</span><span>${label} ${e.affinity >= 0 ? '+' : ''}${e.affinity}</span></div>`;
        }).join('')
        : '<div class="od-relation od-relation-empty">특별한 관계 없음</div>';

    const statusLabel = o.status === 'FREE' ? '재야' : o.factionId ? (store.getFaction(o.factionId)?.name ?? '-') : '-';
    const loyaltyColor = o.loyalty >= 70 ? '#4caf50' : o.loyalty >= 40 ? '#e8c35a' : '#e05a5a';

    // 무장 개인 평판 표시 [11][27]
    const odRep = getOfficerReputationVisual(o);
    const odRepRow = `<div class="od-rep-row" title="${odRep.title}"><span class="rep-badge" style="color:${odRep.color}">${odRep.icon} ${odRep.label}</span></div>`;

    // 상호작용 UI [24][32][33]: 플레이어 세력 소속 무장이 상대와 할 수 있는 행동
    const gs = store.getGlobalState();
    const myFaction = gs.playerFactionId ? store.getFaction(gs.playerFactionId) : null;
    const actingOfficers = myFaction
        ? store.getOfficersByCity(myFaction.capitalCityId ?? store.getOfficer(myFaction.leaderId)?.cityId ?? '')
            .filter(off => off.factionId === gs.playerFactionId)
        : [];
    const actor = actingOfficers.find(off => off.id !== officerId) ?? actingOfficers[0];
    const affinity = actor ? getAffinityBetween(store, actor.id, officerId) : 0;
    const affinityColor = affinity >= 30 ? '#4caf50' : affinity <= -30 ? '#e05a5a' : 'var(--text, #ddd)';
    const interactions: Array<{ kind: 'CHAT' | 'GIFT' | 'DEBATE' | 'DUEL'; label: string; enabled: boolean }> = [
        { kind: 'CHAT', label: '💬 대화', enabled: !!actor && checkInteraction(store, actor.id, officerId, 'CHAT').ok },
        { kind: 'GIFT', label: '🎁 증정', enabled: !!actor && checkInteraction(store, actor.id, officerId, 'GIFT').ok },
        { kind: 'DEBATE', label: '🎙️ 설전', enabled: !!actor },
        { kind: 'DUEL', label: '⚔️ 일기토', enabled: !!actor },
    ];
    const actionButtons = interactions.map(i =>
        `<button class="od-action-btn" data-kind="${i.kind}" data-actor="${actor?.id ?? ''}" ${i.enabled ? '' : 'disabled'}>${i.label}</button>`,
    ).join('');
    const affinityRow = actor
        ? `<div class="od-affinity-row"><span>${actor.name}과(와)의 우호도</span><b style="color:${affinityColor}">${affinity >= 0 ? '+' : ''}${affinity}</b></div>
           <div class="od-actions">${actionButtons}</div>
           <div class="od-action-msg" id="od-action-msg"></div>`
        : '';

    officerDetail.innerHTML = `
        <div class="od-name-row"><span class="od-name">${o.name}</span><span class="od-faction">${statusLabel}</span></div>
        ${odRepRow}
        ${statBar('統率', o.stats.leadership, '#5a8fd4')}
        ${statBar('武力', o.stats.might, '#d45a5a')}
        ${statBar('智力', o.stats.intelligence, '#5ad48f')}
        ${statBar('政治', o.stats.politics, '#e8c35a')}
        ${statBar('魅力', o.stats.charisma, '#c35ad4')}
        <div class="od-loyalty-row">
            <span>충성도 <b style="color:${loyaltyColor}">${o.loyalty}</b></span>
            <span>야망 <b>${o.ambition}</b></span>
        </div>
        ${affinityRow}
        <div class="od-relations-title">── 인맥 ──</div>
        ${relationRows}
    `;
}

/**
 * [Auth/officers] 런타임 무장 → 정적 데이터셋 무장 해석 결과.
 *
 * 런타임 id 는 `cao_pi` 처럼 자유 문자열이고 정적 데이터셋 id 는 `off_NNNN` 이라
 * 1:1 대응이 없다. 두 계층을 잇는 유일한 공통 표현은 한국어 이름이다.
 * `resolveOfficerIdByName()` 이 이름 → 데이터셋 id 를 담당하고, 동명이인이면
 * 임의로 고르지 않는다.
 */
type StaticOfficerLink =
    | { readonly status: 'linked'; readonly id: string; readonly traits: readonly string[]; readonly paragraphs: readonly string[] }
    | { readonly status: 'ambiguous'; readonly name: string; readonly candidateCount: number }
    | { readonly status: 'unlinked'; readonly name: string };

/**
 * 무장 이름으로 정적 데이터셋 프로필을 찾는다. 절대 던지지 않는다.
 * - 이름이 비었거나 데이터셋에 없으면 `unlinked`
 * - 동명이인이면 `ambiguous` (후보 수만 알리고, 누구인지 고르지 않는다)
 * - 유일하게 풀리면 `linked` (id · 성향 · 도장 문단)
 */
function linkStaticOfficer(name: string): StaticOfficerLink {
    if (typeof name !== 'string' || name.trim() === '') {
        return { status: 'unlinked', name: '' };
    }
    const resolution = resolveOfficerIdByName(name);
    if (resolution.status === 'not-found') {
        return { status: 'unlinked', name: resolution.name };
    }
    if (resolution.status === 'ambiguous') {
        // 동명이인: 후보를 노출만 하고 아무것도 선택하지 않는다.
        return { status: 'ambiguous', name: resolution.name, candidateCount: resolution.candidates.length };
    }
    // id 로 프로필/도장을 다시 조회한다. 어느 한쪽이 없으면 unlinked 로 내려간다.
    const profile = OFFICER_PROFILES.get(resolution.id);
    if (!profile) {
        return { status: 'unlinked', name: resolution.name };
    }
    const paragraphs = getBridgeDossierParagraphs(profile.id).filter(p => p.trim() !== '');
    return { status: 'linked', id: profile.id, traits: profile.traits, paragraphs };
}

/**
 * 성향(trait) 줄과 도장 문단을 화면에 얹기 위한 보조.
 * 값이 없으면 빈 배열이라 호출부는 그대로 렌더하면 된다( degrade ).
 */
function buildOfficerProfileLines(link: StaticOfficerLink, traitLine: string | undefined): string[] {
    const lines: string[] = [];
    if (traitLine !== undefined && traitLine.trim() !== '') {
        lines.push(`── 성향 ──`, traitLine);
    }
    if (link.status === 'linked' && link.paragraphs.length > 0) {
        lines.push(`── 도장 ──`, ...link.paragraphs);
    } else if (link.status === 'ambiguous') {
        lines.push(`── 도장 ──`, `이름이 같은 무장이 ${link.candidateCount}명 있어 기록을 특정할 수 없다.`);
    }
    return lines;
}

// 대화 분기 id를 특화 대화 상황으로 옮긴다. military/strategy는 전장 맥락으로 본다.
function mapBranchToSituation(branchId: string): DialogueContext['situation'] {
    switch (branchId) {
        case 'military':
        case 'strategy':
            return 'battle';
        case 'diplomacy':
            return 'diplomacy';
        case 'domestic':
            return 'domestic';
        default:
            return 'personal';
    }
}

// 두 무장 사이 관계를 특화 대화 태도로 옮긴다. 직접 엣지가 우선하고 없으면 소속과 우호도로 판단한다.
function mapRelationToDialogue(store: GameStore, actorId: string, targetId: string): DialogueContext['relationship'] {
    const edge = store.getRelationships(actorId).find(e => e.target === targetId);
    if (edge) {
        if (edge.type === 'SWORN_BROTHER') return 'sworn';
        if (edge.type === 'FAMILY') return 'family';
        if (edge.type === 'NEMESIS' || edge.type === 'RIVAL') return 'enemy';
    }
    const actor = store.getOfficer(actorId);
    const target = store.getOfficer(targetId);
    if (actor && target && actor.factionId && actor.factionId === target.factionId) return 'ally';
    return 'neutral';
}

function openOfficerDialogue(officerId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const target = store.getOfficer(officerId);
    if (!target) return;
    // 이름으로만 정적 데이터셋을 찾는다. id 매핑은 시도하지 않는다.
    const staticLink = linkStaticOfficer(target.name);
    const gs = store.getGlobalState();
    const playerFaction = gs.playerFactionId ? store.getFaction(gs.playerFactionId) : null;
    const playerOfficers = playerFaction
        ? store.getOfficersByFaction(playerFaction.id).filter(o => o.id !== target.id)
        : [];
    const selectedActor = store.getOfficer(gs.selectedOfficerId ?? '');
    const actor = selectedActor && selectedActor.id !== target.id
        ? selectedActor
        : playerOfficers[0] ?? (playerFaction ? store.getOfficer(playerFaction.leaderId) : null);
    if (!actor || actor.id === target.id) {
        openDialogue({
            pages: [{
                title: `${target.name} — 무장 기록`,
                subtitle: target.factionId ? store.getFaction(target.factionId)?.name ?? '무소속' : '재야',
                speaker: target.name,
                speakerId: target.id,
                text: '대화를 시작할 행위자를 먼저 선택하세요.',
                detail: [
                    `統率 ${target.stats.leadership} · 武力 ${target.stats.might}`,
                    `智力 ${target.stats.intelligence} · 政治 ${target.stats.politics} · 魅力 ${target.stats.charisma}`,
                    ...buildOfficerProfileLines(staticLink, undefined),
                ],
            }],
            index: 0,
        });
        return;
    }

    const affinity = getAffinityBetween(store, actor.id, target.id);
    // 성향이 풀렸을 때만 id·traits 를 넘긴다. 동명이인이면 아무 id 도 주지 않는다 —
    // 잘못된 성향이 붙는 것보다 성향 줄이 없는 편이 낫다.
    const dialogueOfficer = staticLink.status === 'linked'
        ? { name: target.name, personality: target.personality, id: staticLink.id, traits: staticLink.traits }
        : target;
    const conversationBranch = conversationSystem.getDialogueBranch(
        dialogueOfficer,
        affinity >= 30 ? 'personal' : target.stats.might >= target.stats.intelligence ? 'military' : 'strategy',
        affinity,
        { includeTraitLine: true },
    );
    // 특화 대화 — 성향/능력치/관계/상황 조합으로 무장마다 다른 대사를 뽑는다.
    const specialized = engine.dialogueEngine.generateDialogue({
        officerId: target.id,
        situation: mapBranchToSituation(conversationBranch.id),
        relationship: mapRelationToDialogue(store, actor.id, target.id),
        affinity,
    });
    const specializedText = specialized.text.replace(/^[^:]+:\s*/, '');
    const status = target.status === 'FREE' ? '재야 무장' : store.getFaction(target.factionId!)?.name ?? '무소속';
    const chooseInteraction = (kind: 'CHAT' | 'GIFT' | 'DEBATE' | 'DUEL'): DialogueChoice => {
        const gate = checkInteraction(store, actor.id, target.id, kind);
        return {
            id: kind,
            label: kind === 'CHAT' ? '교대 인사를 건넨다' : kind === 'GIFT' ? '선물을 보낸다' : kind === 'DEBATE' ? '설전을 요청한다' : '일기토를 요청한다',
            description: gate.ok ? (kind === 'GIFT' ? '200金 · 우호도 상승' : '즉시 결과 확인') : gate.reason ?? '선택 불가',
            disabled: !gate.ok,
            onSelect: () => {
                const result = executeInteraction(store, actor.id, target.id, kind);
                if (result.success) addLog(result.message);
                renderOfficerDetail(target.id);
                return result.message;
            },
        };
    };

    // 대화창 구성 원칙: 좌측 상단에 화자 정보, 본문은 새 조립기가 만든다.
    const gsNow = store.getGlobalState();
    const topicOf = (branchId: string): DialogueTopic =>
        (['military', 'strategy', 'domestic', 'diplomacy', 'personal'] as const)
            .find(t => t === branchId) ?? 'personal';
    const composed = composeDialogue({
        speaker: {
            name: target.name,
            traitLine: conversationBranch.traitLine,
            factionName: status,
        },
        listener: { name: actor.name },
        topic: topicOf(conversationBranch.id),
        affinity,
        year: gsNow.time.year,
        month: gsNow.time.month,
        stateLine: `통솔 ${target.stats.leadership} · 무력 ${target.stats.might} · 지력 ${target.stats.intelligence}`,
    });

    // 전략 건의 — 목표 무장의 능력에 따라 건넬 수 있는 계책이 달라진다.
    const strategySystem = new StrategicOptionSystem(store, engine.diplomacyEngine);
    const counselContext = {
        officerId: target.id,
        turnCount: store.getGlobalState().turnCount,
        factionStrength: playerFaction?.gold ?? 0,
        counterpartFactionId: target.factionId && target.factionId !== gs.playerFactionId ? target.factionId : undefined,
    };
    const counselCategoryLabel = { diplomacy: '외교', battle: '전투', domestic: '내정' } as const;
    const strategyPages: DialoguePage[] = (['diplomacy', 'battle', 'domestic'] as const).map(category => {
        const context = { ...counselContext, category };
        const counselOptions = strategySystem.getOptions(context);
        return {
            title: `${target.name}의 ${counselCategoryLabel[category]} 건의`,
            subtitle: `가용한 계책 ${counselOptions.length}건 · ${status}`,
            speaker: target.name,
            speakerId: target.id,
            text: counselOptions.length > 0
                ? `${target.name}이(가) ${counselCategoryLabel[category]} 방면으로 건넬 수 있는 계책이다.`
                : `${target.name}은(는) 지금 ${counselCategoryLabel[category]} 방면으로 건넬 계책이 없다.`,
            detail: counselOptions.map(o =>
                `${o.title} — ${o.description} (요건: ${o.requirements.join(' · ') || '없음'} / 효과: ${o.effects.join(' · ')})`,
            ),
            choices: counselOptions.map(o => ({
                id: `counsel:${o.id}`,
                label: o.title,
                description: `${o.description} · 우호도 ${o.affinityImpact >= 0 ? '+' : ''}${o.affinityImpact}`,
                onSelect: () => {
                    const result = strategySystem.executeOption(o.id, context);
                    addAffinity(store, actor.id, target.id, o.affinityImpact, '전략 건의');
                    const msg = result.success ? `${target.name}의 ${o.title} — ${result.message}` : result.message;
                    addLog(msg);
                    renderOfficerDetail(target.id);
                    return msg;
                },
            })),
        };
    });

    openDialogue({
        pages: [
            {
                title: conversationBranch.title,
                subtitle: `${status} · 우호도 ${affinity >= 0 ? '+' : ''}${affinity}`,
                speaker: target.name,
                speakerId: target.id,
                text: composed,
                detail: [
                    `현재 우호도 ${affinity >= 0 ? '+' : ''}${affinity}`,
                    `장기 ${target.personality} · 충성도 ${target.loyalty} · 명성 ${target.fame}`,
                    ...(conversationBranch.traitLine !== undefined ? [conversationBranch.traitLine] : []),
                    '── 특화 ──',
                    specializedText,
                ],
                choices: [chooseInteraction('CHAT')],
                giftComposer: {
                    actorId: actor.id,
                    targetId: target.id,
                    currentAffinity: affinity,
                },
            },
            {
                title: `${target.name}의 특화 대화`,
                subtitle: `${status} · 성향 ${target.personality} · 감정 ${specialized.emotion}`,
                speaker: target.name,
                speakerId: target.id,
                text: specializedText,
                detail: [
                    `상황 ${mapBranchToSituation(conversationBranch.id)} · 관계 ${mapRelationToDialogue(store, actor.id, target.id)} · 우호도 ${affinity >= 0 ? '+' : ''}${affinity}`,
                ],
                choices: specialized.choices.map(choice => {
                    const req = choice.statRequirement;
                    const lacking = req !== undefined && actor.stats[req.stat] < req.value;
                    return {
                        id: `special:${choice.id}`,
                        label: choice.label,
                        description: `${choice.description}${req !== undefined ? ` · 필요 ${req.stat} ${req.value}` : ''}${choice.affinityDelta !== 0 ? ` · 우호도 ${choice.affinityDelta >= 0 ? '+' : ''}${choice.affinityDelta}` : ''}`,
                        disabled: lacking,
                        onSelect: () => {
                            if (lacking) return '능력이 부족해 선택할 수 없다.';
                            addAffinity(store, actor.id, target.id, choice.affinityDelta, '특화 대화');
                            const msg = `${target.name} — “${choice.label}” (우호도 ${choice.affinityDelta >= 0 ? '+' : ''}${choice.affinityDelta})`;
                            addLog(msg);
                            renderOfficerDetail(target.id);
                            return msg;
                        },
                    };
                }),
            },
            {
                title: `${target.name}의 능력과 경력`,
                subtitle: '상세 정보를 확인하고 행동 방침을 선택하세요',
                speaker: `${actor.name}의 판단`,
                text: `${target.name}의 기질과 경험을 읽으면 어떤 임무를 맡길지 더 나은 판단을 내릴 수 있습니다.`,
                detail: [
                    `統率 ${target.stats.leadership} · 武力 ${target.stats.might} · 智力 ${target.stats.intelligence}`,
                    `政治 ${target.stats.politics} · 魅力 ${target.stats.charisma} · 야망 ${target.ambition}`,
                    `상호작용 기록 ${store.getRelationships(target.id).reduce((sum, edge) => sum + edge.history.length, 0)}건`,
                    `상태 ${status} · 위치 ${target.cityId ? store.getCity(target.cityId)?.name ?? '미상' : '미상'}`,
                    ...buildOfficerProfileLines(staticLink, conversationBranch.traitLine),
                ],
            },
            ...strategyPages,
            {
                title: `${target.name}에게 어떤 말을 건넬까?`,
                subtitle: '선택한 행동은 즉시 우호도와 기록에 반영됩니다',
                speaker: actor.name,
                text: '관계는 한 번의 선택이 아니라 계속된 대화로 만들어집니다.',
                choices: [chooseInteraction('DEBATE'), chooseInteraction('DUEL')],
            },
        ],
        index: 0,
    });
}

// 무장 목록 클릭 → 상세 정보 + 선택형 대화 [24][27]
// [2026-10-03] 대상이 상시 존재하던 #cdp-officers → 살아 있는 상위 #cdp-sheet-body 로 바뀐다.
//   무장 목록은 시트를 열 때 만들어졌다가 닫을 때 지워진다. 요소에 직접 걸면
//   두 번째 도시를 열 때 리스너가 옛 DOM 에 남아 조용히 죽는다.
cdpOfficersContainer?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.cdp-officer-clickable') as HTMLElement | null;
    if (!row) return;
    const officerId = row.dataset.officerId ?? null;
    renderOfficerDetail(officerId);
    if (officerId) openOfficerDialogue(officerId);
});

// 도시 시설 클릭 → 시설별 선택형 대화/투자 [49]
cdpFacilities.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest('.cdp-facility') as HTMLElement | null;
    if (!button || !currentPanelCityId) return;
    openFacilityDialogue(currentPanelCityId, button.dataset.facility as FacilityType);
});

// 상호작용 버튼 클릭 → 대화/증정/설전/일기토 실행 [24][32][33]
officerDetail.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.od-action-btn') as HTMLButtonElement | null;
    if (!btn || btn.disabled || !engine) return;
    const kind = btn.dataset.kind as 'CHAT' | 'GIFT' | 'DEBATE' | 'DUEL';
    const actorId = btn.dataset.actor;
    const targetId = officerDetail.dataset.officerId;
    if (!actorId || !targetId) return;

    const store = engine['store'];
    const result = executeInteraction(store, actorId, targetId, kind);
    renderOfficerDetail(targetId); // 우호도/버튼 상태 갱신 (메시지보다 먼저 — 재렌더가 내용을 지움)
    const msg = officerDetail.querySelector('#od-action-msg');
    if (msg) {
        msg.textContent = result.message;
        msg.classList.toggle('is-err', !result.success);
    }
    if (result.success) addLog(result.message);
});

document.getElementById('cdp-close')!.addEventListener('click', () => {
    stopCityAmbient();
    cityDetailPanel.classList.remove('city-entry-mode');
    cityDetailPanel.style.display = 'none';
    citySceneCanvas?.classList.remove('is-active');
    if (lastCityView) chinaMap.setView(lastCityView);
    if (currentPanelCityId) {
        worldCities = worldCities.map(city => ({ ...city, isSelected: city.id === currentPanelCityId }));
        chinaMap.setCities(worldCities);
    }
    canvas.focus({ preventScroll: true });
});

/**
 * [2026-10-03] 좌·우 사이드바(레일)를 걷어내고 그림 위 정보 시트로 대체했다.
 *
 * 왜 — 실측(1001x900)에서 좌측 레일이 무대의 1.2%~19.2%(180px)를 먹으며 병영·농지
 * 배지를 각각 2% 까지 밀어 배지 반쪽이 화면 밖으로 잘랐다. 우측 레일(23% 폭)까지
 * 겹치면 가장 좁은 창에서 그림의 47% 가 사라진다. 그래서 1100px 기준 자동 접힘,
 * 리사이즈마다 접힘 재계산, 접힘 상태 배지 재계산까지 붙었다가 전부 복잡해졌다.
 *
 * 지금 — 레일을 DOM 에서 없앴다. 같은 정보(주둔 무장·내정 명령·포로 기록·세력·무장)는
 * 그림 위 오버레이(#cdp-scene-sheet)에 담고, 건물 배지를 누를 때만 연다. 닫으면
 * 그림이 온전히 보이고, 리사이즈에 따라 접히거나 재계산할 것도 없어졌다.
 */
function openCitySceneSheet(city: import('./core/types.js').City): void {
    const sheet = document.getElementById('cdp-scene-sheet');
    const body = document.getElementById('cdp-sheet-body');
    if (!sheet || !body || !engine) return;
    const store = engine['store'];
    const gs = store.getGlobalState();
    const isPlayerCity = city.ownerId === gs.playerFactionId;

    // 좌측 레일 내용(성주·명령·史記)과 우측 레일 내용(세력·무장)을 한 흐름으로 담는다.
    // 렌더 함수는 그대로 재사용한다 — 내용은 그대로 두고 위치만 옮겼다.
    const commanderSlot = document.createElement('div');
    commanderSlot.id = 'city-commander';
    const groupsSlot = document.createElement('div');
    groupsSlot.id = 'cdp-command-groups';
    const resultSlot = document.createElement('div');
    resultSlot.id = 'cdp-action-result';
    const factionsSlot = document.createElement('div');
    factionsSlot.id = 'cdp-factions';
    const officersSlot = document.createElement('div');
    officersSlot.id = 'cdp-officers';

    body.replaceChildren();
    body.append(commanderSlot, groupsSlot, resultSlot);
    body.insertAdjacentHTML('beforeend',
        '<div class="cdp-section-title">諸侯 — 세력 정보</div>');
    body.append(factionsSlot);
    body.insertAdjacentHTML('beforeend',
        '<div class="cdp-section-title">武將 — 무장 목록 <span id="cdp-officer-count" class="cdp-count"></span></div>');
    body.append(officersSlot);

    renderCityCommander(city);
    renderCityCommandGroups(city, isPlayerCity);
    renderCityFactions(city);
    renderCityOfficerList(city);
    sheet.hidden = false;
    // 시트가 그림을 덮으므로 배지를 다시 확정한다 — 닫았을 때도 같은 이유로 되돌린다.
    requestAnimationFrame(applyCitySceneBadgePositions);
}

function closeCitySceneSheet(): void {
    const sheet = document.getElementById('cdp-scene-sheet');
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.getElementById('cdp-sheet-body')?.replaceChildren();
    requestAnimationFrame(applyCitySceneBadgePositions);
}

document.getElementById('cdp-sheet-close')?.addEventListener('click', closeCitySceneSheet);

// [2026-10-04] 이동 모드 취소 — ESC. 토스트의 취소 버튼만으로도 되지만,
//   지도를 켠 뒤 아무것도 안 누른 상태에서 빠져나갈 수단이 필요하다.
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && travelModeActive) cancelTravel();
});

/** 내정치 바 한 줄 생성 — 값→HTML 변환은 src/core/city_scene_art.ts 의 순수 함수가 한다. */
function statBar(label: string, value: number, max: number, color: string): string {
    return renderStatBar({ label, value, max, color });
}

const FACILITY_INFO: Record<FacilityType, { label: string; effect: string; icon: string }> = {
    [FacilityType.PALACE]: { label: '저택', effect: '도시 충성 +2', icon: '🏛️' },
    [FacilityType.WALL]: { label: '성벽', effect: '방어력 +3', icon: '🧱' },
    [FacilityType.MARKET]: { label: '시장', effect: '상업 +3', icon: '🏪' },
    [FacilityType.FARM]: { label: '농장', effect: '농업 +3', icon: '🌾' },
    [FacilityType.TAVERN]: { label: '주막', effect: '치안 +2', icon: '🍶' },
    [FacilityType.BLACKSMITH]: { label: '대장간', effect: '기술 +2', icon: '⚒️' },
    [FacilityType.GRANARY]: { label: '창고', effect: '월 식량 수입 +10', icon: '🏚️' },
    [FacilityType.BARRACKS]: { label: '훈련장', effect: '도시 병력 +2', icon: '🎯' },
};

function getFacilityRows(city: import('./core/types.js').City): Array<{ type: FacilityType; level: number; maxLevel: number; investment: number }> {
    const existing = new Map(city.facilities.map(f => [f.type, f]));
    // 도시 운영 패널: 모든 핵심 시설을 선택 가능하게 하되,
    // 아직 건설되지 않은 시설은 Lv.0으로 표시해 실제 건설 상태를 구분한다. [49]
    const defaults: FacilityType[] = [
        FacilityType.PALACE, FacilityType.WALL, FacilityType.MARKET, FacilityType.FARM,
        FacilityType.TAVERN, FacilityType.BLACKSMITH, FacilityType.GRANARY, FacilityType.BARRACKS,
    ];
    const types = new Set<FacilityType>([...existing.keys(), ...defaults]);
    return [...types].map(type => existing.get(type) ?? { type, level: 0, maxLevel: 3, investment: 0 });
}

function renderFacilityList(city: import('./core/types.js').City, isPlayerCity: boolean): void {
    cdpFacilities.innerHTML = getFacilityRows(city).map(facility => {
        const info = FACILITY_INFO[facility.type];
        return `<button class="cdp-facility" data-facility="${facility.type}" title="${isPlayerCity ? '클릭하여 상세 대화와 투자' : '클릭하여 상세 대화'}">
            <span class="cdp-facility-name">${info.icon} ${info.label}</span>
            <span class="cdp-facility-level">Lv.${facility.level}/${facility.maxLevel}</span>
        </button>`;
    }).join('');
}

function applyFacilityInvestment(city: import('./core/types.js').City, type: FacilityType): { success: boolean; message: string } {
    const store = engine['store'];
    const existing = city.facilities.find(f => f.type === type);
    const level = existing?.level ?? 0;
    const maxLevel = existing?.maxLevel ?? 3;
    const cost = 100 + level * 50;
    if (level >= maxLevel) return { success: false, message: `${FACILITY_INFO[type].label}은(는) 이미 최대 단계입니다.` };
    if (city.funds < cost) return { success: false, message: `도시 자금이 부족합니다 (${cost}金 필요).` };

    const nextLevel = level + 1;
    const facilities = existing
        ? city.facilities.map(f => f.type === type ? { ...f, level: nextLevel, investment: f.investment + cost } : f)
        : [...city.facilities, { type, level: nextLevel, maxLevel, investment: cost }];
    const updates: Partial<import('./core/types.js').City> = {
        funds: city.funds - cost,
        facilities,
    };
    const ds = { ...city.developmentStats };
    switch (type) {
        case FacilityType.PALACE: updates.loyalty = Math.min(100, city.loyalty + 2); break;
        case FacilityType.WALL: updates.defense = Math.min(city.maxDefense, city.defense + 3); break;
        case FacilityType.MARKET: ds.commerce = Math.min(ds.maxCommerce, ds.commerce + 3); break;
        case FacilityType.FARM: ds.farming = Math.min(ds.maxFarming, ds.farming + 3); break;
        case FacilityType.TAVERN: ds.publicOrder = Math.min(ds.maxPublicOrder, ds.publicOrder + 2); break;
        case FacilityType.BLACKSMITH: ds.technology = Math.min(ds.maxTechnology, ds.technology + 2); break;
        case FacilityType.GRANARY: updates.foodIncome = city.foodIncome + 10; break;
        // [결함 수정] 병력 상한을 인구 비례로. 예전엔 +2 무제한이라
        // 시설을 반복 건설하면 병력이 무한히 늘었고, 다른 곳(BARRACKS 건물)은
        // 1000 으로 또 다른 상한을 써 같은 건물이 다르게 동작했다.
        case FacilityType.BARRACKS: updates.development = Math.min(garrisonCap(city), city.development + 120); break;
    }
    updates.developmentStats = ds;
    store.updateCity(city.id, updates);
    return { success: true, message: `${FACILITY_INFO[type].label} Lv.${nextLevel} 개량 완료 (${cost}金) · ${FACILITY_INFO[type].effect}` };
}

function openFacilityDialogue(cityId: string, type: FacilityType): void {
    if (!engine) return;
    const store = engine['store'];
    const city = store.getCity(cityId);
    if (!city) return;
    // 시장/창고는 '설비 투자' 창이 아니라 사건 대화가 먼저다. [신규 기능]
    if (type === FacilityType.MARKET) { openMarketDialogue(cityId); return; }
    const isPlayerCity = city.ownerId === store.getGlobalState().playerFactionId;
    const row = getFacilityRows(city).find(item => item.type === type);
    if (!row) return;
    const info = FACILITY_INFO[type];
    const cost = 100 + row.level * 50;
    openDialogue({
        pages: [
            {
                title: `${city.name} · ${info.label}`,
                subtitle: `도시 시설 Lv.${row.level}/${row.maxLevel}`,
                speaker: `${info.icon} ${info.label}`,
                // 시설은 사람이 아니다 — 왼쪽 열에 글자 표식을 쓴다.
                placeMark: info.icon,
                text: `${info.label}은(는) ${city.name}의 운영 능력을 보여줍니다. 현재 투자는 ${row.investment}金, 다음 단계 투자는 ${cost}金입니다.`,
                detail: [
                    `현재 효과 ${info.effect}`,
                    `도시 자금 ${city.funds}金 · 인구 ${city.population.toLocaleString()}`,
                    `충성 ${city.loyalty} · 치안 ${city.developmentStats.publicOrder}`,
                ],
                choices: isPlayerCity ? [{
                    id: 'invest',
                    label: `${cost}金 투자하여 개량한다`,
                    description: info.effect,
                    disabled: row.level >= row.maxLevel || city.funds < cost,
                    onSelect: () => {
                        const result = applyFacilityInvestment(city, type);
                        addLog(result.message);
                        const updated = store.getCity(cityId);
                        if (updated) renderCityDetailPanel(updated, updated.ownerId ? store.getFaction(updated.ownerId) : null, false);
                        return result.message;
                    },
                }] : [],
            },
            {
                title: `${info.label} 상세 기록`,
                subtitle: '시설 운영 정보를 직접 확인합니다',
                speaker: '도시 운영 기록',
                text: '시설의 단계와 효과는 도시 패널과 세이브에 함께 보존됩니다.',
                detail: [
                    `단계 Lv.${row.level}/${row.maxLevel}`,
                    `누적 투자 ${row.investment}金`,
                    `다음 개량 비용 ${cost}金`,
                ],
            },
        ],
        index: 0,
    });
}

/** 도시 진입 화면의 등각투영 건물 배치도를 렌더링한다. [49][D32] */
function playCitySceneTone(kind: 'enter' | 'invest' | 'toggle'): void {
    try {
        const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtor) return;
        const context = new AudioCtor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = kind === 'invest' ? 520 : kind === 'toggle' ? 330 : 220;
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.2);
        oscillator.addEventListener('ended', () => void context.close(), { once: true });
    } catch {
        // 오디오 권한/브라우저 제약이 있어도 도시 기능은 계속 동작한다.
    }
}

/** 도시 낮밤 옵셋 — 디버그/E2E용 시간 점프 (밀리초). */
let cityTimeOffsetMs = 0;

function currentNightFactor(): number {
    return dayNightPhase(Date.now() + cityTimeOffsetMs).nightFactor;
}

/** 씬 캔버스만 다시 그린다 — 주야 틱·투자 갱신용. DOM(배지·초상·힌트)은 손대지 않는다. */
function drawCityCanvas(city: import('./core/types.js').City): void {
    if (!citySceneCanvas) return;
    const ctx = citySceneCanvas.getContext('2d');
    if (!ctx) return;

    // [2026-10-03 실제 결함 수정] 캔버스 backing-store 가 480x240 으로 고정돼 있었다.
    //   CSS 가 캔버스를 무대 크기(예: 1920x1080)로 늘리므로, 창을 키워도 내부는
    //   480x240 그대로였다 — 화면이 4배로 확대된 듯 흐리고 배율도 어긋났다.
    //   사용자가 "도시화면 좌우 리사이징이 안 된다" 고 본 것이 이것이다
    //   (DOM/이미지 쪽 리사이즈는 정상이고, 캔버스 내부 해상도만 따라가지 않았다).
    //
    //   해법: 무대 rect × devicePixelRatio 로 backing-store 를 맞춘다(지도 캔버스와 동일).
    //   셀렉터는 CSS 에서 쓰는 .city-scene-canvas 그대로 쓴다.
    const stageEl = citySceneCanvas.closest('.city-scene-stage') ?? citySceneCanvas;
    const rect = stageEl.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round((rect.width || citySceneCanvas.clientWidth || 480) * dpr));
    const height = Math.max(1, Math.round((rect.height || citySceneCanvas.clientHeight || 240) * dpr));
    if (citySceneCanvas.width !== width || citySceneCanvas.height !== height) {
        citySceneCanvas.width = width;
        citySceneCanvas.height = height;
    }
    const night = currentNightFactor();
    ctx.clearRect(0, 0, width, height);

    // 그림이 준비되면 캔버스는 **밤 안개만 얹는 층**이 된다. 그림은 <img> 가 밑에
    // 깔려 있고, 여기서 불투명 배경을 칠하면 그림이 가려진다.
    if (citySceneArtReady) {
        const seasonNow = engine?.['store'].getGlobalState().season ?? 'SPRING';
        const devNow = Math.max(1, Math.min(5, city.development / 20));
        const statesNow = engine?.['store'].getGlobalState().cityBuildingStates?.[city.id] ?? {};
        // 배치는 그림이 있어도 항상 다시 만들어야 한다 — 재사용하면 저장된
        // 투자·레벨 상태가 반영되지 않아 투자 직후 화면이 안 바뀐다.
        citySceneBuildings = citySceneRenderer.generateCityLayout(city.id, devNow, seasonNow, statesNow);
        citySceneCityId = city.id;
        citySceneRenderer.applyNightTint(ctx, width, height, night);
        return;
    }

    ctx.fillStyle = night > 0.5 ? '#141c2e' : '#26382c';
    ctx.fillRect(0, 0, width, height);

    // 지도 위에 도시가 놓인 느낌을 주는 가벼운 격자
    ctx.strokeStyle = 'rgba(220, 210, 170, 0.10)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 32) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += 24) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    const season = engine?.['store'].getGlobalState().season ?? 'SPRING';
    const developmentLevel = Math.max(1, Math.min(5, city.development / 20));
    const buildingStates = engine?.['store'].getGlobalState().cityBuildingStates?.[city.id] ?? {};
    const buildings = citySceneRenderer.generateCityLayout(city.id, developmentLevel, season, buildingStates);
    citySceneBuildings = buildings;
    citySceneCityId = city.id;
    const sorted = [...buildings].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const gridRadius = Math.ceil(Math.sqrt(Math.max(1, buildings.length)));
    const blossom = season === 'SPRING' ? '#f4a7c3' : season === 'SUMMER' ? '#8fce7a' : season === 'AUTUMN' ? '#e8955a' : '#d8d8e2';

    // [2026-10-03] 캔버스가 창 크기를 따라가므로 타일 크기도 따라가야 한다.
    //   예전엔 42x21 로 고정이라 창이 커지면 도심이 한쪽에 작게 몰려 있었다.
    //   기준 높이 240px(예전 고정 높이) 대비 비율로 타일·오프셋·글자를 함께 늘린다.
    const BASE_H = 240;
    const scale = Math.max(0.25, height / BASE_H);
    const tileW = Math.round(42 * scale);
    const tileH = Math.round(21 * scale);
    const originYOff = Math.round(28 * scale);

    ctx.save();
    ctx.translate(width / 2, height / 2 + originYOff);
    for (const decor of generateDecorations(city.id, gridRadius)) {
        citySceneRenderer.renderDecor(ctx, decor, tileW, tileH, night, blossom);
    }
    for (const building of sorted) {
        citySceneRenderer.renderBuilding(ctx, building, tileW, tileH, night);
        const point = citySceneRenderer.worldToScreen(building.x, building.y, tileW, tileH);
        ctx.fillStyle = night > 0.5 ? 'rgba(255, 230, 170, 0.95)' : 'rgba(255, 248, 210, 0.9)';
        ctx.font = `${Math.max(9, Math.round(9 * scale))}px "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(building.label, point.sx, point.sy + 14 * scale);
    }
    ctx.restore();
    citySceneRenderer.applyNightTint(ctx, width, height, night);
}

/** 도시 낮밤 자동 순환 타이머 — 패널이 열려 있을 때만 0.5초마다 다시 그린다. */
let cityAmbient: AmbientTicker | null = null;

function startCityAmbient(cityId: string): void {
    stopCityAmbient();
    cityAmbient = createAmbientTicker(CITY_AMBIENT_INTERVAL_MS, () => {
        if (!engine || !citySceneCanvas) return;
        const city = engine['store'].getCity(cityId);
        if (!shouldRedrawAmbient({
            sceneActive: citySceneCanvas.classList.contains('is-active'),
            cityExists: !!city,
            drawnCityId: citySceneCityId,
            targetCityId: cityId,
        })) return;
        drawCityCanvas(city!);
    });
    cityAmbient.start();
}

function stopCityAmbient(): void {
    cityAmbient?.stop();
    cityAmbient = null;
}

function renderCityScene(city: import('./core/types.js').City): void {
    if (!citySceneCanvas) return;
    drawCityCanvas(city);

    const season = engine?.['store'].getGlobalState().season ?? 'SPRING';
    selectedCitySceneBuilding = null;
    // [2026-10-03] 캔버스가 창 크기를 따라가므로 배지 좌표도 실제 크기로 계산한다.
    //   예전엔 480x240 고정이라 창이 커지면 배지가 그림 왼쪽 위로 몰렸다.
    renderCitySceneBadges(citySceneBuildings, citySceneCanvas.width, citySceneCanvas.height);
    renderCityCommander(city);
    renderCitySeason(season);
    renderCityHint(city);
    if (citySceneSummary) {
        const counts = new Map<string, number>();
        for (const building of citySceneBuildings) counts.set(building.label, (counts.get(building.label) ?? 0) + 1);
        citySceneSummary.innerHTML = Array.from(counts.entries())
            .map(([label, count]) => `<span class="city-building-chip">${label} × ${count}</span>`)
            .join('');
    }
    showCitySceneBuildingDetail(null);
    citySceneCanvas.classList.add('is-active');
    playCitySceneTone('enter');
    startCityAmbient(city.id);
}

/**
 * HUD 패널 rect → 무대 % 인셋 목록.
 *
 * 유리 패널이라 앵커를 완전히 가린다. 패널이 숨었거나 크기가 0 이면 인셋이 아니다
 * (도시를 열기 전에는 전부 0 이다). 무대가 아직 레이아웃되지 않았으면 빈 목록을 돌려야
 * 0 으로 나누어 배지를 조용히 잃지 않는다.
 *
 * 마지막 셋은 그림 *안쪽*에 얹힌 HUD(좌·우 레일, 하단 시설줄)다. 앞의 둘은 무대 바깥의
 * 패널이라 배지가 그림 위로 밀려날 일이 없지만, 이 셋은 그림을 덮으므로 반드시 포함해야 한다.
 */
function measureCitySceneInsets(): SceneInset[] {
    const stage = document.getElementById('city-scene-stage');
    if (!stage) return [];
    const stageRect = stage.getBoundingClientRect();
    if (!isVisibleRect(stageRect)) return [];

    // 좌표 변환은 src/core/city_scene_art.ts 의 순수 함수(toStageInset)가 한다.
    // 여기서는 "어느 패널이 보여 주는가" 만 판단한다 — 브라우저 없이 계산 자체를 검증할 수 있게.
    const insets: SceneInset[] = [];
    // [2026-10-03] 좌·우 레일이 없어 인셋은 상단 바·하단 시설줄·(열린 시트)만 읽는다.
//   시트는 기본(hidden)이라 닫혀 있을 때 인셋에 들어가지 않고, 배지를 그림 위에 그대로 둔다.
    for (const selector of ['.cdp-header', '.cdp-scene-sheet:not([hidden])', '.cdp-stage-hud-bottom']) {
        const pane = document.querySelector(selector);
        if (!pane) continue;
        const rect = pane.getBoundingClientRect();
        if (!isVisibleRect(rect)) continue;
        insets.push(toStageInset(rect, stageRect));
    }
    return insets;
}

/**
 * 배지 좌표를 HUD 가 덮지 않는 곳으로 확정한다.
 *
 * 앵커는 data-anchor-* 에 "희망 좌표(그림의 %)"로 남아 있고, 여기서 실측 인셋을 곁들여
 * 눌릴 수 있는 좌표를 style.left/top 에 쓴다. 측정 못 하면(패널 아직 숨김) 희망 좌표 그대로 쓴다.
 *
 * [2026-10-02 — 무대가 창 크기 그대로가 되면서 새로 넣은 단계]
 * 앵커는 *그림의 %* 인데 무대는 이제 16:9 가 아니라 창 비율이다. .city-scene-art 의
 * object-fit: cover 가 그림을 잘라내므로, 무대 % 를 그림 % 라고 그냥 쓰면 배지가
 * 잘린 뒤의 엉뚱한 곳을 가리킨다(실측 최대 470px). 그래서 mapAnchorToStage() 로
 * cover 사각형을 한 번 더 적용해 "무대 위 %"로 되돌린 *다음에* HUD 회피를 푼다.
 * 순서가 중요한다 — 인셋은 무대 % 기준이므로 보정 후에 비교해야 같은 좌표계다.
 */
function applyCitySceneBadgePositions(): void {
    const layer = document.getElementById('city-scene-badges');
    if (!layer) return;
    const buttons = Array.from(layer.querySelectorAll<HTMLButtonElement>('.city-badge'));
    if (buttons.length === 0) return;

    const stage = document.getElementById('city-scene-stage');
    const stageRect = stage?.getBoundingClientRect();
    const insets = measureCitySceneInsets();
    // 그림이 없으면(로드 전/실패) 앵커는 절차 렌더용 타원 링이라 그대로 쓴다.
    const artWidth = citySceneArt?.naturalWidth ?? 0;
    const artHeight = citySceneArt?.naturalHeight ?? 0;
    const onStage = (anchor: { x: number; y: number }): { x: number; y: number } =>
        citySceneArtReady && stageRect && stageRect.width > 0 && stageRect.height > 0
            ? mapAnchorToStage(anchor, artWidth, artHeight, stageRect.width, stageRect.height)
            : anchor;

    // [2026-10-03 되돌림] 여기에 배지 반폭을 크롭 마진에 섞으면 안 된다.
    //   좁은 창에서 배지 일부가 잘리는 문제는 *의도된* 처리다. clampAnchorToCover 의
    //   계약은 "잘린 건물의 배지는 크롭 경계에 붙는다" 이며, E2E(city_art_measure)가
    //   경계에서 45px 이내를 정상으로 판정한다(EDGE_TOL_PX).
    //   반폭을 더하니 배지가 안쪽으로 밀려(768x1024 교역소: 경계 1162.6 → 실측
    //   1143.4 = 19px 안쪽) 그 자리에 있는 다른 건물을 가리키게 됐다.
    //   배지 반쪽이 보이는 것은 "이 창에서는 저쪽 편" 이라는 사실을 알리는 대가이고,
    //   엉뚱한 건물을 가리키는 것보다 낫다.
    //   배지 자체 폭은 아래(겹침 간격 계산)에서 쓰고, 여기선 앵커 % 만 다룬다.
    const badgeRect = buttons[0].getBoundingClientRect();

    const resolved = buttons.map(btn => {
        const onStageAnchor = onStage({
            x: Number(btn.dataset.anchorX),
            y: Number(btn.dataset.anchorY),
        });
        // [2026-10-03] 잘려 나간 앵커를 크롭 경계로 되돌린 **다음에** HUD 회피를 푼다.
        //   순서가 반대면 clampToStage(2..98) 가 크롭 경계에 배지를 밀착시켜
        //   다른 건물 위를 가리킨다(실측: 병영 370px → 497.6px, 127.6px 어긋남).
        const inView = clampAnchorToCover(onStageAnchor);
        return resolveVisibleAnchor(inView, insets);
    });

    // 겹침을 푸 때의 최소 간격은 배지 실제 크기를 무대 %로 바꿔 쓴다. 34px 를 상수로 박으면
    // CSS 로 배지가 커졌을 때 조용히 겹친다.
    const minGapX = stageRect && stageRect.width > 0 ? badgeRect.width / stageRect.width * 100 : 0;
    const minGapY = stageRect && stageRect.height > 0 ? badgeRect.height / stageRect.height * 100 : 0;

    const placed = separateOverlaps(resolved, minGapX, minGapY);
    buttons.forEach((btn, i) => {
        btn.style.left = `${placed[i].x.toFixed(1)}%`;
        btn.style.top = `${placed[i].y.toFixed(1)}%`;
    });
}

/** 씬 위 시설 배지 — 타입별 1개씩, 클릭하면 캔버스 클릭과 같은 선택 흐름을 탄다. */
function renderCitySceneBadges(buildings: CityBuilding[], width: number, height: number): void {
    const layer = document.getElementById('city-scene-badges');
    if (!layer) return;
    // 타입별 1개씩 타원 슬롯에 배치 — % 단위 혼용 거리 계산 대신 겹침 없는 고정 슬롯을 쓴다.
    const picked: CityBuilding[] = [];
    const seen = new Set<string>();
    for (const building of buildings) {
        if (seen.has(building.type)) continue;
        seen.add(building.type);
        picked.push(building);
    }
    const badges: string[] = picked.map((building, i) => {
        // 그림이 있으면 그림 위 좌표를 쓴다. 없으면 종전 타원 링 — 앵커는 그림 전용이라
        // 절차 렌더와 어긋난다.
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, picked.length);
        const preferred = citySceneArtReady
            ? anchorFor(building.type, i, picked.length)
            : { x: 50 + 42 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) };
        return (
            `<button type="button" class="city-badge" data-building-id="${building.id}" ` +
            `data-anchor-x="${preferred.x.toFixed(1)}" data-anchor-y="${preferred.y.toFixed(1)}" ` +
            `title="${building.label} Lv.${building.level}">` +
            // 2026-10-02 사용자 요청 — 첫 글자만("시") 말고 전체 이름("시장")을 적는다.
            // 잘라내던 이유였던 34px 원형 배지는 CSS 에서 필(pill) 모양으로 바꿨다.
            // [2026-10-03] 이름 아래 레벨 숫자는 뺀다 — 하단 시설줄이 이미
            // "주막 Lv.0/3" 을 보여주고, 배지는 그림 위에 얹히므로 두 번째 줄이
            // 이름 실루엣만 가릴 뿐이었다. 정보는 title(hover)과 하단 시설줄에 남긴다.
            `<span class="city-badge-label">${building.label}</span></button>`
        );
    });
    layer.innerHTML = badges.join('');
    applyCitySceneBadgePositions();
    // 위 호출은 패널이 아직 숨겨져 있을 때 돈다. renderCityDetailPanel 이 city-entry-mode 를
    // 붙이고 표시한 *뒤에* 한 번 더 재야 rect 가 실측값이므로 다음 프레임에 다시 잰다.
    requestAnimationFrame(applyCitySceneBadgePositions);
    layer.querySelectorAll<HTMLButtonElement>('.city-badge').forEach(btn => {
        // [2026-10-03] 좌·우 레일을 걷어냈으므로, 시트를 열기 위한 도시를 기억한다.
        //   배지 클릭 → 상세 + 이 도시의 정보 시트. 시트는 도시를 열 때마다 닫힌다.
        btn.addEventListener('click', () => {
            const target = citySceneBuildings.find(b => b.id === btn.dataset.buildingId);
            if (!target) return;
            showCitySceneBuildingDetail(target);
            // [2026-10-04] 성문은 다른 건물과 흐름이 다르다. 정보 시트(명령·무장·
            //   세력 목록)가 아니라 **성문지기와의 대화**를 먼저 치는 게 자연스럽다.
            //   이동 전 상태를 되돌릴 수 있게 "다른 도시 방문" 선택지는 시트 경로를 쓴다.
            if (target.type === 'WALL') {
                // 저장소가 비어 있을 수도 있어 null 을 그대로 넘긴다 — 아래에서 걸러 낸다.
                openCityGatekeeperDialogue(citySceneCityId ? engine?.['store'].getCity(citySceneCityId) : undefined);
                return;
            }
            if (citySceneCityId) {
                const city = engine?.['store'].getCity(citySceneCityId);
                if (city) openCitySceneSheet(city);
            }
            addLog(`도시 건물 선택: ${target.label} (Lv.${target.level})`);
        });
    });
}

/** 주둔 무장 초상 — 통솔+무력 합이 가장 높은 무장을 내세운다. */
/**
 * 세력 정보 — 현재 도시를 점령한 세력 하나만.
 *
 * 2026-09-30 사용자 요청. 세력 전체를 나열하면 "지금 이 도시에 누구 있나" 가 묻혀서
 * 화면 purpose(도시 하나 보기)와 어긋난다. 무주공산이면 세력 없음으로 표시한다.
 */
function renderCityFactions(city: import('./core/types.js').City): void {
    const el = document.getElementById('cdp-factions');
    if (!el || !engine) return;
    const store = engine['store'];

    if (!city.ownerId) {
        el.innerHTML = '<div class="cdp-faction-row"><span class="cdp-faction-name">무주공산</span>'
            + '<span class="cdp-faction-meta">이 도시는 어떤 세력도 점령하지 않았다</span></div>';
        return;
    }
    const f = store.getFaction(city.ownerId);
    if (!f) {
        el.innerHTML = '<div class="cdp-faction-row"><span class="cdp-faction-meta">점령 세력을 찾을 수 없습니다.</span></div>';
        return;
    }
    const leader = store_getOfficerSafe(f.leaderId);
    const capital = f.capitalCityId ? store.getCity(f.capitalCityId) : null;
    const isPlayer = f.id === store.getGlobalState().playerFactionId;
    el.innerHTML = `<div class="cdp-faction-row is-player" style="--faction-color:${f.color}">
        <span class="cdp-faction-name">${f.name}${isPlayer ? ' ★' : ''}</span>
        <span class="cdp-faction-meta">군주 ${leader?.name ?? '—'} · 수도 ${capital?.name ?? '—'} · 도시 ${f.cities.length}</span>
    </div>`;
}

/** 도시 패널을 닫는다 — ✕ 버튼과 같은 경로(stopCityAmbient·is-active 정리 포함). */
function closeCityPanel(): void {
    document.getElementById('cdp-close')?.dispatchEvent(new Event('click'));
}

/** 인접 도시 판정 거리 — 출정 대상 고를 때 쓴다. */
const ADJACENT_DIST = 0.16;

/** 出征 — 인접 적 도시를 골라 전투로 들어간다. */
function openCityExpeditionDialogue(city: import('./core/types.js').City): void {
    if (!engine) return;
    const store = engine['store'];
    const targets = store.getAllCities().filter(c => {
        if (!c.ownerId || c.ownerId === city.ownerId) return false;
        const dx = (c.mapX ?? 0) - (city.mapX ?? 0);
        const dy = (c.mapY ?? 0) - (city.mapY ?? 0);
        return Math.hypot(dx, dy) <= ADJACENT_DIST;
    });
    if (targets.length === 0) {
        openDialogue({ index: 0, pages: [{
            title: '出征 — 出陣', speaker: '문서관', placeMark: '📜',
            text: '인접한 적 도시가 없다. 먼 곳으로 출진하려면 수도를 거쳐야 한다.',
        }] });
        return;
    }
    openDialogue({ index: 0, pages: [{
        title: '出征 — 出陣',
        subtitle: `${city.name} · 병력 ${city.development.toLocaleString()}`,
        speaker: '문서관', placeMark: '📜',
        text: `병력 ${city.development.toLocaleString()}으로 출진한다. 공격할 도시를 고르시오.`,
        choices: targets.map(t => {
            const tf = t.ownerId ? store.getFaction(t.ownerId) : null;
            return {
                id: `exp:${t.id}`,
                label: `${t.name} · ${tf?.name ?? '무주'}`,
                description: `병력 ${t.development.toLocaleString()} · 방어 ${t.defense}/${t.maxDefense}`,
                onSelect: () => {
                    launchExpedition(city.id, t.id);
                    return `${t.name}으로 출진이 개시된다.`;
                },
            };
        }),
    }] });
}

/** 출진 실행 — 페널을 닫고 전투로 넘어간다. */
function launchExpedition(sourceCityId: string, targetCityId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const target = store.getCity(targetCityId);
    if (!target) return;
    expeditionSource = sourceCityId;
    expeditionTarget = targetCityId;
    addLog(`📍 出征 ${target.name}으로 출진이 개시된다`);
    // ✕ 경로가 stopCityAmbient 와 is-active 정리를 함께 한다.
    closeCityPanel();
    enterBattleMode();
}

/** 登用 — 이 도시에 있는 재야 무장을 등용한다. */
function openCityRecruitDialogue(city: import('./core/types.js').City): void {
    if (!engine) return;
    const store = engine['store'];
    const gs = store.getGlobalState();
    const pool = store.getAllOfficers()
        .filter(o => isFreeOfficerInCity(o, city.id))
        .sort((a, b) => (b.stats.leadership + b.stats.might) - (a.stats.leadership + a.stats.might))
        .slice(0, 8);
    if (pool.length === 0) {
        openDialogue({ index: 0, pages: [{
            title: '登用 — 登用', speaker: '문서관', placeMark: '📜',
            text: `${city.name}에 머무는 재야 무장이 없다.`,
        }] });
        return;
    }
    const loyalty = engine['loyaltySystem'];
    const repMod = getReputationDiplomacyModifier(store, gs.playerFactionId ?? null);
    const repLabel = describeReputationModifier(repMod);
    openDialogue({ index: 0, pages: [{
        title: '登用 — 登用',
        subtitle: `${city.name} · 재야 ${pool.length}명`,
        speaker: '문서관', placeMark: '📜',
        text: '이 도시에 머무는 재야 무장이다. 등용할 사람을 고르시오.',
        detail: [repLabel ? `평판 보정 ${repLabel}` : ''].filter(Boolean),
        choices: pool.map(o => {
            const chance = Math.round(loyalty.getRecruitChance(o.id, undefined, gs.playerFactionId ?? undefined) * 100);
            return {
                id: `rec:${o.id}`,
                label: `${o.name} · 등용 확률 ${chance}%`,
                description: `統${o.stats.leadership} 武${o.stats.might} 智${o.stats.intelligence}`,
                onSelect: () => {
                    const playerCity = gs.playerFactionId ? store.getCitiesByFaction(gs.playerFactionId)[0] : null;
                    if (!playerCity) return '등용할 세력 도시가 없다.';
                    loyalty.penaltyMessages = [];
                    const result = loyalty.recruit(o.id, gs.playerFactionId!, playerCity.id);
                    addLog(result.message);
                    for (const msg of loyalty.penaltyMessages) addLog(msg);
                    renderCityDetailPanel(city, city.ownerId ? store.getFaction(city.ownerId) : null, false);
                    return result.message;
                },
            };
        }),
    }] });
}

/** 復起 — 방랑군 세력이 적 도시를 약탈한다. */
function openCityRaidDialogue(city: import('./core/types.js').City): void {
    if (!engine) return;
    const store = engine['store'];
    const gs = store.getGlobalState();
    const pf = gs.playerFactionId ? store.getFaction(gs.playerFactionId) : null;
    if (!pf?.isVagrant) {
        openDialogue({ index: 0, pages: [{
            title: '復起 —  방랑군 습격', speaker: '문서관', placeMark: '📜',
            text: '방랑군 세력만 쓸 수 있는 명령이다.',
        }] });
        return;
    }
    const pts = engine.strategicCommand.getStrategyPoints();
    const strength = (() => { try { return computeVagrantStrength(store, gs.playerFactionId!); } catch { return 0; } })();
    const targets = store.getAllCities()
        .filter(c => c.ownerId !== gs.playerFactionId)
        .sort((a, b) => a.defense - b.defense)
        .slice(0, 5);
    openDialogue({ index: 0, pages: [{
        title: '復起 —  방랑군 습격',
        subtitle: `전략 포인트 ${pts} · 약략 30 소모`,
        speaker: '문서관', placeMark: '📜',
        text: targets.length === 0 ? '약탈할 도시가 없다.' : '약탈할 도시를 고르시오. 약략은 전략 포인트 30 을 쓴다.',
        choices: targets.map(c => {
            const reachable = pts >= 30 && strength >= c.defense * 10;
            return {
                id: `raid:${c.id}`,
                label: `${c.name} · 방어 ${c.defense}`,
                description: reachable ? '약탈 가능' : '약략 불가 — 병력 부족',
                disabled: !reachable,
                onSelect: () => {
                    const outcome = engine.playerRaidCity(c.id);
                    addLog(outcome.message);
                    const resultEl = document.getElementById('cdp-action-result');
                    if (resultEl) { resultEl.textContent = outcome.message; resultEl.dataset.cityId = c.id; }
                    if (outcome.success) {
                        syncChinaMapCities();
                        renderCityDetailPanel(c, c.ownerId ? store.getFaction(c.ownerId) : null, true);
                    }
                    return outcome.message;
                },
            };
        }),
    }] });
}

/** 外交 — 기존 외교 패널을 연다. */
function openCityDiplomacy(): void {
    if (diplomacyPanel.style.display === 'block') {
        diplomacyPanel.style.display = 'none';
        return;
    }
    renderDiplomacyPanel();
    diplomacyPanel.style.display = 'block';
    closeCityPanel();
}

/** 좌측 레일 명령 목록 — 내정 / 지배 / 인사 / 교外 4그룹. */
function renderCityCommandGroups(
    city: import('./core/types.js').City,
    isPlayerCity: boolean,
): void {
    const el = document.getElementById('cdp-command-groups');
    if (!el) return;
    const groups: Array<{ title: string; items: Array<{ label: string; action?: string; amount?: string; run?: () => void; disabled?: boolean }> }> = [
        {
            title: '內政 — 내정',
            items: [
                { label: '징병', amount: 'recruit' },
                { label: '훈련', amount: 'train' },
                { label: '순찰', amount: 'patrol' },
                { label: '자동 배정', action: 'auto-domestic' },
                { label: '개발', amount: 'develop' },
            ],
        },
        {
            title: '支配 — 지배',
            items: [
                { label: '出征 · 出陣', run: () => openCityExpeditionDialogue(city), disabled: !isPlayerCity },
                { label: '復起 · 약탈', run: () => openCityRaidDialogue(city), disabled: !isPlayerCity },
            ],
        },
        {
            title: '人事 — 인사',
            items: [
                { label: '登用 · 등용', run: () => openCityRecruitDialogue(city), disabled: !isPlayerCity },
            ],
        },
        {
            title: '外交 — 교외',
            items: [
                { label: '外交 · 외교', run: openCityDiplomacy },
                { label: '月報 · 보고', run: () => document.getElementById('btn-report')?.dispatchEvent(new MouseEvent('click')) },
            ],
        },
    ];

    el.innerHTML = groups.map(g => `
        <div class="cdp-command-group">
            <div class="cdp-command-group-title">${g.title}</div>
            ${g.items.map(it => it.action
                ? `<button type="button" class="cdp-action-btn" data-action="${it.action}">${it.label}</button>`
                : `<button type="button" class="cdp-action-btn" data-cmd="1"${it.disabled ? ' disabled' : ''}>${it.label}</button>`
            ).join('')}
        </div>`).join('');

    // 수량 선택이 필요한 내정 명령은 직접 실행하지 않고 선택지 대화창을 먼저 연다.
    el.querySelectorAll<HTMLButtonElement>('.cdp-action-btn[data-cmd]').forEach(btn => {
        const label = btn.textContent ?? '';
        for (const g of groups) {
            const hit = g.items.find(i => i.label === label);
            if (!hit) continue;
            if (hit.amount) {
                btn.addEventListener('click', () => openDomesticAmountDialogue(city, hit.amount!, hit.label));
            } else if (hit.run) {
                btn.addEventListener('click', hit.run);
            }
            break;
        }
    });
}

/**
 * 내정 명령의 수량 선택 단계.
 *
 * 2026-09-30 사용자 요청 — 내정 목록을 누르면 곧바로 고정 금액(200/150/100/250金) 으로
 * 执行돼 임의로 조절할 수 없었다. 여기서 배수를 고르면 runCityAction 의 비용·효과가
 * 그 배수만큼 늘어난다. 배수만 고르는 이유는-effect 를 세분하면 도시마다 다른
 * (재고·인구·상한) 이라 설명이 거짓말을 하게 되기 때문이다.
 */
const DOMESTIC_AMOUNTS: ReadonlyArray<{ label: string; times: number; note: string }> = [
    { label: '소량 ×1', times: 1, note: '기본 단위' },
    { label: '중량 ×3', times: 3, note: '세 배' },
    { label: '대량 ×5', times: 5, note: '다섯 배' },
];

/** 내정 명령별 1회당 골드 — 수량 선택지의 예상 비용을 보여주는 데 쓴다. */
const DOMESTIC_UNIT_COST: Record<string, number> = {
    recruit: 200, train: 150, patrol: 100, develop: 250,
};

function openDomesticAmountDialogue(
    city: import('./core/types.js').City,
    action: string,
    label: string,
): void {
    const unit = DOMESTIC_UNIT_COST[action] ?? 0;
    const effect: Record<string, string> = {
        recruit: '병사 모집', train: '병사 훈련', patrol: '치안 +5', develop: '상업+3 · 농업+3',
    };
    openDialogue({ index: 0, pages: [{
        title: `內政 — ${label}`,
        subtitle: `${city.name} · 보유 ${city.funds.toLocaleString()}金`,
        speaker: ' 문서관', placeMark: '📜',
        text: `${label}을 몇 회 실행할지 고르시오. 수량에 따라 비용과 효과가 함께 늘어난다.`,
        detail: [`1회당 ${unit}金 · 효과 ${effect[action] ?? ''}`],
        choices: DOMESTIC_AMOUNTS.map(a => ({
            id: `${action}:${a.times}`,
            label: `${a.label} · ${(unit * a.times).toLocaleString()}金`,
            description: a.note,
            disabled: unit * a.times > city.funds,
            onSelect: () => {
                runCityAction(city.id, action, a.times);
                return `${label} ${a.label} 실행`;
            },
        })),
    }] });
}

function renderCityCommander(city: import('./core/types.js').City): void {
    const el = document.getElementById('city-commander');
    if (!el) return;
    const officers = city.officerIds
        .map(id => store_getOfficerSafe(id))
        .filter((o): o is NonNullable<typeof o> => o !== null)
        .sort((a, b) => (b.stats.might + b.stats.leadership) - (a.stats.might + a.stats.leadership));
    const top = officers[0];
    if (!top) {
        el.innerHTML = '<div class="city-commander-empty">주둔 무장 없음</div>';
        return;
    }
    el.innerHTML =
        `<div class="city-commander-portrait">${renderPortraitSvg({
            id: top.id, name: top.name, gender: top.gender === 'F' ? 'F' : 'M',
            grade: Math.max(0, Math.min(9, top.rank)),
        })}</div>` +
        `<div class="city-commander-name">${top.name}</div>` +
        `<div class="city-commander-stats">統${top.stats.leadership} 武${top.stats.might} 智${top.stats.intelligence}</div>`;
}

/** 계절 오버레이 — 씬 위에 시간대 분위기를 얹는다. */
function renderCitySeason(season: string): void {
    const el = document.getElementById('city-scene-season');
    if (!el) return;
    el.dataset.season = String(season).toLowerCase();
}

/** 다음 행동 안내 — 가장 낮은 내정 지표를 골라 추천한다. */
function renderCityHint(city: import('./core/types.js').City): void {
    const el = document.getElementById('city-hint-bar');
    if (!el) return;
    const ds = city.developmentStats;
    const candidates: Array<{ key: string; value: number; hint: string }> = [
        { key: '상업', value: ds.commerce, hint: '시장 투자·개발 명령을 권장합니다' },
        { key: '농업', value: ds.farming, hint: '농지 투자·개발 명령을 권장합니다' },
        { key: '기술', value: ds.technology, hint: '공방 투자를 권장합니다' },
        { key: '치안', value: ds.publicOrder, hint: '순찰·관청 투자를 권장합니다' },
        { key: '충성', value: city.loyalty, hint: '복지 정책·선정을 권장합니다' },
    ];
    candidates.sort((a, b) => a.value - b.value);
    const lowest = candidates[0];
    el.textContent = `💡 ${lowest.key}(${lowest.value}) — ${lowest.hint}`;
}

/** 선택한 건물의 정보와 투자 버튼을 표시한다. */
function showCitySceneBuildingDetail(building: CityBuilding | null): void {
    selectedCitySceneBuilding = building;
    if (!citySceneDetail) return;
    if (!building) {
        citySceneDetail.textContent = '건물을 클릭하면 상세 정보가 표시됩니다.';
        return;
    }
    // [2026-10-03] 타입을 그림 이름(서원·교역소·마구간)에 맞췄으므로 분기도 고쳤다.
    //   마지막 else 는 STABLE 로 흐른다. 이전처럼 나머지를 몰아서 쓰면
    //   새 이름들이 엉뚱한 역할 설명을 갖게 된다.
    const role = building.type === 'GOVERNMENT' ? '치안·내정 중심'
        : building.type === 'BARRACKS' ? '병력·훈련 중심'
        : building.type === 'MARKET' ? '상업·교역 중심'
        : building.type === 'FARM' ? '농업·식량 중심'
        : building.type === 'SEOUN' ? '교육·유교 중심'
        : building.type === 'WORKSHOP' ? '기술·개발 중심'
        : building.type === 'WALL' ? '방어·도시 보호 중심'
        : building.type === 'TRADING_HOUSE' ? '보관·장부 중심'
        : building.type === 'PALACE' ? '수도·경호 중심'
        : building.type === 'ACADEMY' ? '교육·양성 중심'
        : building.type === 'BLACKSMITH' ? '무기·장비 중심'
        : '마구간·가축 단지';
    citySceneDetail.innerHTML = `<strong>${building.label}</strong> · Lv.${building.level} · ${role} · ${building.active ? '운영 중' : '휴업'} · 누적 투자 ${building.investment}金 <button id="city-building-invest" class="city-building-invest" type="button">투자</button><button id="city-building-toggle" class="city-building-toggle" type="button">${building.active ? '휴업' : '운영'}</button>`;
}

/** 도시 전경의 건물을 클릭했을 때 선택 정보를 표시한다. */
function selectCitySceneBuilding(clientX: number, clientY: number): void {
    if (!citySceneCanvas || !citySceneCityId || citySceneBuildings.length === 0) return;
    const rect = citySceneCanvas.getBoundingClientRect();
    const x = (clientX - rect.left) * citySceneCanvas.width / rect.width;
    const y = (clientY - rect.top) * citySceneCanvas.height / rect.height;
    // [2026-10-03] drawCityCanvas 가 타일 크기를 캔버스 높이 기준으로 정하므로
    //   여기도 같은 값을 써야 한다. 예전 고정값(42/21)을 쓰면 창을 키웠을 때
    //   클릭 좌표가 렌더링된 건물과 어긋나 엉뚱한 건물이 선택됐다.
    const scale = Math.max(0.25, citySceneCanvas.height / 240);
    const originX = citySceneCanvas.width / 2;
    const originY = citySceneCanvas.height / 2 + Math.round(28 * scale);
    const sorted = [...citySceneBuildings].sort((a, b) => (b.x + b.y) - (a.x + a.y));
    for (const building of sorted) {
        const point = citySceneRenderer.worldToScreen(building.x, building.y, Math.round(42 * scale), Math.round(21 * scale));
        const sx = originX + point.sx;
        const sy = originY + point.sy;
        if (Math.abs(x - sx) <= building.width / 2 + 4 && y >= sy - building.height * 1.5 && y <= sy + 8) {
            showCitySceneBuildingDetail(building);
            addLog(`도시 건물 선택: ${building.label} (Lv.${building.level})`);
            return;
        }
    }
    showCitySceneBuildingDetail(null);
}

/** 건물에 투자하여 도시 자금과 해당 운영 지표를 실제로 변경한다. */
function investInSelectedCityBuilding(): void {
    const building = selectedCitySceneBuilding;
    if (!building || !engine || !citySceneCityId) return;
    const store = engine['store'];
    const city = store.getCity(citySceneCityId);
    if (!city) return;
    const gs = store.getGlobalState();
    if (city.ownerId !== gs.playerFactionId) {
        if (citySceneDetail) citySceneDetail.textContent = '이 도시는 현재 투자할 수 없습니다.';
        return;
    }
    const cost = 120 + building.level * 80;
    if (city.funds < cost) {
        if (citySceneDetail) citySceneDetail.textContent = `투자금이 부족합니다. 필요 ${cost}金 · 보유 ${city.funds}金`;
        return;
    }
    const stats = { ...city.developmentStats };
    let development = city.development;
    let defense = city.defense;
    let population = city.population;
    switch (building.type) {
        case 'GOVERNMENT': stats.publicOrder = Math.min(stats.maxPublicOrder, stats.publicOrder + 2); break;
        // [결함 수정] 상한을 garrisonCap 으로 통일(위 시설 BARRACKS 와 동일).
        // 예전엔 여기만 1000 고정이라 도시마다 상한이 어긋났다.
        case 'BARRACKS': development = Math.min(garrisonCap(city), development + 600); break;
        case 'MARKET': stats.commerce = Math.min(stats.maxCommerce, stats.commerce + 2); break;
        case 'FARM': stats.farming = Math.min(stats.maxFarming, stats.farming + 2); break;
        // [2026-10-03] TEMPLE → SEOUN, HOUSE → STABLE 로 이름이 바뀌었다(그림에 맞추기 위함).
        //   인과는 기능 기준이다 — 서원은 민심(+1), 마구간은 인구(+500)로 그대로 옮긴다.
        case 'SEOUN': stats.publicOrder = Math.min(stats.maxPublicOrder, stats.publicOrder + 1); break;
        case 'WORKSHOP': stats.technology = Math.min(stats.maxTechnology, stats.technology + 2); break;
        case 'WALL': defense = Math.min(city.maxDefense, defense + 5); break;
        case 'STABLE': population += 500; break;
    }
    store.updateCity(city.id, { funds: city.funds - cost, developmentStats: stats, development, defense, population });
    const nextBuilding = building.level < 5
        ? { ...building, level: building.level + 1, investment: building.investment + cost, active: true }
        : building;
    persistCityBuildingState(city.id, nextBuilding);
    playCitySceneTone('invest');
    const updated = store.getCity(city.id);
    if (updated) renderCityScene(updated);
    selectedCitySceneBuilding = nextBuilding;
    showCitySceneBuildingDetail(selectedCitySceneBuilding);
    addLog(`${city.name} ${building.label} 투자 완료 — ${cost}金 사용`);
}

citySceneCanvas?.addEventListener('click', event => selectCitySceneBuilding(event.clientX, event.clientY));
citySceneDetail?.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('#city-building-invest')) investInSelectedCityBuilding();
    if (target.closest('#city-building-toggle')) toggleSelectedCityBuilding();
});

/** 건물 운영 상태를 GlobalState에 기록해 압축 세이브에도 보존한다. [49][D32] */
function persistCityBuildingState(cityId: string, building: CityBuilding): void {
    if (!engine) return;
    const store = engine['store'];
    const gs = store.getGlobalState();
    const cityStates = { ...(gs.cityBuildingStates?.[cityId] ?? {}) };
    const state: CityBuildingState = {
        buildingId: building.id,
        level: building.level,
        investment: building.investment,
        active: building.active,
    };
    cityStates[building.id] = state;
    store.setGlobalState({ cityBuildingStates: { ...(gs.cityBuildingStates ?? {}), [cityId]: cityStates } });
}

function toggleSelectedCityBuilding(): void {
    if (!selectedCitySceneBuilding || !citySceneCityId || !engine) return;
    const next = { ...selectedCitySceneBuilding, active: !selectedCitySceneBuilding.active };
    persistCityBuildingState(citySceneCityId, next);
    playCitySceneTone('toggle');
    selectedCitySceneBuilding = next;
    showCitySceneBuildingDetail(next);
    addLog(`${next.label} ${next.active ? '운영 시작' : '휴업 전환'}`);
}

/**
 * 무장 목록 렌더 — 도시 소속 + 재야(FREE) + 수용 중인 포로.
 *
 * [2026-10-03] 좌·우 레일을 걷어내면서 그림 위 시트로 옮겼는데, 이 렌더가
 * renderCityDetailPanel 안에 인라인으로 박혀 있으면 시트가 같은 내용을 다시 만들어야 한다.
 * 한 곳에 모아 두어야 도시 열 때와 배지 눌렀을 때의 목록이 어긋나지 않는다.
 */
function renderCityOfficerList(city: import('./core/types.js').City): void {
    // [2026-10-03] 시트가 닫혀 있으면 무장 목록 자리가 없다. 조용히 넘긴다 —
    //   시트를 열면 그때 만들어져 이 함수가 다시 불린다.
    const officersEl = document.getElementById('cdp-officers');
    if (!officersEl) return;
    const faction = city.ownerId ? engine?.['store'].getFaction(city.ownerId) ?? null : null;
    const cityOfficers = city.officerIds
        .map(id => store_getOfficerSafe(id))
        .filter((o): o is NonNullable<typeof o> => o !== null);
    const officers = mergeCityAndFreeOfficers(cityOfficers, engine!['store'].getAllOfficers(), city.id)
        .sort((a, b) => (b.stats.leadership + b.stats.might) - (a.stats.leadership + a.stats.might));
    const countEl = document.getElementById('cdp-officer-count');
    if (countEl) countEl.textContent = `(${officers.length})`;

    // 수용 중인 포로 표시 [131-145]
    const captives = getCaptivesInCity(engine!['store'], city.id);

    officersEl.innerHTML = officers.map(o => {
        const isLeader = faction?.leaderId === o.id;
        const isFree = isFreeOfficer(o);
        const role = officerRoleLabel(o, faction?.leaderId ?? null);
        return `<div class="cdp-officer-row cdp-officer-clickable${isFree ? ' is-free' : ''}" data-officer-id="${o.id}" title="클릭하여 상세 정보 보기">
            <div>
                <div class="cdp-officer-name ${isLeader ? 'is-leader' : ''}">${o.name}</div>
                <div class="cdp-officer-stats">統率${o.stats.leadership} 武力${o.stats.might} 智力${o.stats.intelligence}</div>
            </div>
            <span class="cdp-officer-role">${role}</span>
        </div>`;
    }).join('')
    + (captives.length > 0
        ? captives.map(c => `<div class="cdp-officer-row cdp-captive-row" data-officer-id="${c.id}">
            <div>
                <div class="cdp-officer-name">⛓️ ${c.name}</div>
                <div class="cdp-officer-stats">포로 — 이번 달에 탈출할 수 있다 (지력 ${store_getOfficerSafe(c.id)?.stats.intelligence ?? '-'})</div>
            </div>
            <span class="cdp-officer-role">포로</span>
        </div>`).join('')
        : '');
}

/** 도시 상세 패널 렌더링 (switched: 다른 도시에서 전환 시 콘텐츠 페이드) */
function renderCityDetailPanel(city: import('./core/types.js').City, faction: import('./core/types.js').Faction | null, switched: boolean): void {
    cdpCityName.textContent = city.name;
    renderCityScene(city);

    // 진입 헤더 요약 — 핵심 수치를 한눈에 (이름 요소는 E2E 대조용으로 순수 유지)
    const cdpSummary = document.getElementById('cdp-summary')!;
    const summaryChip = (label: string, value: string, accent = false) =>
        `<span class="cdp-chip${accent ? ' cdp-chip-accent' : ''}"><b>${label}</b> ${value}</span>`;
    cdpSummary.innerHTML =
        summaryChip(city.isCapital ? '🏯 首都' : '🏘️ 일반', city.isCapital ? '수도' : '도시', city.isCapital) +
        summaryChip('👥 인구', city.population.toLocaleString()) +
        summaryChip('⚔️ 병력', city.development.toLocaleString()) +
        summaryChip('💰 자금', city.funds.toLocaleString()) +
        summaryChip('📈 月入', `金+${city.goldIncome} · 粮+${city.foodIncome}`) +
        summaryChip('🛡️ 방어', `${city.defense}/${city.maxDefense}`);

    // 세력 배지 (세력색 테두리 + 군주 평판 등급 [11][27])
    if (faction) {
        const leader = faction.leaderId ? store_getOfficerSafe(faction.leaderId) : null;
        const repVis = getLeaderReputationVisual(leader);
        cdpFactionBadge.innerHTML = `${faction.name} <span class="rep-badge" style="color:${repVis.color}" title="${repVis.title}">${repVis.icon} ${repVis.label}</span>`;
        cdpFactionBadge.style.display = 'inline-block';
        cdpFactionBadge.style.setProperty('--faction-color', factionColor(faction.color));
        // 색약 모드 이중 부호화 — 세력 기호를 배지에 병기 [461-480]
        const cbSym = factionSymbol(faction.color, colorblindMode);
        if (cbSym) cdpFactionBadge.innerHTML += `<span class="cb-symbol">${cbSym}</span>`;
    } else {
        cdpFactionBadge.textContent = '무주공산';
        cdpFactionBadge.style.display = 'inline-block';
        cdpFactionBadge.style.setProperty('--faction-color', 'var(--gold-dim)');
    }

    // 내정치 바 (developmentStats 기반) + 병력·방어 현황
    const ds = city.developmentStats;
    if (cdpStats) {
        cdpStats.innerHTML =
            statBar('상업', ds.commerce, ds.maxCommerce, '#d4af37') +
            statBar('농업', ds.farming, ds.maxFarming, '#7cb342') +
            statBar('기술', ds.technology, ds.maxTechnology, '#5fb5e8') +
            statBar('치안', ds.publicOrder, ds.maxPublicOrder, '#e9865a') +
            statBar('충성', city.loyalty, 100, '#b06ae8') +
            statBar('병력', city.development, garrisonCap(city), '#d45a5a') +
            statBar('방어', city.defense, city.maxDefense, '#5a8fd4');
    }

    // 도시 시설 목록 — 건설 상태와 상위 효과를 확인하고 직접 운영할 수 있다. [49]
    const playerCity = engine['store'].getGlobalState().playerFactionId === city.ownerId;
    renderFacilityList(city, playerCity);
    renderCityFactions(city);

    // 무장 목록 — 도시 소속 + 재야(무소속 FREE) 를 함께 둔다.
    // 登用 패널을 지우면서 재야가 화면에서 사라졌는데, 여기 합쳐 두지 않으면
    // "등용할 사람이 없다" 와 "화면에 없다" 를 구분할 수 없다. 규칙은 단위 테스트가 붙는다.
    renderCityOfficerList(city);

    const captiveHistory = engine.chronicle.list()
        .filter(entry => entry.kind === 'CAPTURE' && entry.cityId === city.id)
        .slice(0, 5);
    const captiveHistoryEl = document.getElementById('cdp-captive-history');
    const captiveSection = document.getElementById('cdp-captive-history-section');
    if (captiveHistoryEl) {
        captiveHistoryEl.innerHTML = captiveHistory.length > 0
            ? captiveHistory.map(entry => `<div class="cdp-history-row">${entry.icon} ${entry.text}<span>${entry.year}년 ${entry.month}월</span></div>`).join('')
            : '도시의 포로 처분 기록이 없습니다.';
    }
    // 기록이 없으면 섹션을 접어 진입 화면 한 화면 구성을 유지한다 (E2E는 textContent로 읽으므로 영향 없음)
    if (captiveSection) captiveSection.style.display = captiveHistory.length > 0 ? '' : 'none';

    // 명령 목록을 좌측 레일에 그린다. 내정 5개는 도시 선택 때마다 초기화돼야 한다.
    const gs0 = engine['store'].getGlobalState();
    const isPlayerCity0 = city.ownerId !== null && city.ownerId === gs0.playerFactionId;
    renderCityCommandGroups(city, isPlayerCity0);
    const actionResult = document.getElementById('cdp-action-result');
    if (actionResult && isPlayerCity0) {
        actionResult.textContent = '';
        actionResult.dataset.cityId = city.id;
    }

    // 전환 시 콘텐츠 페이드 애니메이션 재생 (같은 도시 재클릭 시 생략)
    if (switched) {
        cityDetailPanel.querySelectorAll<HTMLElement>('.cdp-section, .cdp-header').forEach(el => {
            el.style.animation = 'none';
            void el.offsetWidth;
            el.style.animation = '';
        });
    }

    // 진입 화면은 한 가지 구성뿐이다 (2026-09-30 개편): 16:9 배경 그림 위에
    // 상단 바와 하단 시설줄이 반투명으로 얹힌다(좌·우 레일은 2026-10-03 에 걷어냈고,
    // 같은 정보는 그림 위 시트로 옮겼다). 모드 전환이 없으므로
    // 돌아오기 버튼(🏛 도시 관리)도 필요 없다 — 닫기는 ✕ 하나로 충분하다.
    cityDetailPanel.classList.add('city-entry-mode');
    // 인라인 display 를 지워 CSS(.city-entry-mode 의 grid) 가 레이아웃을 결정하게 한다.
    cityDetailPanel.style.display = '';
    // [2026-10-03] 레일을 걷어냈으므로 접힘 재계산은 없다. 대신 시트를 닫는다 —
    //   도시를 바꿀 때 이전 도시의 정보가 남아 있으면 어느 도시 것인지 헷갈린다.
    closeCitySceneSheet();
}

/**
 * 출진 대상 — 2026-09-30 에 출진 UI(出征 섹션)를 삭제하며 설정하는 곳이 없어졌다.
 * 남은 참조는 전투 종료 처리와 복수 이벤트 로그인데, 둘 다 여기서 멈춘다.
 * 출진 UI 를 되살리면 이 두 칸에 값을 넣으면 그대로 동작한다.
 */
let expeditionSource: string | null = null;
let expeditionTarget: string | null = null;

/** 전투 종료 시 출진 결과 처리 — 승리 시 도시 점령 [105] */
function resolveExpeditionOutcome(playerWon: boolean): void {
    if (!engine || !expeditionSource || !expeditionTarget) return;
    const store = engine['store'];
    const source = store.getCity(expeditionSource);
    const target = store.getCity(expeditionTarget);
    expeditionSource = null;
    expeditionTarget = null;
    if (!source || !target) return;

    if (playerWon) {
        // 도시 점령: 소속 변경 + 방어력 감소 + 병력 일부 이동
        const gs = store.getGlobalState();
        const newDefense = Math.max(5, Math.floor(target.defense * 0.4));
        const garrisonTransfer = Math.floor(source.development * 0.3);
        store.updateCity(target.id, {
            ownerId: gs.playerFactionId,
            defense: newDefense,
            development: Math.max(0, target.development - garrisonTransfer),
        });
        store.updateCity(source.id, { development: Math.max(0, source.development - garrisonTransfer) });
        addLog(`🏳️ ${target.name} 점령! 영토가 확장되었습니다`);
        // 전투 후처리: 포로 포획 + 병력/자금/국고 약탈 [131-145]
        const spoils = processBattleSpoils(store, source.id, target.id);
        for (const msg of spoils.messages) {
            addLog(msg);
        }
        if (spoils.capturedOfficerIds.length > 0) {
            addLog(`⛓️ 포로 ${spoils.capturedOfficerIds.length}명 — 도시 패널에서 등용할 수 있습니다`);
        }
    } else {
        store.updateCity(source.id, { development: Math.max(0, Math.floor(source.development * 0.8)) });
        addLog(`⚔️ ${target.name} 공성 실패 — 병력이 20% 감소했습니다`);
    }
    syncChinaMapCities();
    if (currentPanelCityId) showCityInfo(currentPanelCityId);
}

/** 내정 명령 실행 — 실행 후 패널/전도 동기 갱신 [49] */
function runCityAction(cityId: string, action: string, times = 1): void {
    const store = engine['store'];
    const city = store.getCity(cityId);
    if (!city) return;
    // 수량은 1·3·5 만 받는다 — 선택지에서만 오지만 외부 호출에도 대상을 막는다.
    const n = ([1, 3, 5].includes(times) ? times : 1);
    const gs = store.getGlobalState();
    const faction = city.ownerId ? store.getFaction(city.ownerId) : null;
    if (!faction || city.ownerId !== gs.playerFactionId) return;

    const ds = { ...city.developmentStats };
    let resultMsg = '';

    switch (action) {
        case 'recruit': {
            // 징병: 골드 200 소모 → 병력 증가, 충성 -3
            if (city.funds < 200) { resultMsg = '골드가 부족합니다 (200 필요)'; break; }
            // [결함 수정] 증가량에 garrisonCap 상한을 건다.
            // 예전엔 상한이 아예 없어 플레이어가 세력 AI 규칙을 그대로
            // 우회할 수 있었다. AI(faction_ai_monthly)와 AI 명령
            // (CityRecruitmentCommand)은 둘 다 garrisonCap 을 지키는데
            // 플레이어 경로만 무제한이었다. BARRACKS 결함과 같은 구조다.
            //
            // 증가량 규칙(600~1000 무작위)은 이 커밋에서 바꾸지 않는다 —
            // 병력 증가 속도는 밸런스 판단이 필요하고, 여기서는 상한
            // 일관성만 확보한다. 계산은 computeRecruitGain(순수 함수)이 한다.
            const { gain, cap, capped } = computeRecruitGain(
                city.development, city.population, city.isCapital,
            );
            if (capped) {
                resultMsg = `병력이 이미 상한(${cap.toLocaleString()}명)에 달했습니다`;
                break;
            }
            // [결함 수정] 병력을 모으는데 development 에 +1 만 했다.
            // 1) 계산한 gain 이 버려져 UI 는 "600~1000명 모집" 이라면서
            //    실제로는 1명만 늘어난다.
            // 2) 상한으로 city.maxDefense(방어도, 0~100)를 썼다.
            //    병력이 인구의 0.4 ~ 12% 규모인 지금 이건 사실상 무의미하다.
            store.updateCity(city.id, { funds: city.funds - 200 * n, development: city.development + gain * n });
            resultMsg = `병사 ${(gain * n).toLocaleString()}명 모집 완료 (골드 -${(200 * n).toLocaleString()})`;
            break;
        }
        case 'train': {
            // 훈련: 골드 150 소모 → 병력 소모
            if (city.funds < 150 * n) { resultMsg = `골드가 부족합니다 (${150 * n} 필요)`; break; }
            // [결함 수정] "사기 반영" 이라면서 병력을 +2 하던 것을
            // 실제 의미(사기상승은 training 개념) 에 맞게 병력 소모로 바꿨다.
            // 병력을 늘리는 코드는 위 'recruit' 항목 하나로 통일한다.
            // 훈련이 병력을 늘리면 징병 규칙(가산분 순증)을 우회해 버린다.
            const loss = Math.min(city.development, 200 * n);
            store.updateCity(city.id, { funds: city.funds - 150 * n, development: city.development - loss });
            resultMsg = `훈련 완료 — ${loss.toLocaleString()}명 사기 상승 (골드 -${(150 * n).toLocaleString()})`;
            break;
        }
        case 'patrol': {
            // 순찰: 골드 100 소모 → 치안 +5
            if (city.funds < 100 * n) { resultMsg = `골드가 부족합니다 (${100 * n} 필요)`; break; }
            ds.publicOrder = Math.min(ds.maxPublicOrder, ds.publicOrder + 5 * n);
            store.updateCity(city.id, { funds: city.funds - 100 * n, developmentStats: ds });
            resultMsg = `순찰 완료 — 치안 ${ds.publicOrder} (골드 -${(100 * n).toLocaleString()})`;
            break;
        }
        case 'auto-domestic': {
            // [49][76-85] 능력치 기반 자동 내정 배정 — 등록된 임무는 다음 턴 종료 시 실행된다.
            const scheduler = engine['domesticScheduler'];
            const excluded = new Set<string>();
            const taskTypes = [
                { task: 'agriculture' as const, type: DomesticTaskType.FARMING, label: '농업' },
                { task: 'commerce' as const, type: DomesticTaskType.COMMERCE, label: '상업' },
                { task: 'public_order' as const, type: DomesticTaskType.PUBLIC_ORDER, label: '치안' },
            ];
            let assigned = 0;
            for (const task of taskTypes) {
                const currentCity = store.getCity(city.id);
                if (!currentCity || currentCity.funds < 100) break;
                const recommendation = scheduler.autoAssign(city.id, [task.task], excluded)[0];
                if (!recommendation) break;
                scheduler.registerAssignment(city.id, {
                    taskType: task.type,
                    officerIds: [recommendation.officerId],
                    allocatedFunds: 100,
                });
                excluded.add(recommendation.officerId);
                assigned++;
            }
            resultMsg = assigned > 0
                ? `자동 내정 ${assigned}개 배정 — 다음 턴 종료 시 결과가 반영됩니다`
                : '배정 가능한 무장 또는 도시 자금이 부족합니다';
            break;
        }
        case 'develop': {
            // 개발: 골드 250 소모 → 상업+3, 농업+3
            if (city.funds < 250 * n) { resultMsg = `골드가 부족합니다 (${250 * n} 필요)`; break; }
            ds.commerce = Math.min(ds.maxCommerce, ds.commerce + 3 * n);
            ds.farming = Math.min(ds.maxFarming, ds.farming + 3 * n);
            store.updateCity(city.id, { funds: city.funds - 250 * n, developmentStats: ds });
            resultMsg = `개발 완료 — 상업 ${ds.commerce} · 농업 ${ds.farming} (골드 -${(250 * n).toLocaleString()})`;
            break;
        }
    }

    // [2026-10-03] 레일이 없어 이 요소는 시트가 열려 있을 때만 존재한다(동적으로 만든다).
    //   닫혀 있으면 참조가 null 이라 조용히 넘어간다 — 결과는 로그로도 남는다.
    const actionResult = document.getElementById('cdp-action-result');
    if (actionResult) actionResult.textContent = resultMsg;

    // 패널 + 사이드바 + 전도 갱신
    const refreshed = store.getCity(cityId);
    if (refreshed) {
        const fac2 = refreshed.ownerId ? store.getFaction(refreshed.ownerId) : null;
        renderCityDetailPanel(refreshed, fac2, false);
        // [2026-10-03] 명령은 시트 안에서 누른다. renderCityDetailPanel 가 시트를 닫지
        //   않도록(닫으면 누르던 손이 사라진다) 여기서 시트를 다시 채운다.
        if (!document.getElementById('cdp-scene-sheet')?.hidden) openCitySceneSheet(refreshed);
        const el2 = document.getElementById('cdp-action-result');
        if (el2) el2.textContent = resultMsg; // 렌더 후 다시 세팅 (innerHTML 리셋 방지)
        factionDetail.textContent = fac2
            ? `${fac2.name} — 병력 ${refreshed.development} · 충성 ${refreshed.loyalty}`
            : '무주공산';
    }
    syncChinaMapCities();
}

// 내정 명령 버튼 이벤트 위임
// [2026-10-03] 대상이 #cdp-command-groups → #cdp-sheet-body 로 바뀌었다(레일 제거).
//   레일은 도시를 열 때마다 새로 만들어지고 시트는 매번 지워졌다가 다시 차므로,
//   요소에 직접 걸면 두 번째 도시를 열 때 죽는다(리스너가 옛 DOM 에 남는다).
//   그래서 살아 있는 상위(#cdp-sheet-body)에 위임한다 — 안쪽이 바뀌어도 그대로 듣는다.
//   왼쪽에 #cdp-sheet-body 가 없으면 도시 화면이 아니라 다른 흐름이므로 아무것도 하지 않는다.
document.getElementById('cdp-sheet-body')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.cdp-action-btn') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    if (!action || !currentPanelCityId) return;
    runCityAction(currentPanelCityId, action);
});

function store_getOfficerSafe(id: string): import('./core/types.js').Officer | null {
    try {
        return engine['store'].getOfficer(id);
    } catch {
        return null;
    }
}

// ============================================================
// Game Loop
// ============================================================

function gameLoop(timestamp: number): void {
    if (!isRunning) return;

    // FPS counter
    frameCount++;
    if (timestamp - fpsTimer >= 1000) {
        currentFps = frameCount;
        frameCount = 0;
        fpsTimer = timestamp;
        fpsDisplay.textContent = `FPS: ${currentFps}`;
    }

    // Delta time
    const dt = lastFrameTime ? (timestamp - lastFrameTime) / 1000 : 0;
    lastFrameTime = timestamp;

    // Render
    renderFrame(dt);

    // UI updates (throttled)
    updateUI();

    animFrameId = requestAnimationFrame(gameLoop);
}

// ============================================================
// Canvas Resize
// ============================================================

function resizeCanvas(): void {
    const rect = canvas.parentElement!.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width === nextWidth && canvas.height === nextHeight) return;
    // CSS 크기는 유지하고 backing-store만 DPI에 맞춰 확대한다.
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 도시 최소 간격이 창 크기에 따라 달라지므로 배치를 다시 계산한다.
    if (typeof chinaMap !== 'undefined' && chinaMap) chinaMap.onCanvasResized();
}

const mapResizeObserver = typeof ResizeObserver !== 'undefined'
    // [2026-10-03] 레일 접힘 재계산 삭제 — 아래 resize 리스너가 시트 열림 상태를 본다.
    //   도시 캔버스 재생성도 여기로 모았다(캔버스가 창 크기를 따라가야 하므로).
    ? new ResizeObserver(() => { resizeCanvas(); syncSidebarTopOffset(); redrawCitySceneCanvas(); })
    : null;
if (mapResizeObserver && canvas.parentElement) mapResizeObserver.observe(canvas.parentElement);
// [2026-10-03] 창 크기가 바뀌면 도시 캔버스도 다시 그린다. backing-store 를 재설정하면
//   이전 그림이 지워지므로 크기를 바꾼 뒤 다시 칠해야 한다. (이게 없으면 캔버스가 이전
//   창 크기로 남아 "좌우 리사이징이 안 된다" 고 보인다.) 배지 좌표도 함께 다시 계산한다.
window.addEventListener('resize', () => {
    resizeCanvas();
    syncSidebarTopOffset();
    redrawCitySceneCanvas();
    applyCitySceneBadgePositions();
}, { passive: true });

/**
 * 도시 씬 캔버스를 현재 창 크기로 다시 그린다.
 *
 * 도시가 열려 있고 씬이 활성화된 경우에만 동작한다 — 닫힌 화면에서 불필요한
 * 작업을 하지 않도록. `drawCityCanvas` 가 backing-store 를 크기에 맞춘 뒤
 * 지우고 다시 칠하므로, 리사이즈가 눈에 보이게 반영된다.
 */
function redrawCitySceneCanvas(): void {
    if (!citySceneCanvas || !citySceneCityId) return;
    if (!citySceneCanvas.classList.contains('is-active')) return;
    const city = engine?.['store'].getCity(citySceneCityId);
    if (!city) return;
    drawCityCanvas(city);
    // 배지·초상은 CSS % 좌표라 자동 따라가지만, 툴팁 라벨 등은 캔버스 좌표에
    // 얹히므로 씬을 통째로 다시 그려 앵커를 맞춘다.
    applyCitySceneBadgePositions();
}

// ============================================================
// Render Frame
// ============================================================

function renderFrame(_dt: number): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 이벤트 연출 흔들림 [191-200] — 감쇠 진동을 렌더에 오프셋으로 적용
    if (feedbackEffects.isShaking()) {
        const { x, y } = feedbackEffects.update(_dt);
        ctx.save();
        ctx.translate(x, y);
        ctxRestorePending = true;
    }

    if (!isRunning) {
        ctx.fillStyle = '#e94560';
        ctx.font = 'bold 36px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('삼국지리턴', canvas.width / 2, canvas.height / 2 - 20);
        ctx.fillStyle = '#8080a0';
        ctx.font = '16px sans-serif';
        ctx.fillText('게임 시작을 눌러주세요', canvas.width / 2, canvas.height / 2 + 30);
        ctx.textAlign = 'start';
        return;
    }

    // [312] 리플레이 재생 모드 — 전투 UI 대신 리플레이 뷰어 렌더
    if (replayViewer) {
        updateReplayViewer(_dt);
        return;
    }

    if (isBattleMode && battleFrontend) {
        battleFrontend.render(ctx, canvas.width, canvas.height);
    } else {
        // 월드 화면: 중국 전도 [9] + 계절 톤 [1057][321-340]
        try {
            const gsSeason = engine ? monthToSeason(engine['store'].getGlobalState().time.month) : null;
            if (chinaMap['seasonTint'] !== gsSeason) chinaMap.setSeasonTint(gsSeason);
        } catch { /* 엔진 미초기화 */ }
        chinaMap.render();
        const state = engine?.getCurrentPhase();
        if (state) {
            ctx.fillStyle = 'rgba(240, 232, 208, 0.8)';
            ctx.font = '13px "Malgun Gothic", sans-serif';
            ctx.fillText(`Phase: ${state}`, 12, 24);
        }
    }

    // 흔들림 중이었으면 컨텍스트 상태 복원
    if (ctxRestorePending) {
        ctx.restore();
        ctxRestorePending = false;
    }
}

// ============================================================
// UI Update
// ============================================================

let uiTick = 0;

function updateUI(): void {
    uiTick++;
    if (uiTick % 10 !== 0) return;

    try {
        const gs = engine['store'].getGlobalState();
        turnDisplay.textContent = `턴 ${gs.turnCount}`;
        dateDisplay.textContent = `${gs.time.year}년 ${gs.time.month}월`;
        const season = monthToSeason(gs.time.month);
        document.body.dataset.season = season;
        titleScreen?.setSeason(season);
    } catch {
        // engine not fully initialized
    }
}

// ============================================================
// Button Handlers
// ============================================================

async function startGame(world: BuiltWorld | null = null, selectedOfficerId: string | null = null): Promise<void> {
    if (isRunning) return;

    if (world) {
        debugLog('게임 월드 초기화 중...');
        statusText.textContent = '월드 생성 중...';

        // 시나리오 기반 월드 구성
        try {
            engine.initWorld(world.officers, world.factions, world.cities, [], world.scenario?.id, world.mapFeatures);
            // 이민족 배치 — 북방 접경지에 실제로 존재하던 부족을 둔다.
            // 도시 이름 → id 해석을 여기서 끝내야 store 에 고아 인덱스가 생기지 않는다.
            const tribeNameToId: Record<string, string> = {};
            for (const c of world.cities) tribeNameToId[c.name] = c.id;
            engine['store'].setMigrationTribes(buildTribeRoster(tribeNameToId));
            // 황제 거처 — 황제 엔티티가 아직 없어, 가장 넓은 세력의 수도로 결정론적으로 정한다.
            // 알현은 이 도시에서만 열린다(아래 maybeOpenImperialAudience).
            const strongestFaction = [...world.factions].sort((a, b) => b.cities.length - a.cities.length)[0];
            if (strongestFaction?.capitalCityId) {
                engine['store'].setImperialCourt(createCourt('황제', strongestFaction.capitalCityId));
            }
            // [269][33] 시나리오 데이터에 포함된 초기 인맥을 정규화 스토어와 그래프 인덱스에 주입
            for (const relationship of world.relationships) engine['store'].addRelationship(relationship);
            engine['store'].rebuildGraphIndex();
            debugLog(`월드 생성 완료 — ${world.factions.length}세력, ${world.cities.length}도시, ${world.officers.length}무장`);
            // 플레이어 세력/군주 지정 (개인 행동 페이즈용) + 시나리오 난이도 주입 [X-난이도]
            const difficulty = world.scenario?.difficulty ?? 3;
            engine['store'].setGlobalState({
                ...engine['store'].getGlobalState(),
                playerFactionId: world.playerFactionId,
                selectedOfficerId: resolveProtagonistId(world, selectedOfficerId),
                difficulty,
                // 시나리오 시작 연월 주입 [300] — 누락 시 기본값(192년)으로 남아
                // 연의전 이벤트의 연도 조건이 전부 어긋난다
                time: { year: world.startYear, month: world.startMonth },
                visitedCityIds: [],
                cityBuildingStates: {},
            });
        } catch (err) {
            addLog(`월드 초기화 실패: ${err}`);
            statusText.textContent = '초기화 실패';
            return;
        }
    } else {
        // 이어하기(로드) 경로 — 저장된 월드를 전도에 재동기화 [17]
        const loadedCities = engine['store'].getAllCities();
        if (loadedCities.length > 0) {
            addLog(`세이브 복원 — ${Object.keys(engine['store'].getState().factions).length}세력, ${loadedCities.length}도시, ${Object.keys(engine['store'].getState().officers).length}무장`);
        }
    }

    // 신규 시작은 모든 도시를 먼저 보여주고, 발견 모드는 버튼으로 전환한다. [49]
    if (world) {
        visitedCityIds.clear();
        cityVisibilityMode = 'all';
        chinaMap.setDiscoveredOnly(false);
    }
    updateMapVisibilityButton();

    // 신규/이어하기 공통: 중국 전도에 도시 배치 (소속/영토 포함) [9][17]
    syncChinaMapCities();

    // 정산 증감의 기준선 — 이 시점의 재고로 두어야 첫 턴이 실제 증감으로 표시된다
    prevSettlement = computeSettlement(engine['store']);
    latestSettlement = prevSettlement;

    // [2026-10-03 제거] 첫 플레이 자동 튜토리얼 — 안내를 통째로 뺐다(사용자 요청).
    //   시작하자마자 안내 창이 뜨던 동작이 사라졌다. 별도 로그도 내지 않는다 —
    //   뺀 기능을 다시 조용히 안내하지 않는다.

    isRunning = true;
    isPaused = false;
    setPauseButton(false);
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnSave.disabled = false;
    btnSlots.disabled = false;
    btnReport.disabled = false;
    btnBattle.disabled = false;
    btnDiplomacy.disabled = false;
    btnNextMonth.disabled = false;
    btnGraph.disabled = false;
    // [트레이스] 턴 기록을 볼 수 있게 되면 버튼을 연다.
    btnTrace.disabled = false;
    btnMapVisibility.disabled = false;
    statusText.textContent = '게임 실행 중';
    lastFrameTime = 0;

    debugLog('게임 루프 시작');
    animFrameId = requestAnimationFrame(gameLoop);
}

btnStart.addEventListener('click', () => { openScenarioScreen(); });

btnMapVisibility.addEventListener('click', () => {
    setCityVisibilityMode(cityVisibilityMode === 'all' ? 'discovered' : 'all');
});

btnPause.addEventListener('click', () => {
    if (!isRunning) return;
    isPaused = !isPaused;
    setPauseButton(isPaused);
    statusText.textContent = isPaused ? '일시정지' : '게임 실행 중';
    if (isPaused) {
        // RAF 루프 정지 (재개 시 lastFrameTime 리셋으로 급강 점프 방지)
        if (animFrameId !== null) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
    } else {
        lastFrameTime = 0;
        animFrameId = requestAnimationFrame(gameLoop);
    }
});

// ============================================================
// Battle UI Event Handlers
// ============================================================

const battlePanel = document.getElementById('battle-panel')!;
const battlePhase = document.getElementById('battle-phase')!;
const battleUnits = document.getElementById('battle-units')!;
const btnBattleStart = document.getElementById('btn-battle-start') as HTMLButtonElement;
const btnEndTurn = document.getElementById('btn-end-turn') as HTMLButtonElement;
const btnBattleRetreat = document.getElementById('btn-battle-retreat') as HTMLButtonElement;
const btnBattleReplay = document.getElementById('btn-battle-replay') as HTMLButtonElement;

function enterBattleMode(): void {
    if (!engine || !isRunning) return;
    isBattleMode = true;
    battlePanel.style.display = 'block';
    // [312] 새 전투 시작 — 리플레이 로그 초기화
    replayManager.clearLogs();
    btnBattleReplay.style.display = 'none';

    const battleTiles = hexTiles.map(t => ({
        q: t.q,
        r: t.r,
        terrain: (t.terrain === 'city' ? 'PLAINS' :
                  t.terrain === 'water' ? 'WATER' :
                  t.terrain === 'forest' ? 'FOREST' :
                  t.terrain === 'mountain' ? 'MOUNTAIN' :
                  t.terrain === 'swamp' ? 'MARSH' :
                  t.terrain === 'road' ? 'PLAINS' :
                  t.terrain === 'desert' ? 'DESERT' : 'PLAINS') as any,
        elevation: 0,
        defense: 1,
        hasForestCover: t.terrain === 'forest',
        isRiverCrossing: false,
    }));

    // 출진 중이면 출진 도시의 실제 무장/병력으로 편성, 아니면 기본 데모 편성
    let deployable: DeployableUnit[];
    let enemyUnits: Parameters<BattleFrontend['initBattle']>[1] extends never ? never : any[];
    if (expeditionSource && expeditionTarget) {
        const store = engine['store'];
        const srcCity = store.getCity(expeditionSource);
        const tgtCity = store.getCity(expeditionTarget);
        const gs = store.getGlobalState();
        // 아군: 출진 도시 주둔 무장 (최대 4명, 통솔 순)
        const srcOfficers = (srcCity?.officerIds ?? [])
            .map(id => store.getOfficer(id))
            .filter((o): o is NonNullable<typeof o> => o !== null)
            .sort((a, b) => b.stats.leadership - a.stats.leadership)
            .slice(0, 4);
        const unitTypes = ['INFANTRY', 'CAVALRY', 'ARCHER', 'INFANTRY'] as const;
        const perUnitSoldiers = Math.floor((srcCity?.development ?? 4000) / Math.max(1, srcOfficers.length));
        deployable = srcOfficers.map((o, i) => ({
            unitId: `friendly_${i + 1}`,
            officerName: o.name,
            officerId: o.id,
            unitType: unitTypes[i % unitTypes.length],
            soldiers: perUnitSoldiers,
            morale: 80 + Math.floor(o.stats.charisma / 10),
            deployed: false,
        }));
        // 적군: 방어 도시의 무장/병력 반영
        const tgtOfficers = (tgtCity?.officerIds ?? [])
            .map(id => store.getOfficer(id))
            .filter((o): o is NonNullable<typeof o> => o !== null)
            .sort((a, b) => b.stats.leadership - a.stats.leadership)
            .slice(0, 3);
        const enemyPer = Math.floor((tgtCity?.development ?? 3500) / Math.max(1, tgtOfficers.length));
        const enemyTypes = ['INFANTRY', 'CAVALRY', 'ARCHER'] as const;
        enemyUnits = tgtOfficers.map((o, i) => ({
            unitId: `enemy_${i + 1}`, officerId: o.id, unitType: enemyTypes[i],
            soldiers: enemyPer, morale: 70, training: 60,
            position: { q: 3, r: -1 + i }, facing: 0, isSupplied: true,
            baseAttack: 60 + Math.floor(o.stats.might / 3), baseDefense: 55 + Math.floor(o.stats.leadership / 4),
            movementPoints: 4, maxMovementPoints: 4, hasEvasionSkill: false, evasionProbability: 0.1,
        }));

        // 인접 아군 도시 증원 반영 [107] — 방어 도시 소유 세력의 인접 도시가 지원군 파견
        if (tgtCity?.ownerId) {
            const allCities = store.getAllCities();
            const allOfficers = Object.values(store.getState().officers);
            const reinf = assembleReinforcements(
                tgtCity.id, tgtCity.ownerId, allCities, allOfficers,
                Object.values(store.getState().armies),
            );
            if (reinf.officerIds.length > 0 && reinf.totalTroops > 0) {
                const reinfTypes = ['CAVALRY', 'ARCHER', 'INFANTRY'] as const;
                reinf.officerIds.slice(0, 2).forEach((oid, i) => {
                    const o = store.getOfficer(oid);
                    if (!o) return;
                    const perUnit = Math.floor(reinf.totalTroops / reinf.officerIds.length);
                    enemyUnits.push({
                        unitId: `enemy_r${i + 1}`, officerId: oid, unitType: reinfTypes[i % reinfTypes.length],
                        soldiers: perUnit, morale: 75, training: 60,
                        position: { q: 4, r: i }, facing: 0, isSupplied: true,
                        baseAttack: 55 + Math.floor(o.stats.might / 3), baseDefense: 50 + Math.floor(o.stats.leadership / 4),
                        movementPoints: 5, maxMovementPoints: 5, hasEvasionSkill: false, evasionProbability: 0.1,
                    });
                });
                const srcNames = reinf.contingents.map(c => store.getCity(c.sourceCityId)?.name ?? c.sourceCityId).join(', ');
                addLog(`🛡️ ${tgtCity.name}에 ${srcNames}에서 증원 ${reinf.totalTroops.toLocaleString()}명 도착!`);
            }
        }
        void gs;
    } else {
        deployable = [
            { unitId: 'friendly_1', officerName: '유비', unitType: 'INFANTRY', soldiers: 5000, morale: 85, deployed: false },
            { unitId: 'friendly_2', officerName: '관우', unitType: 'CAVALRY', soldiers: 3000, morale: 90, deployed: false },
            { unitId: 'friendly_3', officerName: '장비', unitType: 'INFANTRY', soldiers: 4000, morale: 88, deployed: false },
            { unitId: 'friendly_4', officerName: '제갈량', unitType: 'ARCHER', soldiers: 2000, morale: 95, deployed: false },
        ];
        enemyUnits = [
            { unitId: 'enemy_1', officerId: 'enemy_1', unitType: 'INFANTRY' as const, soldiers: 4000, morale: 70, training: 60,
              position: { q: 3, r: -1 }, facing: 0, isSupplied: true, baseAttack: 75, baseDefense: 65,
              movementPoints: 4, maxMovementPoints: 4, hasEvasionSkill: false, evasionProbability: 0.1 },
            { unitId: 'enemy_2', officerId: 'enemy_2', unitType: 'CAVALRY' as const, soldiers: 2500, morale: 75, training: 65,
              position: { q: 4, r: -2 }, facing: 0, isSupplied: true, baseAttack: 85, baseDefense: 55,
              movementPoints: 6, maxMovementPoints: 6, hasEvasionSkill: false, evasionProbability: 0.1 },
            { unitId: 'enemy_3', officerId: 'enemy_3', unitType: 'ARCHER' as const, soldiers: 3000, morale: 65, training: 70,
              position: { q: 2, r: 1 }, facing: 0, isSupplied: true, baseAttack: 70, baseDefense: 60,
              movementPoints: 4, maxMovementPoints: 4, hasEvasionSkill: false, evasionProbability: 0.15 },
        ];
    }
    void deployable; void enemyUnits;

    // 복수 이벤트 판정 [32][33][C-인간관계] — 출진 편성에 실제 무장 ID가 있는 경우
    // 아군×적군 유닛쌍 중 NEMESIS 관계가 조우하면 복수 이벤트 발동:
    // 플레이어 관여(아군이 주도) → 인터랙티브 미니게임 / AI 주도 → 자동 판정
    if (expeditionSource && expeditionTarget && engine) {
        const storeV = engine['store'];
        const gsV = storeV.getGlobalState();
        const friendlyIds = (storeV.getCity(expeditionSource)?.officerIds ?? []).slice(0, 4);
        // 수비 도시 전체 무장을 복수 판정 대상으로 (전투 유닛은 상위 3명뿐이지만 관계망은 전원)
        const enemyOfficerIds = storeV.getCity(expeditionTarget)?.officerIds ?? [];
        outer: for (const fId of friendlyIds) {
            for (const eId of enemyOfficerIds) {
                const judged = judgeVengeanceOnly(storeV, fId, eId);
                if (!judged.triggered || !judged.kind || !judged.actorId || !judged.targetId) continue;
                // 주도자가 플레이어 세력 소속이면 인터랙티브 모달로 진행
                const actor = storeV.getOfficer(judged.actorId);
                if (actor && actor.factionId === gsV.playerFactionId) {
                    openVengeanceModal(storeV, judged.actorId, judged.targetId, judged.kind, deployable, enemyUnits);
                } else {
                    // AI 주도 — 자동 판정 + 전투 유닛 임팩트 [32][131-145]
                    const outcome = tryVengeanceOnEncounter(storeV, fId, eId);
                    if (outcome.triggered) {
                        addLog(outcome.message);
                        const impact = applyVengeanceToUnits(outcome, deployable, enemyUnits);
                        if (impact.allyLog) addLog(impact.allyLog);
                        if (impact.enemyLog) addLog(`🪫 ${storeV.getCity(expeditionTarget)?.name ?? '적군'} 병력 사기가 흔들립니다`);
                    }
                }
                break outer; // 전투당 복수 이벤트 1회
            }
        }
    }

    battleFrontend = new BattleFrontend(hexRenderer);
    battleFrontend.setCallbacks({
        onPhaseChange: (phase: string) => {
            updateBattleUI();
            // 출진 전투 종료 판정 — 승패에 따라 도시 점령/패배 처리 [105]
            if (phase === 'RESULT' && expeditionSource && expeditionTarget) {
                const remaining = battleFrontend.getState().units.some(u => u.unitId.startsWith('friendly_'));
                const enemyRemaining = battleFrontend.getState().units.some(u => !u.unitId.startsWith('friendly_'));
                resolveExpeditionOutcome(remaining && !enemyRemaining);
            }
        },
        onAction: updateBattleUI,
        // [312] 리플레이 기록 — 전투 액션 상세를 실시간 누적
        onActionDetail: (detail) => {
            replayManager.recordAction(
                battleFrontend.getState().turn,
                detail.officerId || detail.unitId,
                detail.action,
                detail.targetOfficerId ?? null,
                detail.value,
                detail.q,
                detail.r,
            );
        },
    });
    battleFrontend.initBattle(battleTiles, deployable);

    (battleFrontend as any).state.units.push(...enemyUnits);

    btnBattleStart.style.display = 'inline-block';
    btnEndTurn.style.display = 'none';
    btnBattleRetreat.style.display = 'none';

    addLog('⚔️ 전투 모드 진입 — 유닛을 배치하세요');
    updateBattleUI();
}

function updateBattleUI(): void {
    const state = battleFrontend.getState();

    // Phase info
    const phaseNames: Record<string, string> = {
        DEPLOYMENT: '⚔️ 배치 페이즈',
        PLAYER_TURN: '🎯 아군 턴',
        ENEMY_TURN: '👹 적군 턴',
        RESULT: '🏆 전투 종료',
    };
    battlePhase.textContent = phaseNames[state.phase] || state.phase;

    // [312] 전투 종료 시 리플레이 버튼 표시
    btnBattleReplay.style.display = state.phase === 'RESULT' && replayManager.logCount > 0 ? 'inline-block' : 'none';

    // Button visibility
    btnBattleStart.style.display = state.phase === 'DEPLOYMENT' ? 'inline-block' : 'none';
    btnEndTurn.style.display = state.phase === 'PLAYER_TURN' ? 'inline-block' : 'none';
    btnBattleRetreat.style.display = state.phase === 'PLAYER_TURN' ? 'inline-block' : 'none';

    // Unit cards
    let html = '';
    if (state.phase === 'DEPLOYMENT') {
        for (const u of battleFrontend.getDeployableUnits()) {
            const deployedClass = u.deployed ? 'deployed' : '';
            html += `<div class="battle-unit-card ${deployedClass}" data-unit="${u.unitId}">
                <div><span class="unit-name">${u.officerName}</span>
                <span class="unit-info"> [${u.unitType}]</span></div>
                <div><span class="unit-soldiers">${u.soldiers}명</span> · <span class="unit-morale">사기 ${u.morale}</span></div>
            </div>`;
        }
    } else {
        for (const u of state.units) {
            const isFriendly = u.unitId.startsWith('friendly_');
            const sideClass = isFriendly ? '' : 'enemy';
            const selectedClass = u.unitId === state.selectedUnitId ? 'selected' : '';
            const hpPct = u.soldiers > 0 ? Math.max(1, u.soldiers / 100) : 0;
            const hpColor = hpPct > 60 ? '#44cc88' : hpPct > 30 ? '#ccaa44' : '#cc4444';
            html += `<div class="battle-unit-card ${sideClass} ${selectedClass}" data-unit="${u.unitId}">
                <div>
                    <div><span class="unit-name">${u.unitId.replace('friendly_', '').replace('enemy_', '')}</span>
                    <span class="unit-info"> [${u.unitType}]</span></div>
                    <div class="hp-bar-bg"><div class="hp-bar-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
                </div>
                <div style="text-align:right">
                    <div class="unit-soldiers">${u.soldiers}명</div>
                    <div class="unit-morale">사기 ${Math.round(u.morale)}</div>
                </div>
            </div>`;
        }
    }
    battleUnits.innerHTML = html;
}

// Battle button handlers
btnBattleStart.addEventListener('click', () => {
    battleFrontend.startBattle();
    addLog('전투 시작!');
    updateBattleUI();
});

btnEndTurn.addEventListener('click', () => {
    battleFrontend.endTurn();
    addLog('턴 종료');
    updateBattleUI();
});

btnBattleRetreat.addEventListener('click', () => {
    isBattleMode = false;
    battlePanel.style.display = 'none';
    btnBattleStart.style.display = 'none';
    btnEndTurn.style.display = 'none';
    btnBattleRetreat.style.display = 'none';
    btnBattleReplay.style.display = 'none';
    addLog('🏳️ 퇴각 — 전투 모드 종료');
});

// [312] 리플레이 URL 내보내기 — 전투 종료 후 활성화
btnBattleReplay.addEventListener('click', async () => {
    const compressed = await replayManager.exportForUrlSharing();
    if (!compressed) {
        addLog('⚠️ 리플레이 기록이 없습니다');
        return;
    }
    const url = `${location.origin}${location.pathname}?replay=${compressed}`;
    const panel = document.getElementById('replay-panel')!;
    document.getElementById('rp-content')!.textContent = url;
    panel.style.display = 'flex';
    addLog(`🎬 리플레이 URL 생성 완료 (${(compressed.length / 1024).toFixed(1)}kB, 액션 ${replayManager.logCount}건)`);
});
document.getElementById('rp-close')?.addEventListener('click', () => {
    document.getElementById('replay-panel')!.style.display = 'none';
});
document.getElementById('rp-copy')?.addEventListener('click', () => {
    const text = document.getElementById('rp-content')!.textContent ?? '';
    void navigator.clipboard?.writeText(text).then(() => addLog('📋 리플레이 URL이 클립보드에 복사되었습니다'));
});

// [312] 리플레이 뷰어 — 공유 URL 접속 시 헥스 맵 애니메이션 재생
let replayViewer: ReplayViewer | null = null;
const replaySpeedControls = new ReplaySpeedControls(
    document.getElementById('replay-speed-controls') as HTMLFieldSetElement,
    speed => replayViewer?.setSpeed(speed),
);

/** 새 리플레이를 준비하고 속도 UI는 항상 안전한 1x부터 시작한다. */
function prepareReplayPlayback(logs: readonly ReplayActionLog[]): number {
    replayViewer = new ReplayViewer({
        addLog,
        onComplete: () => replaySpeedControls.setEnabled(false),
    });
    const unitCount = replayViewer.load(logs);
    replaySpeedControls.reset();
    replaySpeedControls.setEnabled(!replayViewer.isFinished);
    replaySpeedControls.setVisible(unitCount > 0);
    if (unitCount === 0) replayViewer = null;
    return unitCount;
}

function checkReplayParam(): void {
    const params = new URLSearchParams(location.search);
    const replay = params.get('replay');
    if (!replay) return;
    // 실패/손상 데이터가 이전 세션의 배율을 물려받지 않도록 UI부터 1x로 복구한다.
    replaySpeedControls.reset();
    replaySpeedControls.setVisible(false);
    void replayManager.importFromCompressedString(replay).then(logs => {
        if (logs.length === 0) {
            addLog('⚠️ 리플레이 데이터 복원 실패 — 기본 속도 1x로 복구');
            return;
        }
        // 리플레이 재생 모드 — 타이틀을 덮고 헥스 전장에서 애니메이션 재생 [312]
        const unitCount = prepareReplayPlayback(logs);
        if (unitCount === 0) {
            addLog('⚠️ 리플레이에 유닛 정보가 없습니다 — 기본 속도 1x 유지');
            return;
        }
        document.getElementById('title-screen')!.style.display = 'none';
        addLog(`🎬 공유된 리플레이 로드 완료 — 액션 ${logs.length}건, 유닛 ${unitCount} (자동 재생)`);
        replayViewer!.play();
    });
}

/** 리플레이 뷰어 프레임 처리 — gameLoop에서 매 프레임 호출 */
function updateReplayViewer(dt: number): void {
    if (!replayViewer) return;
    replayViewer.update(dt * 1000);
    // 전장 렌더: 기본 헥스 타일 + 유닛 오버레이
    hexRenderer.render(hexTiles, canvas.width, canvas.height);
    replayViewer.draw(ctx, 30, canvas.width / 2, canvas.height / 2);
    // 재생 안내 + 진행률 바 오버레이
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, 340, 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px "Malgun Gothic", sans-serif';
    ctx.fillText(
        replayViewer.isFinished ? '🏁 리플레이 종료 — 새로고침으로 다시 재생' : `🎬 리플레이 재생 중 (${replayViewer.actionCount} 액션 · ${replayViewer.speed}x)`,
        10, 20,
    );
    // 진행률 바 [461-480]
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(10, 32, 320, 6);
    ctx.fillStyle = '#d4af37';
    ctx.fillRect(10, 32, 320 * replayViewer.progress, 6);
}

// [312][461-480] 리플레이 컨트롤 키바인딩 — Space 일시정지, 0~4 속도 프리셋
// radio에 포커스가 있더라도 브라우저의 네이티브 키보드 탐색을 유지한다.
document.addEventListener('keydown', (e) => {
    if (!replayViewer || replayViewer.isFinished) return;
    const target = e.target as HTMLElement | null;
    const isReplaySpeedInput = target instanceof HTMLInputElement && target.name === 'replay-speed';
    if (target && !isReplaySpeedInput && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === ' ') {
        if (isReplaySpeedInput) return; // radio 기본 Space 선택을 유지한다.
        e.preventDefault();
        replayViewer.togglePause();
    } else if (e.key >= '0' && e.key <= '4') {
        e.preventDefault();
        // 3은 제외 프리셋(0.5/1/2/4) 계약을 보존하기 위한 4x 별칭이다.
        replaySpeedControls.setSpeed(e.key === '0' ? 0.5 : e.key === '1' ? 1 : e.key === '2' ? 2 : 4);
    }
});

// [461-480] 키보드 조작·오버레이 접근성
// 단축키: N 다음 달, S 저장, G 관계망, H 도움말, D 외교, R 보고, P 일시정지, Escape 최상위 패널 닫기.
const shortcutButtons: Record<string, HTMLButtonElement> = {
    n: btnNextMonth,
    s: btnSave,
    g: btnGraph,
    d: btnDiplomacy,
    r: btnReport,
    p: btnPause,
};

const dialogueSurface = dialogueScene.surface();

function closeTopOverlay(): boolean {
    const overlays: Array<[string, HTMLElement, HTMLElement]> = [
        ['dialogue-modal', dialogueSurface.panel, dialogueSurface.closeButton],
        // [2026-10-03] btnHelp(도움말) 삭제로 roaming-modal 의 트리거가 비었다.
        //   돌아갈 포커스 대상이 없어 btnSettings(설정)로 대체한다 — 방랑군 창을 닫은 뒤
        //   포커스를 받을 수 있는 실제 버튼이어야 한다.
        ['roaming-modal', document.getElementById('roaming-modal')!, btnSettings],
        ['replay-panel', document.getElementById('replay-panel')!, btnBattleReplay],
        ['vengeance-modal', document.getElementById('vengeance-modal')!, btnBattle],
        ['a11y-panel', a11yPanel, btnSettings],
        ['graph-panel', graphPanel, btnGraph],
        ['trace-panel', tracePanel, btnTrace],
        ['save-slots-panel', saveSlotsPanel, btnSlots],
        ['diplomacy-panel', diplomacyPanel, btnDiplomacy],
        ['monthly-report-panel', document.getElementById('monthly-report-panel')!, btnReport],
        ['city-detail-panel', cityDetailPanel, canvas],
        ['auth-panel', document.getElementById('auth-panel-container')!, btnAuth],
    ];
    for (const [id, panel, trigger] of overlays) {
        if (panel.style.display !== 'none' && panel.style.display !== '') {
            if (id === 'roaming-modal' && !rmState?.resolved) return true;
            if (id === 'dialogue-modal') closeDialogue();
            else if (id === 'roaming-modal') document.getElementById('rm-close')?.click();
            else if (id === 'replay-panel') document.getElementById('rp-close')?.dispatchEvent(new Event('click'));
            else if (id === 'vengeance-modal') document.getElementById('vm-close')?.click();
            else panel.style.display = 'none';
            if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true });
            addLog(`⌨ 단축키로 닫음: ${id}`);
            return true;
        }
    }
    return false;
}

document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (e.key === 'Escape') {
        if (closeTopOverlay()) e.preventDefault();
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const button = shortcutButtons[e.key.toLowerCase()];
    if (button && !button.disabled) {
        e.preventDefault();
        button.click();
    }
});

btnBattle.addEventListener('click', () => {
    enterBattleMode();
});

btnReport.addEventListener('click', () => {
    showMonthlyReport();
});

// ============================================================
// 세이브 슬롯 관리 [17][212] — 수동 3슬롯 + 자동 저장 1슬롯
// ============================================================

const slotManager = new SaveSlotManager();
const saveSlotsPanel = document.getElementById('save-slots-panel')!;
const saveSlotList = document.getElementById('ss-slot-list')!;

/** 현재 상태를 지정 슬롯에 저장 — [303] 다중 탭 뮤텍스로 동시 저장 충돌 방지 */
function saveToSlot(slot: SlotId): void {
    if (!engine) return;
    // [303] 락 획득 시도 — 실패 시 다른 탭이 저장 중
    if (!mutexCoordinator.acquireLock()) {
        addLog('⚠️ 동시 저장 불가: 다른 탭에서 게임 중입니다. 해당 탭을 닫고 다시 시도하세요. [303]');
        return;
    }
    try {
        mutexCoordinator.ensureLockOrThrow();
        const compressed = engine.saveCompressed();
        const gs = engine['store'].getGlobalState();
        const faction = gs.playerFactionId ? engine['store'].getFaction(gs.playerFactionId) : null;
        // [461-480] UI 설정 스냅샷 — 접근성·색약 모드 동반 저장
        // [2026-10-03] tutorialDone 항목 제거 — 안내를 통째로 뺐다. 저장 스키마는
        //   읽는 쪽이 없는 필드를 그냥 무시하므로 구형 세이브를 못 읽게 하진 않는다.
        const ok = slotManager.save(slot, compressed, {
            year: gs.time.year,
            month: gs.time.month,
            turnCount: gs.turnCount,
            factionName: faction?.name ?? '-',
            uiSettings: {
                fontMode: a11ySettings.fontMode,
                textScale: a11ySettings.textScale,
                screenShake: a11ySettings.screenShake,
                showStatNumbers: a11ySettings.showStatNumbers,
                colorblindMode,
                colorPattern,
            },
        });
        addLog(ok
            ? `${slot === 'auto' ? '자동' : `슬롯 ${slot}`} 저장 완료 (${gs.time.year}년 ${gs.time.month}월)`
            : '저장 실패: 저장 공간 부족');
        if (ok) renderSaveSlots();
    } catch (err) {
        addLog(`저장 실패: ${err}`);
    } finally {
        // [303] 저장 완료 후 락 해제
        mutexCoordinator.releaseLock();
    }
}

/**
 * [309] 모드 창작 마당 — JSON 모드 파일 드래그&드롭 마운트
 * SchemaValidator [301]로 검증 후 핫 인젝션 [302], 실패 시 게임에 영향 없음
 */
function setupModDragDrop(): void {
    const hint = document.getElementById('mod-drop-hint')!;
    const toast = document.getElementById('mod-result-toast')!;
    let dragDepth = 0;

    const showToast = (msg: string, ok: boolean): void => {
        toast.textContent = msg;
        toast.style.background = ok ? 'rgba(40,80,50,0.95)' : 'rgba(90,40,40,0.95)';
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 4000);
    };

    window.addEventListener('dragenter', (e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        dragDepth++;
        hint.style.display = 'flex';
    });
    window.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) hint.style.display = 'none';
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragDepth = 0;
        hint.style.display = 'none';
        const file = e.dataTransfer?.files?.[0];
        if (!file || !modLoader) return;
        const reader = new FileReader();
        reader.onload = () => {
            void modLoader!.loadModFromFile(String(reader.result)).then(result => {
                if (result.success) {
                    showToast(`📦 모드 마운트 성공: $result.meta.name} v$result.meta.version}`, true);
                    addLog(`📦 모드 마운트: $result.meta.name} — 무장 $result.stats.officersLoaded} · 세력 $result.stats.factionsLoaded} · 도시 $result.stats.citiesLoaded} [309]`);
                } else {
                    showToast(`❌ 모드 검증 실패: $result.errors[0] ?? '알 수 없는 오류'}`, false);
                    addLog(`❌ 모드 마운트 실패 [301]: $result.errors.join(' / ')}`);
                }
            });
        };
        void reader.readAsText(file);
    });
}

/** [49] 세이브의 방문 도시 기록을 지도 필터 상태로 복원한다. */
function restoreVisitedCitiesFromGlobalState(): void {
    visitedCityIds.clear();
    for (const cityId of engine['store'].getGlobalState().visitedCityIds ?? []) {
        visitedCityIds.add(cityId);
    }
}

/** 지정 슬롯에서 불러와 게임 재시작 */
function loadFromSlot(slot: SlotId): void {
    const data = slotManager.load(slot);
    if (!data) { addLog(`슬롯 ${slot}이(가) 비어 있습니다.`); return; }
    const ok = engine.loadCompressed(data);
    if (!ok) {
        addLog('불러오기 실패: 세이브 데이터가 손상되었습니다.');
        return;
    }
    // [49] 방문 도시 기록 복원 — 구버전 세이브에는 필드가 없으므로 빈 목록으로 시작한다.
    restoreVisitedCitiesFromGlobalState();

    // [461-480] UI 설정 복원 — 세이브 시점의 접근성·색약 모드·튜토리얼 상태
    restoreUiSettings(slotManager.getUiSettings(slot));
    saveSlotsPanel.style.display = 'none';
    addLog(`슬롯 ${slot === 'auto' ? '자동' : slot}에서 불러왔습니다`);
    void startGame(null);
}

/** 세이브에 포함된 UI 설정 복원 (구버전 세이브: null이면 무시) [461-480] */
function restoreUiSettings(ui: import('./core/save_slot_manager.js').UiSettingsSnapshot | null): void {
    if (!ui) return;
    if (ui.fontMode === 'serif' || ui.fontMode === 'sans' || ui.fontMode === 'contrast') {
        a11ySettings = { ...a11ySettings, fontMode: ui.fontMode };
    }
    if (ui.textScale === 0.9 || ui.textScale === 1.0 || ui.textScale === 1.15 || ui.textScale === 1.3) {
        a11ySettings = { ...a11ySettings, textScale: ui.textScale };
    }
    if (typeof ui.screenShake === 'boolean') a11ySettings = { ...a11ySettings, screenShake: ui.screenShake };
    if (typeof ui.showStatNumbers === 'boolean') a11ySettings = { ...a11ySettings, showStatNumbers: ui.showStatNumbers };
    if (ui.colorblindMode === 'none' || ui.colorblindMode === 'deuteranopia' || ui.colorblindMode === 'tritanopia') {
        colorblindMode = ui.colorblindMode;
    }
    if (ui.colorPattern === 'none' || ui.colorPattern === 'hatch' || ui.colorPattern === 'dots' || ui.colorPattern === 'border') {
        colorPattern = ui.colorPattern;
    }
    saveAccessibilitySettings(a11ySettings);
    applyAccessibility();
    applyColorblindToMap();
}

const SLOT_DEFS: Array<{ id: SlotId; label: string }> = [
    { id: 1, label: '슬롯 一' },
    { id: 2, label: '슬롯 二' },
    { id: 3, label: '슬롯 三' },
    { id: 'auto', label: '自動' },
];

/** 슬롯 목록 렌더링 — 메타데이터 미리보기 포함 */
function renderSaveSlots(): void {
    saveSlotList.innerHTML = SLOT_DEFS.map(({ id, label }) => {
        const meta = slotManager.getMeta(id);
        const name = label + (id === 'auto' ? ' (매월 자동)' : '');
        if (!meta) {
            return `<div class="ss-slot" data-slot="${id}">
                <div class="ss-slot-head"><span class="ss-slot-name">${name}</span><span class="ss-slot-tag">빈 슬롯</span></div>
                <div class="ss-slot-empty">클릭하여 현재 상태를 저장</div>
            </div>`;
        }
        const saved = new Date(meta.savedAt);
        const time = `${saved.getMonth() + 1}/${saved.getDate()} ${String(saved.getHours()).padStart(2, '0')}:${String(saved.getMinutes()).padStart(2, '0')}`;
        return `<div class="ss-slot" data-slot="${id}">
            <div class="ss-slot-head"><span class="ss-slot-name">${name}</span><span class="ss-slot-tag">${time}</span></div>
            <div class="ss-slot-info">${meta.factionName} · ${meta.year}년 ${meta.month}월 · 턴 ${meta.turnCount}</div>
            <div class="ss-slot-actions"><button class="ss-load-btn" data-load="${id}">불러오기</button></div>
        </div>`;
    }).join('');
}

btnSlots.addEventListener('click', () => {
    renderSaveSlots();
    saveSlotsPanel.style.display = saveSlotsPanel.style.display === 'none' || !saveSlotsPanel.style.display ? 'block' : 'none';
});
document.getElementById('ss-close')!.addEventListener('click', () => {
    saveSlotsPanel.style.display = 'none';
});
saveSlotList.addEventListener('click', (e) => {
    const loadBtn = (e.target as HTMLElement).closest('.ss-load-btn') as HTMLElement | null;
    if (loadBtn) {
        e.stopPropagation();
        loadFromSlot(loadBtn.dataset.load as SlotId);
        return;
    }
    const slotEl = (e.target as HTMLElement).closest('.ss-slot') as HTMLElement | null;
    if (slotEl) saveToSlot(slotEl.dataset.slot as SlotId);
});

// ============================================================
// 접근성 설정 패널 [461-480] — 글꼴 전환·글자 크기·화면 흔들림
// ============================================================
// 접근성 설정 패널 [461-480] 상태 — 색약 친화 팔레트 포함
const a11yPanel = document.getElementById('a11y-panel')!;
let a11ySettings: AccessibilitySettings = loadAccessibilitySettings();
let colorblindMode: ColorblindMode = 'none';
let colorPattern: PatternOption = 'none';

function applyAccessibility(): void {
    for (const [k, v] of Object.entries(accessibilityAttributes(a11ySettings))) {
        document.body.setAttribute(k, v);
    }
}

/** 세력 색 일괄 변환기 — 지도/배지/패널 공용 [461-480] */
function factionColor(hex: string | null | undefined): string {
    return convertFactionColor(hex ?? '#888898', colorblindMode);
}

function renderA11yPanel(): void {
    const content = document.getElementById('a11y-content')!;
    // 색약 친화 팔레트 섹션 [461-480] — 모드/패턴 선택 버튼 동적 생성
    const cbRow =
        `<div class="a11y-row"><span class="a11y-label">세력 색</span><span class="a11y-opts">` +
        (Object.keys(COLORBLIND_MODE_LABELS) as ColorblindMode[])
            .map((m) => `<button class="a11y-option${m === colorblindMode ? ' active' : ''}" data-cb="${m}">${COLORBLIND_MODE_LABELS[m]}</button>`)
            .join('') +
        `</span></div>` +
        `<div class="a11y-row"><span class="a11y-label">세력 무늬</span><span class="a11y-opts">` +
        (PATTERN_OPTIONS as readonly PatternOption[])
            .map((p) => `<button class="a11y-option${p === colorPattern ? ' active' : ''}" data-pattern="${p}">${PATTERN_LABELS[p]}</button>`)
            .join('') +
        `</span></div>`;
    content.innerHTML = renderAccessibilityPanel(a11ySettings).replace('<div class="ss-hint">', cbRow + '<div class="ss-hint">');
    content.querySelectorAll('.a11y-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            const el = btn as HTMLElement;
            const font = el.dataset['font'] as AccessibilitySettings['fontMode'] | undefined;
            const scale = el.dataset['scale'];
            const shake = el.dataset['shake'];
            const stat = el.dataset['stat'];
            const cb = el.dataset['cb'] as ColorblindMode | undefined;
            const pat = el.dataset['pattern'] as PatternOption | undefined;
            const typewriter = el.dataset['typewriter'];
            const speech = el.dataset['speech'];
            if (font) a11ySettings = { ...a11ySettings, fontMode: font };
            else if (scale) a11ySettings = { ...a11ySettings, textScale: Number(scale) as AccessibilitySettings['textScale'] };
            else if (shake) a11ySettings = { ...a11ySettings, screenShake: shake === 'on' };
            else if (stat) a11ySettings = { ...a11ySettings, showStatNumbers: stat === 'on' };
            else if (typewriter) a11ySettings = { ...a11ySettings, typewriter: typewriter === 'on' };
            else if (speech) {
                a11ySettings = { ...a11ySettings, speech: speech === 'on' };
                // 켰다가 끄면 지금 읽는 소리를 바로 멈춘다.
                if (!a11ySettings.speech) stopSpeech();
            }
            else if (cb) colorblindMode = cb;
            else if (pat) colorPattern = pat;
            saveAccessibilitySettings(a11ySettings);
            applyAccessibility();
            applyColorblindToMap();
            renderA11yPanel();
        });
    });
}

btnSettings.addEventListener('click', () => {
    if (!a11yPanel.style.display || a11yPanel.style.display === 'none') {
        renderA11yPanel();
        a11yPanel.style.display = 'block';
    } else {
        a11yPanel.style.display = 'none';
    }
});
document.getElementById('a11y-close')!.addEventListener('click', () => { a11yPanel.style.display = 'none'; });

// 타이틀바 로그인 아이콘 — 인증 패널 토글
const authPanelBox = document.getElementById('auth-panel-container')!;
btnAuth.addEventListener('click', () => {
    const open = authPanelBox.style.display === 'none' || authPanelBox.style.display === '';
    authPanelBox.style.display = open ? 'block' : 'none';
});

// ============================================================
// 턴 실행 트레이스 패널 [디버그]
// executeTurn(AI 턴) 이 수행한 전체 과정을 번호가 붙은 트리로 보여준다.
// "1턴을 돌렸는데 도대체 뭐가 일어났지" 를 되돌아보기 위한 창이다.
// ============================================================
const tracePanel = document.getElementById('trace-panel')!;
const traceTreeEl = document.getElementById('trace-tree')!;
const traceSummaryEl = document.getElementById('trace-summary')!;
const traceDeepEl = document.getElementById('trace-deep') as HTMLInputElement;

function refreshTracePanel(): void {
    if (!engine) {
        traceSummaryEl.textContent = '게임이 아직 시작되지 않았습니다';
        traceTreeEl.innerHTML = '<div class="trace-detail">시나리오를 선택하면 턴 기록이 여기에 쌓입니다.</div>';
        return;
    }
    const trace = engine.getTurnTrace();
    const tree = trace.getTree();
    const deep = traceDeepEl.checked;
    const total = tree.children.length;
    traceSummaryEl.textContent = tree.children.length === 0
        ? '아직 실행된 턴이 없습니다 — 「다음 달」을 눌러 보세요'
        : `${tree.label} · ${total}단계 · ${tree.detail || '진행 중'}`;
    traceTreeEl.innerHTML = renderTraceTreeHtml(tree, deep ? 3 : 1);
}

function openTracePanel(): void {
    refreshTracePanel();
    tracePanel.style.display = 'block';
}

btnTrace.addEventListener('click', () => {
    if (tracePanel.style.display === 'block') tracePanel.style.display = 'none';
    else openTracePanel();
});
document.getElementById('trace-close')!.addEventListener('click', () => { tracePanel.style.display = 'none'; });
traceDeepEl.addEventListener('change', refreshTracePanel);

// ============================================================
// 인맥 그래프 패널 [269][33] — 줌/팬/클릭 인터랙션 + 노드 상세
// ============================================================
const graphPanel = document.getElementById('graph-panel')!;
const graphViewer = new RelationshipGraphViewer();
let graphDetach: (() => void) | null = null;
let graphCenterId: string | null = null;

/** 스토어 관계 엣지 → 뷰어 그래프 변환 (중심 무장 기준 1홉) [33] */
function buildStoreGraph(centerId: string | null) {
    const officers = engine['store'].getAllOfficers();
    const nameOf = new Map(officers.map((o) => [o.id, o.name] as const));
    const facOf = new Map(officers.map((o) => [o.id, o.factionId ?? ''] as const));
    const allEdges = engine['store'].getState().relationships;
    const edges = Object.values(allEdges).filter((e) =>
        !centerId || e.source === centerId || e.target === centerId,
    );
    return graphViewer.buildGraph(
        officers.map((o) => ({ id: o.id, name: o.name, factionId: facOf.get(o.id) ?? '' })),
        edges,
        centerId ?? undefined,
    );
}

function renderGraphPanel(): void {
    // 중심 무장 셀렉터 (현직 무장만, 이름순)
    const officers = engine['store'].getAllOfficers()
        .filter((o) => o.deathYear === null)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const sel = document.getElementById('gp-center') as HTMLSelectElement;
    sel.innerHTML = '<option value="">— 전체 관계망 —</option>' +
        officers.map((o) => `<option value="${o.id}"${o.id === graphCenterId ? ' selected' : ''}>${o.name}</option>`).join('');

    const graph = buildStoreGraph(graphCenterId);
    const canvas = document.getElementById('gp-canvas') as HTMLCanvasElement;
    graphViewer.attachCanvas(canvas);
    const layout = graphViewer.layoutGraph(graph, canvas.width, canvas.height);
    graphViewer.render(layout);
    if (!graphDetach) {
        graphDetach = graphViewer.attachInteraction(canvas, () => {
            const g = buildStoreGraph(graphCenterId);
            return graphViewer.layoutGraph(g, canvas.width, canvas.height);
        }, (nodeId: string | null) => {
            if (nodeId) {
                graphCenterId = nodeId;
                (document.getElementById('gp-center') as HTMLSelectElement).value = nodeId;
                renderGraphPanel();
            }
        }, (nodeId: string) => {
            // [461-480] 더블클릭 — 사이드바 무장 상세 패널에 해당 무장 표시
            renderOfficerDetail(nodeId);
            addLog(`인맥 뷰: ${engine['store'].getOfficer(nodeId)?.name ?? nodeId} 상세 표시`);
        });
    }
    renderGraphDetail();
}

function renderGraphDetail(): void {
    const detail = document.getElementById('gp-detail')!;
    if (!graphCenterId) {
        detail.innerHTML = '<span class="gp-hint">노드를 클릭하면 해당 무장을 중심으로 다시 배치합니다</span>';
        return;
    }
    const officers = engine['store'].getAllOfficers();
    const center = officers.find((o) => o.id === graphCenterId);
    const rels = Object.values(engine['store'].getState().relationships)
        .filter((e) => e.source === graphCenterId || e.target === graphCenterId);
    const nameOf = new Map(officers.map((o) => [o.id, o.name] as const));
    const typeLabel: Record<string, string> = {
        FRIEND: '우호', RIVAL: '경쟁', SWORN_BROTHER: '의형제',
        NEMESIS: '숙명', FAMILY: '친족', SPOUSE: '배우자', SUBORDINATE: '주종',
    };
    const rows = rels
        .sort((a, b) => b.affinity - a.affinity)
        .slice(0, 12)
        .map((e) => {
            const other = e.source === graphCenterId ? e.target : e.source;
            const label = typeLabel[e.type] ?? e.type;
            return `<div class="gp-rel-row"><span class="gp-rel-name">${nameOf.get(other) ?? other}</span>` +
                `<span class="gp-rel-type">${label}</span>` +
                `<span class="gp-rel-aff" data-aff="${e.affinity}">${e.affinity >= 0 ? '+' : ''}${e.affinity}</span></div>`;
        }).join('');
    detail.innerHTML = `<div class="gp-rel-title">${center?.name ?? graphCenterId}의 인맥 (${rels.length})</div>${rows || '<span class="gp-hint">기록된 관계가 없습니다</span>'}`;
}

btnGraph.addEventListener('click', () => {
    if (!graphPanel.style.display || graphPanel.style.display === 'none') {
        renderGraphPanel();
        graphPanel.style.display = 'block';
    } else {
        graphPanel.style.display = 'none';
    }
});
document.getElementById('gp-close')!.addEventListener('click', () => { graphPanel.style.display = 'none'; });
document.getElementById('gp-center')!.addEventListener('change', (e) => {
    graphCenterId = (e.target as HTMLSelectElement).value || null;
    renderGraphPanel();
});

/** 색약 모드 변경 시 지도 소유 색을 즉시 재동기화 [461-480] */
function applyColorblindToMap(): void {
    try {
        syncChinaMapCities();
    } catch {
        // 게임 미시작 상태에서는 지도가 비어 있음 — 무시
    }
}

// 저장된 설정 복원 (페이지 로드 시 1회)
applyAccessibility();

// ============================================================
// 外交 패널 [341-360] — 세력 관계도 + 수동 외교 제안
// ============================================================

const diplomacyPanel = document.getElementById('diplomacy-panel')!;
const dpFactionList = document.getElementById('dp-faction-list')!;
const dpTreasury = document.getElementById('dp-treasury')!;

const RELATION_LABEL: Record<string, { label: string; cls: string }> = {
    alliance: { label: '동맹', cls: 'dp-relation-alliance' },
    war: { label: '전쟁', cls: 'dp-relation-war' },
    neutral: { label: '중립', cls: 'dp-relation-neutral' },
    surrendered: { label: '종속', cls: 'dp-relation-surrendered' },
};

/** 외교 패널 렌더링 — 플레이어 관점의 관계도 + 액션 버튼 */
function renderDiplomacyPanel(): void {
    if (!engine) return;
    const store = engine['store'];
    const gs = store.getGlobalState();
    const playerFactionId = gs.playerFactionId;
    const player = playerFactionId ? store.getFaction(playerFactionId) : null;
    if (!player) return;

    dpTreasury.textContent = `國庫 — ${player.gold.toLocaleString()} 金`; 
    const diplo: DiplomacyEngine = engine.diplomacyEngine;
    const others = store.getAllFactions().filter(f => f.id !== playerFactionId);

    dpFactionList.innerHTML = others.map(f => {
        const rel = diplo.getRelation(playerFactionId!, f.id);
        const relInfo = RELATION_LABEL[rel] ?? RELATION_LABEL.neutral;
        const canPeace = rel === FactionRelation.WAR;
        const canAlly = rel === FactionRelation.NEUTRAL;
        const canBreak = rel === FactionRelation.ALLIANCE;
        const canGift = rel !== FactionRelation.WAR;
        const canDeclare = rel !== FactionRelation.WAR;
        return `<div class="dp-faction-row" style="--faction-color:${factionColor(f.color)}">
            <div class="dp-faction-head">
                <span class="dp-faction-name">${f.name}</span>
                <span class="dp-relation-tag ${relInfo.cls}">${relInfo.label}</span>
            </div>
            <div class="dp-actions">
                ${canGift ? `<button class="dp-btn" data-act="gift" data-target="${f.id}">증정 (300金)</button>` : ''}
                ${canAlly ? `<button class="dp-btn" data-act="alliance" data-target="${f.id}">동맹 제안</button>` : ''}
                ${canBreak ? `<button class="dp-btn" data-act="break" data-target="${f.id}">동맹 파기</button>` : ''}
                ${canPeace ? `<button class="dp-btn" data-act="peace" data-target="${f.id}">휴전 제파</button>` : ''}
                ${canDeclare ? `<button class="dp-btn war" data-act="war" data-target="${f.id}">선전포고</button>` : ''}
            </div>
            <div class="dp-result" id="dp-result-${f.id}"></div>
        </div>`;
    }).join('') || '<div class="ss-slot-empty">외교 가능한 타세력이 없습니다.</div>';
}

/** 수동 외교 액션 처리 — 결과를 패널과 로그에 반영 */
function handleDiplomacyAction(action: string, targetFactionId: string): void {
    if (!engine) return;
    const store = engine['store'];
    const gs = store.getGlobalState();
    const playerFactionId = gs.playerFactionId;
    if (!playerFactionId) return;
    const diplo: DiplomacyEngine = engine.diplomacyEngine;
    const target = store.getFaction(targetFactionId);
    if (!target) return;

    let result: { success: boolean; message: string };
    switch (action) {
        case 'gift': {
            const player = store.getFaction(playerFactionId)!;
            if (player.gold < 300) {
                result = { success: false, message: '국고가 부족합니다 (300金 필요).' };
                break;
            }
            result = diplo.sendGift(playerFactionId, targetFactionId, 300, 0);
            if (result.success) {
                store.updateFaction(playerFactionId, { gold: player.gold - 300 });
                store.updateFaction(targetFactionId, { gold: target.gold + 300 });
            }
            break;
        }
        case 'alliance':
            // 평판 보정 [11]: 명성 높은 세력의 제안은 받아들여지기 쉬움
            result = diplo.formAlliance(playerFactionId, targetFactionId, getReputationDiplomacyModifier(store, playerFactionId));
            break;
        case 'break':
            result = diplo.breakAlliance(playerFactionId, targetFactionId);
            break;
        case 'peace':
            result = diplo.makePeace(playerFactionId, targetFactionId, getReputationDiplomacyModifier(store, playerFactionId));
            break;
        case 'war':
            result = diplo.declareWar(playerFactionId, targetFactionId);
            break;
        default:
            return;
    }

    addLog(`${result.success ? '🕊️' : '❌'} [외교] ${target.name}: ${result.message}`);
    renderDiplomacyPanel();
}

btnDiplomacy.addEventListener('click', () => {
    renderDiplomacyPanel();
    diplomacyPanel.style.display = diplomacyPanel.style.display === 'none' || !diplomacyPanel.style.display ? 'block' : 'none';
});
document.getElementById('dp-close')!.addEventListener('click', () => {
    diplomacyPanel.style.display = 'none';
});
dpFactionList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.dp-btn') as HTMLElement | null;
    if (!btn) return;
    handleDiplomacyAction(btn.dataset.act!, btn.dataset.target!);
});

btnSave.addEventListener('click', () => {
    saveToSlot(1);
});

// ============================================================
// 턴 진행 — '다음 月' 버튼 [201]
// ============================================================

let isAdvancingTurn = false;
btnNextMonth.addEventListener('click', async () => {
    if (!engine || isAdvancingTurn || !isRunning) return;
    isAdvancingTurn = true;
    btnNextMonth.disabled = true;
    btnNextMonth.dataset.icon = '⏳';
    btnNextMonth.setAttribute('aria-label', '턴 진행 중');
    try {
        await engine.executeTurn();
        const gs = engine['store'].getGlobalState();
        addLog(`📅 ${gs.time.year}년 ${gs.time.month}월 — 턴 ${gs.turnCount}`);
        // 월말 정산 요약 갱신 [E1-361][461-480]
        updateSettlementPanel();
        // 지도(소속/영토) + 열려 있는 패널 갱신
        syncChinaMapCities();
        if (currentPanelCityId) {
            const store = engine['store'];
            const city = store.getCity(currentPanelCityId);
            if (city) {
                renderCityDetailPanel(city, city.ownerId ? store.getFaction(city.ownerId) : null, false);
            }
        }
        if (diplomacyPanel.style.display === 'block') renderDiplomacyPanel();
        // [2026-10-04] 진행 중인 이동 1일 경과. 도착하면 목적지 도시를 연다.
        //   턴이 한 달(한 기) 진행될 때 1일만 줄어든다는 점이 규칙의 핵심이다 —
        //   가까운 도시는 1~2개월, 먼 곳은 여러 달 걸린다.
        const arrived = advanceActiveTravelOneTurn();
        if (arrived) enterCity(arrived);
    } catch (err) {
        addLog(`턴 진행 실패: ${err}`);
    } finally {
        isAdvancingTurn = false;
        btnNextMonth.disabled = false;
        btnNextMonth.dataset.icon = '⏭';
        btnNextMonth.setAttribute('aria-label', '다음 月');
    }
});

// ============================================================
// Initialize
// ============================================================

function init(): void {
    debugLog('엔진 초기화 중...');
    statusText.textContent = '엔진 초기화 중...';

    resizeCanvas();
    syncSidebarTopOffset();

    // Create engine and bootstrap
    engine = getGameEngine();
    engineRef.current = engine;
    bootstrap = getBootstrap();

    // [309] 모드 창작 마당 — 스토어 주입 + 로드 완료 콜백
    modLoader = new RuntimeModLoader(engine['store']);
    modLoader.onModLoadComplete((result) => {
        if (result.success) {
            addLog(`📦 모드 마운트: ${result.meta.name} v${result.meta.version} — 무장 ${result.stats.officersLoaded} · 세력 ${result.stats.factionsLoaded} · 도시 ${result.stats.citiesLoaded} · 이벤트 ${result.stats.eventsLoaded}`);
            syncChinaMapCities();
        }
    });

    // [303] 다중 탭 뮤텍스 — BroadcastChannel 연결
    mutexCoordinator.init();
    window.addEventListener('beforeunload', () => mutexCoordinator.destroy());

    // [309] 드래그&드롭 모드 마운트 — 화면 전역 드롭 수신
    setupModDragDrop();

    // Create renderers: 헥사(전투용) + 중국 전도(월드용)
    hexRenderer = new HexMapCanvasRenderer(canvas);
    hexTiles = generateDemoHexTiles();
    chinaMap = new ChinaMapRenderer(canvas);

    // Subscribe to engine events
    engine.subscribe('PHASE_CHANGE', (event: any) => {
        debugLog(`페이즈 전환: ${event.payload.from} → ${event.payload.to}`);
    });

    // AI 세력 월간 외교 이벤트 [341-360]
    engine.subscribe('FACTION_DIPLOMACY', (event: any) => {
        addLog(`🕊️ [외교] ${event.payload.factionName}: ${event.payload.message}`);
    });

    // AI 세력 월간 행동 후 자동 저장 (auto 슬롯) [212]
    engine.subscribe('FACTION_AI_ACTION', (event: any) => {
        // AI 행동 로그 표시 [201] — 내정/징병/공성/포로 후처리 메시지를 게임 로그에 반영
        if (event?.payload?.actions) {
            const factionName = event.payload.factionId
                ? engine['store'].getFaction(event.payload.factionId)?.name ?? 'AI'
                : 'AI';
            for (const action of event.payload.actions) {
                addLog(`🤖 [${factionName}] ${action}`);
            }
            for (const outcome of event.payload.captiveOutcomes ?? []) {
                chronicle.add('CAPTURE', outcome.message as string);
            }
        }
        if (!engine) return;
        // [303] 자동 저장도 뮤텍스로 보호 — 경합 시 이번 달은 건너뜀
        if (!mutexCoordinator.acquireLock()) return;
        try {
            mutexCoordinator.ensureLockOrThrow();
            const compressed = engine.saveCompressed();
            const gs = engine['store'].getGlobalState();
            const faction = gs.playerFactionId ? engine['store'].getFaction(gs.playerFactionId) : null;
            slotManager.save('auto', compressed, {
                year: gs.time.year,
                month: gs.time.month,
                turnCount: gs.turnCount,
                factionName: faction?.name ?? '-',
            });
        } catch {
            // 자동 저장 실패는 무음 처리 (게임 진행 방해하지 않음)
        } finally {
            mutexCoordinator.releaseLock();
        }
    });

    engine.subscribe('COMMAND_REPLAY', (event: any) => {
        if (!event?.payload) return;
        replayManager.recordCommandEvent(event.payload as ReplayCommandEvent);
    });

    // AI 스트리밍 BattleCommand 결과 — 전리품과 포로 처분을 즉시 로그/연대기에 반영 [121-130][131-145]
    engine.subscribe('COMMAND_EXECUTED', (event: any) => {
        if (event?.payload?.commandType !== 'BATTLE' || !event.payload.success) return;
        for (const message of event.payload.logMessages ?? []) {
            addLog(message);
        }
        // 연대기 기록은 BattleCommand가 undo 가능한 원자 경계에서 직접 추가한다.
    });

    engine.subscribe('OFFICER_DEATH', (event: any) => {
        addLog(`⚔️ ${event.payload.officerName} 사망 (${event.payload.cause})`);
    });

    // 세력 멸망/배신/엔딩 이벤트 [213][24] — 연대기 기록 포함 [441-460]
    engine.subscribe('FACTION_DESTROYED', (event: any) => {
        addLog(`🔥 세력 멸망: ${event.payload.factionName}`);
        chronicle.add('DESTROYED', `${event.payload.factionName} 세력이 역사에서 사라졌다`);
    });
    engine.subscribe('OFFICER_DEFECTED', (event: any) => {
        addLog(`🚪 배신: ${event.payload.officerName}이(가) 이탈했습니다`);
        chronicle.add('DEFECTION', `${event.payload.officerName}이(가) 주군을 배신했다`);
    });
    engine.subscribe('FACTION_BANKRUPT', (event: any) => {
        addLog(`💸 파산: ${event.payload.factionName} 국고가 ${event.payload.gold.toLocaleString()}로 바닥났다 — 월세 미납이 시작됐다`);
        chronicle.add('HISTORICAL', `${event.payload.factionName}가 월세를 내지 못했다`);
        fireFeedback('VENGEANCE_FAIL');
    });
    engine.subscribe('CITY_STARVATION', (event: any) => {
        addLog(`🍂 굶주림: ${event.payload.cityName}에서 병력 ${event.payload.losses}명이 굶어 죽었다`);
        chronicle.add('HISTORICAL', `${event.payload.cityName}에서 굶주림으로 병력 ${event.payload.losses}이 죽었다`);
        fireFeedback('VENGEANCE_FAIL');
    });
    engine.subscribe('CITY_RIOT', (event: any) => {
        addLog(`🔥 민란: ${event.payload.cityName}에서 반란이 일어나 도시가 이탈했다`);
        chronicle.add('DESTROYED', `${event.payload.cityName}에서 민란이 일어나 도시가 세력에서 이탈했다`);
        fireFeedback('VENGEANCE_FAIL');
    });
    engine.subscribe('BATTLE_START', () => {
        addLog('⚔️ 전투가 개시되었습니다');
    });
    engine.subscribe('HISTORICAL_EVENT', (event: any) => {
        const detail = event.payload.description ?? (event.payload.dialogueLines ?? []).join(' ');
        addLog(`📜 ${event.payload.eventName}${detail ? ` — ${detail}` : ''}`);
        chronicle.add('HISTORICAL', event.payload.eventName);
    });
    engine.subscribe('CAMPAIGN_ORDER_COMPLETED', (event: any) => {
        const city = engine?.['store'].getCity(event.payload.targetCityId);
        addLog(`🚩 원정 완료: ${city?.name ?? event.payload.targetCityId} (병력 ${event.payload.soldiers})`);
        chronicle.add('HISTORICAL', `원정이 끝나 ${city?.name ?? '목표지'}에 도착했다`);
    });
    engine.subscribe('TRANSPORT_COMPLETED', (event: any) => {
        addLog(`📦 수송 완료: 금 ${event.payload.gold} · 식량 ${event.payload.food} · 병력 ${event.payload.soldiers}`);
    });
    engine.subscribe('DOMESTIC_ASSIGNMENT_COMPLETED', (event: any) => {
        const sign = event.payload.increment >= 0 ? '+' : '';
        addLog(`🏛️ 내정 완료: ${event.payload.taskType} (${event.payload.statChanged} ${sign}${event.payload.increment})`);
    });
    engine.subscribe('OFFICER_RETIRED', (event: any) => {
        addLog(`🎋 은퇴: ${event.payload.officerName}이(가) ${event.payload.age}세에 은퇴했습니다`);
        chronicle.add('HISTORICAL', `${event.payload.officerName}이(가) ${event.payload.age}세에 은퇴했다`);
    });
    engine.subscribe('FACTION_VAGRANT', (event: any) => {
        addLog(`🏳️ ${event.payload.factionName}이(가) 재야로 전락했다 (${event.payload.message})`);
        chronicle.add('DESTROYED', `${event.payload.factionName} 세력이 재야로 전락했다`);
    });
    engine.subscribe('INTELLIGENCE_NETWORK_COLLAPSED', (event: any) => {
        const city = engine?.['store'].getCity(event.payload.cityId);
        addLog(`🕸️ 첩보망 붕괴: ${city?.name ?? event.payload.cityId}의 첩보 조직이 무너졌다`);
    });
    // 포로 탈출 이벤트 [131-145]
    engine.subscribe('CAPTIVE_ESCAPED', (event: any) => {
        addLog(`🏃 포로 탈출: ${event.payload.officerName}이(가) 수용소에서 탈출했습니다`);
        chronicle.add('CAPTURE', `${event.payload.officerName}이(가) 수용소에서 탈출했다`);
    });
    // 이벤트 연출 [191-200] — 흔들림 + 사운드
    engine.subscribe('VENGEANCE_EVENT', (event: any) => {
        fireFeedback(event.payload.success ? 'VENGEANCE_SUCCESS' : 'VENGEANCE_FAIL');
    });
    engine.subscribe('SWORN_BROTHER_RESCUED', () => {
        fireFeedback('RESCUE');
    });
    engine.subscribe('FACTION_DESTROYED', () => {
        fireFeedback('FACTION_DESTROYED');
    });
    // 월간 복수 이벤트 [32][33][C-인간관계]
    engine.subscribe('VENGEANCE_EVENT', (event: any) => {
        addLog(`${event.payload.message}`);
        chronicle.add('VENGEANCE', event.payload.message as string);
    });
    // 의형제 구출 이벤트 [C-인간관계]
    engine.subscribe('SWORN_BROTHER_RESCUED', (event: any) => {
        addLog(`🤝 의형제 구출: ${event.payload.rescuerName}이(가) ${event.payload.officerName}을(를) 구했습니다`);
        chronicle.add('RESCUE', `${event.payload.rescuerName}이(가) 의형제 ${event.payload.officerName}을(를) 구출했다`);
    });
    // 의형제 결의 이벤트 [C-인간관계][25]
    engine.subscribe('SWORN_BROTHER_PACT', (event: any) => {
        addLog(`${event.payload.message}`);
        chronicle.add('PACT', event.payload.message as string);
        fireFeedback('RESCUE'); // 결의도 밝은 톤으로 연출
    });
    engine.subscribe('GAME_ROAMING_EVENT', (event: any) => {
        addLog(`${event.payload.message}`);
        chronicle.add('VISIT', event.payload.message as string);
        if (event.payload.type === 'BANDIT') fireFeedback('VENGEANCE_FAIL'); // 산적 약탈 — 경고 톤
        else fireFeedback('RESCUE'); // 현자/상인 방문 — 밝은 톤
    });
    // 재야 무장 출사 타진 이벤트 [24][421-440]
    engine.subscribe('FREE_OFFICER_VISIT', (event: any) => {
        addLog(`${event.payload.message}`);
        chronicle.add('FREE_VISIT', `${event.payload.officerName}이(가) ${event.payload.cityName}을(를) 찾아 출사를 타진했다`);
        fireFeedback('RESCUE');
        // 플레이어 세력 도시 방문 → 선택 모달 (선택지 대기열) [461-480]
        if (event.payload.needsPlayerChoice) {
            pendingVisits.push(event.payload as FreeOfficerVisit);
            if (pendingVisits.length === 1) openVisitModal(pendingVisits[0]);
        }
    });
    engine.subscribe('GAME_ENDING', (event: any) => {
        showEnding(event.payload.ending as string, event.payload.winner as string);
        chronicle.add('ENDING', `${event.payload.winner}이(가) 천하를 통일했다 — ${event.payload.ending}`);
        // 메타 시스템 연동 [213-214] — 엔딩 도달 기록 + 나비 효과 내러티브
        engine.metaManager.triggerEnding(event.payload.ending as string);
        engine.narrativeManager.recordEvent(`엔딩 도달: ${event.payload.ending}`);
    });
    // [213] playerFactionId 정합성 — 플레이어 세력 멸망 시 패배 화면 (세력멸亡 엔딩)
    engine.subscribe('PLAYER_DEFEAT', (event: any) => {
        showEnding('PLAYER_FACTION_DESTROYED', null);
        chronicle.add('DESTROYED', event.payload.message as string);
        engine.narrativeManager.recordEvent(event.payload.message as string);
        addLog(event.payload.message as string);
    });
    // 지옥 난이도 제약 이벤트 [X-난이도]
    engine.subscribe('HELL_CONSTRAINT', (event: any) => {
        addLog(`${event.payload.message}`);
        const kind = event.payload.kind as string;
        if (kind === 'TAX_LEAK') chronicle.add('VISIT', event.payload.message as string);
        else if (kind === 'DESERTION') chronicle.add('DEFECTION', event.payload.message as string);
        else if (kind === 'REVOLT') chronicle.add('DESTROYED', event.payload.message as string);
        fireFeedback('VENGEANCE_FAIL');
    });

    debugLog('엔진 준비 완료 — 게임 시작을 눌러주세요');
    statusText.textContent = '게임 시작 대기 중';

    // Initial render
    renderFrame(0);
}

// ============================================================
// Title Screen — [21] 로비 반응형, [1057] 계절 테마
// ============================================================

/**
 * 엔딩 화면 표시 [213] — 승리(통일) / 패배(세력 멸망 or 타세력 통일)
 */
function showEnding(ending: string, winnerName: string | null): void {
    const screen = document.getElementById('ending-screen')!;
    const title = document.getElementById('ending-title')!;
    const sub = document.getElementById('ending-sub')!;
    const body = document.getElementById('ending-body')!;
    const gs = engine['store'].getGlobalState();
    const playerFaction = gs.playerFactionId ? engine['store'].getFaction(gs.playerFactionId) : null;

    const isVictory = ending === 'PLAYER_UNIFICATION';
    const isPlayerDestroyed = ending === 'PLAYER_FACTION_DESTROYED';
    screen.classList.toggle('victory', isVictory);
    screen.classList.toggle('defeat', !isVictory);
    title.textContent = isVictory ? '天下統一'
        : (ending === 'AI_UNIFICATION' ? '霸業途半' : '勢力減亡');
    sub.textContent = isVictory
        ? `${playerFaction?.name ?? ''} — 천하를 통일했습니다`
        : isPlayerDestroyed
            ? '플레이어 세력은 天下の夢을 이루지 못했습니다'
            : `${winnerName ?? '타세력'}이(가) 천하를 통일했습니다`;
    body.innerHTML = isVictory
        ? `긴 전란이 끝나고 천하에 평화가 찾아왔습니다.<br>${gs.time.year}년 ${playerFaction?.name ?? ''}의 강토에 태평성세가 열립니다.`
        : `전란의 소용돌이 속에 ${playerFaction?.name ?? '세력'}은(는) 역사 속으로 사라졌습니다.<br>다음 판에서는 누가 천하를 얻을까요.`;
    screen.style.display = 'flex';
    addLog(isVictory ? '🏆 천하통일 — 승리!'
        : isPlayerDestroyed ? '💀 플레이어 세력 멸망 — 게임 오버' : '💀 게임 오버');
}

// 엔딩 → 타이틀 복귀
document.getElementById('btn-ending-title')!.addEventListener('click', () => {
    document.getElementById('ending-screen')!.style.display = 'none';
    isRunning = false;
    location.reload();
});

/**
 * 월간 보고서 패널 표시 [E1-361]
 */
function showMonthlyReport(): void {
    if (!engine || !isRunning) return;
    // 포팅 시스템 월간 동향 peek (읽기 전용 — 다음 달 보고서를 위해 버퍼 유지) [76-85][321-340][341-360][421-438]
    const store = engine['store'];
    const report = new MonthlyReportSystem(store, () => ({
        ...engine.peekMonthlyPortedLog(false),
        climates: engine.climateManager.getAllClimates().map(c => ({
            regionId: c.regionId,
            weather: c.weather,
            temperature: c.temperature,
            harvestModifier: c.harvestModifier,
        })),
        // 도시별 기후 표 [321-340] — 도시 위치를 기후권에 매핑해 소유 세력과 함께 표시
        cityClimates: store.getAllCities().map(c => {
            const regionId = resolveCityClimateRegion(c.name, c.mapX, c.mapY);
            const climate = engine.climateManager.getClimate(regionId);
            return {
                cityName: c.name,
                regionId,
                weather: climate?.weather ?? 'SUNNY',
                temperature: climate?.temperature ?? 18,
                harvestModifier: climate?.harvestModifier ?? 1.0,
                ownerId: c.ownerId,
            };
        }),
    })).generate();
    const panel = document.getElementById('monthly-report-panel')!;
    document.getElementById('mr-title')!.textContent = `月報 — ${report.year}년 ${report.month}월 보고`;
    document.getElementById('mr-finance')!.innerHTML = `
        <div class="mr-fin-item"><div class="mr-fin-value">${report.playerGold.toLocaleString()}</div><div class="mr-fin-label">국고</div></div>
        <div class="mr-fin-item"><div class="mr-fin-value">+${report.goldIncome}</div><div class="mr-fin-label">월 골드 수입</div></div>
        <div class="mr-fin-item"><div class="mr-fin-value">${report.playerFood.toLocaleString()}</div><div class="mr-fin-label">군량</div></div>
        <div class="mr-fin-item"><div class="mr-fin-value">+${report.foodIncome}</div><div class="mr-fin-label">월 군량 수입</div></div>`;
    document.getElementById('mr-cities')!.innerHTML = report.cities.map(c =>
        `<div class="mr-row"><span class="mr-name">${c.name}</span><span class="mr-val">자금 ${c.funds} · 병력 ${c.development} · 상${c.commerce}/농${c.farming}</span></div>`).join('')
        || '<div class="mr-row">소속 도시 없음</div>';
    document.getElementById('mr-factions')!.innerHTML = report.factions.map(f =>
        `<div class="mr-row"><span class="mr-name">${f.name}</span><span class="mr-val">골드 ${f.gold} · 도시 ${f.cities} · 무장 ${f.officers}</span></div>`).join('')
        || '<div class="mr-row">생존 타세력 없음</div>';
    renderMonthlyPortedSection(report.ported ?? null);
    panel.style.display = 'block';
}

/** 월간 동향 섹션 렌더 — 출진/수송/첩보망/기후/은퇴 [76-85][321-340][341-360][421-438] */
function renderMonthlyPortedSection(ported: import('./core/monthly_report.js').PortedMonthlySection | null): void {
    const el = document.getElementById('mr-ported');
    if (!el) return;
    if (!ported) {
        el.innerHTML = '<div class="mr-row">동향 데이터 없음</div>';
        return;
    }
    const rows: string[] = [];
    for (const c of ported.campaigns) {
        rows.push(`<div class="mr-row"><span class="mr-name">⚔️ 출진 완료</span><span class="mr-val">${c.leaderName} 군단 → ${c.targetCity} (병력 ${c.soldiers.toLocaleString()})</span></div>`);
    }
    for (const t of ported.transports) {
        rows.push(`<div class="mr-row"><span class="mr-name">📦 수송 완료</span><span class="mr-val">${t.fromCity} → ${t.toCity} (금 ${t.gold} · 군량 ${t.food} · 병력 ${t.soldiers})</span></div>`);
    }
    for (const n of ported.collapsedNetworks) {
        rows.push(`<div class="mr-row"><span class="mr-name">🕸️ 첩보망 붕괴</span><span class="mr-val">${n.cityId} — 유지비 미납 (${n.factionId})</span></div>`);
    }
    // 방랑군 동향 [83] — 전환/등용/습격/재기
    for (const v of ported.vagrant ?? []) {
        const icon = v.kind === 'CONVERT' ? '🏚️' : v.kind === 'RAID' ? '⚔️' : '🤝';
        const label = v.kind === 'CONVERT' ? '방랑군 몰락' : v.kind === 'RAID' ? (v.success ? '습격 점령' : '습격 격퇴') : (v.success ? '재야 영입' : '영입 실패');
        rows.push(`<div class="mr-row"><span class="mr-name">${icon} ${label}</span><span class="mr-val" style="${v.success ? '' : 'opacity:.7'}">${v.message.replace(/^\\[.*?\\]\\s*/, '')}</span></div>`);
    }
    const weatherIcon = (w: string): string =>
        ({ SUNNY: '☀️', CLOUDY: '☁️', RAIN: '🌧️', STORM: '⛈️', SNOW: '❄️', FOG: '🌫️', HEATWAVE: '🔥' } as Record<string, string>)[w] ?? '🌤️';
    if (ported.climates.length > 0) {
        rows.push(`<div class="mr-row"><span class="mr-name">${weatherIcon(ported.climates[0].weather)} 기후</span><span class="mr-val">${ported.climates.map(c => `${c.regionId} ${c.weather} ${c.temperature}°C (수확 ×${c.harvestModifier})`).join(' · ')}</span></div>`);
    }
    // 도시별 기후·수확 보정 표 [321-340]
    if (ported.cityClimates && ported.cityClimates.length > 0) {
        const rowsHtml = ported.cityClimates.map(cc => {
            const icon = weatherIcon(cc.weather);
            const modPct = Math.round(cc.harvestModifier * 100);
            const modColor = cc.harvestModifier >= 1.0 ? '#7ec97e' : (cc.harvestModifier >= 0.8 ? '#e0c26a' : '#e07a6a');
            const ownerTag = cc.ownerId ? `<span style="opacity:.6">(${cc.ownerId})</span>` : '<span style="opacity:.4">(무주)</span>';
            return `<tr>` +
                `<td style="padding:2px 8px">${icon} ${cc.cityName}</td>` +
                `<td style="padding:2px 8px;opacity:.65">${cc.regionId}</td>` +
                `<td style="padding:2px 8px">${cc.temperature}°C</td>` +
                `<td style="padding:2px 8px;color:${modColor};font-weight:700">×${cc.harvestModifier} (${modPct}%)</td>` +
                `<td style="padding:2px 8px">${ownerTag}</td></tr>`;
        }).join('');
        rows.push(`<div class="mr-row"><table style="width:100%;border-collapse:collapse;font-size:.72rem">` +
            `<tr style="opacity:.55"><th style="text-align:left;padding:2px 8px">도시</th><th style="text-align:left;padding:2px 8px">기후권</th>` +
            `<th style="text-align:left;padding:2px 8px">기온</th><th style="text-align:left;padding:2px 8px">수확 보정</th><th style="text-align:left;padding:2px 8px">소유</th></tr>` +
            rowsHtml + `</table></div>`);
    }
    for (const r of ported.retired) {
        rows.push(`<div class="mr-row"><span class="mr-name">🌾 은퇴</span><span class="mr-val">${r.officerName} (${r.age}세) — 전장을 떠났습니다</span></div>`);
    }
    for (const c of ported.captives ?? []) {
        const label = c.decision === 'RECRUIT' ? '등용' : c.decision === 'EXECUTE' ? '처형' : '석방';
        const icon = c.decision === 'RECRUIT' ? '🤝' : c.decision === 'EXECUTE' ? '⚔️' : '🕊️';
        rows.push(`<div class="mr-row"><span class="mr-name">${icon} 포로 ${label}</span><span class="mr-val">${c.message}</span></div>`);
    }
    el.innerHTML = rows.join('') || '<div class="mr-row">이번 달 주요 동향 없음</div>';
}
document.getElementById('mr-close')!.addEventListener('click', () => {
    document.getElementById('monthly-report-panel')!.style.display = 'none';
});

function monthToSeason(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
    if (month <= 2 || month === 12) return 'winter';
    if (month <= 5) return 'spring';
    if (month <= 8) return 'summer';
    return 'autumn';
}

// Load save if exists — 슬롯 매니저 기반 (구버전 단일 키 폴백 포함) [17]
const titleSlotManager = new SaveSlotManager();
const hasAnySave = titleSlotManager.hasAnySave();
if (hasAnySave) {
    addLog('이전 저장 데이터 발견');
}

const titleScreen = new TitleScreen({
    onNewGame: () => { openScenarioScreen(); },
    onRecruit: () => { void openEditorScreen(); },
    onContinue: () => {
        try {
            // 최근 저장 슬롯(auto 폴백 포함)을 찾아 복원
            const metas = titleSlotManager.getAllMetas();
            const latest = metas.sort((a, b) => b.savedAt - a.savedAt)[0];
            const data = latest ? titleSlotManager.load(latest.slot) : titleSlotManager.load('auto');
            if (!data) return;
            const ok = engine.loadCompressed(data);
            if (!ok) {
                addLog('불러오기 실패: 세이브 데이터가 손상되었습니다. 새로운 시작을 이용하세요.');
                statusText.textContent = '불러오기 실패';
                return;
            }
            addLog(latest ? `슬롯 ${latest.slot === 'auto' ? '자동' : latest.slot}에서 불러오기 완료` : '세이브 불러오기 완료');
            // [49] 타이틀의 '이어하기' 경로도 방문 도시 기록을 복원한다.
            restoreVisitedCitiesFromGlobalState();
            void startGame(null);
        } catch (err) {
            addLog(`불러오기 실패: ${err}`);
        }
    },
});
titleScreen.setHasSave(hasAnySave);
titleScreen.show();

// 시나리오를 미리 적재한다. '신규 장수 생성'은 시나리오 화면을 거치지 않고
// 곧바로 월드를 만들므로, 타이틀에서 첫 클릭이 빈 배열을 받으면 죽는다.
// 실패해도 타이틀은 살아 있어야 하므로 여기서는 조용히 넘어간다.
void loadScenarios().catch(() => {
    addLog('시나리오 데이터 미리 읽기 실패 — 시작하기 진입 시 다시 시도합니다.');
});
// ============================================================
// 무장 편집 + 시나리오 선택 [신규 기능]
// ============================================================
// 흐름: 타이틀 → 무장편집(신규/기존) → 시나리오 선택 → 세력 선택 → 시작
// 판정/검색/랜덤은 전부 src/core 의 순수 모듈에 있다. 여기서는 DOM 만 다룬다.
const editorScreen = document.getElementById('editor-screen')!;
const edName = document.getElementById('ed-name') as HTMLInputElement;
const edCourtesy = document.getElementById('ed-courtesy') as HTMLInputElement;
const edGender = document.getElementById('ed-gender') as HTMLSelectElement;
const edBirth = document.getElementById('ed-birth') as HTMLInputElement;
const edDeath = document.getElementById('ed-death') as HTMLInputElement;
const edGrade = document.getElementById('ed-grade') as HTMLInputElement;
const edRank = document.getElementById('ed-rank') as HTMLInputElement;
const edSpecialty = document.getElementById('ed-specialty') as HTMLInputElement;
const edStatsBox = document.getElementById('ed-stats')!;
const edSearch = document.getElementById('ed-search') as HTMLInputElement;
const edFilterGender = document.getElementById('ed-filter-gender') as HTMLSelectElement;
const edFilterBirth = document.getElementById('ed-filter-birth') as HTMLSelectElement;
const edRoster = document.getElementById('ed-roster')!;
const edRosterCount = document.getElementById('ed-roster-count')!;
const edWarn = document.createElement('p');
edWarn.className = 'editor-warn';
edWarn.style.display = 'none';
edStatsBox.parentElement?.insertBefore(edWarn, edStatsBox.nextSibling);
const pickScreen = document.getElementById('pick-scenario-screen')!;
const pickList = document.getElementById('pick-scenario-list')!;
const pickSub = document.getElementById('pick-scenario-sub')!;

/** 무장편집에서 고른 무장. 확정되면 이 값이 시나리오 화면까지 살아 있다. */
let editorChoice: { kind: 'new'; name: string } | { kind: 'existing'; id: string } | null = null;
/** 기존 무장 탭에서 현재 고른 프로필 */
let editorSelectedProfile: EditableOfficer | null = null;
// 실제무장편집을 기본 탭으로 둔다 (요청한 San7 용어 순서).
let editorMode: 'new' | 'existing' = 'existing';

const EDITOR_STATS = [
    { key: 'leadership', label: '통솔' },
    { key: 'might', label: '무력' },
    { key: 'intelligence', label: '지력' },
    { key: 'politics', label: '정치' },
    { key: 'charisma', label: '매력' },
] as const;

/** 능력치 슬라이더 — DOM 은 한 번만 만든다. */
const editorStatInputs = {} as Record<string, HTMLInputElement>;
for (const s of EDITOR_STATS) {
    const wrap = document.createElement('div');
    wrap.className = 'editor-stat';
    const head = document.createElement('div');
    head.className = 'editor-stat-head';
    const label = document.createElement('span');
    label.textContent = s.label;
    const value = document.createElement('span');
    value.textContent = '50';
    head.append(label, value);
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '1';
    range.max = '100';
    range.value = '50';
    range.setAttribute('aria-label', `${s.label} 능력치`);
    range.addEventListener('input', () => { value.textContent = range.value; });
    wrap.append(head, range);
    edStatsBox.append(wrap);
    editorStatInputs[s.key] = range;
}

function setEditorWarn(message: string): void {
    edWarn.textContent = message;
    edWarn.style.display = message === '' ? 'none' : 'block';
}

// ============================================================
// San7 스타일 편집 화면 렌더 [신규 기능]
// ============================================================
// 값이 바뀔 때만 다시 그린다. 슬라이더를 조작할 때마다 DOM 을 통째로
// 바꾸면 노드가 새로 생겨 포커스가 튄다.
const edPortrait = document.getElementById('ed-portrait')!;
const edPortraitCaption = document.getElementById('ed-portrait-caption')!;
const edRadarBox = document.getElementById('ed-radar')!;
const edAgeFill = document.getElementById('ed-age-fill')!;
const edAgeText = document.getElementById('ed-age-text')!;
const edLevel = document.getElementById('ed-level')!;
const edTraits = document.getElementById('ed-traits')!;
const edExistingPortrait = document.getElementById('ed-existing-portrait')!;
const edExistingCaption = document.getElementById('ed-existing-caption')!;
const edExistingRadar = document.getElementById('ed-existing-radar')!;
const edExistingAgeFill = document.getElementById('ed-existing-age-fill')!;
const edExistingAgeText = document.getElementById('ed-existing-age-text')!;
const edExistingLevel = document.getElementById('ed-existing-level')!;
const edExistingTraits = document.getElementById('ed-existing-traits')!;
const edExistingClassify = document.getElementById('ed-existing-classify')!;
const edExistingStatsBox = document.getElementById('ed-existing-stats')!;
const edExistingName = document.getElementById('ed-existing-name') as HTMLInputElement;
const edExistingRank = document.getElementById('ed-existing-rank') as HTMLInputElement;
const edExistingSpecialty = document.getElementById('ed-existing-specialty') as HTMLInputElement;

/** 실제무장편집 탭의 능력치 슬라이더 — 신규 탭 것과 별개다 (값이 서로 덮어쓰이면 안 된다). */
const edExistingStatInputs = {} as Record<string, HTMLInputElement>;
for (const s of EDITOR_STATS) {
    const wrap = document.createElement('div');
    wrap.className = 'editor-stat';
    const head = document.createElement('div');
    head.className = 'editor-stat-head';
    const label = document.createElement('span');
    label.textContent = s.label;
    const value = document.createElement('span');
    value.textContent = '50';
    head.append(label, value);
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '1';
    range.max = '100';
    range.value = '50';
    range.setAttribute('aria-label', `${s.label} 능력치 (실제무장편집)`);
    range.addEventListener('input', () => { value.textContent = range.value; });
    wrap.append(head, range);
    edExistingStatsBox.append(wrap);
    edExistingStatInputs[s.key] = range;
}

/** 실제무장편집 슬라이더 5개를 읽는다. */
function readExistingStatsFromSliders(): typeof EMPTY_STATS {
    return {
        leadership: Number.parseInt(edExistingStatInputs.leadership.value, 10) || 0,
        might: Number.parseInt(edExistingStatInputs.might.value, 10) || 0,
        intelligence: Number.parseInt(edExistingStatInputs.intelligence.value, 10) || 0,
        politics: Number.parseInt(edExistingStatInputs.politics.value, 10) || 0,
        charisma: Number.parseInt(edExistingStatInputs.charisma.value, 10) || 0,
    };
}


const EMPTY_STATS = { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 };

/** 기준 연도 — 연령 바 계산용. 시나리오가 없으면 200년으로 둔다. */
function editorReferenceYear(): number {
    const list = getCachedScenarios();
    if (list.length > 0) return Number.parseInt(list[0].start_date.slice(0, 4), 10) || 200;
    return 200;
}

/** 만 나이. 생년이 없으면 null — 가짜 나이를 만들지 않는다. */
function ageOf(birthYear: number | null, referenceYear: number): number | null {
    if (birthYear === null || !Number.isFinite(birthYear)) return null;
    return referenceYear - birthYear;
}

/** 연령 바 — 0~100세를 0~100%로 매핑. 60세 이상은 색을 바꾼다. */
function paintAge(fill: HTMLElement, text: HTMLElement, birthYear: number | null, refYear: number): void {
    const age = ageOf(birthYear, refYear);
    if (age === null) {
        fill.style.width = '0%';
        text.textContent = '미상';
        return;
    }
    fill.style.width = `${Math.max(0, Math.min(100, age))}%`;
    fill.style.background = age >= 60
        ? 'linear-gradient(90deg, #8a5a4a, #c05a3a)'
        : 'linear-gradient(90deg, #6a8fb5, #d4af6a)';
    text.textContent = `만 ${age}세 · ${refYear - age}년생`;
}

function paintTraits(box: HTMLElement, traits: string[]): void {
    box.innerHTML = '';
    if (traits.length === 0) {
        const none = document.createElement('span');
        none.className = 'moe-trait none';
        none.textContent = '없음';
        box.append(none);
        return;
    }
    for (const t of traits.slice(0, 12)) {
        const chip = document.createElement('span');
        chip.className = 'moe-trait';
        chip.textContent = t;
        box.append(chip);
    }
}

/** 능력치 슬라이더 5개를 읽는다. */
function readStatsFromSliders(): typeof EMPTY_STATS {
    return {
        leadership: Number.parseInt(editorStatInputs.leadership.value, 10) || 0,
        might: Number.parseInt(editorStatInputs.might.value, 10) || 0,
        intelligence: Number.parseInt(editorStatInputs.intelligence.value, 10) || 0,
        politics: Number.parseInt(editorStatInputs.politics.value, 10) || 0,
        charisma: Number.parseInt(editorStatInputs.charisma.value, 10) || 0,
    };
}

/**
 * 능력치에서 특성 라벨을 뽑는다.
 * 실제 판정 규칙이 아니라 '편집 화면에 무엇을 보여줄지' 를 고르는 표시용 규칙.
 */
function deriveTraitsFromStats(stats: typeof EMPTY_STATS, grade: number): string[] {
    const pairs: [string, number][] = [
        ['단려', stats.leadership], ['강저', stats.might], ['지략', stats.intelligence],
        ['교화', stats.politics], ['안목', stats.charisma],
    ];
    // 높은 능력치부터 태그로. 상위 3개까지만 (San7 도 3개 내외).
    pairs.sort((a, b) => b[1] - a[1]);
    const out: string[] = [];
    for (const [label, value] of pairs) {
        if (value >= 70) out.push(label);
        if (out.length >= 3) break;
    }
    if (out.length < 3) out.push(grade >= 8 ? '명장' : grade >= 5 ? '장수' : '신규');
    return out;
}

/** 신규무장편집 패널을 현재 폼 값으로 갱신한다. */
function paintNewOfficerPanels(): void {
    const birth = edBirth.value.trim() === '' ? null : Number.parseInt(edBirth.value, 10);
    const grade = edGrade.value === '' ? 3 : Number.parseInt(edGrade.value, 10);
    const refYear = editorReferenceYear();
    const stats = readStatsFromSliders();
    const name = edName.value.trim() || '미지명';
    const courtesy = edCourtesy.value.trim();

    edPortrait.innerHTML = renderPortraitSvg({
        id: 'off_custom_player', name, gender: edGender.value === 'F' ? 'F' : 'M', grade,
    });
    edPortraitCaption.textContent = courtesy ? `${name} (字 ${courtesy})` : name;
    edRadarBox.innerHTML = renderRadarSvg({ stats });
    paintAge(edAgeFill, edAgeText, birth, refYear);
    edLevel.textContent = String(Math.max(1, Math.min(10, grade)));
    paintTraits(edTraits, deriveTraitsFromStats(stats, grade));
}

/** 실제무장편집 패널을 고른 프로필로 갱신한다. */
function paintExistingPanels(): void {
    const p = editorSelectedProfile;
    if (!p) {
        edExistingCaption.textContent = '무장을 선택하세요';
        edExistingLevel.textContent = '1';
        edExistingClassify.textContent = '—';
        paintAge(edExistingAgeFill, edExistingAgeText, null, editorReferenceYear());
        paintTraits(edExistingTraits, []);
        edExistingRadar.innerHTML = renderRadarSvg({ stats: EMPTY_STATS });
        // 편집 필드는 고른 무장이 없으니 잠근다.
        for (const el of [edExistingName, edExistingRank, edExistingSpecialty]) el.disabled = true;
        return;
    }
    const profile = getOfficerProfile(p.id);
    const stats = profile?.stats ?? EMPTY_STATS;
    edExistingPortrait.innerHTML = renderPortraitSvg({
        id: p.id, name: p.name, gender: p.gender, grade: p.grade ?? 3,
    });
    const bio = profile?.bio ? String(profile.bio).trim() : '';
    edExistingCaption.textContent = bio ? `${p.name} — ${bio.slice(0, 40)}` : p.name;
    edExistingRadar.innerHTML = renderRadarSvg({ stats });
    paintAge(edExistingAgeFill, edExistingAgeText, p.birthYear, editorReferenceYear());
    edExistingLevel.textContent = String(Math.max(1, Math.min(10, p.grade ?? 1)));
    paintTraits(edExistingTraits, p.traits);
    const parts = [p.gender === 'F' ? '녀' : '남'];
    if (p.grade !== null) parts.push(`${p.grade}급`);
    if (profile?.affiliationLabel) parts.push(profile.affiliationLabel);
    edExistingClassify.textContent = parts.join(' · ');

    // 편집 필드에 프로필 값을 싣는다. 슬라이더는 별도 세트라 안 겹친다.
    for (const s of EDITOR_STATS) {
        const input = edExistingStatInputs[s.key];
        const v = stats[s.key] ?? 50;
        input.value = String(Math.max(1, Math.min(100, Math.round(v))));
        input.dispatchEvent(new Event('input'));
    }
    edExistingName.value = p.name;
    edExistingRank.value = String(p.grade ?? 5);
    edExistingSpecialty.value = profile?.policyLabel ? String(profile.policyLabel) : '';
    for (const el of [edExistingName, edExistingRank, edExistingSpecialty]) el.disabled = false;
}



/** 현재 폼 값을 EditableOfficer 로 읽는다. 신규 무장 경로 전용. */
function readNewOfficer(): EditableOfficer {
    const birthRaw = edBirth.value.trim();
    const deathRaw = edDeath.value.trim();
    return {
        id: 'off_custom_player',
        name: edName.value,
        gender: edGender.value === 'F' ? 'F' : 'M',
        birthYear: birthRaw === '' ? null : Number.parseInt(birthRaw, 10),
        deathYear: deathRaw === '' ? null : Number.parseInt(deathRaw, 10),
        grade: edGrade.value.trim() === '' ? null : Number.parseInt(edGrade.value, 10),
        traits: [],
    };
}

/** 검색 결과 렌더. 상위 N 건만 그린다. */
function renderRoster(): void {
    const decade = edFilterBirth.value === '' ? null : Number.parseInt(edFilterBirth.value, 10);
    const query = {
        text: edSearch.value,
        gender: edFilterGender.value === '' ? null : (edFilterGender.value as 'M' | 'F'),
        birthMin: decade, birthMax: decade === null ? null : decade + 9,
    };
    const results = searchRoster({
        ...query,
        // 맨 앞 카드가 반드시 탈 수 있어야 한다. 연생/역연 정렬은 어느 쪽도 이를 못 보장한다.
        sort: 'playable',
        playableYears: getCachedScenarios().map(s => Number.parseInt(s.start_date.slice(0, 4), 10)),
    });
    const total = countRoster(query);
    edRosterCount.textContent = total === 0
        ? '조건에 맞는 무장이 없습니다.'
        : `${total}명 중 ${results.length}명 표시`;

    edRoster.innerHTML = '';
    if (results.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'roster-empty';
        empty.textContent = '검색 결과가 없습니다. 이름을 지우거나 필터를 완화해 보세요.';
        edRoster.append(empty);
        return;
    }
    for (const p of results) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'roster-card';
        card.dataset.id = p.id;
        if (editorSelectedProfile?.id === p.id) card.classList.add('selected');
        const name = document.createElement('span');
        name.className = 'roster-name';
        name.textContent = p.name;
        const meta = document.createElement('span');
        meta.className = 'roster-meta';
        // 미상은 '미상' 으로 적는다. 숫자로 지어내지 않는다.
        const by = p.birthYear === null ? '미상' : `${p.birthYear}년생`;
        const dy = p.deathYear === null ? '' : ` · ${p.deathYear}년 사망`;
        meta.textContent = `${by} · ${p.gender === 'F' ? '녀' : '남'}${dy}`;
        card.append(name, meta);
        edRoster.append(card);
    }
}

function switchEditorMode(mode: 'new' | 'existing'): void {
    editorMode = mode;
    document.getElementById('tab-editor-new')!.classList.toggle('active', mode === 'new');
    document.getElementById('tab-editor-existing')!.classList.toggle('active', mode === 'existing');
    document.getElementById('tab-editor-new')!.setAttribute('aria-selected', String(mode === 'new'));
    document.getElementById('tab-editor-existing')!.setAttribute('aria-selected', String(mode === 'existing'));
    document.getElementById('editor-new-panel')!.style.display = mode === 'new' ? 'block' : 'none';
    document.getElementById('editor-existing-panel')!.style.display = mode === 'existing' ? 'block' : 'none';
    if (mode === 'existing') renderRoster();
    paintEditorPanels();
}

/** 현재 탭에 맞는 패널만 갱신한다. */
function paintEditorPanels(): void {
    if (editorMode === 'new') paintNewOfficerPanels();
    else paintExistingPanels();
}

/**
 * 무장 편집 화면을 연다.
 *
 * [결함 수정] 시나리오를 먼저 로드한 뒤 연다.
 * renderRoster() → renderPickScenarios() → openPickScenarioScreen() 경로가
 * getCachedScenarios() 만 믿고 있다. 페이지가 새로고침된 직후(캐시 없음)에
 * 이 경로로 들어오면 시나리오 0건으로 평가되어 카드 자체가 그려지지 않는다.
 * 같은 버그가 openScenarioScreen(일반 시작)·openPickScenarioScreen(편집 확정)
 * 두 곳에 따로 있었고, 여기서는 편집 화면 진입 지점이다.
 *
 * 주의: searchRoster 의 playableYears 가 비면 정렬 점수만 낮아질 뿐 카드는
 * 그려진다. 카드 목록(searchRoster)과 시나리오 목록(renderPickScenarios)은
 * 서로 다른 목록이라, 어느 쪽이 빈 배열을 만들지는 경로를 따라가 봐야 한다.
 * 여기서는 "캐시 없는 상태로 진입하면 안 된다" 만 보장한다.
 */
async function openEditorScreen(): Promise<void> {
    setEditorWarn('');
    try {
        await loadScenarios();
    } catch (err) {
        addLog(`시나리오 로드 실패: ${err}`);
    }
    editorScreen.classList.add('open');
    editorScreen.focus();
    if (edName.value.trim() === '') {
        // 첫 진입 초안 — 이름은 비워 두고 능력치만 채운다.
        // 곧장 '시나리오로 이동' 을 눌러도 성명 경고로 막히게 된다.
        const stats = rollCustomStats(hashSeed('editor-draft'));
        for (const s of EDITOR_STATS) {
            const input = editorStatInputs[s.key];
            input.value = String(stats[s.key]);
            input.dispatchEvent(new Event('input'));
        }
        // 기준 연도(184)에 장수로 성립하도록 기본 생년을 둔다.
        // 180으로 두면 만 4세로 나와 부자연스럽다.
        if (edBirth.value.trim() === '') edBirth.value = '160';
    }
    switchEditorMode(editorMode);
}

function closeEditorScreen(): void {
    editorScreen.classList.remove('open');
    pickScreen.style.display = 'none';
    titleScreen.show();
}

/** 확정한 무장으로 플레이 가능한 시나리오를 그린다. */
function renderPickScenarios(): void {
    const officer = editorChoice?.kind === 'existing'
        ? editorSelectedProfile
        : readNewOfficer();
    if (!officer) return;

    const scenarios = getCachedScenarios();
    const all = evaluateScenarios(scenarios, officer);
    const ok = playableScenarios(all);
    const blocked = all.length - ok.length;

    pickSub.textContent = `${officer.name} · ${officer.birthYear === null ? '출생 연도 미상' : `${officer.birthYear}년생`} — 플레이 가능한 시나리오 ${ok.length}건${blocked > 0 ? ` (제외 ${blocked}건)` : ''}`;

    pickList.innerHTML = '';
    if (all.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'roster-empty';
        empty.textContent = '시나리오 데이터를 불러오지 못했습니다.';
        pickList.append(empty);
        return;
    }

    // 탈락 항목도 '왜 안 되는지' 보이게 아래에 붙인다. 숨기면 이유를 알 수 없다.
    for (const item of all) {
        const card = document.createElement('button');
        const playable = item.playability.ok;
        card.type = 'button';
        card.className = playable ? 'scenario-card pick-card' : 'scenario-card pick-card blocked';
        card.dataset.id = item.scenario.id;
        if (!playable) card.disabled = true;

        const stars = '★'.repeat(item.scenario.difficulty)
            + `<span class="off">${'★'.repeat(Math.max(0, 5 - item.scenario.difficulty))}</span>`;
        card.innerHTML = `
            <span class="scenario-num">${item.scenario.id}</span>
            <span class="scenario-body">
                <span class="scenario-name">${item.scenario.title_kr}</span>
                <span class="scenario-date">${item.startYear}년 ${item.startMonth}월 — ${item.scenario.title_en}</span>
                <span class="scenario-desc">${item.scenario.description}</span>
            </span>
            <span class="scenario-side">
                <span class="difficulty">${stars}</span>
                <span class="faction-count">세력 ${item.factionCount}</span>
            </span>`;

        const note = document.createElement('span');
        if (playable) {
            note.className = 'pick-note';
            note.textContent = item.playability.note;
        } else {
            note.className = 'pick-reason';
            note.textContent = `플레이 불가 — ${item.playability.reason}`;
        }
        card.append(note);
        pickList.append(card);
    }
}

/**
 * 확정한 무장으로 시나리오 선택 화면을 연다.
 *
 * [결함 수정] loadScenarios() 를 await 한다.
 * 예전엔 renderPickScenarios() 만 동기 호출했는데, 그 안의
 * getCachedScenarios() 는 "이미 로드된 것"만 돌려준다. 페이지가 새로고침된
 * 직후(캐시 없음) 편집 화면에서 이 경로로 들어오면 시나리오가 0건이라
 * 카드가 하나도 그려지지 않았다. E2E 의 "실제무장편집 경로에서 시나리오가
 * 뜨지 않는다" 가 정확히 이 증상이다.
 *
 * openScenarioScreen(일반 시작 흐름)에서 고친 것과 같은 결함이다. 같은
 * 버그가 두 곳에 따로 있던 셈이라 여기서도 고친다 — 한 곳만 고치고
 * 넘어가면 다른 경로에서 그대로 남는다.
 */
async function openPickScenarioScreen(): Promise<void> {
    editorScreen.classList.remove('open');
    try {
        await loadScenarios();
    } catch (err) {
        addLog(`시나리오 로드 실패: ${err}`);
    }
    renderPickScenarios();
    pickScreen.style.display = 'flex';
}

/** 신규 무장 확정 — 유효성만 확인하고 시나리오 화면으로 넘긴다. */
function applyNewOfficer(): void {
    const name = edName.value;
    if (name.trim() === '') {
        setEditorWarn('성명을 입력하거나 [랜덤] 을 눌러 주세요.');
        edName.focus();
        return;
    }
    if (name.length > 8) {
        setEditorWarn('성명은 8자 이내여야 합니다.');
        edName.focus();
        return;
    }
    const birth = edBirth.value.trim();
    if (birth !== '' && !Number.isFinite(Number.parseInt(birth, 10))) {
        setEditorWarn('출생 연도를 숫자로 입력해 주세요.');
        edBirth.focus();
        return;
    }
    setEditorWarn('');
    editorChoice = { kind: 'new', name: name.trim() };
    // async — 시나리오를 먼저 로드한다. E2E 는 500ms 만 기다리므로
    // 로드보다 늦게 뜨면 안 된다(아래에서 로딩 표시로 덮인다).
    void openPickScenarioScreen();
}

/** 기존 무장 확정 — 고른 프로필이 있어야 한다. */
function applyExistingOfficer(): void {
    if (!editorSelectedProfile) {
        setEditorWarn('목록에서 무장을 먼저 선택해 주세요.');
        switchEditorMode('existing');
        return;
    }
    setEditorWarn('');
    editorChoice = { kind: 'existing', id: editorSelectedProfile.id };
    void openPickScenarioScreen();
}

// ---------------------------------------------------------- 무장편집 이벤트
document.getElementById('btn-editor-back')!.addEventListener('click', closeEditorScreen);
document.getElementById('tab-editor-new')!.addEventListener('click', () => switchEditorMode('new'));
document.getElementById('tab-editor-existing')!.addEventListener('click', () => switchEditorMode('existing'));
document.getElementById('btn-ed-apply')!.addEventListener('click', applyNewOfficer);
document.getElementById('btn-ed-apply-existing')!.addEventListener('click', applyExistingOfficer);
document.getElementById('btn-pick-scenario-back')!.addEventListener('click', () => {
    pickScreen.style.display = 'none';
    editorScreen.classList.add('open');
    switchEditorMode(editorMode);
});

// 필드별 랜덤 — data-rand 로 대상 필드를 구분한다.
// 이 프로젝트는 tsconfig 에 DOM.Iterable 이 없어 NodeList 를 직접 순회할 수 없다.
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-new-panel [data-rand]'))) {
    btn.addEventListener('click', () => {
        const field = btn.dataset.rand as EditorField;
        const seedText = `${edName.value}|${edBirth.value}|${field}`;
        const birth = Number.parseInt(edBirth.value, 10);
        const value = randomField(field, seedText, Number.isFinite(birth) ? birth : 180);
        // 출생 연도는 랜덤이 먼저다 — 뒤 필드가 여기 의존한다.
        if (field === 'birth') {
            edBirth.value = value;
            edBirth.dispatchEvent(new Event('input'));
            return;
        }
        switch (field) {
            case 'name': edName.value = value; break;
            case 'courtesy': edCourtesy.value = value; break;
            case 'gender': edGender.value = value; break;
            case 'death': edDeath.value = value; break;
            case 'grade': edGrade.value = value; break;
            case 'rank': edRank.value = value; break;
            case 'specialty': edSpecialty.value = value; break;
        }
        setEditorWarn('');
    });
}

document.getElementById('btn-ed-all-random')!.addEventListener('click', () => {
    // 이름이 이미 있으면 그 이름을 유지한다 (값을 잃지 않기 위해).
    const keepName = edName.value.trim();
    const rolled = rollWholeOfficer(keepName === '' ? 'blank' : keepName);
    edName.value = keepName === '' ? rolled.name : keepName;
    edCourtesy.value = rolled.courtesy;
    edGender.value = rolled.gender;
    edBirth.value = String(rolled.birthYear);
    edDeath.value = rolled.deathYear === null ? '' : String(rolled.deathYear);
    edGrade.value = String(rolled.grade);
    edRank.value = String(rolled.rank);
    edSpecialty.value = rolled.specialty;
    for (const s of EDITOR_STATS) {

        const input = editorStatInputs[s.key];
        input.value = String(rolled.stats[s.key]);
        input.dispatchEvent(new Event('input'));
    }
    setEditorWarn('');
});

// ---------------------------------------------------------- 기존 무장 검색
edSearch.addEventListener('input', renderRoster);
edFilterGender.addEventListener('change', renderRoster);
edFilterBirth.addEventListener('change', renderRoster);

// 값이 바뀌면 패널(초상/레이더/연령/특성)을 다시 그린다.
for (const el of [edName, edCourtesy, edGender, edBirth, edGrade]) {
    el.addEventListener('input', () => { if (editorMode === 'new') paintNewOfficerPanels(); });
    el.addEventListener('change', () => { if (editorMode === 'new') paintNewOfficerPanels(); });
}
for (const key of Object.keys(editorStatInputs)) {
    editorStatInputs[key].addEventListener('input', () => {
        if (editorMode === 'new') paintNewOfficerPanels();
    });
}

// 배치 버튼 — 선택은 시각적 상태만 바꾼다(아직 게임 규칙에는 반영하지 않는다).
document.getElementById('ed-deploy')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.moe-deploy-btn') as HTMLElement | null;
    if (!btn) return;
    for (const el of Array.from(document.querySelectorAll('.moe-deploy-btn'))) el.classList.remove('active');
    btn.classList.add('active');
});

edRoster.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.roster-card') as HTMLElement | null;
    if (!card) return;
    const profile = getOfficerProfile(card.dataset.id!);
    if (!profile) return;
    editorSelectedProfile = toEditable(profile);
    document.getElementById('btn-ed-apply-existing')!.removeAttribute('disabled');
    for (const el of Array.from(edRoster.querySelectorAll('.roster-card'))) el.classList.remove('selected');
    card.classList.add('selected');
    setEditorWarn('');
    // 고른 무장의 초상/레이더/연령/특성을 즉시 갱신한다.
    paintExistingPanels();
});
document.getElementById('btn-ed-search-random')!.addEventListener('click', () => {
    const genderFilter = edFilterGender.value;
    const p = randomProfile(hashSeed(`pick|${edSearch.value}|${Date.now()}`), (cand) =>
        genderFilter === '' || cand.gender === genderFilter);
    if (!p) return;
    edSearch.value = p.name;
    renderRoster();
});

// ---------------------------------------------------------- 시나리오 선택
pickList.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.pick-card') as HTMLElement | null;
    if (!card || card.classList.contains('blocked') || (card as HTMLButtonElement).disabled) return;
    const s = getCachedScenarios().find(x => x.id === card.dataset.id);
    if (!s) return;
    pickScreen.style.display = 'none';
    selectedScenario = s;
    renderFactionList(s);
    factionScreen.style.display = 'flex';
});

init();

// ============================================================
// 시나리오 선택 → 세력 선택 → 게임 시작 [9]
// ============================================================

const scenarioScreen = document.getElementById('scenario-screen')!;
const factionScreen = document.getElementById('faction-screen')!;
const scenarioList = document.getElementById('scenario-list')!;
const factionList = document.getElementById('faction-list')!;
const officerScreen = document.getElementById('officer-screen')!;
const officerList = document.getElementById('officer-list')!;
let selectedScenario: ScenarioData | null = null;
let selectedFactionIdx = 0;
let pendingWorld: BuiltWorld | null = null;

async function openScenarioScreen(): Promise<void> {
    // [결함 수정] 화면을 먼저 띄우고 데이터를 나중에 채운다.
    //
    // 예전엔 `await loadScenarios()` 가 끝난 뒤에 scenarioScreen 을
    // display:flex 로 만들었다. 즉 fetch + res.json() 이 끝나기 전까지
    // 사용자는 아무 반응도 없는 화면을 보게 되고, E2E 는 그 첫 전환을
    // 4초 안에 관측하지 못한 채 "화면이 안 열린다" 고 판정했다.
    // 데이터는 이미 캐시되므로 두 번째 진입은 빠르지만, 첫 진입이 느린
    // 사실이 테스트 결과에서 지워져 원인을 놓치기 쉬웠다.
    //
    // 화면 전환과 데이터 로딩을 분리하면 로딩이 아무리 느려도 화면은
    // 즉시 뜬다. 실패는 목록 자리에 메시지로 남긴다.
    factionScreen.style.display = 'none';
    scenarioScreen.style.display = 'flex';
    // 로딩 중 표시 — 데이터를 기다리는 동안 빈 화면을 보여주지 않는다.
    // (E2E 는 scenario-card 개수를 세므로, 로딩 상태임을 분명히 해둔다)
    scenarioList.innerHTML = '<div class="scenario-loading">시나리오를 불러오는 중…</div>';
    try {
        const scenarios = await loadScenarios();
        renderScenarioList(scenarios);
    } catch (err) {
        scenarioList.innerHTML = '<div class="scenario-error">시나리오를 불러오지 못했습니다.</div>';
        addLog(`시나리오 로드 실패: ${err}`);
        statusText.textContent = '시나리오 로드 실패';
    }
}

function renderScenarioList(scenarios: ScenarioData[]): void {
    scenarioList.innerHTML = scenarios.map(s => {
        const [y, m] = s.start_date.split('-');
        const stars = '★'.repeat(s.difficulty) + `<span class="off">${'★'.repeat(Math.max(0, 5 - s.difficulty))}</span>`;
        // 난이도 배율 요약 [X-난이도] — 사건 빈도/산적 피해를 직관적으로 안내
        const mult = DIFFICULTY_MULTIPLIERS[Math.min(4, Math.max(0, s.difficulty - 1))];
        const freqPct = Math.round((mult.roamingFrequency - 1) * 100);
        const banditPct = Math.round((mult.banditScale - 1) * 100);
        const balText = `${freqPct >= 0 ? '사건 +' + freqPct : '사건 ' + freqPct}% · 산적 ${banditPct >= 0 ? '+' : ''}${banditPct}%`;
        const balClass = s.difficulty <= 2 ? 'bal-easy' : s.difficulty >= 4 ? 'bal-hard' : 'bal-std';
        return `<button class="scenario-card" data-id="${s.id}">
            <span class="scenario-num">${s.id}</span>
            <span class="scenario-body">
                <span class="scenario-name">${s.title_kr}</span>
                <span class="scenario-date">${y}년 ${Number(m)}월 — ${s.title_en}</span>
                <span class="scenario-desc">${s.description}</span>
            </span>
            <span class="scenario-side">
                <span class="difficulty">${stars}</span>
                <span class="difficulty-balance ${balClass}">${balText}</span>
                <span class="faction-count">세력 ${s.factions.length}</span>
            </span>
        </button>`;
    }).join('');
}

scenarioList.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.scenario-card') as HTMLElement | null;
    if (!card) return;
    const id = card.dataset.id;
    const s = getCachedScenarios().find(x => x.id === id);
    if (!s) return;
    selectedScenario = s;
    renderFactionList(s);
    scenarioScreen.style.display = 'none';
    factionScreen.style.display = 'flex';
});

function renderFactionList(s: ScenarioData): void {
    document.getElementById('faction-screen-sub')!.textContent =
        `${s.title_kr} — ${s.start_date.replace('-', '년 ')}월 · 세력을 선택하세요`;
    factionList.innerHTML = s.factions.map((f, i) =>
        `<button class="faction-card" data-idx="${i}" style="--faction-color:${factionColor(f.color)}">
            <span class="faction-name">${f.name}</span>
            <span class="faction-leader">군주: ${getKnownOfficerName(f.leader_id)}</span>
            <span class="faction-cap">수도: ${f.capital}</span>
        </button>`).join('');
}

// 세력 클릭 — 무장편집을 거친 경로면 그 무장으로, 아니면 기존 시나리오 경로를 쓴다.
// 두 핸들러를 따로 두면 같은 클릭이 두 번 처리되므로 여기 하나로 합쳤다.
factionList.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.faction-card') as HTMLElement | null;
    if (!card || !selectedScenario) return;
    const idx = Number(card.dataset.idx);
    factionScreen.style.display = 'none';

    if (editorChoice?.kind === 'existing') {
        // 실제무장편집: 고른 무장의 편집값을 고른 세력에 반영한다.
        if (!editorSelectedProfile) {
            setEditorWarn('무장을 먼저 선택해 주세요.');
            addLog('무장 미선택 — 기존 시나리오 경로로 진행합니다.');
        } else {
            const profile = editorSelectedProfile;
            const world = buildExistingOfficerWorld(
                selectedScenario, idx, profile.name, profile.id, {
                    name: edExistingName.value.trim() || profile.name,
                    birthYear: profile.birthYear ?? Number.parseInt(selectedScenario.start_date.slice(0, 4), 10) - 30,
                    gender: profile.gender,
                    rank: Number.parseInt(edExistingRank.value, 10) || 5,
                    stats: readExistingStatsFromSliders(),
                    specialty: edExistingSpecialty.value.trim() || null,
                });
            addLog(`${edExistingName.value.trim() || profile.name} — ${selectedScenario.title_kr}의 ${selectedScenario.factions[idx].name}으로 합류합니다.`);
            void startGame(world);
            return;
        }
    }

    if (editorChoice?.kind === 'new') {
        const stage = selectedScenario;
        const birthRaw = Number.parseInt(edBirth.value, 10);
        const startYear = Number.parseInt(stage.start_date.slice(0, 4), 10);
        // 생년을 안 썼으면 시작 시 장수로 환산한다 (가짜 값이 아니라 기본값).
        const birthYear = Number.isFinite(birthRaw) ? birthRaw : startYear - 30;
        const world = buildCustomOfficerWorld(stage, {
            name: editorChoice.name,
            courtesyName: edCourtesy.value,
            gender: edGender.value === 'F' ? 'F' : 'M',
            birthYear,
            rank: Number.parseInt(edRank.value, 10) || 5,
            stats: {
                leadership: Number.parseInt(editorStatInputs.leadership.value, 10),
                might: Number.parseInt(editorStatInputs.might.value, 10),
                intelligence: Number.parseInt(editorStatInputs.intelligence.value, 10),
                politics: Number.parseInt(editorStatInputs.politics.value, 10),
                charisma: Number.parseInt(editorStatInputs.charisma.value, 10),
            },
            specialty: edSpecialty.value.trim() || null,
        });
        addLog(`${editorChoice.name} — ${stage.title_kr}의 ${stage.factions[idx].name}에서 출발합니다.`);
        void startGame(world);
        return;
    }

    selectedFactionIdx = idx;
    pendingWorld = buildWorld(selectedScenario, idx);
    renderOfficerList(pendingWorld, idx);
    factionScreen.style.display = 'none';
    officerScreen.style.display = 'flex';
});

function renderOfficerList(world: BuiltWorld, factionIdx: number): void {
    const faction = world.factions[factionIdx];
    if (!faction) return;
    document.getElementById('officer-screen-sub')!.textContent =
        `${faction.name} — 플레이할 무장을 고르십시오`;
    const byId = new Map(world.officers.map(o => [o.id, o]));
    const roster = faction.officers
        .map(id => byId.get(id))
        .filter((o): o is NonNullable<typeof o> => o !== null && o !== undefined);
    officerList.innerHTML = roster.map(o => {
        const isLeader = o.id === faction.leaderId;
        return `<button class="officer-card" data-officer-id="${o.id}">
            <span class="officer-portrait">${renderPortraitSvg({
                id: o.id, name: o.name, gender: o.gender === 'F' ? 'F' : 'M',
                grade: Math.max(0, Math.min(9, o.rank)),
            })}</span>
            <span class="officer-info">
                <span class="officer-card-name">${o.name}${isLeader ? '<span class="officer-lord-mark">군주</span>' : ''}</span>
                <span class="officer-card-stats">統${o.stats.leadership} 武${o.stats.might} 智${o.stats.intelligence} 政${o.stats.politics} 魅${o.stats.charisma}</span>
                <span class="officer-card-trait">${o.personality} · ${o.rank}품</span>
            </span>
        </button>`;
    }).join('');
}

officerList.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.officer-card') as HTMLElement | null;
    if (!card || !pendingWorld) return;
    const officerId = card.dataset.officerId ?? null;
    const world = pendingWorld;
    pendingWorld = null;
    officerScreen.style.display = 'none';
    void startGame(world, officerId);
});

document.getElementById('btn-officer-back')!.addEventListener('click', () => {
    pendingWorld = null;
    officerScreen.style.display = 'none';
    factionScreen.style.display = 'flex';
});

document.getElementById('btn-scenario-back')!.addEventListener('click', () => {
    scenarioScreen.style.display = 'none';
    titleScreen.show();
});

// [312] 타이틀 화면 리플레이 URL 가져오기 — 붙여넣은 URL에서 파라미터 추출 후 재생
document.getElementById('btn-replay-load')?.addEventListener('click', () => {
    const input = document.getElementById('replay-url-input') as HTMLInputElement;
    const msgEl = document.getElementById('replay-import-msg')!;
    // 어떤 입력/복원 결과라도 이전 속도를 재사용하지 않고 안전한 기본값부터 시작한다.
    replaySpeedControls.reset();
    replaySpeedControls.setVisible(false);
    const showMsg = (text: string, ok: boolean): void => {
        msgEl.textContent = text;
        msgEl.style.color = ok ? '#9fd6a0' : '#e08a80';
        msgEl.style.display = 'block';
    };
    if (!input.value.trim()) {
        showMsg('URL을 입력하세요', false);
        return;
    }
    // 전체 URL 또는 압축 문자열만 직접 허용
    let param = input.value.trim();
    const m = param.match(/[?&]replay=([A-Za-z0-9\-_.~]+)/);
    if (m) param = m[1];
    void replayManager.importFromCompressedString(param).then(logs => {
        if (logs.length === 0) {
            showMsg('❌ 리플레이 복원 실패 — URL이 올바른지 확인하세요', false);
            return;
        }
        const unitCount = prepareReplayPlayback(logs);
        if (unitCount === 0) {
            showMsg('❌ 리플레이에 유닛 정보가 없습니다 — 기본 속도 1x 유지', false);
            return;
        }
        document.getElementById('scenario-screen')!.style.display = 'none';
        document.getElementById('title-screen')!.style.display = 'none';
        addLog(`🎬 리플레이 로드 완료 — 액션 ${logs.length}건, 유닛 ${unitCount} (자동 재생)`);
        replayViewer!.play();
    });
});

document.getElementById('btn-faction-back')!.addEventListener('click', () => {
    factionScreen.style.display = 'none';
    scenarioScreen.style.display = 'flex';
});

// 디버그/테스트 훅 (브라우저 콘솔 및 E2E 테스트용)
declare global {
    interface Window { __game?: Record<string, unknown> }
}
window.__game = {
    getChinaMap: () => chinaMap,
    getWorldCities: () => worldCities,
    getVisibleCityIds: () => chinaMap?.getVisibleCityIds() ?? [],
    getFactionLabels: () => chinaMap?.getFactionLabels() ?? [],
    getCityVisibilityMode: () => cityVisibilityMode,
    // [2026-10-04] 이동 상태 — E2E 가 "경로가 그려졌나 / 도착했나" 를 읽는다.
    //   군단 위치 모델은 아직 없어 진행도는 0~1 시각 값일 뿐이다.
    isTravelModeActive: () => travelModeActive,
    getTravelRoute: () => (travelRoute ? { ...travelRoute } : null),
    hasTravelRoute: () => chinaMap?.hasTravelRoute() ?? false,
    getTravelRoutePoints: () => chinaMap?.getTravelRoutePoints() ?? [],
    // [2026-10-04] 이동 계획 — 육로/해로 구간별 소요 일수
    getTravelPlan: () => chinaMap?.getTravelPlan() ?? null,
    getActiveTravel: () => engine?.['store'].getGlobalState().activeTravel ?? null,
    // [2026-10-04] 진행도(0~1) — 턴마다 마커가 실제로 전진하는지 E2E 가 확인한다.
    getTravelProgress: () => (chinaMap as unknown as { travelProgress?: number } | undefined)?.travelProgress ?? 0,
    // [2026-10-04] 검증용 — 두 도시 id 사이 경로를 즉시 세운다(UI 를 거치지 않고).
    setTravelRouteForTest: (fromId: string, toId: string) => {
        chinaMap?.setTravelRoute(fromId, toId);
        return chinaMap?.getTravelRoutePoints() ?? [];
    },
    getRoadCount: () => (chinaMap as unknown as { roads?: unknown[] } | undefined)?.roads?.length ?? 0,
    getCurrentPanelCityId: () => currentPanelCityId,
    getCityScreenPosition: (cityId: string) => chinaMap?.getCityScreenPosition(cityId) ?? null,
    getEngine: () => engine,
    getStore: () => engine?.['store'] ?? null,
    /** [디버그] 마지막 턴의 실행 트리(번호가 붙은 계층 구조) */
    getTurnTrace: () => engine ? engine.getTurnTrace().getTree() : null,
    /** [디버그] 턴 트리를 텍스트로 — 콘솔에서 바로 보려면 이게 편하다 */
    getTurnTraceText: (maxDepth = 2) => engine ? engine.getTurnTrace().toText(maxDepth) : '',
    /** [디버그] 트레이스 패널을 연다 — E2E/수동 확인용 */
    openTracePanel: () => { openTracePanel(); return true; },
    closeTracePanel: () => { tracePanel.style.display = 'none'; return true; },
    openCity: (cityId: string) => { showCityInfo(cityId); return true; },
    /** E2E/디버그용: 교역소 대화를 직접 연다. */
    openTradeDialogue: (cityId: string) => { openTradeDialogue(cityId); return true; },
    /**
     * E2E/디버그용: 대사를 한 번에 다 보여준다(타이포그래피 끄기).
     * E2E 는 창을 연 직후 dialogue-text 의 textContent 를 읽는다.
     * 글자가 덜 나왔으면 길이 검사에 걸리므로, 검사용으로 명시적으로 끈다.
     */
    setDialogueInstant: (instant: boolean) => { revealForceInstant = instant; return revealForceInstant; },
    /** E2E/디버그용: 타이포그래피가 지금 끝났는지. */
    isDialogueRevealDone: () => dialogueScene.isRevealDone(),
    getCitySceneBuildings: () => citySceneBuildings.map(building => ({
        id: building.id, type: building.type, level: building.level,
        investment: building.investment, active: building.active, label: building.label,
    })),
    selectCitySceneBuildingByIndex: (index: number) => {
        const building = citySceneBuildings[index];
        if (!building) return false;
        showCitySceneBuildingDetail(building);
        return true;
    },
    investSelectedCityBuilding: () => { investInSelectedCityBuilding(); return true; },
    toggleSelectedCityBuilding: () => { toggleSelectedCityBuilding(); return true; },
    getCityBuildingStates: () => engine?.['store'].getGlobalState().cityBuildingStates ?? {},
    getMapView: () => chinaMap.getView(),
    closeCity: () => { document.getElementById('cdp-close')?.dispatchEvent(new Event('click')); return true; },
    debugCityTime: (offsetMs: number) => { cityTimeOffsetMs = offsetMs; return true; },
    /** 포팅 시스템 접근자 [76-85][213-214][321-340][341-360][421-438][431-432][441-460] */
    getPortedSystems: () => engine ? {
        strategicCommand: engine.strategicCommand,
        lifeSimulator: engine.lifeSimulator,
        metaManager: engine.metaManager,
        legacyManager: engine.legacyManager,
        metaDataManager: engine.metaDataManager,
        intelligenceManager: engine.intelligenceManager,
        narrativeManager: engine.narrativeManager,
        climateManager: engine.climateManager,
    } : null,
    /** E2E/테스트용: 코어 시스템 모듈 접근자 (동적 import 실패 우회) */
    systems: {
        freeOfficerVisit: () => free_officer_visit_system,
        roamingEvent: () => roaming_event_system,
        vengeance: () => vengeance_system,
        captiveEscape: () => captive_escape_system,
    },
    /** E2E 테스트용: 시나리오 지정 시작 (예: startScenario('05', 2)) */
    startScenario: (id: string, factionIndex: number) => {
        void loadScenarios().then(() => {
            const loaded = getCachedScenarios().find(s => s.id === id);
            if (!loaded) return false;
            const world = buildWorld(loaded, factionIndex);
            void startGame(world);
            return true;
        });
        return true;
    },
    /** E2E 테스트용: AI BattleCommand로 포로 후처리까지 강제 실행 */
    runTestBattle: () => {
        if (!engine) return { success: false, reason: 'engine not ready' };
        try {
        const store = engine['store'];
        const gs = store.getGlobalState();
        const playerFactionId = gs.playerFactionId;
        const attackerFaction = store.getAllFactions().find(f =>
            f.id !== playerFactionId && store.getCitiesByFaction(f.id).length > 0,
        );
        const defenderFaction = attackerFaction
            ? store.getAllFactions().find(f => f.id !== playerFactionId && f.id !== attackerFaction.id)
            : undefined;
        const attacker = attackerFaction
            ? store.getAllOfficers().find(o => o.factionId === attackerFaction.id && o.cityId)
            : undefined;
        const source = attacker?.cityId ? store.getCity(attacker.cityId) : null;
        const target = defenderFaction
            ? store.getAllCities().find(c => c.ownerId === defenderFaction.id
                && c.id !== source?.id
                && store.getOfficersByCity(c.id).some(o => o.factionId === defenderFaction.id))
            : undefined;
        if (!attackerFaction || !defenderFaction || !attacker || !source || !target) {
            return { success: false, reason: 'battle fixture unavailable' };
        }

        store.updateOfficer(attacker.id, { actionPoints: 100 });
        store.updateCity(source.id, { development: 99_999, defense: 100 });
        store.updateCity(target.id, { development: 1, defense: 1, loyalty: 30 });
        engine.diplomacyEngine.declareWar(attackerFaction.id, defenderFaction.id);
        const originalRandom = Math.random;
        Math.random = () => 0;
        try {
            engine.enqueueCommand(new BattleCommand(attacker.id, source.id, target.id, gs.turnCount));
            const result = engine.executeAllCommands()[0];
            engine['processEventQueue']();
            return {
                success: result?.success ?? false,
                commandType: result?.commandType ?? null,
                captiveOutcomes: result?.captiveOutcomes ?? [],
                targetCityId: target.id,
                logMessages: result?.logMessages ?? [],
                logText: document.getElementById('log-content')?.textContent ?? '',
                chronicleText: engine.chronicle.listByKind('CAPTURE').map(entry => entry.text),
            };
        } finally {
            Math.random = originalRandom;
        }
        } catch (error) {
            return { success: false, reason: error instanceof Error ? error.stack ?? error.message : String(error) };
        }
    },
    /** E2E 테스트용: 세이브 수행 */
    saveGame: () => {
        if (!engine) return false;
        const compressed = engine.saveCompressed();
        try { localStorage.setItem('sik_re_save', compressed); return true; } catch { return false; }
    },
    /** E2E/디버그용: 인증 런타임 스냅샷 (스토어 + 흐름 양쪽을 함께 노출) */
    getAuthRuntime: () => {
        if (!authRuntime) return null;
        const snapshot = authRuntime.store.getSnapshot();
        const flowState = authRuntime.flow.viewModel.getState();
        return {
            mode: authRuntime.mode,
            state: snapshot.state.status,
            guestSessionId: snapshot.guestSession?.sessionId ?? null,
            flowState: flowState.status,
            flowGuestSessionId: authRuntime.flow.viewModel.getGuestSession()?.sessionId ?? null,
        };
    },
    /** E2E/디버그용: 인증 흐름의 현재 DOM 상태 */
    getAuthPanelState: () => {
        const root = document.getElementById('auth-panel-container')?.querySelector('[data-auth-state]');
        return root?.getAttribute('data-auth-state') ?? null;
    },
    /** E2E/디버그용: 게스트 세션 시작 (프로바이더 네트워크 호출 없음) */
    signInAsGuest: async () => {
        if (!authRuntime) return null;
        const state = await authRuntime.flow.signInAsGuest();
        // 흐름과 스토어는 별개 상태 기계이므로 공유 게스트 스토리지를 통해 정합시킨다.
        await authRuntime.store.restoreSession();
        return state.status;
    },
    /** E2E/디버그용: 로그아웃 */
    signOutAuth: async () => {
        if (!authRuntime) return null;
        const state = await authRuntime.flow.signOut();
        await authRuntime.store.signOut();
        return state.status;
    },
    /** E2E/디버그용: 오프라인 어댑터에 프로바이더 전이를 주입(네트워크 호출 없음) */
    emitAuthProviderEvent: (event: AuthChangeEvent, session: AuthSession | null) => {
        if (!authRuntime) return false;
        return authRuntime.emitProviderEvent(event, session);
    },
};

// [Auth] 브라우저 런타임 배선 — 오프라인 어댑터로도 정상 마운트된다.
// index.html의 인라인 부트스트랩은 window.authClient가 있을 때만 동작하므로
// 여기서 window.authClient를 노출하지 않아 이중 마운트를 피한다.
let authRuntime: AuthRuntime | null = null;
const authPanelContainer = document.getElementById('auth-panel-container');
if (authPanelContainer) {
    void bootstrapAuth(authPanelContainer)
        .then((runtime) => { authRuntime = runtime; })
        .catch((error: unknown) => {
            addLog(`인증 초기화 실패: ${error instanceof Error ? error.message : String(error)}`);
        });
}

// [312] 페이지 로드 시 공유 리플레이 파라미터 확인
checkReplayParam();
