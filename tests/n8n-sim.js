'use strict';
// A tiny stand-in for the n8n runtime, enough to execute n8n/workflow.json in tests:
// Code nodes run their jsCode, IF nodes and "={{ }}" expressions are evaluated, and
// every HTTP Request goes to a handler supplied by the test (mock LLM / Odoo / Chatwoot).
// It does not replace a real n8n import; it checks the wiring and the generated code.

const vm = require('node:vm');

function makeContext(outputs, input) {
  const $ = (name) => ({
    first: () => {
      if (!outputs[name]) throw new Error(`node "${name}" has not run`);
      return outputs[name][0];
    },
    get isExecuted() {
      return !!outputs[name];
    },
  });
  return { $, $input: { first: () => input, all: () => [input] }, $json: input && input.json };
}

function evalExpr(value, ctx) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const tpl = value.slice(1);
  const run = (expr) => vm.runInNewContext(`(${expr})`, { ...ctx, JSON, Number, String });
  const whole = tpl.match(/^\{\{([\s\S]*)\}\}$/);
  if (whole && !whole[1].includes('}}')) return run(whole[1]);
  return tpl.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(run(e)));
}

async function runWorkflow(wf, payload, httpHandler) {
  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const outputs = {};
  const http = [];
  const start = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  outputs[start.name] = [{ json: { headers: {}, params: {}, query: {}, body: payload } }];
  const queue = [[start.name, 0]];
  while (queue.length) {
    const [from, idx] = queue.shift();
    const targets = ((wf.connections[from] || {}).main || [])[idx] || [];
    for (const t of targets) {
      const node = byName[t.node];
      if (!node) throw new Error(`connection to missing node ${t.node}`);
      const input = outputs[from][0];
      const ctx = makeContext(outputs, input);
      if (node.type === 'n8n-nodes-base.code') {
        const items = vm.runInNewContext(`(() => {\n${node.parameters.jsCode}\n})()`, { ...ctx, JSON, Number, String, Array, Object, Math, RegExp, Date });
        if (!Array.isArray(items) || !items.length) continue; // branch stops
        outputs[node.name] = items;
        queue.push([node.name, 0]);
      } else if (node.type === 'n8n-nodes-base.if') {
        const c = node.parameters.conditions.conditions[0];
        const ok = !!evalExpr(c.leftValue, ctx);
        outputs[node.name] = [input];
        queue.push([node.name, ok ? 0 : 1]);
      } else if (node.type === 'n8n-nodes-base.httpRequest') {
        const p = node.parameters;
        const req = {
          node: node.name,
          url: evalExpr(p.url, ctx),
          body: JSON.parse(evalExpr(p.jsonBody, ctx)),
          headers: Object.fromEntries(((p.headerParameters || {}).parameters || []).map((h) => [h.name, evalExpr(h.value, ctx)])),
          credential: node.credentials.httpHeaderAuth.name,
        };
        http.push(req);
        let json;
        try {
          json = await httpHandler(req);
        } catch (err) {
          if (node.onError !== 'continueRegularOutput') throw err;
          json = { error: { message: err.message } };
        }
        outputs[node.name] = [{ json }];
        queue.push([node.name, 0]);
      } else {
        throw new Error(`simulator does not support ${node.type}`);
      }
    }
  }
  return { outputs, http };
}

module.exports = { runWorkflow };
