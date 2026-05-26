import { getBody, jsonResponse } from './_http.js';
import { loadReportFromMemory } from './_memory.js';
import { loadReport } from './_storage.js';

export async function onRequest(context: any): Promise<Response> {
  const body = getBody(context);
  const runId = body.runId || body.run_id;
  if (!runId) return jsonResponse({ error: 'runId is required' }, 400);

  const report = await loadReportFromMemory(context, String(runId)) ?? await loadReport(String(runId));
  if (!report) return jsonResponse({ error: 'report not found' }, 404);
  return jsonResponse(report);
}
