'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = path.join(__dirname, 'test-data');
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.FACTORY_NAME = 'Automated Test Factory';
process.env.DATA_DIR = TEST_DIR;

let server;
let baseUrl;

function request(method, pathUrl, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, baseUrl);
    const opt = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers }
    };
    if (body) {
      if (!opt.headers['Content-Type']) opt.headers['Content-Type'] = 'application/json';
      opt.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(opt, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  const app = require('../server.js');
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test('health check returns 200 ok', async () => {
  const res = await request('GET', '/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.data, 'ok');
});

test('security headers are present on responses', async () => {
  const res = await request('GET', '/api/session');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('session endpoint reports public status and factory name', async () => {
  const res = await request('GET', '/api/session');
  assert.equal(res.status, 200);
  assert.equal(res.json.admin, false);
  assert.equal(res.json.factory, 'Automated Test Factory');
});

test('initial apps are populated from seed if no data file exists', async () => {
  const res = await request('GET', '/api/apps');
  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.json.apps), true);
  assert.equal(res.json.apps.length, 2);
  assert.equal(res.json.apps[0].name, 'Intranet');
});

test('admin authentication and CRUD workflow', async () => {
  // 1. Unauthenticated attempt fails
  let res = await request('POST', '/api/apps', {}, JSON.stringify({ name: 'Hacker', url: 'http://evil.com' }));
  assert.equal(res.status, 401);

  // 2. Wrong password fails
  res = await request('POST', '/api/login', {}, JSON.stringify({ password: 'wrongpassword' }));
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'Wrong password');

  // 3. Successful login
  res = await request('POST', '/api/login', {}, JSON.stringify({ password: 'test-admin-password' }));
  assert.equal(res.status, 200);
  assert.equal(res.json.admin, true);

  const cookieHeader = res.headers['set-cookie'];
  assert.ok(cookieHeader && cookieHeader[0]);
  const cookie = cookieHeader[0].split(';')[0];
  assert.ok(cookieHeader[0].includes('HttpOnly'));
  assert.ok(cookieHeader[0].includes('SameSite=Strict'));

  // 4. Session now reflects admin = true
  res = await request('GET', '/api/session', { Cookie: cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.admin, true);

  // 5. Add new app
  res = await request('POST', '/api/apps', { Cookie: cookie }, JSON.stringify({
    name: 'Production Line 1',
    url: 'http://192.168.1.50:8000',
    category: 'Production',
    description: 'Line 1 real-time telemetry'
  }));
  assert.equal(res.status, 201);
  assert.ok(res.json.id);
  assert.equal(res.json.name, 'Production Line 1');
  assert.equal(res.json.category, 'Production');
  const appId = res.json.id;

  // 6. Verify app in list
  res = await request('GET', '/api/apps');
  assert.equal(res.status, 200);
  const found = res.json.apps.find(a => a.id === appId);
  assert.ok(found);
  assert.equal(found.url, 'http://192.168.1.50:8000');

  // 7. Input validation: missing name
  res = await request('POST', '/api/apps', { Cookie: cookie }, JSON.stringify({
    name: '',
    url: 'http://192.168.1.99'
  }));
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'Name is required');

  // 8. Input validation: non-http protocol
  res = await request('POST', '/api/apps', { Cookie: cookie }, JSON.stringify({
    name: 'Malicious',
    url: 'javascript:alert(1)'
  }));
  assert.equal(res.status, 400);

  // 9. Update app
  res = await request('PUT', `/api/apps/${appId}`, { Cookie: cookie }, JSON.stringify({
    name: 'Production Line 1 (Updated)',
    url: 'https://line1.factory.local',
    category: 'Assembly',
    description: 'Updated dashboard'
  }));
  assert.equal(res.status, 200);
  assert.equal(res.json.name, 'Production Line 1 (Updated)');
  assert.equal(res.json.category, 'Assembly');

  // 10. Update non-existent app
  res = await request('PUT', '/api/apps/does-not-exist', { Cookie: cookie }, JSON.stringify({
    name: 'Nobody',
    url: 'http://nobody.com'
  }));
  assert.equal(res.status, 404);

  // 11. Delete app
  res = await request('DELETE', `/api/apps/${appId}`, { Cookie: cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);

  // Verify deletion in GET /api/apps
  res = await request('GET', '/api/apps');
  assert.equal(res.json.apps.some(a => a.id === appId), false);

  // 12. Delete non-existent app
  res = await request('DELETE', `/api/apps/${appId}`, { Cookie: cookie });
  assert.equal(res.status, 404);

  // 13. Logout
  res = await request('POST', '/api/logout');
  assert.equal(res.status, 200);
  assert.equal(res.json.admin, false);
  assert.ok(res.headers['set-cookie'][0].includes('Max-Age=0'));
});

test('tampered cookie is rejected', async () => {
  const fakeCookie = 'admin=9999999999999.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const res = await request('GET', '/api/session', { Cookie: fakeCookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.admin, false);
});
