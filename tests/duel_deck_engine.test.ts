import { describe, it, expect } from 'vitest';
import { DuelDeckBuilder, DuelTurnProcessor } from '../src/core/duel_deck_engine';

describe('DuelDeckBuilder', () => {
    const builder = new DuelDeckBuilder();

    it('should build a 15-card deck', () => {
        const deck = builder.buildDeck('officer_1', 90, ['BLADE']);
        expect(deck.cards).toHaveLength(15);
        expect(deck.ownerId).toBe('officer_1');
    });

    it('should draw cards from deck', () => {
        const deck = builder.buildDeck('officer_1', 80, []);
        const card = builder.drawCard(deck);
        expect(card).not.toBeNull();
        expect(deck.cards).toHaveLength(14);
    });

    it('should return null when deck is empty', () => {
        const deck = { cards: [], ownerId: 'test' };
        const card = builder.drawCard(deck);
        expect(card).toBeNull();
    });

    it('should generate more SPECIAL cards for high might', () => {
        const specialChance = (might: number, bonus: number): number => Math.min(0.3, might / 300 + bonus);
        const sampleSpecials = (might: number, skills: string[]): number => {
            let total = 0;
            for (let i = 0; i < 200; i++) {
                total += builder.buildDeck('officer_1', might, skills).cards
                    .filter(c => c.type === 'SPECIAL').length;
            }
            return total;
        };
        const highSpecials = sampleSpecials(300, ['BLADE']);
        const lowSpecials = sampleSpecials(20, []);
        expect(highSpecials).toBeGreaterThan(lowSpecials);
        const lowRate = lowSpecials / (200 * 15);
        expect(lowRate).toBeLessThan(specialChance(20, 0) + 0.05);
        expect(highSpecials / (200 * 15)).toBeGreaterThan(specialChance(300, 0.1) - 0.05);
    });
});

describe('DuelTurnProcessor', () => {
    const processor = new DuelTurnProcessor();

    it('should start a duel with correct initial state', () => {
        const state = processor.startDuel('player_1', 90, 'ai_1', 80, ['BLADE'], []);
        expect(state.playerHp).toBe(100);
        expect(state.aiHp).toBe(100);
        expect(state.turn).toBe(0);
        expect(state.maxTurns).toBe(5);
        expect(state.winner).toBeNull();
    });

    it('should process a turn and update state', () => {
        const builder = new DuelDeckBuilder();
        const playerDeck = builder.buildDeck('player_1', 90, ['BLADE']);
        const aiDeck = builder.buildDeck('ai_1', 80, []);
        const processor = new DuelTurnProcessor();
        let state = processor.startDuel('player_1', 90, 'ai_1', 80, ['BLADE'], []);

        state = processor.processTurn(state, playerDeck, aiDeck);
        expect(state.turn).toBe(1);
        expect(state.results).toHaveLength(1);
        expect(state.winner).toBeNull();
    });

    it('should determine a winner after 5 turns', () => {
        const processor = new DuelTurnProcessor();
        const builder = new DuelDeckBuilder();
        const playerDeck = builder.buildDeck('player_1', 90, ['BLADE']);
        const aiDeck = builder.buildDeck('ai_1', 80, []);
        let state = processor.startDuel('player_1', 90, 'ai_1', 80, ['BLADE'], []);

        for (let i = 0; i < 5; i++) {
            state = processor.processTurn(state, playerDeck, aiDeck);
        }

        expect(state.winner).not.toBeNull();
        expect(state.turn).toBeLessThanOrEqual(5);
    });
});
