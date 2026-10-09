'use strict';
// Minimal Odoo client for opening a service ticket (project.task).
//
// Two protocols:
//   'json2'   Odoo 19+ JSON-2 API: POST /json/2/<model>/<method>, API key as a Bearer token.
//             This is what the n8n workflow uses (HTTP Request node + header credential).
//   'jsonrpc' Classic JSON-RPC: POST /jsonrpc, execute_kw with db / uid / API key. Works on older Odoo.
//
// The bot's Odoo user should be a dedicated user that can only create tasks in the
// service desk project (see README, "Safety and design").

function taskValues(ticket, projectId) {
  return {
    name: ticket.name,
    description: ticket.description,
    project_id: Number(projectId),
    priority: ticket.priority === '1' ? '1' : '0',
  };
}

class OdooClient {
  constructor({ url, db, login, apiKey, protocol = 'json2', fetchImpl = globalThis.fetch }) {
    this.url = String(url).replace(/\/+$/, '');
    this.db = db;
    this.login = login;
    this.apiKey = apiKey;
    this.protocol = protocol;
    this.fetch = fetchImpl;
    this.uid = null;
  }

  async _post(path, body, headers = {}) {
    const res = await this.fetch(this.url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Odoo HTTP ${res.status}: ${(data && data.message) || 'error'}`);
    return data;
  }

  async _rpc(service, method, args) {
    const data = await this._post('/jsonrpc', {
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Date.now(),
    });
    if (data.error) throw new Error(`Odoo RPC error: ${(data.error.data && data.error.data.message) || data.error.message}`);
    return data.result;
  }

  async call(model, method, args = [], kwargs = {}) {
    if (this.protocol === 'json2') {
      // JSON-2 takes named arguments only.
      return this._post(`/json/2/${model}/${method}`, kwargs, {
        Authorization: `Bearer ${this.apiKey}`,
        'X-Odoo-Database': this.db,
      });
    }
    if (this.uid == null) {
      this.uid = await this._rpc('common', 'authenticate', [this.db, this.login, this.apiKey, {}]);
      if (!this.uid) throw new Error('Odoo login failed');
    }
    return this._rpc('object', 'execute_kw', [this.db, this.uid, this.apiKey, model, method, args, kwargs]);
  }

  // Returns the new task id.
  async createTask(ticket, projectId) {
    const vals = taskValues(ticket, projectId);
    const out =
      this.protocol === 'json2'
        ? await this.call('project.task', 'create', [], { vals_list: [vals] })
        : await this.call('project.task', 'create', [[vals]]);
    return Array.isArray(out) ? out[0] : out;
  }
}

module.exports = { OdooClient, taskValues };
