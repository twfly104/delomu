import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './v3-support.test.mjs';

// With DELOMU_PUBLIC_URL set, www.<that host> redirects to the public URL; every other host is served as before.
const srv = await startServer({ publicUrl: 'https://grapim.example' });
after(() => srv.close());

const port = new URL(srv.base).port;
const ask = (host, path, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host } }, res => { res.resume(); res.on('end', () => resolve(res)); });
  req.on('error', reject);
  req.end();
});

test('www of the public host redirects to the public URL, keeping path and query', async () => {
  const res = await ask('www.grapim.example', '/login?next=%2Forgs');
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, 'https://grapim.example/login?next=%2Forgs');
  assert.equal((await ask('WWW.GRAPIM.EXAMPLE', '/', 'HEAD')).statusCode, 301);
});

test('other hosts and non-GET requests on www are not redirected', async () => {
  assert.notEqual((await ask('grapim.example', '/login')).statusCode, 301);
  assert.notEqual((await ask('delomu-production.up.railway.app', '/login')).statusCode, 301);
  assert.notEqual((await ask('www.grapim.example', '/login', 'POST')).statusCode, 301);
});
