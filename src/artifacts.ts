/**
 * Evidence handoff (#8): resolve the newest dsh-session-export artifact for
 * a recall hit, so the other session plugins can be pointed at it directly.
 *
 * dsh-session-export always writes into `<baseDir>/dsh-transcripts/` with
 * `transcript-<id8>-<YYYYMMDD-HHMMSS>.{md,html,json}` report files and
 * `bundle-<id8>-<YYYYMMDD-HHMMSS>.zip` bundles; `baseDir` defaults to the
 * session's own cwd, which is exactly the `cwd` a recall hit carries. The
 * timestamp slug sorts chronologically, so the lexicographically greatest
 * matching name is the newest export of that session.
 *
 * A hit with no exported artifact carries `null` — never a fabricated path.
 * A hit with one also carries `exportedAt` (P1 freshness): the filename slug
 * parsed in the local timezone, or the file's mtime when the slug is absent
 * or impossible — never a fabricated timestamp.
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { RecallReportFreshness } from './types.ts'

/** Directory-scanning seam (injectable for tests). */
export type ListDir = (dir: string) => string[]

/** File-metadata seam (injectable for tests): the mtime in ms, or null when unreadable. */
export type StatFile = (path: string) => { mtimeMs: number } | null

/** The fixed artifact directory dsh-session-export writes into. */
export const EXPORTED_ARTIFACTS_DIR = 'dsh-transcripts'

/** The `YYYYMMDD-HHMMSS` timestamp slug embedded in export names. */
const TIMESTAMP_SLUG_RE = /(\d{8}-\d{6})/

/** Match the per-session artifact name prefixes export produces. */
function isSessionArtifact(name: string, id8: string): boolean {
  return name.startsWith(`transcript-${id8}-`) || name.startsWith(`bundle-${id8}-`)
}

/**
 * Parse a `YYYYMMDD-HHMMSS` filename slug into Unix epoch milliseconds in the
 * local timezone (the export filenames are written in the exporting host's
 * local time). Null when the name carries no slug, or when the components are
 * impossible (month 13, Feb 31, hour 25): the `Date` constructor would silently
 * roll such values over instead of failing, so the round-trip check rejects
 * them before they masquerade as a real timestamp.
 */
export function parseSlugTimestamp(name: string): number | null {
  const slug = name.match(TIMESTAMP_SLUG_RE)?.[1]
  if (slug === undefined) return null
  const year = Number(slug.slice(0, 4))
  const month = Number(slug.slice(4, 6))
  const day = Number(slug.slice(6, 8))
  const hour = Number(slug.slice(9, 11))
  const minute = Number(slug.slice(11, 13))
  const second = Number(slug.slice(13, 15))
  const d = new Date(year, month - 1, day, hour, minute, second)
  if (
    d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day
    || d.getHours() !== hour || d.getMinutes() !== minute || d.getSeconds() !== second
  ) return null
  return d.getTime()
}

/** A resolved export: the newest artifact path plus the export time we can attribute to it. */
export interface ExportedArtifact {
  /** Newest artifact for the session, or null when none exists. */
  path: string | null
  /** Export time in Unix epoch ms — the filename slug (local tz) when parseable, else the file's mtime; null with no artifact or when neither works. */
  exportedAt: number | null
}

/** Default file-metadata seam: real mtime; unreadable paths yield null. */
export const defaultStatFile: StatFile = (path) => {
  try {
    return { mtimeMs: statSync(path).mtimeMs }
  } catch {
    return null
  }
}

/**
 * Newest exported artifact (path plus export time) for a session (by its
 * 8-char id prefix and the cwd its artifacts live under), or nulls when none
 * exists. A missing `dsh-transcripts/` directory or an unreadable one is
 * simply "no artifact". Selection order is unchanged from #8: by timestamp
 * slug first (so a newer `bundle-` beats any `transcript-`), name-lexicographic
 * as tie-break.
 */
export function latestExportedArtifactInfo(
  cwd: string | null,
  id8: string,
  listDir: ListDir,
  statFile: StatFile = defaultStatFile,
): ExportedArtifact {
  if (cwd == null || cwd === '' || id8 === '') return { path: null, exportedAt: null }
  const dir = join(cwd, EXPORTED_ARTIFACTS_DIR)
  let names: string[]
  try {
    names = listDir(dir)
  } catch {
    return { path: null, exportedAt: null }
  }
  const matches = names.filter((name) => isSessionArtifact(name, id8))
  if (matches.length === 0) return { path: null, exportedAt: null }
  // Order by the timestamp slug (YYYYMMDD-HHMMSS), not the whole name: a
  // `transcript-` name would otherwise always beat a newer `bundle-` one.
  const slug = (name: string): string => (name.match(TIMESTAMP_SLUG_RE)?.[1] ?? '')
  matches.sort((a, b) => slug(a).localeCompare(slug(b)) || a.localeCompare(b))
  const newest = matches[matches.length - 1]
  if (newest === undefined) return { path: null, exportedAt: null }
  const path = join(dir, newest)
  const exportedAt = parseSlugTimestamp(newest) ?? statFile(path)?.mtimeMs ?? null
  return { path, exportedAt: Number.isFinite(exportedAt) ? exportedAt : null }
}

/**
 * Newest exported artifact path for a session (by its 8-char id prefix and
 * the cwd its artifacts live under), or null when none exists. A missing
 * `dsh-transcripts/` directory or an unreadable one is simply "no artifact".
 * Compat wrapper: the path-only view of {@link latestExportedArtifactInfo}.
 */
export function latestExportedArtifact(cwd: string | null, id8: string, listDir: ListDir): string | null {
  return latestExportedArtifactInfo(cwd, id8, listDir).path
}

/**
 * Build the item-level freshness field from a resolved export and the hit's
 * session-activity timestamp (P1). Undeterminable values are OMITTED rather
 * than nulled so the result keeps validating against the output schema
 * (exportedAt/stale are declared optional); the whole field is absent when
 * the hit has no artifact, or when neither sub-value could be determined.
 *
 * `stale` is a one-sided verdict: `lastActivity` must be an event time
 * strictly greater than zero (the degraded raw scan stores missing event
 * timestamps as 0), and an event that occurred can never postdate the
 * session's true latest activity — so `stale: true` always certifies "the
 * session has events newer than this report", while `stale: false` (or an
 * omitted value) only means "no evidence of staleness".
 */
export function reportFreshnessField(info: ExportedArtifact, lastActivity: number): RecallReportFreshness | undefined {
  if (info.path == null) return undefined
  const out: RecallReportFreshness = {}
  if (info.exportedAt != null) {
    out.exportedAt = info.exportedAt
    if (Number.isFinite(lastActivity) && lastActivity > 0) out.stale = info.exportedAt < lastActivity
  }
  return Object.keys(out).length > 0 ? out : undefined
}
