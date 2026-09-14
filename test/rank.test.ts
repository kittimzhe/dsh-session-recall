import { describe, expect, it } from 'vitest'
import { rankItems, rankingActive } from '../src/rank.ts'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

function item(cwd: string | null, matchTime: number) {
  return { cwd, createdAt: matchTime - DAY, bestMatch: { time: matchTime } }
}

describe('rankingActive', () => {
  it('is off without controls', () => {
    expect(rankingActive({})).toBe(false)
    expect(rankingActive({ recencyHalfLifeDays: 0 })).toBe(false)
    expect(rankingActive({ pinnedCwds: [] })).toBe(false)
  })

  it('is on with either control', () => {
    expect(rankingActive({ recencyHalfLifeDays: 30 })).toBe(true)
    expect(rankingActive({ pinnedCwds: ['/proj'] })).toBe(true)
  })
})

describe('rankItems', () => {
  it('returns the same order untouched without controls', () => {
    const items = [item('/a', NOW - 90 * DAY), item('/b', NOW - DAY)]
    expect(rankItems(items)).toEqual(items)
    expect(rankItems(items, {})).toEqual(items)
  })

  it('lets a newer match overtake an older, higher-ranked one under decay', () => {
    // Backend rank 1 is 90 days old (weight 1 × 0.125 = 0.125);
    // rank 2 is 1 day old (weight 0.5 × ~0.977 ≈ 0.49) → overtakes.
    const old = item('/a', NOW - 90 * DAY)
    const fresh = item('/b', NOW - 1 * DAY)
    const out = rankItems([old, fresh], { recencyHalfLifeDays: 30, now: NOW })
    expect(out).toEqual([fresh, old])
  })

  it('keeps a dominant rank ahead despite decay', () => {
    // Rank 1 fresh-ish (10 days, weight ≈ 0.79) vs rank 2 brand-new (≈0.5 × 1):
    // 0.79 > 0.5 → order unchanged.
    const first = item('/a', NOW - 10 * DAY)
    const second = item('/b', NOW)
    expect(rankItems([first, second], { recencyHalfLifeDays: 30, now: NOW })).toEqual([first, second])
  })

  it('floats pinned cwds to the top as a group', () => {
    const pinnedOld = item('/pinned', NOW - 300 * DAY)
    const pinnedNew = item('/pinned', NOW - DAY)
    const plain = item('/plain', NOW)
    const out = rankItems([plain, pinnedOld, pinnedNew], { pinnedCwds: ['/pinned'], recencyHalfLifeDays: 30, now: NOW })
    // Pinned group first (decay orders it inside the group), plain last.
    expect(out).toEqual([pinnedNew, pinnedOld, plain])
  })

  it('breaks ties stably by original position', () => {
    const a = item('/a', NOW - 5 * DAY)
    const b = item('/b', NOW - 5 * DAY)
    const out = rankItems([a, b], { recencyHalfLifeDays: 30, now: NOW })
    // Equal weights: rank 1 beats rank 2 by the 1/rank relevance term alone.
    expect(out).toEqual([a, b])
  })

  it('never mutates the input array', () => {
    const items = [item('/a', NOW - 90 * DAY), item('/b', NOW)]
    const snapshot = [...items]
    rankItems(items, { recencyHalfLifeDays: 30, now: NOW })
    expect(items).toEqual(snapshot)
  })

  it('falls back to createdAt when bestMatch.time is missing', () => {
    const byCreated = { cwd: '/a', createdAt: NOW - 90 * DAY, bestMatch: { time: 0 } }
    const fresh = item('/b', NOW - DAY)
    const out = rankItems([byCreated, fresh], { recencyHalfLifeDays: 30, now: NOW })
    expect(out).toEqual([fresh, byCreated])
  })
})
