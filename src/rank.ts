/**
 * Result re-ranking for cross-session recall hits.
 *
 * The FTS backend returns hits in its own relevance order but exposes no
 * numeric score. Two optional, composable controls re-rank that order:
 *
 * - **Recency decay** (`recencyHalfLifeDays`): each hit's weight is its
 *   backend rank position (1/rank, a monotone relevance proxy) multiplied by
 *   an exponential decay `0.5^(ageDays / halfLife)` over the match time. A hit
 *   one half-life old needs roughly twice the relevance rank to keep its
 *   place — "the bug we fixed last week" beats an older, equally-ranked match.
 *
 * - **Session pinning** (`pinnedCwds`): hits from pinned project directories
 *   float to the top as a group, preserving their internal order.
 *
 * Sorting is stable (ties keep backend order) and per result page: the
 * backend pages lazily, so ranking is applied to the page in hand — a
 * documented limitation, not a global rerank.
 *
 * @module dsh-session-recall/rank
 */

/** The slice of a recall item ranking needs (structural, for testability). */
export interface RankableItem {
  readonly cwd: string | null
  readonly createdAt: number
  readonly bestMatch: { readonly time: number }
}

export interface RankingOptions {
  /** Exponential recency half-life in days; unset disables decay re-ranking. */
  readonly recencyHalfLifeDays?: number
  /** Project directories whose hits float to the top. */
  readonly pinnedCwds?: readonly string[]
  /** Clock override for tests; defaults to Date.now(). */
  readonly now?: number
}

/** True when any ranking control is active. */
export function rankingActive(options: RankingOptions): boolean {
  return (options.recencyHalfLifeDays ?? 0) > 0 || (options.pinnedCwds?.length ?? 0) > 0
}

/** One item's decayed weight; rank positions are 1-based. */
function weight(item: RankableItem, rank: number, halfLifeDays: number | undefined, now: number): number {
  const relevance = 1 / rank
  if (halfLifeDays === undefined || halfLifeDays <= 0) return relevance
  const matchTime = item.bestMatch.time > 0 ? item.bestMatch.time : item.createdAt
  const ageDays = Math.max(0, (now - matchTime) / 86_400_000)
  return relevance * Math.pow(0.5, ageDays / halfLifeDays)
}

/**
 * Re-rank one page of hits. Returns the same item references in a new order;
 * the input is never mutated. With no controls active the input order is
 * returned unchanged.
 */
export function rankItems<T extends RankableItem>(items: readonly T[], options?: RankingOptions): T[] {
  if (options === undefined || !rankingActive(options)) return [...items]
  const now = options.now ?? Date.now()
  const halfLife = options.recencyHalfLifeDays
  const pinned = new Set(options.pinnedCwds ?? [])
  const decorated = items.map((item, index) => ({
    item,
    index,
    pinned: item.cwd !== null && pinned.has(item.cwd),
    score: weight(item, index + 1, halfLife, now),
  }))
  decorated.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    return a.index - b.index
  })
  return decorated.map((entry) => entry.item)
}
