import { describe, expect, it } from 'vitest';
import { splitAmfiCategory } from './amfiCategory';

describe('splitAmfiCategory', () => {
  it('splits the modern heading into shelf and sub-category', () => {
    expect(splitAmfiCategory('Equity Scheme - Mid Cap Fund')).toEqual({
      bucket: 'Equity',
      subCategory: 'Mid Cap Fund',
    });
  });

  // AMFI ships both spellings, sometimes on the same day for the same shelf.
  it('accepts the plural "Schemes" spelling', () => {
    expect(splitAmfiCategory('Equity Schemes - Mid Cap Fund')).toEqual({
      bucket: 'Equity',
      subCategory: 'Mid Cap Fund',
    });
  });

  it('keeps hybrids on the hybrid shelf, not equity', () => {
    expect(splitAmfiCategory('Hybrid Scheme - Aggressive Hybrid Fund')).toEqual({
      bucket: 'Hybrid',
      subCategory: 'Aggressive Hybrid Fund',
    });
  });

  it('maps the pre-2018 headings AMFI never rewrote', () => {
    expect(splitAmfiCategory('Income').bucket).toBe('Debt');
    expect(splitAmfiCategory('Growth').bucket).toBe('Equity');
    expect(splitAmfiCategory('Income/Debt Oriented').bucket).toBe('Debt');
  });

  // A sub-category is never invented — a client could act on it.
  it('leaves the sub-category empty when the heading names none', () => {
    expect(splitAmfiCategory('Income').subCategory).toBe('');
    expect(splitAmfiCategory('Fund of Funds').subCategory).toBe('');
  });

  it('does not force index or solution funds onto an equity or debt shelf', () => {
    expect(splitAmfiCategory('Other Scheme - Index Funds').bucket).toBe('Other');
    expect(splitAmfiCategory('Solution Oriented Scheme - Retirement Fund').bucket).toBe('Other');
  });

  it('survives a missing heading', () => {
    expect(splitAmfiCategory(null)).toEqual({ bucket: 'Other', subCategory: '' });
    expect(splitAmfiCategory('   ')).toEqual({ bucket: 'Other', subCategory: '' });
  });
});
