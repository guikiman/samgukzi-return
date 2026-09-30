/**
 * [B11] 일기토(Duel) 미니게임 엔진
 *
 * 삼국지리턴 스타일 5턴제 일기토
 * 카드 대결: ATTACK > DEFENSE, DEFENSE > COUNTER, COUNTER > ATTACK
 * SPIRIT 시스템: 매 턴 +1 (최대 5), SPECIAL 카드 소모
 */

import type { OfficerID, OfficerStats } from './types';

export type DuelCardType =
    | 'SLASH'       // 기본 공격
    | 'GUARD'       // 방어
    | 'POWER_STRIKE'// 강력 공격 (spirit 2 소모)
    | 'COUNTER'     // 반격
    | 'HEAL'        // 회복 (spirit 1 소모)
    | 'FURY';       // 분노 (spirit 3 소모, 3배 데미지)

export interface DuelCard {
    readonly type: DuelCardType;
    readonly power: number;
    readonly spiritCost: number;
    readonly label: string;
    readonly description: string;
}

export interface DuelState {
    readonly turn: number;
    readonly playerId: OfficerID;
    readonly enemyId: OfficerID;
    readonly playerName: string;
    readonly enemyName: string;
    readonly playerHp: number;
    readonly enemyHp: number;
    readonly playerSpirit: number;
    readonly enemySpirit: number;
    readonly playerMaxHp: number;
    readonly enemyMaxHp: number;
    readonly phase: 'READY' | 'PLAYER_TURN' | 'ENEMY_TURN' | 'RESOLVE' | 'DONE';
    readonly log: string[];
    readonly winner: OfficerID | null;
    readonly maxTurns: number;
}

const ALL_CARDS: Record<DuelCardType, DuelCard> = {
    SLASH: { type: 'SLASH', power: 10, spiritCost: 0, label: '참격', description: '기본 공격, spirit 불필요' },
    GUARD: { type: 'GUARD', power: 0, spiritCost: 0, label: '방어', description: '공격을 막고 spirit +1' },
    POWER_STRIKE: { type: 'POWER_STRIKE', power: 25, spiritCost: 2, label: '필살기', description: '강력한 공격, spirit 2 소모' },
    COUNTER: { type: 'COUNTER', power: 15, spiritCost: 0, label: '반격', description: '공격을 되받아침' },
    HEAL: { type: 'HEAL', power: -15, spiritCost: 1, label: '치유', description: 'HP 15 회복, spirit 1 소모' },
    FURY: { type: 'FURY', power: 35, spiritCost: 3, label: '분노', description: '3배 데미지, spirit 3 소모' },
};

const CARD_WIN: Record<DuelCardType, DuelCardType[]> = {
    SLASH: ['GUARD'],       // 참격은 방어를 깸
    GUARD: ['COUNTER'],     // 방어는 반격을 막음
    POWER_STRIKE: ['SLASH', 'GUARD', 'COUNTER', 'HEAL', 'FURY'], // 필살기는 모든 일반 카드를 이김
    COUNTER: ['SLASH'],     // 반격은 참격을 되받아침
    HEAL: ['GUARD'],        // 치유는 방어 중에 가능
    FURY: ['SLASH', 'GUARD', 'COUNTER', 'HEAL', 'POWER_STRIKE'], // 분노는 모든 카드를 이김 (단, 상대도 FURY면 무승부)
};

export class DuelMinigame {
    private state: DuelState;

    constructor() {
        this.state = this.createInitialState('', '', { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 }, { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 });
    }

    private createInitialState(
        playerId: OfficerID,
        enemyId: OfficerID,
        playerStats: OfficerStats,
        enemyStats: OfficerStats,
    ): DuelState {
        return {
            turn: 0,
            playerId,
            enemyId,
            playerName: playerId,
            enemyName: enemyId,
            playerHp: 100,
            enemyHp: 100,
            playerSpirit: 3,
            enemySpirit: 3,
            playerMaxHp: 100,
            enemyMaxHp: 100,
            phase: 'READY',
            log: [],
            winner: null,
            maxTurns: 5,
        };
    }

    /** 일기토 시작 — 표기명은 로그 전용이며 승패 판정은 id로 한다. */
    startDuel(
        playerId: OfficerID,
        enemyId: OfficerID,
        playerStats: OfficerStats,
        enemyStats: OfficerStats,
        playerName?: string,
        enemyName?: string,
    ): DuelState {
        const initialHp = 50 + Math.floor((playerStats.might + enemyStats.might) / 2);
        this.state = {
            turn: 0,
            playerId,
            enemyId,
            playerName: playerName ?? playerId,
            enemyName: enemyName ?? enemyId,
            playerHp: initialHp,
            enemyHp: initialHp,
            playerSpirit: 3,
            enemySpirit: 3,
            playerMaxHp: initialHp,
            enemyMaxHp: initialHp,
            phase: 'PLAYER_TURN',
            log: [`⚔️ ${playerName ?? playerId} vs ${enemyName ?? enemyId} 일기토 시작! (HP: ${initialHp})`],
            winner: null,
            maxTurns: 5,
        };
        return this.getState();
    }

    /** 사용 가능한 카드 목록 반환 */
    getAvailableCards(spirit: number): DuelCard[] {
        return Object.values(ALL_CARDS).filter(card => card.spiritCost <= spirit);
    }

    /** 적 AI 카드 선택 (랜덤) */
    private enemyChooseCard(): DuelCardType {
        const available = this.getAvailableCards(this.state.enemySpirit);
        if (available.length === 0) return 'SLASH';
        return available[Math.floor(Math.random() * available.length)].type;
    }

    /** 카드 대결 해소 */
    private resolveCards(playerCard: DuelCardType, enemyCard: DuelCardType): { playerDmg: number; enemyDmg: number; log: string } {
        const pCard = ALL_CARDS[playerCard];
        const eCard = ALL_CARDS[enemyCard];

        // SPIRIT 차감
        this.state = {
            ...this.state,
            playerSpirit: Math.min(5, this.state.playerSpirit - pCard.spiritCost + 1),
            enemySpirit: Math.min(5, this.state.enemySpirit - eCard.spiritCost + 1),
        };

        // 카드 승패 판정
        const pWinsAgainst = CARD_WIN[playerCard] ?? [];
        const eWinsAgainst = CARD_WIN[enemyCard] ?? [];

        const pBeatsE = pWinsAgainst.includes(enemyCard);
        const eBeatsP = eWinsAgainst.includes(playerCard);

        let playerDmg = 0;
        let enemyDmg = 0;
        let logMsg = '';

        if (playerCard === 'HEAL') {
            const heal = 15;
            this.state = { ...this.state, playerHp: Math.min(this.state.playerMaxHp, this.state.playerHp + heal) };
            logMsg = `${this.state.playerName} 치유! HP +${heal}`;
        }
        if (enemyCard === 'HEAL') {
            const heal = 15;
            this.state = { ...this.state, enemyHp: Math.min(this.state.enemyMaxHp, this.state.enemyHp + heal) };
            logMsg += (logMsg ? ' / ' : '') + `${this.state.enemyName} 치유! HP +${heal}`;
        }

        if (pBeatsE && !eBeatsP) {
            enemyDmg = pCard.power;
            logMsg += (logMsg ? ' / ' : '') + `${this.state.playerName}의 ${pCard.label} 성공! ${this.state.enemyName}에게 ${enemyDmg} 데미지!`;
        } else if (eBeatsP && !pBeatsE) {
            playerDmg = eCard.power;
            logMsg += (logMsg ? ' / ' : '') + `${this.state.enemyName}의 ${eCard.label} 성공! ${this.state.playerName}에게 ${playerDmg} 데미지!`;
        } else {
            // 무승부: 서로 데미지 (또는 방어/반격 상쇄)
            if (playerCard === 'SLASH' || enemyCard === 'SLASH') {
                if (playerCard === 'SLASH') enemyDmg = Math.floor(pCard.power * 0.5);
                if (enemyCard === 'SLASH') playerDmg = Math.floor(eCard.power * 0.5);
                logMsg += (logMsg ? ' / ' : '') + '서로 참격! 상호 데미지!';
            } else {
                logMsg += (logMsg ? ' / ' : '') + '공방이 팽팽합니다!';
            }
        }

        // 데미지 적용
        if (playerDmg > 0) {
            this.state = { ...this.state, playerHp: Math.max(0, this.state.playerHp - playerDmg) };
        }
        if (enemyDmg > 0) {
            this.state = { ...this.state, enemyHp: Math.max(0, this.state.enemyHp - enemyDmg) };
        }

        this.state = {
            ...this.state,
            log: [...this.state.log, logMsg],
        };

        return { playerDmg, enemyDmg, log: logMsg };
    }

    /** 플레이어 카드 선택 후 턴 실행 */
    playCard(playerCardType: DuelCardType): DuelState {
        if (this.state.phase === 'DONE') return this.getState();
        if (this.state.phase !== 'PLAYER_TURN') return this.getState();

        // spirit 체크
        const card = ALL_CARDS[playerCardType];
        if (card.spiritCost > this.state.playerSpirit) {
            return this.getState();
        }

        // 적 카드 선택
        const enemyCardType = this.enemyChooseCard();

        // 대결 해소
        this.resolveCards(playerCardType, enemyCardType);

        // 턴 증가
        const newTurn = this.state.turn + 1;

        // 승패 판정
        let winner: OfficerID | null = null;
        let phase: DuelState['phase'] = 'RESOLVE';

        if (this.state.playerHp <= 0) {
            winner = this.state.enemyId;
            phase = 'DONE';
            this.state = { ...this.state, log: [...this.state.log, `💀 ${this.state.playerName} 패배!`] };
        } else if (this.state.enemyHp <= 0) {
            winner = this.state.playerId;
            phase = 'DONE';
            this.state = { ...this.state, log: [...this.state.log, `🏆 ${this.state.playerName} 승리!`] };
        } else if (newTurn >= this.state.maxTurns) {
            // 5턴 종료: HP 많은 쪽 승리
            winner = this.state.playerHp > this.state.enemyHp ? this.state.playerId :
                     this.state.enemyHp > this.state.playerHp ? this.state.enemyId : null;
            phase = 'DONE';
            this.state = {
                ...this.state,
                log: [...this.state.log, `${winner ? `🏆 ${winner} 승리!` : '⚖️ 무승부!'}`],
            };
        } else {
            phase = 'PLAYER_TURN';
        }

        this.state = {
            ...this.state,
            turn: newTurn,
            phase,
            winner,
            playerSpirit: Math.min(5, this.state.playerSpirit + 1),
            enemySpirit: Math.min(5, this.state.enemySpirit + 1),
        };

        return this.getState();
    }

    /** 일기토 종료 여부 */
    isDuelOver(): boolean {
        return this.state.phase === 'DONE';
    }

    /** 현재 상태 반환 */
    getState(): DuelState {
        return { ...this.state, log: [...this.state.log] };
    }

    /** 승자 반환 */
    getWinner(): OfficerID | null {
        return this.state.winner;
    }
}
