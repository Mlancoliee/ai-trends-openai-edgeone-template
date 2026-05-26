import { getBody, jsonResponse } from './_http.js';
import { deleteReportFromMemory } from './_memory.js';

export async function onRequest(context: any): Promise<Response> {
  const body = getBody(context);
  const runId = body.runId || body.run_id;
  if (!runId) return jsonResponse({ error: 'runId is required' }, 400);

  const deleted = await deleteReportFromMemory(context, String(runId));
  if (!deleted) return jsonResponse({ error: 'report not found or delete not supported' }, 404);
  return jsonResponse({ success: true, runId });
}
