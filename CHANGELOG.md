# Changelog

## 0.5.1 — 2026-09-14

- Tool description now points at the evidence handoff: call `transcript_export` (from dsh-session-export, when composed) with a hit sessionId to save a full report. No code changes.

## 0.5.0 — 2026-09-14

Ranking controls + query diagnostics: the retrieval layer explains itself.

- **`recencyHalfLifeDays`** — re-rank cross-session hits with exponential recency decay: backend rank (1/rank relevance proxy) × `0.5^(ageDays/halfLife)` over the match time. Unset or `<= 0` keeps backend order. Applies per result page (the backend pages lazily; a documented limitation).
- **`pinnedCwds`** — sessions from pinned project directories float to the top as a group, stable inside the group.
- **Diagnostics in every result** — new `diagnostics` field: `source` (`fts` / `cjk-fallback` / `session-scan`), `scanned` + `scanBudget` when a fallback scan ran, and `ranked`. Null when the call failed before searching. The text projection adds a compact `Diagnostics:` line when there is something to say.
- Ranking is pure and exported (`rankItems` / `rankingActive`) for reuse and testing.

## 0.4.1 — 2026-09-13

- Fix dead relative links on the npm readme: language switch and LICENSE links now point at absolute GitHub URLs.

## 0.4.0 — 2026-09-13

Scope policy + redaction: the retrieval layer gets the same deployment controls an evidence tool needs.

- **`redactionMode` (`off`/`mask`/`hash`)** — redact secret-looking text (bearer headers, prefixed API keys, private-key blocks, emails) in snippets and titles. `mask` replaces with placeholders; `hash` replaces with a deterministic `#xxxxxxxx` digest so equal secrets stay comparable without being readable. Every result now carries a `redacted` count, plus a model-facing hint when redaction fired.
- **cwd allowlist / denylist** — `cwdAllowlist` restricts recall to the listed project directories; `cwdDenylist` excludes specific ones (deny wins). Applies to cross-session hits, the CJK fallback scan, `session_id` reads, and the calling cwd itself.
- **`allProjectsPolicy` (`allow`/`deny`/`confirm`)** — the `all_projects` argument can now be ignored with an explanation (`deny`) or gated behind the official `@deepseek-ai/dsh-user-approval` seam (`confirm`). Fail-closed: no approval service, no agent, or a throwing answerer all degrade to a cwd-scoped search with a hint.
- Tool description now tells the model about redaction markers and the possible approval gate.
- Output schema: new required integer field `redacted`.

## 0.3.0 — 2026-09-12

- CJK substring fallback for zero-hit FTS queries, with ANDed space-separated terms for multi-word recovery.

## 0.2.0 — 2026-09-11

- Measured benchmark (corpus scale, warm latency, cold build) in README.

## 0.1.0 — 2026-09-10

- Initial release: model-facing `recall` tool over `ctx.sessionQuery`, cwd-scoped by default, typed output contract, presentation card.
