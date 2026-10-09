'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEvent } = require('../src/chatwoot');

function event(over = {}, conv = {}) {
  return {
    event: 'message_created',
    message_type: 'incoming',
    content: 'Hi there',
    private: false,
    account: { id: 1 },
    sender: { type: 'contact', name: 'Dana Whitfield' },
    conversation: {
      id: 7,
      status: 'pending',
      meta: { sender: { name: 'Dana Whitfield', email: 'Dana@Example.com', phone_number: '+15555550142' } },
      custom_attributes: { bot_state: JSON.stringify({ turns: 2, slots: { problem: 'leak' } }) },
      ...conv,
    },
    ...over,
  };
}

test('customer message in a bot-owned chat is handled, with saved state', () => {
  const e = parseEvent({ body: event() }); // n8n wraps the payload in "body"
  assert.equal(e.kind, 'message');
  assert.equal(e.conversation_id, 7);
  assert.equal(e.contact.email, 'dana@example.com');
  assert.equal(e.state.turns, 2);
});

test('once a human owns the chat, the bot ignores everything', () => {
  assert.equal(parseEvent(event({}, { status: 'open' })).kind, 'ignore');
  assert.equal(parseEvent(event({}, { status: 'resolved' })).kind, 'ignore');
});

test('a human agent replying in a pending chat releases it', () => {
  assert.equal(parseEvent(event({ message_type: 'outgoing', sender: { type: 'user' } })).kind, 'release');
});

test("the bot's own messages, private notes, other events and empty text are ignored", () => {
  assert.equal(parseEvent(event({ message_type: 'outgoing', sender: { type: 'agent_bot' } })).kind, 'ignore');
  assert.equal(parseEvent(event({ private: true })).kind, 'ignore');
  assert.equal(parseEvent(event({ event: 'conversation_created' })).kind, 'ignore');
  assert.equal(parseEvent(event({ content: '   ' })).kind, 'ignore');
  assert.equal(parseEvent({}).kind, 'ignore');
});

test('corrupt saved state is treated as empty', () => {
  const e = parseEvent(event({}, { custom_attributes: { bot_state: '{oops' } }));
  assert.deepEqual(e.state, {});
});
