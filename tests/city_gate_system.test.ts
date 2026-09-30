import { describe, it, expect } from 'vitest';
import {
  shouldInspectAtGate,
  resolveGateChoice,
  gateBribeCost,
  gateSneakThreshold,
} from '../src/core/city_gate_system.js';

describe('성문 검문 판정', () => {
  const base = {
    cityName: '낙양',
    ownerId: 'fac_1',
    ownerName: '원소',
    playerFactionId: 'fac_0',
    atWar: false,
    visited: false,
  };

  it('자국 도시는 검문 없이 통과한다', () => {
    expect(shouldInspectAtGate({ ...base, ownerId: 'fac_0' }).kind).toBe('none');
  });

  it('무주공산은 검문 없이 통과한다', () => {
    expect(shouldInspectAtGate({ ...base, ownerId: null, ownerName: null }).kind).toBe('none');
  });

  it('미방문 중립 도시는 일반 검문을 받는다', () => {
    const result = shouldInspectAtGate(base);
    expect(result.kind).toBe('standard');
    expect(result.cityName).toBe('낙양');
  });

  it('방문한 중립 도시는 검문 없이 통과한다', () => {
    expect(shouldInspectAtGate({ ...base, visited: true }).kind).toBe('none');
  });

  it('전쟁 중인 세력 도시는 방문 여부와 무관하게 엄중 검문을 받는다', () => {
    expect(shouldInspectAtGate({ ...base, atWar: true }).kind).toBe('strict');
    expect(shouldInspectAtGate({ ...base, atWar: true, visited: true }).kind).toBe('strict');
  });
});

describe('성문 검문 해결', () => {
  it('뇌물은 엄중 검문이 300金, 일반 검문이 100金이다', () => {
    expect(gateBribeCost(true)).toBe(300);
    expect(gateBribeCost(false)).toBe(100);
  });

  it('뇌물은 자금이 있으면 통과하고 차감액을 반환한다', () => {
    const result = resolveGateChoice('bribe', { factionGold: 500, officerIntelligence: 50, strict: false }, 0.99);
    expect(result.entered).toBe(true);
    expect(result.goldSpent).toBe(100);
  });

  it('뇌물은 자금이 부족하면 진입 실패한다', () => {
    const result = resolveGateChoice('bribe', { factionGold: 50, officerIntelligence: 50, strict: false }, 0);
    expect(result.entered).toBe(false);
    expect(result.goldSpent).toBe(0);
  });

  it('잠입은 지력 기반 판정이다 (roll 0이면 성공, 0.999면 실패)', () => {
    const context = { factionGold: 0, officerIntelligence: 70, strict: false };
    expect(gateSneakThreshold(70, false)).toBe(90);
    expect(resolveGateChoice('sneak', context, 0).entered).toBe(true);
    expect(resolveGateChoice('sneak', context, 0.999).entered).toBe(false);
    expect(resolveGateChoice('sneak', context, 0.999).infamyDelta).toBe(3);
  });

  it('엄중 검문은 잠입이 어렵다', () => {
    expect(gateSneakThreshold(70, true)).toBe(60);
  });

  it('돌아가기는 진입하지 않는다', () => {
    const result = resolveGateChoice('leave', { factionGold: 9999, officerIntelligence: 99, strict: false }, 0);
    expect(result.entered).toBe(false);
    expect(result.goldSpent).toBe(0);
  });
});
