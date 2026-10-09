'use strict';
const { DEFAULT_CONFIG } = require('../src/config');

const config = { ...DEFAULT_CONFIG };

function msg(text, contact = {}) {
  return { text, conversation_id: 101, account_id: 1, contact: { name: '', phone: '', email: '', ...contact } };
}

function llm(intent, extra = {}) {
  return { intent, answer: '', fields: {}, confidence: 0.9, ...extra };
}

module.exports = { config, msg, llm };
