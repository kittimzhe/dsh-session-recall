/**
 * Redaction for recall output text (snippets and titles).
 *
 * Three modes: `off` (default, unchanged), `mask` (placeholder), `hash`
 * (deterministic 8-hex digest — the same secret always hashes to the same
 * marker, so equal markers prove equality without revealing content).
 *
 * Pattern set covers the credential shapes that actually show up in agent
 * transcripts: bearer headers, prefixed API keys, private-key blocks, and
 * email addresses. It is best-effort, not a secrecy guarantee.
 */
import { createHash } from 'node:crypto'

export type RedactionMode = 'off' | 'mask' | 'hash'

export const REDACTION_MODES: readonly RedactionMode[] = ['off', 'mask', 'hash']

interface RedactionRule {
  readonly pattern: RegExp
  /** Placeholder used in `mask` mode. */
  readonly mask: string
}

const RULES: readonly RedactionRule[] = [
  // -----BEGIN X PRIVATE KEY----- … -----END X PRIVATE KEY-----
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, mask: '[PRIVATE KEY REDACTED]' },
  // Authorization: Bearer <token>
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, mask: 'Bearer [REDACTED]' },
  // Prefixed API keys: sk-, ghp_, gho_, github_pat_, xox[baprs]-, AKIA…
  {
    pattern:
      /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16})\b/g,
    mask: '[REDACTED]',
  },
  // Email addresses
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, mask: '[EMAIL]' },
]

function hashMarker(match: string): string {
  return `#${createHash('sha256').update(match).digest('hex').slice(0, 8)}`
}

/**
 * Redact one piece of text. Returns the new text plus how many replacements
 * happened (0 when mode is `off`).
 */
export function redactText(text: string, mode: RedactionMode): { text: string; count: number } {
  if (mode === 'off' || text.length === 0) return { text, count: 0 }
  let count = 0
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match) => {
      count += 1
      return mode === 'mask' ? rule.mask : hashMarker(match)
    })
  }
  return { text: out, count }
}

/** Normalize an untrusted config value into a valid mode (default `off`). */
export function normalizeRedactionMode(value: unknown): RedactionMode {
  return typeof value === 'string' && (REDACTION_MODES as readonly string[]).includes(value)
    ? (value as RedactionMode)
    : 'off'
}
