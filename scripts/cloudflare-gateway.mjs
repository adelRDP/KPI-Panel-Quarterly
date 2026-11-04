// Routing only: the application, database and uploads stay on the Freestyle VM.
// Keep this fixed. Never use a caller-supplied URL as the upstream.
export const PANEL_ORIGIN = 'https://quarterly.example.invalid';

const fail = (status, message) => new Response(JSON.stringify({ error: message }), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export async function proxyPanel(request, { fetchUpstream = fetch } = {}) {
  if (PANEL_ORIGIN.endsWith('.invalid')) return fail(503, 'آدرس انتشار مستقل پنل فصلی هنوز تنظیم نشده است.');
  const incoming = new URL(request.url);
  if (incoming.protocol !== 'https:') return fail(400, 'برای ورود به پنل از آدرس HTTPS استفاده کنید.');
  let path;
  try { path = decodeURIComponent(incoming.pathname); }
  catch { return fail(400, 'آدرس نامعتبر است.'); }
  const api = path === '/api' || path.startsWith('/api/');
  const readOnly = request.method === 'GET' || request.method === 'HEAD';
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' && (api || !readOnly)) {
    return fail(403, 'Cross-site request rejected');
  }
  const origin = request.headers.get('Origin');
  if (origin && origin !== incoming.origin) return fail(403, 'Origin rejected');

  const upstreamUrl = new URL(PANEL_ORIGIN);
  upstreamUrl.pathname = incoming.pathname;
  upstreamUrl.search = incoming.search;
  const headers = new Headers(request.headers);
  for (const name of ['Host', 'Forwarded', 'X-Forwarded-Host', 'X-Forwarded-Proto']) headers.delete(name);
  if (origin) headers.set('Origin', PANEL_ORIGIN);
  const versionedAsset = readOnly && path.startsWith('/src/') && /^[a-f0-9]{12}$/.test(incoming.searchParams.get('v') || '');
  if (versionedAsset) {
    // These are public files, not personalized responses. Do not attach a session.
    for (const name of ['Cookie', 'Authorization', 'X-Panel-Token']) headers.delete(name);
  }
  const options = {
    method: request.method, headers, redirect: 'manual',
    cf: versionedAsset
      ? { cacheEverything: true } // Respect the origin's content-hash/cache validation.
      : { cacheEverything: false, cacheTtlByStatus: { '100-599': -1 } },
  };
  if (!readOnly) { options.body = request.body; options.duplex = 'half'; }

  let response;
  try { response = await fetchUpstream(upstreamUrl.toString(), options); }
  catch { return fail(502, 'ارتباط با سرور پنل برقرار نشد؛ کمی بعد دوباره تلاش کنید.'); }
  const responseHeaders = new Headers(response.headers);
  if (api) responseHeaders.set('Cache-Control', 'no-store');
  const location = responseHeaders.get('Location');
  if (location) {
    const destination = new URL(location, upstreamUrl);
    if (destination.origin !== PANEL_ORIGIN) return fail(502, 'پاسخ مسیر پنل نامعتبر است.');
    destination.protocol = incoming.protocol;
    destination.host = incoming.host;
    responseHeaders.set('Location', destination.toString());
  }
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers: responseHeaders,
  });
}

export default { fetch(request) { return proxyPanel(request); } };
