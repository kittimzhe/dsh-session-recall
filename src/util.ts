/** Small pure helpers shared by the recall tool and its renderers. */

/** Clamp `n` into the inclusive `[lo, hi]` range. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * Short session slug for humans: strips the web-profile `session-` prefix and
 * keeps the first 8 characters of what remains.
 */
export function id8(sessionId: string): string {
  const stripped = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId
  return stripped.slice(0, 8)
}

/** Format Unix epoch milliseconds as a local `YYYY-MM-DD` date. */
export function formatDate(epochMs: number): string {
  const d = new Date(epochMs)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const CJK_RE = /[\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{F900}-\u{FAFF}\u{3040}-\u{30FF}\u{AC00}-\u{D7AF}\u{3000}-\u{303F}]/u

/** Whether `text` contains at least one CJK ideograph, kana, or hangul character. */
export function hasCJK(text: string): boolean {
  return CJK_RE.test(text)
}

/** Collapse every whitespace run and trim; used to normalize model-supplied queries. */
export function normalizeQuery(text: string): string {
  return text.trim().replaceAll(/\s+/g, ' ')
}

/** First line of `text` with control characters stripped, clipped to `limit` code points. */
export function firstLineClipped(text: string, limit: number): string {
  const line = text.split('\n', 1)[0] ?? ''
  let out = ''
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20) continue
    out += ch
    if (out.length >= limit) break
  }
  return out
}

/**
 * Single-line snippet clipped around the first case-insensitive occurrence of
 * `query`, with ellipses at either end when text was cut. Falls back to a
 * head clip when the query is empty or absent.
 */
export function snippetAround(text: string, query: string, limit: number): string {
  const flat = text.replaceAll(/\s+/g, ' ')
  const q = normalizeQuery(query).toLowerCase()
  const idx = q === '' ? -1 : flat.toLowerCase().indexOf(q)
  if (idx < 0) return flat.slice(0, limit)
  const pad = Math.floor(limit / 3)
  const start = Math.max(0, idx - pad)
  const end = Math.min(flat.length, start + limit)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}
