# AI 趋势定时汇总 - EdgeOne Makers Agent 模板

AI 驱动的趋势监控 Agent，自动定时爬取、筛选和汇总 AI 行业资讯，生成结构化的每日趋势报告。

基于 [EdgeOne Makers](https://edgeone.ai/makers) + [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) + React + Vite 构建。

## 部署
[![使用 EdgeOne Makers 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/makers/new?template=ai-trends-scheduled-summary&from=within&fromAgent=1&agentLang=typescript)

## 功能特性

### 核心流水线（4-Agent 架构）
- **数据采集** — 从 Hacker News、Dev.to 和 Web 数据源获取（支持沙箱浏览器抓取动态页面）
- **筛选 & 摘要** — AI 过滤高质量内容并生成中文摘要（并行执行）
- **趋势分析** — 分类分组、识别关键洞察、对比历史数据
- **报告撰写** — 生成结构化 Markdown 日报，支持逐 token 流式输出

### Agent 特性
- **定时执行** — 基于 Cron 的每日自动运行
- **手动触发** — 仪表盘一键生成
- **SSE 流式输出** — 生成过程中实时渐进式渲染内容
- **沙箱浏览器** — 通过无头浏览器抓取动态 SPA 页面内容
- **流式保活** — 每 8 秒 progress 事件防止 CDN 60 秒 idle timeout 断连
- **自动重试** — 流式失败自动降级为非流式调用，对用户透明

### 仪表盘
- **实时流水线进度** — 可视化阶段指示器，实时显示状态
- **渐进式内容呈现** — 资讯条目随筛选、摘要、分析过程逐步展示
- **Writer Token 流** — 报告撰写过程的实时打字预览
- **报告历史** — 浏览、查看和删除历史报告
- **触发来源标识** — 直观区分定时生成和手动生成
- **骨架屏加载** — 无 CLS 的初始加载体验

## 项目结构

```
ai-trends-scheduled-summary-node/
├── agents/ai-trends/           # 后端 Agent 流水线
│   ├── run.ts                  # SSE 入口 — 编排整个流水线
│   ├── _model.ts               # 4-Agent 流水线 + streamWithProgress + token 流式
│   ├── _types.ts               # Zod schemas + StreamEvent 联合类型
│   ├── _sources.ts             # 数据采集（HN / Dev.to / Web 沙箱浏览器）
│   ├── _items.ts               # 增量去重合并 + library 补位
│   ├── _memory.ts              # Store 读写（EdgeOne Memory API）
│   ├── _report.ts              # 兜底报告生成
│   ├── _storage.ts             # 文件存储 fallback
│   ├── _http.ts                # HTTP 工具函数
│   ├── latest.ts               # GET 最新报告
│   ├── history.ts              # GET 报告历史
│   ├── detail.ts               # POST 报告详情
│   ├── delete.ts               # POST 删除报告
│   ├── stop.ts                 # POST 中断生成
│   └── health.ts               # GET 健康检查
├── src/                        # 前端（React + Vite）
│   ├── App.tsx                 # 主仪表盘（流水线、实时资讯流、报告侧边栏）
│   ├── App.module.css          # 全部样式（~1400 行）
│   ├── api.ts                  # SSECallbacks 分发 + REST 接口
│   ├── MarkdownReport.tsx      # Markdown 渲染组件
│   ├── types.ts                # 前端 StreamEvent 镜像类型
│   ├── reportModel.ts          # normalizeReport / EMPTY_REPORT
│   └── main.tsx                # 入口
├── edgeone.json                # 部署配置（沙箱、定时任务、超时）
├── package.json                # @openai/agents ^0.10.1 / react 18 / zod 4
└── .env                        # API_ENV / AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 填入你的 AI Gateway 配置：

```env
AI_GATEWAY_API_KEY=your-api-key
AI_GATEWAY_BASE_URL=your-gateway-url
```

### 3. 本地开发

```bash
edgeone makers dev
```

访问 http://localhost:8088

### 4. 部署

```bash
edgeone makers deploy
```

## 流水线架构

```
collectSources (HN + DevTo + Web 沙箱浏览器)
  → mergeItemLibrary (去重 + library 补位 → 30 items)
  → emit items:fetched
  → [Curator + Summarizer] 并行 streamWithProgress
    → emit items:curated  (kept/dropped)
    → emit items:summarized (aiSummary filled)
  → Analyst streamWithProgress (with tools: get_history, compare, fetch_url)
    → emit analysis (categories + deepDives + keyInsight)
  → Writer stream + token emit
    → emit token × N (前端实时打字)
  → assembleReport → saveToMemory
  → emit complete (完整报告)
```

## API 接口

| 端点 | 方法 | 说明 | 响应格式 |
|------|------|------|----------|
| `/ai-trends/run` | POST | 触发报告生成 | SSE |
| `/ai-trends/latest` | GET | 获取最新报告 | JSON |
| `/ai-trends/history` | GET | 报告历史列表 | JSON |
| `/ai-trends/detail` | POST | 按 runId 获取报告详情 | JSON |
| `/ai-trends/delete` | POST | 删除报告 | JSON |
| `/ai-trends/stop` | POST | 中断当前生成 | JSON |
| `/ai-trends/health` | GET | 健康检查 | JSON |

### SSE 事件类型

```
stage      — 流水线阶段状态变化
items      — 渐进式 item 快照（fetched/curated/summarized）
analysis   — 分析结构化输出（分类 + 核心洞察）
progress   — 保活心跳（长阶段每 8 秒一次）
token      — Writer token 流式输出（实时打字）
complete   — 最终完整报告
error      — 错误信息
```

## 定时任务配置

在 `edgeone.json` 中配置：

```json
{
  "schedules": [{
    "name": "ai-trends-periodic",
    "cron": "0 9 * * *",
    "path": "/ai-trends/run",
    "payload": { "_schedule": true, "trigger": "schedule" }
  }]
}
```

Cron 表达式 `0 9 * * *` 表示每天 UTC 9:00（北京时间 17:00）自动执行。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | 是 | AI Gateway API Key |
| `AI_GATEWAY_BASE_URL` | 是 | AI Gateway Base URL |
| `LLM_MODEL` | 否 | 覆盖模型名称（默认：`@makers/minimax-m2.7`） |

## 使用模型

默认使用 `@makers/minimax-m2.7`。

| 模型 | 推荐场景 |
|------|---------|
| `@makers/minimax-m2.7` | **推荐** — 流式稳定，无连接中断 |
| `@makers/deepseek-v4-flash` | 响应快，但偶有流式中断 |

## 技术栈

- **前端**: React 18 + Vite 5 + CSS Modules
- **Agent**: [@openai/agents](https://www.npmjs.com/package/@openai/agents) ^0.10.1
- **校验**: [zod](https://github.com/colinhacks/zod) ^4
- **存储**: EdgeOne Memory API（报告 + item library）
- **沙箱**: EdgeOne Sandbox Browser（动态页面抓取）
- **部署**: [EdgeOne Makers](https://edgeone.ai/makers)

## License

MIT
