import { getBody, jsonResponse } from './_http.js';

export async function onRequest(context: any): Promise<Response> {
  const body = getBody(context);
  const conversationId = body.conversationId || body.conversation_id;
  const aborter = context?.abortActiveRun;
  if (typeof aborter === 'function' && conversationId) {
    const result = aborter(conversationId);
    return jsonResponse({ status: result ? 'aborting' : 'idle', conversationId, aborted: Boolean(result) });
  }
  return jsonResponse({ status: 'idle', conversationId, aborted: false });
}
