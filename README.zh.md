# dsh-session-recall

[English](README.md) | 中文

[![npm version](https://img.shields.io/npm/v/dsh-session-recall)](https://www.npmjs.com/package/dsh-session-recall) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DeepSeek Harness 的跨会话全文回忆插件：注册模型可调用的 `recall` 工具，让 agent 能**检索自己过往的会话原文**——"上周修的那个 bug"、"简历选的什么字体"——全部通过可信的 `ctx.sessionQuery` 缝完成。

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

## 模型看到什么

```
recall({ query })                        → 每个会话返回最强命中事件，默认只搜当前项目
recall({ query, all_projects: true })    → 搜索本机全部会话
recall({ query, session_id })            → 只搜指定会话内的事件
recall({ query, limit, cursor })         → 翻页
```

每条命中带会话 id、标题（尽力补全）、日期、命中摘录；结果在 Web UI 里渲染成原生搜索卡片（`SearchMatchesResultView`）。CJK 查询零命中时会给出分词提示：FTS 的 `unicode61` 分词器把连续中文当成一个 token，工具会教模型改用空格分隔的短关键词重试。

## 授权边界（官方明确留给工具层的责任）

`sessionQuery` 是可信基础设施——它能读所有会话。所以本工具自己约束每一次调用：

- 默认注入 `sessionFilters: [{ kind: 'cwd', values: [<调用方 agent 的 cwd>] }]`——只搜同一项目目录下开始的会话；
- `all_projects: true` 才放宽到全机，且部署方可以用 `allowAllProjects: false` 直接禁用该参数。

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
    cjkHint: true           # CJK 零命中的分词提示开关
```

## 失败行为

所有失败都返回友好的 `hint` 而不是裸异常：索引未开启会说明需要哪两个配置键；游标失效会告诉模型不带游标重开一次；`session_id` 不存在会建议先做跨会话搜索。标题补全是尽力而为——标题批量读取失败只降级为"无标题"行，绝不让搜索失败。

## 已知限制

- 启动后第一次搜索会扫全量日志建索引（工具描述里已警告模型）；之后增量更新。
- `unicode61` 按完整 token/短语匹配，不支持子串——`AI` 匹配不到 `BRAID`。CJK 零命中提示缓解了最坏情况；基于 `filterEvents()` 的子串兜底是 v2 方向。
- 索引文件单进程独占（官方后端的单写者 SQLite 约束）。

## 开发

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run bundle      # tsdown → lib/
```

## 许可

[MIT](LICENSE)
