# dsh-session-recall

[English](https://github.com/kittimzhe/dsh-session-recall/blob/main/README.md) | 中文

[![CI](https://github.com/kittimzhe/dsh-session-recall/actions/workflows/test.yml/badge.svg)](https://github.com/kittimzhe/dsh-session-recall/actions/workflows/test.yml) [![npm version](https://img.shields.io/npm/v/dsh-session-recall)](https://www.npmjs.com/package/dsh-session-recall) [![npm downloads](https://img.shields.io/npm/dm/dsh-session-recall)](https://www.npmjs.com/package/dsh-session-recall) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/kittimzhe/dsh-session-recall/blob/main/LICENSE)

DeepSeek Harness 的**确定性跨会话全文检索**插件：注册模型可调用的 `recall` 工具，让 agent 能**检索自己过往的会话原文**——"上周修的那个 bug"、"简历选的什么字体"——全部通过可信的 `ctx.sessionQuery` 缝完成。

## 安装

**环境要求**：Node.js 20 或 22 · 挂载了 `tools` 与 `sessionQuery` 服务的 DeepSeek Harness profile（官方 `web` / `agent` profile 均满足）。

```sh
dsh plugin --profile web add dsh-session-recall
```

## 试一次

首次搜索会自动构建持久化 FTS5 索引——无需额外步骤。会话里直接问：

```text
recall：上周给简历选的什么字体来着？
```

工具会按会话返回最强命中——每条带会话 id、尽力补全的标题、日期与命中摘录，在 Web UI 里渲染成原生搜索卡片。

## 会话工具链

| 插件 | 层 | 回答的问题 |
|---|---|---|
| [`dsh-session-export`](https://www.npmjs.com/package/dsh-session-export) | 证据层 | "这个会话到底发生了什么？" |
| **`dsh-session-recall`** | **记忆层** | **"我以前做过什么，在哪？"** |
| [`dsh-session-eval`](https://www.npmjs.com/package/dsh-session-eval) | 评测层 | "刚才的会话好不好？趋势在变好吗？" |

三者都通过同一个受信的 `ctx.sessionQuery` 接缝读取。

## 贡献

- **本地开发**：`npm ci && npm run typecheck && npm test && npm run bundle`（Node 20 或 22）。
- **源码入口**：[`src/tool.ts`](src/tool.ts)（工具契约）、[`src/rank.ts`](src/rank.ts)（新近度重排、置顶项目）、[`src/redact.ts`](src/redact.ts)（脱敏规则）、[`src/resilient.ts`](src/resilient.ts)（降级直扫）。完整源码地图见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- **当前缺口**：[#6](https://github.com/kittimzhe/dsh-session-recall/issues/6)（脱敏规则扩展）、[#7](https://github.com/kittimzhe/dsh-session-recall/issues/7)（同分排序钉死）——或浏览 [`good first issue` 标签](https://github.com/kittimzhe/dsh-session-recall/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)。
- **路线图**：[P2：证据联动——recall 命中携带 sessionId + 转录路径（#8）](https://github.com/kittimzhe/dsh-session-recall/issues/8)，验收标准见 issue；认领前请先留言避免撞车。
- **规矩**：行为变更必须带测试；文档必须 `README.md` 与 `README.zh.md` 同步改；版本发布由维护者执行。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 模型看到什么

```
recall({ query })                        → 每个会话返回最强命中事件，默认只搜当前项目
recall({ query, all_projects: true })    → 搜索本机全部会话
recall({ query, session_id })            → 只搜指定会话内的事件
recall({ query, limit, cursor })         → 翻页
```

每条命中带会话 id、标题（尽力补全）、日期、命中摘录；结果在 Web UI 里渲染成原生搜索卡片（`SearchMatchesResultView`）。因为 FTS 的 `unicode61` 分词器会把连续中文当成一个 token，短中文短语一旦嵌在长句里就匹配不到索引——所以 CJK 查询零命中时会自动回退到对会话文本的子串扫描（走 `sessionQuery.filterEvents` 的字面文本子句），空格拆出的每个词都必须命中，因此 `简历 模板` 也能找回 `简历模板`；hint 会说明这条回退路径是否命中。

## 授权边界（官方明确留给工具层的责任）

`sessionQuery` 是可信基础设施——它能读所有会话。所以本工具自己约束每一次调用：

- 默认注入 `sessionFilters: [{ kind: 'cwd', values: [<调用方 agent 的 cwd>] }]`——只搜同一项目目录下开始的会话；
- `all_projects: true` 才放宽到全机，且部署方可以用 `allowAllProjects: false` 直接禁用该参数。

## 项目定位

`dsh-session-recall` 是一个强调正确性与边界控制的**会话检索层**。

- 检索对象是原始会话日志，不是二次总结内容。
- 默认按 cwd 收敛权限范围，放宽范围必须显式声明。
- 追求可解释、可复现的检索行为，而不是"看起来更聪明"但有损的记忆抽取。

如果你要做长期记忆编排，请用记忆框架；如果你要做可审计、有权限边界的历史检索，请用本插件。

## 为什么做这个

官方 `@deepseek-ai/dsh-session-query` 的 README 自己列出了缺口：

> **No registries or model-facing tool** — … a model-facing tool is absent.（没有模型可调用的工具）
> **No caller authorization** — … a model tool or UI must constrain which sessions its caller may inspect.（调用方授权留给了未来的工具层）

而且官方 web profile 把 SQLite FTS5 后端配置成 `openAt: never` + 内存库——跨会话全文检索默认关闭，就算手动开启，索引也随进程退出而消失。

| | 官方 web 默认 | 装本插件后 |
|---|---|---|
| 模型可调用的搜索工具 | 无 | **`recall`** |
| FTS 索引 | `openAt: never`（关闭） | **开启（懒加载 `first-search`）** |
| 索引存储 | `:memory:`（重启即失） | **持久化 `<DSH_HOME>/session-recall/index.db`** |
| 调用方授权 | 留给调用方 | **默认按 cwd 限定当前项目，显式放宽** |

记忆类插件用 LLM 提取结构化笔记（有损、费 token）；`recall` 检索的是**原始对话记录**——零提取、零损失、装完当天就能搜全部历史。

## 竞品视角

| 能力重心 | 记忆框架类插件 | 通用检索类插件 | `dsh-session-recall` |
|---|---|---|---|
| 检索对象 | 推导后的记忆结构 | 视实现而定 | **原始会话事件文本** |
| 范围控制 | 框架内约束 | 常较粗粒度 | **默认 cwd + 显式 `all_projects` 闸门** |
| CJK 体验 | 视实现而定 | 常受分词限制 | **FTS + CJK 零命中子串回退** |
| 输出契约 | 框架内部格式 | 不统一 | **类型化 `recall` 结果 + 稳定 hint** |

命名与边界说明（2026-09）：

- 本插件与 **`dsh-recall-plugin` 无关**——那是"撤回消息"插件（把工作区与对话回退到某条消息发出之前）。
- 本插件是 **`dsh-recall` 的后继者**——后者是更早的会话检索插件（最后更新 2026-08-21）；本插件在其方向上续写：持久 FTS5 索引、中文回退、审批闸门、谱系鉴权。
- 本插件与 **`dsh-mnemon` 等记忆框架互补**：它们做写入侧的记忆编排；本插件保持只读检索层，只读原始会话日志，不写任何记忆存储。

## 安装（out-of-tree 插件）

从 npm：

```sh
dsh plugin --profile web add dsh-session-recall
```

或从 GitHub：

```sh
dsh plugin --profile web add github:kittimzhe/dsh-session-recall
```

然后在 profile 的 `cordis.patch.yml` 里加入：

```yaml
- insert:
    - id: session-recall
      name: 'dsh-session-recall'
```

插件自带 bundle patch 会开启持久化索引（`session-query-sqlite` → `openAt: first-search`、`path: <DSH_HOME>/session-recall/index.db`）；如果你自己覆盖过该行，请保留这两个值。

## 配置

插件行 config（全部可选）：

```yaml
- id: session-recall
  name: 'dsh-session-recall'
  config:
    allowAllProjects: true  # 是否允许工具的 all_projects 参数
    defaultLimit: 5         # 模型省略 limit 时的页大小（1..10）
    maxLimit: 10            # 最大页大小（1..25）
    cjkHint: true           # CJK 零命中的提示开关
    cjkFallback: true       # CJK 零命中 → 对会话文本做精确子串扫描
    cjkFallbackScanMax: 50  # 跨会话回退时最多扫描的会话数（1..500）
    rawScanFallback: true        # 降级模式：索引整体故障时直扫会话日志
    rawScanMaxSessions: 200      # 降级扫描预算：访问会话数（1..2000）
    rawScanMaxDurationMs: 20000  # 降级扫描墙钟上限（1000..120000）
    rawScanMaxSessionBytes: 8388608  # 降级扫描单日志压缩体积上限（字节）
```

## 降级模式（v0.7.5）

当会话索引本身故障——最典型的是 `SESSION_QUERY_PERSISTENCE_FAILED`：一个无法迁移的会话工件让**所有**索引查询全部失败（v0→v1 迁移闸门拒绝 `subagent/descriptor` version 2，见 [deepseek-harness 讨论 #7995](https://github.com/deepseek-ai/deepseek-harness/discussions/7995)）——`recall` 工具降级为直接扫描持久化会话日志（`$DSH_HOME/sessions`），而不是让整个调用失败：

- **天生容错**：日志用内置的纯 JS zstd 解码器解压、逐行解析；坏行或不可读日志跳过并计数，绝不致命。上游迁移器认不了的那个会话形状，在这里照样可搜。
- **算得起**：会话 header 走流式解压（毫秒级），cwd/时间/session_id 过滤先于任何全量解压；字节级关键词预过滤让不含关键词的日志免去逐行解析；墙钟预算（默认 20 秒）与单日志体积上限（默认压缩后 8 MiB——纯 JS zstd 解压约 2 MB/s）保证工具响应性。会话按最新优先访问，预算用尽时结果会说明覆盖了哪部分。
- **诚实**：结果带 `diagnostics.source: "raw-scan"` 和降级来源提示（不可读/超限跳过数、部分覆盖说明）。未落盘的活跃会话不包含在内。

设 `rawScanFallback: false` 可恢复 v0.7.5 之前的快速失败行为。

## 失败行为

所有失败都返回友好的 `hint` 而不是裸异常：索引未开启会说明需要哪两个配置键；游标失效会告诉模型不带游标重开一次；`session_id` 不存在会建议先做跨会话搜索。标题补全是尽力而为——标题批量读取失败只降级为"无标题"行，绝不让搜索失败。

## 范围策略与脱敏（v0.4）

部署级权限控制——模型能读回什么，由配置说了算：

| 配置 | 取值 | 默认 | 效果 |
|---|---|---|---|
| `redactionMode` | `off` / `mask` / `hash` | `off` | 对标题与摘录中疑似密钥的文本（Bearer 头、前缀式 API key、私钥块、邮箱）脱敏。`hash` 用确定性摘要 `#xxxxxxxx`（同一密钥同一标记）保持可比性。结果带 `redacted` 计数。 |
| `cwdAllowlist` | 路径列表 | （无） | 只检索这些目录下启动的会话；当前项目目录本身也必须在列表内。 |
| `cwdDenylist` | 路径列表 | （无） | 这些目录永不检索。deny 优先于 allow。 |
| `recencyHalfLifeDays` | 天数（如 `30`） | （关闭） | 跨会话命中重排：后端名次 × 命中时间上的指数衰减。不设或 `<= 0` 保持后端顺序。按结果页生效。 |
| `pinnedCwds` | 路径列表 | （无） | 这些项目目录的会话作为一组排在最前。 |
| `allProjectsPolicy` | `allow` / `deny` / `confirm` | `allow` | `deny` 忽略 `all_projects` 并向模型说明；`confirm` 走官方 `@deepseek-ai/dsh-user-approval` 接缝向用户请求批准——无应答者时 fail-closed。 |

三道闸门统一作用于跨会话命中、CJK 回退扫描和 `session_id` 直读——没有绕行路径。

每个结果还带 `diagnostics` 对象（v0.5）：命中由哪个引擎产生（`fts` / `cjk-fallback` / `session-scan`）、回退扫描访问了几个会话（对照预算）、是否做了重排——让调用方知道「为什么是这些结果」。

启用排序后，置顶项目优先，其次按衰减后的相关性排序。分数相同时先按会话创建时间倒序，再按会话 ID 的字典序排列。排序仅作用于当前页；关闭排序选项时保留后端顺序。对于缺少 ID 且分数、创建时间均相同的条目，保留输入顺序。

## 已知限制

- 启动后第一次搜索会扫全量日志建索引（工具描述里已警告模型）；之后增量更新。
- `unicode61` 按完整 token/短语匹配，不支持子串——`AI` 匹配不到 `BRAID`。CJK 查询零命中时会回退到子串扫描（`filterEvents`），空格分隔的各词按 AND 语义都必须命中，因此 `简历 模板` 也能找回 `简历模板`；hint 会说明是否命中。
- 索引文件单进程独占（官方后端的单写者 SQLite 约束）。
- 默认情况下命中结果按原文照摘——脱敏自 v0.4 起为**可选项**（`redactionMode: 'mask' | 'hash'`，见「范围策略与脱敏」一节）。`redactionMode: 'off'`（默认）时，更早会话里粘贴过的 token 或敏感路径仍可能被检索出来；默认 cwd 收窄与 `allowAllProjects: false` 仍是基础防线。

## 基准

真机 headless profile 实测（手头机器为 Node 25、Apple Silicon、暖文件缓存）——数字仅供参考，不是 CI 门槛；受支持并经 CI 测试的版本仍是 Node 20 与 22。

| 语料 | |
|---|---|
| 会话数 | 31 |
| 日志总事件 | 187,706（解压后约 104 MB，zstd 压缩后 49.7 MB） |
| 已索引文本事件 | 8,187 |
| FTS 索引体积 | 15 MB |

| 查询 | 命中 | 暖查询耗时（FTS5 `MATCH`） |
|---|---|---|
| 英文 `font` | 100（上限） | 1.1 ms |
| 英文 `resume template` | 46 | 0.6 ms |
| 中文 `字体` | 29 | 0.3 ms |
| 中文 `简历 模板` | 10 | 0.1 ms |

暖查询（索引已在盘上）耗时 0.1～1.5 ms。冷启动首建：扫描 49.7 MB 日志约 4.7 s（解压 + 逐行扫描），把 8,187 条文本事件写入全新 FTS5 表约 190 ms；全新 profile 的首次 `recall` 在工具 10 s 超时内完成。此后重启复用持久化索引、增量 reconcile。

## 开发

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run bundle      # tsdown → lib/
```

## 许可

[MIT](https://github.com/kittimzhe/dsh-session-recall/blob/main/LICENSE)

## 社区

- [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md)
