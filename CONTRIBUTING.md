# Contributing / 贡献指南

Thanks for your interest in improving `dsh-session-recall`! / 感谢你对 `dsh-session-recall` 的贡献兴趣！

## Source map / 源码地图

Start here before your first PR. / 第一次 PR 前先看这张表。

| Good first reads / 适合先看的文件 | Good first changes / 适合第一次 PR 的位置 |
|---|---|
| [`src/tool.ts`](src/tool.ts) — tool contract, arg handling / 工具契约与参数处理 | Argument validation, hints + tests / 参数校验、提示与测试 |
| [`src/rank.ts`](src/rank.ts) — recency re-ranking, pinned cwds / 新近度重排与置顶 | Tie-break order, ranking knobs + tests / 同分排序、排序参数与测试 |
| [`src/redact.ts`](src/redact.ts) — redaction patterns / 脱敏规则 | New pattern categories + tests / 新规则类别与测试 |
| [`src/resilient.ts`](src/resilient.ts) — degraded raw-scan mode / 降级直扫模式 | Scan budget behavior, diagnostics + tests / 扫描预算行为、诊断与测试 |

[Issues labeled `good first issue`](https://github.com/kittimzhe/dsh-session-recall/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) name the file to change, the definition of done, and the test to add. / 带 `good first issue` 标签的 issue 会写明改哪个文件、怎样算做完、要补什么测试。

## Reporting issues / 提交 issue

1. Search existing issues first — avoid duplicates. / 先搜索已有 issue，避免重复。
2. Include: plugin version (`npm ls dsh-session-recall`), DSH version, Node version (20/22), and a minimal reproduction. / 请附上：插件版本、DSH 版本、Node 版本（20/22）与最小复现步骤。
3. For security vulnerabilities, do **not** open a public issue — see [SECURITY.md](SECURITY.md). / 安全漏洞请勿开公开 issue，见 [SECURITY.md](SECURITY.md)。

## Pull requests / PR 规范

- One PR per concern; keep the diff reviewable. / 一个 PR 只做一件事，保持可审阅的 diff。
- Conventional commit titles (`feat:` / `fix:` / `docs:` / `chore:` / `test:` / `ci:`). / 使用约定式提交前缀。
- Behavior changes require tests; docs changes require no test but must update **both** `README.md` and `README.zh.md` in sync. / 行为变更必须带测试；文档变更无需测试，但 `README.md` 与 `README.zh.md` 必须同步修改。
- Do not hardcode test counts in docs; they go stale. / 文档中不要写死测试数量，会过期。
- CI (Node 20/22) must be green before review. / 合入前 CI（Node 20/22）必须全绿。

## Development setup / 开发环境

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run bundle      # tsdown -> lib/
```

Releases are cut by the maintainer (version bump + tag + GitHub Release + `npm publish`). / 版本发布由维护者执行（版本号 + tag + GitHub Release + `npm publish`）。

## License / 许可

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE). / 提交贡献即表示你同意贡献内容以 [MIT 许可](LICENSE)发布。
