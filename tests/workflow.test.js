'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { text: generated } = require('../scripts/build-workflow');
const { runWorkflow } = require('./n8n-sim');

const FILE = path.join(__dirname, '..', 'n8n', 'workflow.json');
const raw = fs.readFileSync(FILE, 'utf8');
const wf = JSON.parse(raw);

function chatEvent(content, state = {}, over = {}) {
  return {
    event: 'message_created',
    message_type: 'incoming',
    content,
    account: { id: 1 },
    sender: { type: 'contact' },
    conversation: {
      id: 7,
      status: 'pending',
      meta: { sender: { name: 'Dana Whitfield', email: 'dana@example.com', phone_number: '+15555550142' } },
      custom_attributes: { bot_state: JSON.stringify(state) },
    },
    ...over,
  };
}

const llmReply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

test('workflow.json is valid JSON and matches the generator (code nodes = src/)', () => {
  assert.equal(raw, generated);
  assert.equal(wf.active, false);
});

test('every connection points at a real node; every node except the note is connected', () => {
  const names = new Set(wf.nodes.map((n) => n.name));
  const reached = new Set();
  for (const [from, c] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), from);
    for (const branch of c.main) for (const t of branch) { assert.ok(names.has(t.node), t.node); reached.add(t.node); }
  }
  for (const n of wf.nodes) {
    if (n.type.endsWith('stickyNote') || n.type.endsWith('webhook')) continue;
    assert.ok(reached.has(n.name), `${n.name} is not connected`);
  }
});

test('credentials are referenced by name only; no secrets or real hosts inside', () => {
  for (const n of wf.nodes.filter((x) => x.credentials)) {
    for (const c of Object.values(n.credentials)) assert.deepEqual(Object.keys(c), ['name']);
  }
  assert.doesNotMatch(raw, /Bearer [A-Za-z0-9]|api_access_token"\s*:|sk-[A-Za-z0-9]{10}/);
  assert.doesNotMatch(raw, /\b(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+/);
  const hosts = [...raw.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
  for (const h of hosts) assert.ok(['odoo', 'chatwoot', 'api.openai.com'].includes(h), `unexpected host ${h}`);
});

test('simulated run: service request finishes with an Odoo task, reply with ref, state saved', async () => {
  const state = { collecting: true, asking: 'address', turns: 3, slots: { problem: 'Water heater leaking', urgency: 'soon', name: 'Dana Whitfield', phone: '+15555550142' } };
  const { http } = await runWorkflow(wf, chatEvent('12 Mill Lane, Millbrook', state), async (req) => {
    if (req.node.startsWith('LLM')) return llmReply({ intent: 'other', answer: '', fields: { address: '12 Mill Lane, Millbrook' }, confidence: 0.9 });
    if (req.node === 'Odoo: create task') return [42];
    return { ok: true };
  });
  const order = http.map((r) => r.node);
  assert.deepEqual(order, ['LLM: classify and extract', 'Odoo: create task', 'Chatwoot: reply', 'Chatwoot: save state']);
  const [llmReq, odoo, reply, save] = http;
  assert.equal(llmReq.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(llmReq.credential, 'LLM API key');
  assert.equal(odoo.url, 'http://odoo:8069/json/2/project.task/create');
  assert.equal(odoo.headers['X-Odoo-Database'], 'servicedesk');
  assert.equal(odoo.body.vals_list[0].project_id, 1);
  assert.match(odoo.body.vals_list[0].description, /12 Mill Lane/);
  assert.equal(reply.url, 'http://chatwoot:3000/api/v1/accounts/1/conversations/7/messages');
  assert.match(reply.body.content, /ref #42/);
  assert.deepEqual(JSON.parse(save.body.custom_attributes.bot_state).tickets, ['42']);
});

test('simulated run: LLM down + emergency message still gets safety reply, ticket and handoff', async () => {
  const { http } = await runWorkflow(wf, chatEvent('Water is gushing from under the sink!'), async (req) => {
    if (req.node.startsWith('LLM')) throw new Error('connect ECONNREFUSED');
    if (req.node === 'Odoo: create task') return { data: 43 };
    return { ok: true };
  });
  const by = Object.fromEntries(http.map((r) => [r.node, r]));
  assert.match(by['Chatwoot: reply'].body.content, /main water valve.*ref #43/);
  assert.equal(by['Chatwoot: note for staff'].body.private, true);
  assert.match(by['Chatwoot: note for staff'].body.content, /water emergency.*Ticket #43/);
  assert.deepEqual(by['Chatwoot: open for humans'].body, { status: 'open' });
});

test('simulated run: Odoo failure is admitted to the customer and handed off', async () => {
  const { http } = await runWorkflow(wf, chatEvent('A pipe burst in the basement'), async (req) => {
    if (req.node === 'Odoo: create task') throw new Error('HTTP 500');
    if (req.node.startsWith('LLM')) return llmReply({ intent: 'service_request', answer: '', fields: {}, confidence: 0.9 });
    return { ok: true };
  });
  const by = Object.fromEntries(http.map((r) => [r.node, r]));
  assert.doesNotMatch(by['Chatwoot: reply'].body.content, /\{TICKET\}/);
  assert.match(by['Chatwoot: reply'].body.content, /couldn't save the ticket/);
  assert.ok(by['Chatwoot: open for humans']);
});

test('simulated run: plain question, no ticket, no handoff', async () => {
  const { http } = await runWorkflow(wf, chatEvent('What are your hours?'), async (req) => {
    if (req.node.startsWith('LLM')) return llmReply({ intent: 'question', answer: 'Monday to Friday, 8am to 5pm.', fields: {}, confidence: 0.95 });
    return { ok: true };
  });
  assert.deepEqual(http.map((r) => r.node), ['LLM: classify and extract', 'Chatwoot: reply', 'Chatwoot: save state']);
  assert.equal(http[1].body.content, 'Monday to Friday, 8am to 5pm.');
});

test('simulated run: a human replied -> release; chat already open -> nothing at all', async () => {
  const handler = async () => ({ ok: true });
  const rel = await runWorkflow(wf, chatEvent('On my way', {}, { message_type: 'outgoing', sender: { type: 'user' } }), handler);
  assert.deepEqual(rel.http.map((r) => r.node), ['Chatwoot: release to humans']);
  const open = chatEvent('hello?');
  open.conversation.status = 'open';
  const none = await runWorkflow(wf, open, handler);
  assert.equal(none.http.length, 0);
});
