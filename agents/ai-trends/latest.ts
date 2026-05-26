import { jsonResponse } from './_http.js';
import { loadLatestReportFromMemory } from './_memory.js';
import { loadLatestReport } from './_storage.js';

export async function onRequest(context: any): Promise<Response> {
  const latest = await loadLatestReportFromMemory(context) ?? await loadLatestReport();
  return jsonResponse(latest ?? {
    status: 'empty',
    summary: '还没有生成过 AI 趋势报告。',
    reportMarkdown: '# AI 趋势日报\n\n还没有生成过报告，点击“立即生成”开始。',
    trends: [],
    items: [],
  });
}
