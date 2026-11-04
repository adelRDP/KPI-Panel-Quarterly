import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createPanelServer } from '../server.mjs';

test('configured HTTPS host is accepted without weakening local host and origin checks', async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'kpi-hosting-test-'));
  const server = createPanelServer({ dataRoot, publicOrigin: 'https://kpi-demo.style.dev', publicOrigins:['https://kpi-alias.example'] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataRoot, { recursive: true, force: true });
  });
  const get = (headers, path='/api/session') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, headers }, res => {
      const chunks=[];
      res.on('data', chunk=>chunks.push(chunk));
      res.on('end', () => {res.body=Buffer.concat(chunks);resolve(res);});
    });
    req.on('error', reject);
    req.end();
  });
  const hosted = await get({ Host: 'kpi-demo.style.dev', Origin: 'https://kpi-demo.style.dev' });
  assert.equal(hosted.statusCode, 200);
  assert.match(hosted.headers['set-cookie'][0], /; Secure(?:;|$)/);
  assert.equal((await get({ Host: 'evil.style.dev' })).statusCode, 403);
  assert.equal((await get({ Host: 'kpi-demo.style.dev', Origin: 'https://evil.style.dev' })).statusCode, 403);
  assert.equal((await get({ Host: `127.0.0.1:${server.address().port}` })).statusCode, 200);
  assert.equal((await get({Host:'kpi-alias.example',Origin:'https://kpi-alias.example'})).statusCode,200);
  assert.equal((await get({Host:'kpi-alias.example',Origin:'https://kpi-demo.style.dev'})).statusCode,403);
  const navigation={Host:'kpi-demo.style.dev','Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
  assert.equal((await get(navigation,'/')).statusCode,200,'a shared external link opens the public page');
  assert.equal((await get(navigation)).statusCode,403,'cross-site session/API requests remain blocked');
  assert.equal(hosted.headers['cache-control'],'no-store','sessions are never cached');
  const html=await get({Host:'kpi-demo.style.dev'},'/');
  const br=await get({Host:'kpi-demo.style.dev','Accept-Encoding':'br, gzip'},'/');
  assert.equal(br.headers['content-encoding'],'br');
  assert.deepEqual(brotliDecompressSync(br.body),html.body);
  assert.ok(br.body.length<html.body.length/2);
  const gzip=await get({Host:'kpi-demo.style.dev','Accept-Encoding':'br;q=0, gzip'},'/');
  assert.equal(gzip.headers['content-encoding'],'gzip');
  assert.deepEqual(gunzipSync(gzip.body),html.body);
  const cached=await get({Host:'kpi-demo.style.dev','If-None-Match':html.headers.etag},'/');
  assert.equal(cached.statusCode,304);
  assert.equal(cached.body.length,0);
  const imagePath='/src/assets/kpi-sidebar-background.webp';
  const image=await get({Host:'kpi-demo.style.dev'},imagePath);
  assert.equal(image.statusCode,200);
  const version=image.headers.etag.slice(3,15);
  const versioned=await get({Host:'kpi-demo.style.dev'},imagePath+'?v='+version);
  assert.match(versioned.headers['cache-control'],/immutable/);
  assert.doesNotMatch(image.headers['cache-control'],/immutable/);
  const vector=await get({Host:'kpi-demo.style.dev'},'/src/assets/5040-neon-vector.svg?v=af91dc96181c');
  assert.equal(vector.statusCode,200);
  assert.equal(vector.headers['content-type'],'image/svg+xml; charset=utf-8');
  assert.match(vector.headers['cache-control'],/immutable/);
  const logo=await get({Host:'kpi-demo.style.dev'},'/src/assets/kpi-analytics-emblem.png?v=6820079875ad');
  assert.equal(logo.statusCode,200);
  assert.equal(logo.headers['content-type'],'image/png');
  assert.match(logo.headers['cache-control'],/immutable/);
  assert.equal(logo.body.readUInt32BE(16),1672);
  assert.equal(logo.body.readUInt32BE(20),941);
  const collapsed=await get({Host:'kpi-demo.style.dev'},'/src/assets/kpi-growth-collapsed.png?v=cda1a83e34ae');
  assert.equal(collapsed.statusCode,200);assert.equal(collapsed.headers['content-type'],'image/png');
  assert.match(collapsed.headers['cache-control'],/immutable/);
  assert.equal(collapsed.body.readUInt32BE(16),1374);assert.equal(collapsed.body.readUInt32BE(20),1145);
});

test('public origin must be HTTPS', () => {
  assert.throws(() => createPanelServer({ publicOrigin: 'http://kpi-demo.style.dev' }), /HTTPS origin/);
});
