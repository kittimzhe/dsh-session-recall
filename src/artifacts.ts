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
 */
import { join } from 'node:path'

/** Directory-scanning seam (injectable for tests). */
export type ListDir = (dir: string) => string[]

/** The fixed artifact directory dsh-session-export writes into. */
export const EXPORTED_ARTIFACTS_DIR = 'dsh-transcripts'

/** Match the per-session artifact name prefixes export produces. */
function isSessionArtifact(name: string, id8: string): boolean {
  return name.startsWith(`transcript-${id8}-`) || name.startsWith(`bundle-${id8}-`)
}

/**
 * Newest exported artifact path for a session (by its 8-char id prefix and
 * the cwd its artifacts live under), or null when none exists. A missing
 * `dsh-transcripts/` directory or an unreadable one is simply "no artifact".
 */
export function latestExportedArtifact(cwd: string | null, id8: string, listDir: ListDir): string | null {
  if (cwd == null || cwd === '' || id8 === '') return null
  const dir = join(cwd, EXPORTED_ARTIFACTS_DIR)
  let names: string[]
  try {
    names = listDir(dir)
  } catch {
    return null
  }
  const matches = names.filter((name) => isSessionArtifact(name, id8))
  if (matches.length === 0) return null
  // Order by the timestamp slug (YYYYMMDD-HHMMSS), not the whole name: a
  // `transcript-` name would otherwise always beat a newer `bundle-` one.
  const slug = (name: string): string => (name.match(/(\d{8}-\d{6})/)?.[1] ?? '')
  matches.sort((a, b) => slug(a).localeCompare(slug(b)) || a.localeCompare(b))
  const newest = matches[matches.length - 1]
  return newest === undefined ? null : join(dir, newest)
}
