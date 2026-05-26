import { jsonResponse } from './_http.js';
import { loadHistoryFromMemory } from './_memory.js';
import { loadHistory } from './_storage.js';

export async function onRequest(context: any): Promise<Response> {
  const memoryHistory = await loadHistoryFromMemory(context);
  console.log(memoryHistory.length,'////////')
  return jsonResponse({ history: memoryHistory.length ? memoryHistory : await loadHistory() });
}
