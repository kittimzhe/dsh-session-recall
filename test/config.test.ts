import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { cwdAllowed, normalizeCwdPath, normalizeRecallConfig } from '../src/config.ts'

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
      callerTreeOnly: true,
      rawScanFallback: true,
      rawScanMaxSessions: 200,
      rawScanMaxDurationMs: 20000,
      rawScanMaxSessionBytes: 8388608,
      lineageFailurePolicy: 'open',
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
      callerTreeOnly: true,
      rawScanFallback: true,
      rawScanMaxSessions: 200,
      rawScanMaxDurationMs: 20000,
      rawScanMaxSessionBytes: 8388608,
      lineageFailurePolicy: 'open',
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

  it('defaults lineageFailurePolicy to open and rejects unknown values (v0.8.3)', () => {
    expect(normalizeRecallConfig().lineageFailurePolicy).toBe('open')
    expect(normalizeRecallConfig({ lineageFailurePolicy: 'closed' }).lineageFailurePolicy).toBe('closed')
    expect(normalizeRecallConfig({ lineageFailurePolicy: 'maybe' as never }).lineageFailurePolicy).toBe('open')
    expect(normalizeRecallConfig({ lineageFailurePolicy: undefined }).lineageFailurePolicy).toBe('open')
  })

  it('normalizes configured cwd list entries at load time (v0.8.3)', () => {
    expect(normalizeRecallConfig({ cwdAllowlist: ['/proj/'], cwdDenylist: ['/proj/secret/'] })).toMatchObject({
      cwdAllowlist: ['/proj'],
      cwdDenylist: ['/proj/secret'],
    })
    // Relative entries resolve against the host process cwd, deterministically.
    expect(normalizeRecallConfig({ cwdAllowlist: ['rel/proj'] }).cwdAllowlist).toEqual([resolve('rel/proj')])
    expect(normalizeRecallConfig({ cwdDenylist: ['../escape'] }).cwdDenylist).toEqual([resolve('../escape')])
  })

  it('cwdAllowed: trailing separators are equivalent on both sides (v0.8.3)', () => {
    const cfg = normalizeRecallConfig({ cwdAllowlist: ['/proj/'], cwdDenylist: ['/proj/secret/'] })
    expect(cwdAllowed('/proj', cfg)).toBe(true)
    expect(cwdAllowed('/proj/', cfg)).toBe(true) // allowlist entry had the slash
    expect(cwdAllowed('/proj/secret', cfg)).toBe(false)
    expect(cwdAllowed('/proj/secret/', cfg)).toBe(false) // denylist entry had the slash
    const denyOnly = normalizeRecallConfig({ cwdDenylist: ['/nope/'] })
    expect(cwdAllowed('/nope', denyOnly)).toBe(false)
    expect(cwdAllowed('/nope/', denyOnly)).toBe(false)
    expect(cwdAllowed('/nope/x', denyOnly)).toBe(true)
  })

  it('cwdAllowed: `..` segments resolve before allowlist/denylist matching (v0.8.3)', () => {
    const cfg = normalizeRecallConfig({ cwdAllowlist: ['/proj'], cwdDenylist: ['/proj/secret'] })
    // Hit: /docs/../proj IS /proj — inside the allowlist despite the traversal shape.
    expect(cwdAllowed('/docs/../proj', cfg)).toBe(true)
    // Hit (deny): /proj/../proj/secret IS /proj/secret — the traversal must not dodge the denylist.
    expect(cwdAllowed('/proj/../proj/secret', cfg)).toBe(false)
    // Miss: /proj/../elsewhere resolves OUTSIDE the allowlist.
    expect(cwdAllowed('/proj/../elsewhere', cfg)).toBe(false)
  })

  it('normalizeCwdPath strips trailing separators but never shrinks the root', () => {
    expect(normalizeCwdPath('/proj/')).toBe('/proj')
    expect(normalizeCwdPath('/')).toBe('/')
    expect(normalizeCwdPath('')).toBe('')
    expect(normalizeCwdPath('/proj//')).toBe('/proj')
  })
})
