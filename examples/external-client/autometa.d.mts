export function notifyAutometa(
  event: { externalEventId: string; [key: string]: unknown },
  options?: { baseUrl?: string; apiKey?: string; timeoutMs?: number },
): Promise<{ accepted: boolean; code?: string; [key: string]: unknown }>;
