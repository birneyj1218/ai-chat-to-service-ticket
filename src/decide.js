'use strict';
// Conversation and decision logic. Pure function, no I/O, so it is unit-tested
// and pasted unchanged into the n8n "Decide" Code node by scripts/build-workflow.js.
//
// decide({ message, state, llm, config }) -> {
//   reply,        text to post in the chat ("{TICKET}" is replaced with the Odoo task id)
//   handoff,      true = open the conversation for humans; the bot stops replying
//   handoff_note, private note for staff summarising what the bot collected
//   ticket,       null, or { name, description, priority } for a new Odoo task
//   state,        saved on the Chatwoot conversation and passed back next turn
// }
//
// Order of precedence:
//   1. Safety rules (gas smell, active water emergency) are fixed code, never the LLM.
//   2. Asking for a person always wins.
//   3. Limits (too many turns, repeated "not sure") hand off.
//   4. Collecting job details; when complete, open a ticket.
//   5. Answering questions, only when the LLM is confident and the answer passes the guards.

const SLOT_ORDER = ['problem', 'urgency', 'name', 'phone', 'address'];

const ASK = {
  problem: "What's going on? A sentence or two is plenty.",
  urgency: 'How urgent is it: an emergency right now, in the next day or two, or whenever is convenient?',
  name: 'Can I get your name?',
  phone: "What's the best phone number to reach you?",
  address: "What's the address where you need the plumber?",
};

const RE = {
  gas: /\bgas\b[^.?!]*\b(smell|leak|odou?r)|\bsmell(s|ing)?\s+(of\s+|like\s+)?gas\b/i,
  water: /\b(burst|flood(ed|ing)?|pouring|spraying|gushing|through the ceiling|sewage|backing up|overflowing)\b/i,
  human: /^\s*(a\s+)?(person|human|agent|operator)\s*[.!]*\s*$|\b(real person|real human|someone real|live agent|an agent|a manager|(talk|speak|chat) (to|with) (a person|a human|someone|somebody|the office)|call me)\b/i,
  service: /\b(book|booking|appointment|schedule|come out|send (someone|somebody|a plumber)|need a plumber|estimate|leak(ing|s)?|clog(ged)?|broken|not working|no hot water|water heater|drip(ping)?)\b/i,
  price: /(\$\s?\d|\b\d+\s?(dollars|bucks|usd)\b|\bper hour\b)/i,
  credential: /\b(licen[cs]ed|insured|bonded|certified)\b/i,
  phone: /(\+?\d[\d\s().-]{8,}\d)/,
};

function normUrgency(text) {
  const t = String(text || '').toLowerCase();
  if (/emergenc|right now|asap|urgent|immediately/.test(t)) return 'emergency';
  if (/today|tomorrow|soon|day or two|couple (of )?days|this week/.test(t)) return 'soon';
  if (/whenever|no rush|not urgent|routine|next week|convenient|any ?time|flexible/.test(t)) return 'routine';
  return '';
}

function normPhone(text) {
  const m = String(text || '').match(RE.phone);
  if (!m) return '';
  const digits = m[1].replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? m[1].trim() : '';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function freshState(prev) {
  const p = prev && typeof prev === 'object' ? prev : {};
  const s = p.slots && typeof p.slots === 'object' ? p.slots : {};
  const slots = {};
  for (const f of SLOT_ORDER) if (typeof s[f] === 'string' && s[f]) slots[f] = s[f];
  return {
    slots,
    collecting: !!p.collecting,
    asking: SLOT_ORDER.includes(p.asking) ? p.asking : '',
    turns: Number(p.turns) || 0,
    unsure: Number(p.unsure) || 0,
    tickets: Array.isArray(p.tickets) ? p.tickets.slice(-5) : [],
  };
}

function firstName(state) {
  const n = (state.slots.name || '').trim().split(/\s+/)[0];
  return n ? `, ${n}` : '';
}

function missingSlot(state) {
  return SLOT_ORDER.find((f) => !state.slots[f]) || '';
}

// Accept a detail only if it passes a basic check.
function setSlot(state, field, value) {
  if (!value) return;
  if (field === 'phone') {
    const p = normPhone(value);
    if (p) state.slots.phone = p;
  } else if (field === 'urgency') {
    const u = ['emergency', 'soon', 'routine'].includes(value) ? value : normUrgency(value);
    if (u) state.slots.urgency = u;
  } else {
    state.slots[field] = String(value).trim().slice(0, 300);
  }
}

function buildTicket(state, message, kind, urgent) {
  const s = state.slots;
  const urgency = urgent ? 'emergency' : s.urgency || 'not given';
  const who = s.name || message.contact.name || 'website visitor';
  const problem = s.problem || message.text;
  const short = problem.length > 60 ? problem.slice(0, 57).trimEnd() + '...' : problem;
  const rows = [
    ['Customer', s.name || message.contact.name || '-'],
    ['Phone', s.phone || message.contact.phone || '-'],
    ['Email', message.contact.email || '-'],
    ['Address', s.address || '-'],
    ['Problem', problem],
    ['Urgency', urgency],
    ['Chat', `Chatwoot conversation ${message.conversation_id}`],
  ];
  return {
    name: `${urgent || urgency === 'emergency' ? '[URGENT] ' : ''}${kind}: ${short} (${who})`,
    priority: urgent || urgency === 'emergency' ? '1' : '0',
    description:
      '<p><b>Opened by the website chat assistant</b></p><ul>' +
      rows.map(([k, v]) => `<li><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</li>`).join('') +
      `</ul><p><b>Last customer message:</b> ${escapeHtml(message.text)}</p>`,
  };
}

function handoffNote(state, reason) {
  const s = state.slots;
  const got = SLOT_ORDER.filter((f) => s[f]).map((f) => `${f}: ${s[f]}`);
  return `Bot handed off (${reason}). ${got.length ? 'Collected: ' + got.join('; ') + '.' : 'No details collected yet.'}` +
    (state.tickets.length ? ` Ticket(s): ${state.tickets.map((t) => '#' + t).join(', ')}.` : '');
}

// Never let a generated answer quote prices or claim credentials.
function guardAnswer(answer) {
  if (RE.price.test(answer)) {
    return { text: "We don't quote prices over chat, because every job is different. The plumber looks at it first and tells you the price before starting.", handoff: false, price: true };
  }
  if (RE.credential.test(answer)) return { text: '', handoff: true };
  return { text: answer, handoff: false };
}

function decide({ message, state: prevState, llm, config }) {
  const state = freshState(prevState);
  const text = String(message.text || '').slice(0, config.max_message_chars);
  const out = { reply: '', handoff: false, handoff_note: '', ticket: null, state };
  state.turns += 1;

  // Pre-chat form details count as collected.
  if (!state.slots.name && message.contact.name) setSlot(state, 'name', message.contact.name);
  if (!state.slots.phone && message.contact.phone) setSlot(state, 'phone', message.contact.phone);

  const handoff = (reply, reason) => {
    out.reply = reply;
    out.handoff = true;
    out.handoff_note = handoffNote(state, reason);
    state.collecting = false;
    state.asking = '';
    return out;
  };

  // 1. Safety rules: fixed wording, urgent ticket, a person right away.
  if (RE.gas.test(text)) {
    setSlot(state, 'problem', state.slots.problem || text);
    out.ticket = buildTicket(state, message, 'Gas smell reported', true);
    return handoff(
      'If you smell gas, leave the building now and call 911 from outside, then your gas company. I am getting a person from the office on this chat too.',
      'possible gas leak'
    );
  }
  if (RE.water.test(text)) {
    setSlot(state, 'problem', state.slots.problem || text);
    out.ticket = buildTicket(state, message, 'Water emergency', true);
    return handoff(
      "That can't wait. If you can do it safely, turn off the main water valve. I've flagged this as urgent (ref #{TICKET}) and I'm getting a person on this chat right now.",
      'water emergency'
    );
  }

  // 2. A person, on request.
  if (RE.human.test(text) || (llm && llm.intent === 'human')) {
    return handoff("Sure. I'm handing this chat to a person at the office now; they'll reply right here.", 'customer asked for a person');
  }

  // 3. Limits.
  if (state.turns > config.max_bot_turns) {
    return handoff("Let me bring in a person from the office so we don't go in circles. They'll reply right here.", 'turn limit reached');
  }

  // 4. Collecting job details.
  const fields = (llm && llm.fields) || {};
  const startsRequest = (llm && llm.intent === 'service_request') || (!llm && RE.service.test(text));
  if (startsRequest && !state.collecting) {
    state.collecting = true;
    // A new request after an earlier ticket keeps who the customer is, not the old problem.
    delete state.slots.problem;
    delete state.slots.urgency;
    if (!fields.problem && RE.service.test(text) && text.length > 15) fields.problem = text;
  }

  if (state.collecting) {
    for (const f of SLOT_ORDER) setSlot(state, f, fields[f]);
    // If the model missed it, take the reply as the answer to what we just asked.
    if (state.asking && !state.slots[state.asking]) {
      if (state.asking === 'phone') setSlot(state, 'phone', text);
      else if (state.asking === 'urgency') setSlot(state, 'urgency', text);
      else if (!/\?\s*$/.test(text)) setSlot(state, state.asking, text);
    }
    if (!state.slots.urgency) setSlot(state, 'urgency', normUrgency(text));

    const next = missingSlot(state);
    // A question asked mid-form still gets answered when the model is confident.
    let prefix = '';
    if (llm && llm.intent === 'question' && llm.answer && llm.confidence >= config.min_confidence) {
      const g = guardAnswer(llm.answer);
      if (g.text) prefix = g.text + ' ';
    }
    if (next) {
      const askedAgain = state.asking === next;
      state.asking = next;
      state.unsure = 0;
      if (askedAgain && next === 'phone') {
        out.reply = prefix + "Sorry, I couldn't read that as a phone number. Could you type it with the area code?";
      } else if (prefix) {
        out.reply = prefix + ASK[next];
      } else {
        out.reply = (startsRequest ? `Happy to help${firstName(state)}. ` : '') + ASK[next];
      }
      return out;
    }
    out.ticket = buildTicket(state, message, 'Service request');
    state.collecting = false;
    state.asking = '';
    state.unsure = 0;
    const when = state.slots.urgency === 'emergency'
      ? 'Because it is urgent, a person from the office will pick this up right away.'
      : 'The office will call to confirm a time, and the plumber phones before heading over.';
    out.reply = `Thanks${firstName(state)}. I've opened a service ticket (ref #{TICKET}). ${when} Anything else?`;
    if (state.slots.urgency === 'emergency') {
      out.handoff = true;
      out.handoff_note = handoffNote(state, 'urgent service request');
    }
    return out;
  }

  // 5. Questions and small talk.
  if (llm && llm.answer && llm.confidence >= config.min_confidence) {
    const g = guardAnswer(llm.answer);
    if (g.handoff) return handoff("That's one for the office, so I'm passing you to a person now.", 'question outside what the bot may answer');
    state.unsure = 0;
    out.reply = g.price ? `${g.text} Want me to set up a visit?` : g.text;
    return out;
  }

  // Not sure (low confidence, LLM unavailable, or unclear message).
  state.unsure += 1;
  if (state.unsure >= config.max_unsure) {
    return handoff("I'm not sure I can answer that well, so I'm handing you to a person at the office. They'll reply right here.", 'bot unsure');
  }
  out.reply = "Sorry, I'm not sure I understood. I can answer questions about the business, set up a plumber visit, or get you a person. What do you need?";
  return out;
}

// After Odoo creates the task: put its id in the reply, the staff note and the saved state.
function applyTicketId(decision, id) {
  const ref = /^\d+$/.test(String(id == null ? '' : id).trim()) ? String(id).trim() : '';
  if (!ref) {
    // Odoo did not return an id: say so honestly and bring in a person.
    const reply = String(decision.reply || '').replace(/\s*\(ref #\{TICKET\}\)/g, '').split('{TICKET}').join('');
    return {
      ...decision,
      reply: reply + " (I couldn't save the ticket automatically, so a person from the office will take it from here.)",
      handoff: true,
      handoff_note: `${decision.handoff_note || 'Bot handed off.'} Ticket creation FAILED: please open it by hand.`,
      ticket_id: '',
    };
  }
  const state = { ...decision.state, tickets: [...(decision.state.tickets || []), ref].slice(-5) };
  const fill = (s) => String(s || '').split('{TICKET}').join(ref);
  const note = decision.handoff_note ? `${fill(decision.handoff_note)} Ticket #${ref}.` : '';
  return { ...decision, reply: fill(decision.reply), handoff_note: note, ticket_id: ref, state };
}

module.exports = { decide, applyTicketId, guardAnswer, normPhone, normUrgency, SLOT_ORDER };
