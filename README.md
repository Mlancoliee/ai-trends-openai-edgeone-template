# AI Trends Scheduled Summary - EdgeOne Makers Agent Template

AI-powered trend monitoring agent that automatically crawls, curates, and summarizes AI industry news on a schedule, generating structured daily reports.

Built on [EdgeOne Makers](https://edgeone.ai/makers) + [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) + React + Vite.

## Deploy
[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/makers/new?template=ai-trends-scheduled-summary&from=within&fromAgent=1&agentLang=typescript)

## Features

### Core Pipeline (4-Agent Architecture)
- **Data Collection** — Fetches from Hacker News, Dev.to, and web sources (via sandbox browser)
- **Curation & Summarization** — AI filters relevant content and generates Chinese summaries (parallel execution)
- **Trend Analysis** — Categorizes, identifies key insights, compares with historical data
- **Report Writing** — Generates structured Markdown daily reports with token streaming

### Agent Features
- **Scheduled Execution** — Cron-based automatic daily runs
- **Manual Trigger** — One-click generation from the dashboard
- **SSE Streaming** — Real-time progressive content rendering during generation
- **Sandbox Browser** — Fetches dynamic SPA content via headless browser
- **Stream-based Keepalive** — Prevents CDN idle timeout (60s) with periodic progress events
- **Auto-retry** — Stream failures fallback to non-stream mode transparently

### Dashboard
- **Live Pipeline Progress** — Visual stage indicators with real-time status
- **Progressive Content** — Items appear as they're curated, summarized, and analyzed
- **Writer Token Stream** — Live typing preview of the report being written
- **Report History** — Browse, view, and delete past reports
- **Trigger Badge** — Visual distinction between scheduled and manual runs
- **Skeleton Loading** — CLS-free initial load experience

## Project Structure

```
ai-trends-scheduled-summary-node/
├── agents/ai-trends/           # Backend Agent Pipeline
│   ├── run.ts                  # SSE entry point — orchestrates the full pipeline
│   ├── _model.ts               # 4-Agent pipeline + streamWithProgress + token streaming
│   ├── _types.ts               # Zod schemas + StreamEvent union
│   ├── _sources.ts             # Data collection (HN / Dev.to / Web sandbox browser)
│   ├── _items.ts               # Incremental dedup merge + library backfill
│   ├── _memory.ts              # Store read/write (EdgeOne Memory API)
│   ├── _report.ts              # Fallback report generation
│   ├── _storage.ts             # File storage fallback
│   ├── _http.ts                # HTTP utility functions
│   ├── latest.ts               # GET latest report
│   ├── history.ts              # GET report history
│   ├── detail.ts               # POST report detail by runId
│   ├── delete.ts               # POST delete report
│   ├── stop.ts                 # POST abort active run
│   └── health.ts               # GET health check
├── src/                        # Frontend (React + Vite)
│   ├── App.tsx                 # Main dashboard (pipeline bar, live feed, report sidebar)
│   ├── App.module.css          # All styles (~1400 lines)
│   ├── api.ts                  # SSECallbacks dispatch + REST endpoints
│   ├── MarkdownReport.tsx      # Markdown rendering component
│   ├── types.ts                # Frontend StreamEvent mirror types
│   ├── reportModel.ts          # normalizeReport / EMPTY_REPORT
│   └── main.tsx                # Entry point
├── edgeone.json                # Deployment config (sandbox, schedules, timeout)
├── package.json                # @openai/agents ^0.10.1 / react 18 / zod 4
└── .env                        # API_ENV / AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your AI Gateway credentials:

```env
AI_GATEWAY_API_KEY=your-api-key
AI_GATEWAY_BASE_URL=your-gateway-url
```

### 3. Local development

```bash
edgeone makers dev
```

Visit http://localhost:8088

### 4. Deploy

```bash
edgeone makers deploy
```

## Pipeline Architecture

```
collectSources (HN + DevTo + Web sandbox browser)
  → mergeItemLibrary (dedup + library backfill → 30 items)
  → emit items:fetched
  → [Curator + Summarizer] parallel streamWithProgress
    → emit items:curated  (kept/dropped)
    → emit items:summarized (aiSummary filled)
  → Analyst streamWithProgress (with tools: get_history, compare, fetch_url)
    → emit analysis (categories + deepDives + keyInsight)
  → Writer stream + token emit
    → emit token × N (frontend live typing)
  → assembleReport → saveToMemory
  → emit complete (full report)
```

## API Endpoints

| Endpoint | Method | Description | Response |
|----------|--------|-------------|----------|
| `/ai-trends/run` | POST | Trigger report generation | SSE |
| `/ai-trends/latest` | GET | Get latest report | JSON |
| `/ai-trends/history` | GET | List report history | JSON |
| `/ai-trends/detail` | POST | Get report by runId | JSON |
| `/ai-trends/delete` | POST | Delete a report | JSON |
| `/ai-trends/stop` | POST | Abort active generation | JSON |
| `/ai-trends/health` | GET | Health check | JSON |

### SSE Event Types

```
stage      — Pipeline stage status transitions
items      — Progressive item snapshots (fetched/curated/summarized)
analysis   — Analyst structured output (categories + keyInsight)
progress   — Keepalive heartbeat (every 8s during long stages)
token      — Writer token streaming (live typing)
complete   — Final report payload
error      — Error with detail message
```

## Scheduled Execution

Configured in `edgeone.json`:

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

The cron expression `0 9 * * *` runs daily at 09:00 UTC (17:00 UTC+8).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | AI Gateway API Key |
| `AI_GATEWAY_BASE_URL` | Yes | AI Gateway Base URL |
| `LLM_MODEL` | No | Override model name (default: `@makers/minimax-m2.7`) |

## Recommended Models

Default: `@makers/minimax-m2.7`.

| Model | Best For |
|-------|---------|
| `@makers/minimax-m2.7` | **Recommended** — Stable streaming, no connection resets |
| `@makers/deepseek-v4-flash` | Fast but occasional stream interruptions |

## Tech Stack

- **Frontend**: React 18 + Vite 5 + CSS Modules
- **Agent**: [@openai/agents](https://www.npmjs.com/package/@openai/agents) ^0.10.1
- **Validation**: [zod](https://github.com/colinhacks/zod) ^4
- **Storage**: EdgeOne Memory API (reports + item library)
- **Sandbox**: EdgeOne Sandbox Browser (dynamic page crawling)
- **Deployment**: [EdgeOne Makers](https://edgeone.ai/makers)

## License

MIT
