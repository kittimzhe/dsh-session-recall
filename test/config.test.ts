import { describe, expect, it } from 'vitest'
import { cwdAllowed, normalizeRecallConfig } from '../src/config.ts'

describe('normalizeRecallConfig', () => {
  it('defaults everything', () => {
    expect(normalizeRecallConfig()).toEqual({
      allowAllProjects: true,
      defaultLimit: 5,
      maxLimit: 10,
      cjkHint: true,
      cjkFallback: true,
      cjkFallbackScanMax: 50,
      redactionMode: 'off',
      cwdAllowlist: [],
      cwdDenylist: [],
      allProjectsPolicy: 'allow',
      recencyHalfLifeDays: undefined,
      pinnedCwds: [],
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
      redactionMode: 'off',
      cwdAllowlist: [],
      cwdDenylist: [],
      allProjectsPolicy: 'allow',
      recencyHalfLifeDays: undefined,
      pinnedCwds: [],
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

  it('normalizes the new v0.4 fields', () => {
    expect(normalizeRecallConfig({ redactionMode: 'hash', cwdAllowlist: ['/a', '', 5 as unknown as string], cwdDenylist: ['/b'], allProjectsPolicy: 'confirm' })).toMatchObject({
      redactionMode: 'hash',
      cwdAllowlist: ['/a'],
      cwdDenylist: ['/b'],
      allProjectsPolicy: 'confirm',
    })
    expect(normalizeRecallConfig({ redactionMode: 'loud' as never, allProjectsPolicy: 'maybe' as never })).toMatchObject({
      redactionMode: 'off',
      allProjectsPolicy: 'allow',
    })
  })

  it('cwdAllowed: denylist wins, allowlist restricts, empty lists are unrestricted', () => {
    const cfg = normalizeRecallConfig({ cwdAllowlist: ['/proj', '/docs'], cwdDenylist: ['/proj/secret'] })
    expect(cwdAllowed('/proj', cfg)).toBe(true)
    expect(cwdAllowed('/proj/secret', cfg)).toBe(false)
    expect(cwdAllowed('/elsewhere', cfg)).toBe(false)
    expect(cwdAllowed(null, cfg)).toBe(false) // allowlist set: unknown cwd not covered
    const open = normalizeRecallConfig()
    expect(cwdAllowed('/anywhere', open)).toBe(true)
    expect(cwdAllowed(null, open)).toBe(true)
    const denyOnly = normalizeRecallConfig({ cwdDenylist: ['/nope'] })
    expect(cwdAllowed('/fine', denyOnly)).toBe(true)
    expect(cwdAllowed('/nope', denyOnly)).toBe(false)
    expect(cwdAllowed(null, denyOnly)).toBe(true)
  })

  it('normalizes ranking fields (v0.5)', () => {
    expect(normalizeRecallConfig({ recencyHalfLifeDays: 30, pinnedCwds: ['/a', ''] })).toMatchObject({ recencyHalfLifeDays: 30, pinnedCwds: ['/a'] })
    expect(normalizeRecallConfig({ recencyHalfLifeDays: 0 }).recencyHalfLifeDays).toBeUndefined()
    expect(normalizeRecallConfig({ recencyHalfLifeDays: -5 }).recencyHalfLifeDays).toBeUndefined()
    expect(normalizeRecallConfig({ recencyHalfLifeDays: 99_999 }).recencyHalfLifeDays).toBe(3650)
    expect(normalizeRecallConfig({ recencyHalfLifeDays: Number.NaN }).recencyHalfLifeDays).toBeUndefined()
    expect(normalizeRecallConfig().pinnedCwds).toEqual([])
    expect(normalizeRecallConfig().recencyHalfLifeDays).toBeUndefined()
  })

  it('clamps cjkFallbackScanMax into 1..500', () => {
    expect(normalizeRecallConfig({ cjkFallbackScanMax: 0 }).cjkFallbackScanMax).toBe(1)
    expect(normalizeRecallConfig({ cjkFallbackScanMax: 99_999 }).cjkFallbackScanMax).toBe(500)
    expect(normalizeRecallConfig({ cjkFallbackScanMax: Number.NaN }).cjkFallbackScanMax).toBe(50)
  })
})
