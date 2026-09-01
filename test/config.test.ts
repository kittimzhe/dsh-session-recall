import { describe, expect, it } from 'vitest'
import { normalizeRecallConfig } from '../src/config.ts'

describe('normalizeRecallConfig', () => {
  it('defaults everything', () => {
    expect(normalizeRecallConfig()).toEqual({
      allowAllProjects: true,
      defaultLimit: 5,
      maxLimit: 10,
      cjkHint: true,
      cjkFallback: true,
      cjkFallbackScanMax: 50,
    })
  })

  it('honors explicit values', () => {
    expect(normalizeRecallConfig({ allowAllProjects: false, defaultLimit: 3, maxLimit: 20, cjkHint: false, cjkFallback: false, cjkFallbackScanMax: 12 })).toEqual({
      allowAllProjects: false,
      defaultLimit: 3,
      maxLimit: 20,
      cjkHint: false,
      cjkFallback: false,
      cjkFallbackScanMax: 12,
    })
  })

  it('clamps defaultLimit into 1..10', () => {
    expect(normalizeRecallConfig({ defaultLimit: 0 }).defaultLimit).toBe(1)
    expect(normalizeRecallConfig({ defaultLimit: 99 }).defaultLimit).toBe(10)
    expect(normalizeRecallConfig({ defaultLimit: Number.NaN }).defaultLimit).toBe(5)
  })

  it('clamps maxLimit into 1..25 and never below defaultLimit', () => {
    expect(normalizeRecallConfig({ maxLimit: 0 }).maxLimit).toBe(5)
    expect(normalizeRecallConfig({ maxLimit: 99 }).maxLimit).toBe(25)
    expect(normalizeRecallConfig({ defaultLimit: 8, maxLimit: 2 }).maxLimit).toBe(8)
  })

  it('clamps cjkFallbackScanMax into 1..500', () => {
    expect(normalizeRecallConfig({ cjkFallbackScanMax: 0 }).cjkFallbackScanMax).toBe(1)
    expect(normalizeRecallConfig({ cjkFallbackScanMax: 99_999 }).cjkFallbackScanMax).toBe(500)
    expect(normalizeRecallConfig({ cjkFallbackScanMax: Number.NaN }).cjkFallbackScanMax).toBe(50)
  })
})
