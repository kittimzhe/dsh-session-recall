# Changelog

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
