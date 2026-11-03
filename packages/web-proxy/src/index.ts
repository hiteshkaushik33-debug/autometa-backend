const refreshes = new Map<string, Promise<Response>>();
const json = (status: number, code: string, message: string) =>
  Response.json(
    { success: false, error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
const cookieValue = (request: Request, key: string) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(key + '='))
    ?.slice(key.length + 1);
export async function proxy(
  request: Request,
  path: string[],
  mode: 'admin' | 'users',
): Promise<Response> {
  const resource = path.join('/');
  const authAllowed =
    /^auth\/(login|logout|me|development-inbox|verify-email|reset-password|forgot-password|resend-verification)$/.test(
      resource,
    ) ||
    (mode === 'users' && resource === 'auth/register');
  const allowed =
    authAllowed ||
    (mode === 'admin'
      ? /^admin\/(overview|billing|businesses\/[a-f0-9-]{36}\/status)$/.test(
          resource,
        )
      : /^(billing\/(overview|topups|verify|topups\/[a-f0-9-]{36}\/(reconcile|checkout))|business|api-keys(\/[a-f0-9-]{36}(\/rotate)?)?|email\/(overview|settings|messages\/[a-f0-9-]{36}(\/cancel)?|suppressions(\/[a-f0-9-]{36})?))$/.test(
          resource,
        ));
  if (!allowed) return json(404, 'NOT_FOUND', 'Not found.');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
    return json(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  if (
    request.method !== 'GET' &&
    request.headers.get('origin') !==
      (process.env.APP_ORIGIN ?? new URL(request.url).origin)
  )
    return json(
      403,
      'ORIGIN_REJECTED',
      'Refresh the page before trying again.',
    );
  let body: string | undefined;
  if (request.method !== 'GET') {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return json(415, 'INVALID_REQUEST', 'JSON is required.');
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          return json(413, 'PAYLOAD_TOO_LARGE', 'Request too large.');
        }
        chunks.push(part.value);
      }
    body = new TextDecoder().decode(Buffer.concat(chunks));
  }
  const base =
    process.env.INTERNAL_API_BASE_URL ?? 'http://localhost:4100/api/v1';
  const cookiePrefix =
    (process.env.NODE_ENV === 'production' ? '__Host-' : '') +
    'autometa_' +
    mode;
  const accessName = cookiePrefix + '_access',
    refreshName = cookiePrefix + '_refresh';
  let access = cookieValue(request, accessName),
    refresh = cookieValue(request, refreshName);
  let rotated = false;
  const call = (
    endpoint: string,
    method: string,
    payload?: string,
    bearer?: string,
  ) =>
    fetch(base + '/' + endpoint, {
      method,
      body: payload,
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  try {
    let upstream = await call(
      resource + new URL(request.url).search,
      request.method,
      body,
      access,
    );
    if (
      upstream.status === 401 &&
      refresh &&
      !['auth/login', 'auth/register'].includes(resource)
    ) {
      const mapKey = mode + ':' + refresh;
      let task = refreshes.get(mapKey);
      if (!task) {
        task = call(
          'auth/refresh',
          'POST',
          JSON.stringify({ refreshToken: refresh }),
        );
        refreshes.set(mapKey, task);
        void task.finally(() => refreshes.delete(mapKey)).catch(() => {});
      }
      const response = (await task).clone();
      if (response.ok) {
        const data = await response.json();
        access = data.accessToken;
        refresh = data.refreshToken;
        rotated = true;
        upstream = await call(
          resource + new URL(request.url).search,
          request.method,
          body,
          access,
        );
      }
    }
    const data = await upstream.json();
    if (upstream.ok && resource === 'auth/login') {
      if (
        data.user.role !== (mode === 'admin' ? 'SUPER_ADMIN' : 'TENANT_ADMIN')
      ) {
        await call('auth/logout', 'POST', '{}', data.accessToken);
        return json(
          403,
          'WRONG_PORTAL',
          'Use the correct sign-in portal for this account.',
        );
      }
      access = data.accessToken;
      refresh = data.refreshToken;
      rotated = true;
    }
    delete data.accessToken;
    delete data.refreshToken;
    const result = Response.json(data, {
      status: upstream.status,
      headers: { 'cache-control': 'no-store' },
    });
    const cookie = (name: string, value: string, seconds: number) =>
      result.headers.append(
        'set-cookie',
        name +
          '=' +
          value +
          '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
          seconds +
          (process.env.NODE_ENV === 'production' ? '; Secure' : ''),
      );
    if (resource === 'auth/logout' || upstream.status === 401) {
      cookie(accessName, '', 0);
      cookie(refreshName, '', 0);
    } else if (rotated && access && refresh) {
      cookie(accessName, access, 900);
      cookie(refreshName, refresh, 604800);
    }
    return result;
  } catch {
    return json(
      503,
      'SERVICE_UNAVAILABLE',
      'The service is temporarily unavailable. Please try again.',
    );
  }
}
