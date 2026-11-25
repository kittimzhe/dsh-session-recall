## 0.9.0 — 2026-11-25

Export-report freshness (#8 follow-up): recall now answers "how stale is the attached evidence report?", not just "does one exist" — a model that sees the staleness marker has a concrete reason to re-run `/transcript` before citing the report.

- Every hit with an `artifactPath` gains optional `reportFreshness`: `exportedAt` (Unix ms — parsed from the report filename's `YYYYMMDD-HHMMSS` slug in the local timezone, falling back to the file's mtime when the slug is absent or impossible) and `stale` (`exportedAt < bestMatch.time`). `stale` compares against the hit's best-matching event time — the only per-session activity timestamp the search seam already carries on every result path (`SessionHeader` exposes `createdAt` only, `listSessions` has no `lastActivity`, and probing each session's newest event would cost one extra engine round trip per hit); since a matched event can never postdate the session's true latest activity, `stale: true` always certifies "the session has newer events", while `stale: false`/omitted only means "no evidence of staleness" — no `createdAt` fallback (unlike the ranking recency input) because a false fresh is worse than an unknown. Undeterminable values are omitted rather than nulled, and the field is absent without a report, so pre-0.9 results keep validating against the declared output schema.
- Text projection: a stale hit's `· report …` line gains `(report is stale: session has newer events; re-run /transcript <sessionId> to refresh)`; fresh and undeterminable reports render exactly as before. The tool description now explains the field so the model knows to refresh before citing.
- `latestExportedArtifact` keeps its signature (now a path-only view of the new `latestExportedArtifactInfo`); artifact selection order is unchanged (timestamp slug first, name tie-break).
- README/README.zh document the field and its one-sided semantics in the Evidence handoff section.
- Tests 144 → 168, tsc clean.

## 0.8.3 — 2026-11-25

Quality & hardening patch: the CJK fallback stops leaking its budget, cwd matching closes path-shape bypasses, and lineage authorization gains an optional fail-closed mode.

- **CJK fallback scan rework** (cross-session path): candidate sessions are now sorted by `createdAt` (newest first, stable) *before* the `cjkFallbackScanMax` budget is applied — stale sessions can no longer crowd recent history out of the scan; `filterEvents` probes run with bounded concurrency (8 per batch) instead of one-by-one; and the full budget (or the whole candidate list) is scanned before results are truncated to `limit`, so a page full of hits no longer stops the pass while the budget is unspent. `diagnostics` gained an optional `truncated` flag reporting when that truncation cut collected matches; `scanned`/`scanBudget` keep their meanings (visited sessions vs budget).
- **cwd path normalization**: allowlist/denylist matching now compares normalized paths (`path.resolve` + trailing-separator strip) on both sides — `/proj/` and `/proj` are the same directory, and `/proj/../secret` can no longer dodge a denylist (nor fake its way into an allowlist). The same normalization covers the equivalent cwd comparisons everywhere: cross-session hit filtering, the CJK fallback scan (including its cwd scoping against the calling session), `session_id` reads, the calling-cwd gate, and the degraded raw scan's scope check; the backend `sessionFilters` value is normalized too. Config list entries are normalized at load; relative entries resolve against the host process cwd (deterministic, since tool construction precedes any call context).
- **`lineageFailurePolicy` (`open`/`closed`, default `open`)** — what happens when lineage tracing fails while `callerTreeOnly` is on. `open` (default) keeps the pre-0.8.3 fail-open behavior; `closed` refuses the results — cross-session and `session_id` alike — with a model-facing hint instead of risking over-broad access.
- Tests 130 → 144, tsc clean.

## 0.8.2 — 2026-11-23

Peer-range compatibility release (no behavior change).

- `@deepseek-ai/dsh-*` peers widened to `^0.1.5-rc.3 || ^0.2.0 || >=0.2.2-rc.1`, covering the full 0.2.2 release-candidate train (rc.1–rc.5, the current `latest`) and every later 0.2.x stable. rc.2–rc.5 shipped search and chat-import features with no session-format changes, so the rc.1-validated runtime remains the baseline.

## 0.8.1 — 2026-11-05

Peer-range compatibility release (no behavior change).

- `@deepseek-ai/dsh-*` peers widened to `^0.1.5-rc.3 || ^0.2.0 || 0.2.2-rc.1` and `@deepseek-ai/cordis` to `^4.0.2`, ahead of the DSH 0.2.2 release train.
- Verified against `@deepseek-ai/*@0.2.2-rc.1` in a scratch install (including the new `dsh-session-title` transitive peer): full suite 130/130 green, typecheck clean. DSH profiles remain unaffected either way (the host satisfies peers via its shadow-scoped runtime).

## 0.8.0 — 2026-11-04

Evidence handoff (#8): every hit is directly actionable by the other session plugins.

- Each hit now carries `artifactPath` — the newest report `dsh-session-export` wrote for that session under its `dsh-transcripts/` directory (`transcript-<id8>-*` or `bundle-<id8>-*`, newest by timestamp slug wins); `null` when no export exists, never a fabricated path.
- The text projection prints the full `sessionId` on its own `session …` line (the short `id8` stays in the label), so `/transcript --id` and `/eval --id` can be invoked without copying ids by hand; the artifact path rides the same line as `· report <path>`.
- Ordering by timestamp slug, not whole filename — a newer `bundle-` artifact is no longer shadowed by any `transcript-` name.
- Tool description now points at both downstream tools; README/README.zh document the fields with a worked recall → /transcript → /eval example.

## 0.7.9 — 2026-10-23

Test-only patch: redaction coverage for AWS key ids and Slack tokens (#6).

- Both shapes have been covered by the rule table since v0.4.0 (97c79ad); this release adds the missing tests — mask mode asserts `xoxb-`/`xoxa-`/`xoxp-` bodies and a fresh `AKIA…` key never appear in output, hash mode pins the deterministic marker without leaking the secret.
- No runtime changes; the pattern set and its behavior are untouched.

## 0.7.8 — 2026-10-10

Deterministic equal-score ordering (via #9 by varshith84).

- Sessions with equal recall scores now sort by session date (newest first), then session ID (lexical), with the pre-existing index order as a stable fallback — equal-score ties no longer shuffle between runs.
- First external contribution to land in the package.

## 0.7.7 — 2026-10-03

Docs polish round (no runtime changes).

- Install detail completed: requirements, GitHub install route, the `cordis.patch.yml` row.
- Contributor block links the open-gap issues directly; sample outputs aligned with the shipped version.
- Community section; bilingual issue templates (`.github/ISSUE_TEMPLATE/`).
- English/Chinese README sections kept in sync.

## 0.7.6 — 2026-10-02

Contributor-first docs release.

- README (en/zh): one-liner → install → try-once → toolchain table → 6-line contributor block; config/competitive/benchmark sections moved below the fold.
- Roadmap P2 "evidence handoff" now links #8 with acceptance criteria and a claim-first rule.
- Benchmark clarifies Node 25 was the machine at hand; supported and CI-tested versions remain 20/22.
- CONTRIBUTING gains a source map; docs no longer hardcode test counts.
- CHANGELOG backfilled for 0.7.1–0.7.5 (missing entries below).
- README/CONTRIBUTING local-dev commands aligned on `npm ci`; README.zh.md section order synced with English; GitHub issue templates added.

## 0.7.5 — 2026-09-27

Degraded raw-scan mode when the session index is down — tolerant, budgeted, honest (see README "Degraded mode").

## 0.7.4 — 2026-09-26

Optional approval seam via `ctx.get`; peers aligned with harness 0.1.5-rc.3.

## 0.7.3 — 2026-09-22

Docs fix: the requirements line — this plugin injects `tools` + `sessionQuery`, not `commands`.

## 0.7.2 — 2026-09-21

Governance docs (CONTRIBUTING/SECURITY/CoC), CI bundle/pack verification, quick-start docs, npm repository metadata, clock-derived test fixtures.

## 0.7.1 — 2026-09-19

CI workflow (typecheck + vitest, Node 20/22) with badge; docs clarifying the relationship to official plugins and near-name packages.

## 0.7.0 — 2026-09-15

Search dimensions: time window, tool filter, error filter.

- `since_days` (int): only sessions/entries newer than N days (post-filter on createdAt/bestMatch.time).
- `tools` (string[]): only tool events whose snippet mentions one of the given tool names (substring, case-insensitive).
- `errors_only` (bool): only failed tool calls — tool results whose snippet carries `[error]`/`error`/`failed`.
- Filters compose with each other and with existing scopes (cwd, all_projects, caller lineage); applied on both the single-session and cross-session paths, including the CJK fallback.
- 4 new tests. 107/107 total, tsc clean.

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
