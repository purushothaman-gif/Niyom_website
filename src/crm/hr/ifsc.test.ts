import { describe, it, expect } from 'vitest';
import { normaliseIfsc } from './ifsc';

const VALID = /^[A-Z]{4}0[A-Z0-9]{6}$/;

describe('normaliseIfsc', () => {
  it('leaves a correct code alone', () => {
    expect(normaliseIfsc('IDFB0080131')).toBe('IDFB0080131');
  });

  it('upper-cases', () => {
    expect(normaliseIfsc('idfb0080131')).toBe('IDFB0080131');
  });

  it('strips the spaces a copy-paste brings with it', () => {
    // A single trailing space used to fail the format check, and the error
    // explaining it rendered behind the drawer.
    expect(normaliseIfsc('IDFB0080131 ')).toBe('IDFB0080131');
    expect(normaliseIfsc(' IDFB 0080 131')).toBe('IDFB0080131');
    expect(normaliseIfsc('SBIN-0000258')).toBe('SBIN0000258');
  });

  it('turns the letter O in position five into the zero it must be', () => {
    expect(normaliseIfsc('IDFBO080131')).toBe('IDFB0080131');
    expect(VALID.test(normaliseIfsc('sbino000258'))).toBe(true);
  });

  it('does not touch an O anywhere else', () => {
    // Branch codes can legitimately contain the letter O.
    expect(normaliseIfsc('HDFC0OO1234')).toBe('HDFC0OO1234');
  });

  it('never makes a wrong code look right', () => {
    for (const bad of ['IDFB008013', 'IDFB00801311', 'IDF10080131', '12345678901', '']) {
      expect(VALID.test(normaliseIfsc(bad))).toBe(false);
    }
  });
});
