import { jsonResponse } from './_http.js';

export async function onRequest(context: any): Promise<Response> {
  return jsonResponse({
    status: 'ok',
    conversationId: context?.conversation_id,
    runId: context?.run_id,
  });
}
