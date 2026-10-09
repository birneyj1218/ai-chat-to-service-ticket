'use strict';
// Turn a Chatwoot Agent Bot webhook payload into one of three actions:
//   { kind: 'ignore', reason }         nothing to do
//   { kind: 'release', ... }           a human agent replied while the bot owned the chat: step aside
//   { kind: 'message', ... }           a customer message the bot should answer
//
// Chatwoot sends a conversation to an agent bot while its status is "pending".
// When the bot hands off (or a human replies) the status becomes "open" and the
// bot ignores every later event in that conversation.

function parseState(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? s : {};
  } catch (_) {
    return {};
  }
}

function senderType(body) {
  const s = body.sender || {};
  return String(s.type || body.sender_type || '').toLowerCase();
}

function parseEvent(body) {
  const b = (body && body.body) || body || {};
  if (b.event !== 'message_created') return { kind: 'ignore', reason: 'not a new message' };
  const conv = b.conversation;
  if (!conv || !b.account) return { kind: 'ignore', reason: 'no conversation' };
  if (b.private) return { kind: 'ignore', reason: 'private note' };
  if (conv.status !== 'pending') return { kind: 'ignore', reason: 'a human owns this conversation' };

  const base = { account_id: b.account.id, conversation_id: conv.id };

  if (b.message_type === 'outgoing') {
    // Messages the bot itself posted come back as outgoing from an agent bot: ignore them.
    // An outgoing message from a human user means staff stepped in: release the chat.
    if (senderType(b) === 'user') return { kind: 'release', ...base };
    return { kind: 'ignore', reason: 'bot message' };
  }
  if (b.message_type !== 'incoming') return { kind: 'ignore', reason: 'not a customer message' };

  const text = String(b.content || '').trim();
  if (!text) return { kind: 'ignore', reason: 'empty message' };

  const contact = (conv.meta && conv.meta.sender) || b.sender || {};
  const attrs = conv.custom_attributes || {};
  return {
    kind: 'message',
    ...base,
    text,
    contact: {
      name: String(contact.name || '').trim(),
      phone: String(contact.phone_number || '').trim(),
      email: String(contact.email || '').trim().toLowerCase(),
    },
    state: parseState(attrs.bot_state),
  };
}

module.exports = { parseEvent, parseState };
