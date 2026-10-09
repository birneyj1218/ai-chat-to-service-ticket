'use strict';
// Runs the Odoo client against a small in-process mock of Odoo's two JSON APIs.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { OdooClient, taskValues } = require('../src/odoo');

const KEY = 'test-api-key-not-real';

function mockOdoo() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ path: req.url, headers: req.headers, body });
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/json/2/project.task/create') {
        if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { message: 'bad key' });
        return send(200, body.vals_list.map((_, i) => 40 + i));
      }
      if (req.url === '/jsonrpc') {
        const { service, method, args } = body.params;
        if (service === 'common' && method === 'authenticate') {
          return send(200, { jsonrpc: '2.0', id: body.id, result: args[2] === KEY ? 7 : false });
        }
        if (service === 'object' && method === 'execute_kw') return send(200, { jsonrpc: '2.0', id: body.id, result: 55 });
      }
      send(404, { message: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

const ticket = { name: '[URGENT] Water emergency: burst pipe (Dana)', description: '<p>x</p>', priority: '1' };

test('JSON-2: creates the task with bearer key, database header and typed values', async () => {
  const m = await mockOdoo();
  try {
    const c = new OdooClient({ url: m.url + '/', db: 'servicedesk', apiKey: KEY });
    const id = await c.createTask(ticket, '3');
    assert.equal(id, 40);
    const call = m.calls[0];
    assert.equal(call.headers['x-odoo-database'], 'servicedesk');
    assert.deepEqual(call.body, { vals_list: [{ name: ticket.name, description: '<p>x</p>', project_id: 3, priority: '1' }] });
  } finally {
    m.server.close();
  }
});

test('JSON-2: a wrong key is an error, not a silent success', async () => {
  const m = await mockOdoo();
  try {
    const c = new OdooClient({ url: m.url, db: 'servicedesk', apiKey: 'wrong' });
    await assert.rejects(c.createTask(ticket, 3), /401/);
  } finally {
    m.server.close();
  }
});

test('JSON-RPC: authenticates once, then execute_kw create', async () => {
  const m = await mockOdoo();
  try {
    const c = new OdooClient({ url: m.url, db: 'servicedesk', login: 'chat-bot', apiKey: KEY, protocol: 'jsonrpc' });
    assert.equal(await c.createTask(ticket, 3), 55);
    await c.createTask(ticket, 3);
    const auths = m.calls.filter((x) => x.body.params.service === 'common');
    assert.equal(auths.length, 1);
    const exec = m.calls[1].body.params.args;
    assert.deepEqual(exec.slice(0, 5), ['servicedesk', 7, KEY, 'project.task', 'create']);
    assert.equal(exec[5][0][0].project_id, 3);
  } finally {
    m.server.close();
  }
});

test('JSON-RPC: failed login is reported', async () => {
  const m = await mockOdoo();
  try {
    const c = new OdooClient({ url: m.url, db: 'servicedesk', login: 'chat-bot', apiKey: 'wrong', protocol: 'jsonrpc' });
    await assert.rejects(c.createTask(ticket, 3), /login failed/);
  } finally {
    m.server.close();
  }
});

test('taskValues only sends known fields and normal/urgent priority', () => {
  assert.deepEqual(taskValues({ name: 'n', description: 'd', priority: 'x', extra: 1 }, 2), { name: 'n', description: 'd', project_id: 2, priority: '0' });
});
