import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { createPanelServer } from '../server.mjs';
import { PANEL_ORIGIN, proxyPanel } from '../scripts/cloudflare-gateway.mjs';

const GATEWAY = 'https://kpi-panel-5040.example.workers.dev';

test('gateway forwards only to the fixed panel, preserves request streams and maps same-site Origin', async () => {
  const payload = Uint8Array.from([0, 255, 1, 200]);
  const request = new Request(GATEWAY + '/api/activities?url=https://evil.example', {
    method: 'POST', body: payload,
    headers: { Origin: GATEWAY, 'Sec-Fetch-Site': 'same-origin', Cookie: 'panel-session=sample', 'X-Panel-Token': 'sample', 'X-Forwarded-Host': 'evil.example' },
  });
  const response = await proxyPanel(request, { fetchUpstream: async (url, options) => {
    assert.equal(url, PANEL_ORIGIN + '/api/activities?url=https://evil.example');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.get('Origin'), PANEL_ORIGIN);
    assert.equal(options.headers.get('Cookie'), 'panel-session=sample');
    assert.equal(options.headers.get('X-Panel-Token'), 'sample');
    assert.equal(options.headers.get('X-Forwarded-Host'), null);
    assert.deepEqual(new Uint8Array(await new Response(options.body).arrayBuffer()), payload);
    assert.deepEqual(options.cf.cacheTtlByStatus, { '100-599': -1 });
    return new Response('{"saved":true}', { status: 201, headers: { 'Cache-Control': 'public', 'Set-Cookie': 'panel-session=new; Secure; HttpOnly; SameSite=Strict; Path=/' } });
  } });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Set-Cookie'), /Secure; HttpOnly; SameSite=Strict/);
});

test('gateway preserves origin and cross-site restrictions, but accepts shared public page links', async () => {
  let requests = 0;
  const fetchUpstream = async () => { requests++; return new Response('ok'); };
  for (const [path, headers, status] of [
    ['/api/session', { 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['/%61pi/session', { 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['/api/session', { Origin: 'https://evil.example' }, 403],
    ['/api/session', { Origin: PANEL_ORIGIN }, 403],
    ['/%zz', {}, 400],
    ['/', { 'Sec-Fetch-Site': 'cross-site' }, 200],
  ]) {
    const response = await proxyPanel(new Request(GATEWAY + path, { headers }), { fetchUpstream });
    assert.equal(response.status, status, path);
  }
  assert.equal(requests, 1);
  assert.equal((await proxyPanel(new Request(GATEWAY + '/api/session', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } }), { fetchUpstream })).status, 403);
});

test('only versioned public assets are eligible for edge cache; mutable code and API bypass it', async () => {
  for (const [path, cache] of [['/src/assets/logo.webp?v=123456789abc', true], ['/src/theme.css', false], ['/', false], ['/api/session?v=123456789abc', false]]) {
    const response = await proxyPanel(new Request(GATEWAY + path, { headers: { Cookie: 'private', 'X-Panel-Token': 'private' } }), { fetchUpstream: async (url, options) => {
      assert.equal(options.cf.cacheEverything, cache);
      assert.equal(options.headers.get('Cookie'), cache ? null : 'private');
      assert.equal(options.headers.get('X-Panel-Token'), cache ? null : 'private');
      return new Response('ok', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } });
    } });
    assert.equal(response.status, 200);
  }
});

test('gateway never follows upstream redirects or exposes internal failures', async () => {
  const response = await proxyPanel(new Request(GATEWAY), { fetchUpstream: async () => new Response(null, { status: 302, headers: { Location: PANEL_ORIGIN + '/login' } }) });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), GATEWAY + '/login');
  assert.equal((await proxyPanel(new Request(GATEWAY), { fetchUpstream: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }) })).status, 502);
  const failed = await proxyPanel(new Request(GATEWAY), { fetchUpstream: async () => { throw new Error('private credential'); } });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /credential/);
});

test('real panel sessions, role switching and API reads work through the gateway', async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'kpi-gateway-test-'));
  const server = createPanelServer({ dataRoot, publicOrigin: PANEL_ORIGIN });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataRoot, { recursive: true, force: true });
  });
  // Node fetch overwrites Host; use HTTP transport to model the actual hosted origin.
  const fetchUpstream = (url, options) => new Promise((resolve, reject) => {
    const upstream = new URL(url);
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: upstream.pathname + upstream.search,
      method: options.method, headers: { ...Object.fromEntries(options.headers), Host: upstream.host } }, res => {
      const parts = [];
      res.on('data', part => parts.push(part));
      res.on('end', () => resolve(new Response(Buffer.concat(parts), { status: res.statusCode,
        headers: Object.fromEntries(Object.entries(res.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value])) })));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (options.body) Readable.fromWeb(options.body).on('error', reject).pipe(req);
    else req.end();
  });
  const call = (path, options) => proxyPanel(new Request(GATEWAY + path, options), { fetchUpstream });
  const sessionResponse = await call('/api/session');
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.ok(session.token);
  const cookie = sessionResponse.headers.get('Set-Cookie').split(';')[0];
  const persisted = await (await call('/api/session', { headers: { Cookie: cookie } })).json();
  assert.equal(persisted.token, session.token);
  const headers = { Origin: GATEWAY, 'Sec-Fetch-Site': 'same-origin', 'X-Panel-Token': session.token, 'Content-Type': 'application/json' };
  const switchResponse = await call('/api/session', { method: 'POST', headers, body: JSON.stringify({ userId: session.accounts[1].id }) });
  assert.equal(switchResponse.status, 200);
  const switched = await switchResponse.json();
  assert.equal(switched.user.id, session.accounts[1].id);
  assert.equal((await call('/api/notifications', { headers: { ...headers, 'X-Panel-Token': switched.token } })).status, 200);
  assert.equal((await call('/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200);
});
