'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLlmRequest, parseLlmResponse } = require('../src/llm');
const { config } = require('./helpers');

const wrap = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });

test('request: model, JSON mode, business facts in the system prompt, message truncated', () => {
  const body = buildLlmRequest(config, 'x'.repeat(5000), { slots: { name: 'Dana' }, asking: 'phone' });
  assert.equal(body.model, config.llm_model);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /Stonebridge Plumbing/);
  assert.match(body.messages[0].content, /Never quote prices/);
  assert.match(body.messages[1].content, /name="Dana"/);
  assert.match(body.messages[1].content, /asked the customer for: phone/);
  assert.ok(body.messages[1].content.length < config.max_message_chars + 300);
  const noJson = buildLlmRequest({ ...config, llm_json_mode: false }, 'hi', {});
  assert.equal(noJson.response_format, undefined);
});

test('parses a clean JSON reply', () => {
  const r = parseLlmResponse(wrap('{"intent":"service_request","answer":"","fields":{"problem":"leak","urgency":"Soon","phone":""},"confidence":0.8}'));
  assert.deepEqual(r, { intent: 'service_request', answer: '', fields: { problem: 'leak', urgency: 'soon' }, confidence: 0.8 });
});

test('tolerates code fences, clamps confidence, drops bad urgency', () => {
  const r = parseLlmResponse(wrap('```json\n{"intent":"question","answer":"Yes.","fields":{"urgency":"whenever"},"confidence":7}\n```'));
  assert.equal(r.confidence, 1);
  assert.equal(r.fields.urgency, undefined);
});

test('returns null for anything unusable', () => {
  assert.equal(parseLlmResponse(null), null);
  assert.equal(parseLlmResponse({ error: { message: 'timeout' } }), null);
  assert.equal(parseLlmResponse(wrap('not json at all')), null);
  assert.equal(parseLlmResponse(wrap('{"intent":"sell_upgrade","answer":"x"}')), null);
  assert.equal(parseLlmResponse({ choices: [] }), null);
});
