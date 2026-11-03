/** Server only. Add after your existing handler saves the contact successfully. */
export async function notifyAutometa(event, options = {}) {
  const base = options.baseUrl ?? process.env.AUTOMATION_API_BASE_URL;
  const key = options.apiKey ?? process.env.AUTOMATION_API_KEY;
  if (!base || !key) return { accepted: false, code: 'NOT_CONFIGURED' };
  try {
    const response = await fetch(base.replace(/\/$/, '') + '/events', {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + key,
        'idempotency-key': 'contact:' + event.externalEventId,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
    });
    if (response.status !== 202)
      return { accepted: false, code: 'HTTP_' + response.status };
    return { accepted: true, ...(await response.json()) };
  } catch {
    return { accepted: false, code: 'AUTOMATION_UNAVAILABLE' };
  }
}
// Use a stable ID and original occurredAt from the record you already saved.
// Never generate fresh values for retries, and never put the API key in browser code.
