'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, applyTicketId, normPhone, normUrgency } = require('../src/decide');
const { config, msg, llm } = require('./helpers');

test('gas smell: fixed safety reply, urgent ticket, handoff, even if the LLM says otherwise', () => {
  const d = decide({ message: msg('I think I smell gas in the kitchen'), state: {}, llm: llm('question', { answer: 'Sure!', confidence: 1 }), config });
  assert.match(d.reply, /leave the building now and call 911/);
  assert.equal(d.handoff, true);
  assert.equal(d.ticket.priority, '1');
  assert.match(d.ticket.name, /^\[URGENT\] Gas smell/);
  assert.match(d.handoff_note, /possible gas leak/);
});

test('active water emergency: shut-off advice, urgent ticket with ref placeholder, handoff', () => {
  const d = decide({ message: msg('A pipe burst and water is pouring through the ceiling!'), state: {}, llm: null, config });
  assert.match(d.reply, /main water valve/);
  assert.match(d.reply, /\{TICKET\}/);
  assert.equal(d.handoff, true);
  assert.equal(d.ticket.priority, '1');
});

test('asking for a person hands off without a ticket', () => {
  for (const t of ['Can I talk to a real person please?', 'person', 'please just call me']) {
    const d = decide({ message: msg(t), state: {}, llm: null, config });
    assert.equal(d.handoff, true, t);
    assert.equal(d.ticket, null);
  }
  const viaLlm = decide({ message: msg('get me somebody from your team'), state: {}, llm: llm('human'), config });
  assert.equal(viaLlm.handoff, true);
});

test('"when is the office open" is a question, not a handoff', () => {
  const d = decide({
    message: msg('When is the office open?'),
    state: {},
    llm: llm('question', { answer: 'The office is open Monday to Friday, 8am to 5pm.' }),
    config,
  });
  assert.equal(d.handoff, false);
  assert.match(d.reply, /Monday to Friday/);
});

test('confident answers are posted; low-confidence answers are not', () => {
  const ok = decide({ message: msg('Do you fix sump pumps?'), state: {}, llm: llm('question', { answer: 'Yes, we install and repair sump pumps.' }), config });
  assert.equal(ok.reply, 'Yes, we install and repair sump pumps.');
  const unsure = decide({ message: msg('Do you do pool heaters?'), state: {}, llm: llm('question', { answer: 'Probably yes', confidence: 0.3 }), config });
  assert.notEqual(unsure.reply, 'Probably yes');
  assert.equal(unsure.handoff, false);
  assert.equal(unsure.state.unsure, 1);
});

test('two unsure turns in a row hand off', () => {
  const first = decide({ message: msg('asdf'), state: {}, llm: null, config });
  const second = decide({ message: msg('qwerty'), state: first.state, llm: null, config });
  assert.equal(second.handoff, true);
  assert.match(second.handoff_note, /bot unsure/);
});

test('generated answers never quote prices or claim credentials', () => {
  const price = decide({ message: msg('How much for a new faucet?'), state: {}, llm: llm('question', { answer: 'About $150 installed.' }), config });
  assert.doesNotMatch(price.reply, /\$/);
  assert.match(price.reply, /don't quote prices/);
  const lic = decide({ message: msg('Are you licensed?'), state: {}, llm: llm('question', { answer: 'Yes, we are fully licensed and insured.' }), config });
  assert.equal(lic.handoff, true);
  assert.doesNotMatch(lic.reply, /licensed/);
});

test('service request collects problem, urgency, name, phone, address, then opens one ticket', () => {
  let s = {};
  let d = decide({ message: msg('My water heater is leaking from the bottom'), state: s, llm: llm('service_request', { fields: { problem: 'Water heater leaking from the bottom' } }), config });
  assert.equal(d.state.asking, 'urgency');
  assert.equal(d.ticket, null);
  d = decide({ message: msg('In the next day or two would be good'), state: d.state, llm: llm('other', { fields: {} }), config });
  assert.equal(d.state.slots.urgency, 'soon');
  assert.equal(d.state.asking, 'name');
  d = decide({ message: msg('Dana Whitfield'), state: d.state, llm: llm('other', { fields: { name: 'Dana Whitfield' } }), config });
  assert.equal(d.state.asking, 'phone');
  d = decide({ message: msg('my number is 555 0100'), state: d.state, llm: llm('other'), config });
  assert.equal(d.state.asking, 'phone', 'a 7-digit number is rejected');
  assert.match(d.reply, /area code/);
  d = decide({ message: msg('(555) 555-0142'), state: d.state, llm: llm('other', { fields: { phone: '(555) 555-0142' } }), config });
  assert.equal(d.state.asking, 'address');
  d = decide({ message: msg('12 Mill Lane, Millbrook'), state: d.state, llm: llm('other', { fields: { address: '12 Mill Lane, Millbrook' } }), config });
  assert.ok(d.ticket, 'ticket opened');
  assert.equal(d.ticket.priority, '0');
  assert.match(d.ticket.name, /Service request: Water heater leaking/);
  assert.match(d.ticket.description, /555-0142/);
  assert.match(d.ticket.description, /12 Mill Lane/);
  assert.match(d.reply, /ref #\{TICKET\}/);
  assert.equal(d.handoff, false);
  assert.equal(d.state.collecting, false);
  const done = applyTicketId(d, 42);
  assert.match(done.reply, /ref #42/);
  assert.deepEqual(done.state.tickets, ['42']);
});

test('details from the pre-chat form and one rich message skip questions already answered', () => {
  const d = decide({
    message: msg('Kitchen sink is clogged, not urgent, I am at 4 Oak St, Cedar Falls', { name: 'Sam Ortiz', phone: '+1 555 555 0199' }),
    state: {},
    llm: llm('service_request', { fields: { problem: 'Kitchen sink clogged', urgency: 'routine', address: '4 Oak St, Cedar Falls' } }),
    config,
  });
  assert.ok(d.ticket);
  assert.match(d.reply, /Thanks, Sam/);
});

test('urgent (but not flooding) service request opens a ticket and brings in a person', () => {
  let d = decide({ message: msg('No hot water at all', { name: 'Lee', phone: '555-555-0123' }), state: {}, llm: llm('service_request', { fields: { problem: 'No hot water', urgency: 'emergency' } }), config });
  assert.equal(d.state.asking, 'address');
  d = decide({ message: msg('9 Bridge Rd'), state: d.state, llm: llm('other'), config });
  assert.equal(d.ticket.priority, '1');
  assert.equal(d.handoff, true);
});

test('a question asked mid-form is answered and the form continues', () => {
  let d = decide({ message: msg('I need someone to look at a leaking toilet'), state: {}, llm: llm('service_request', { fields: { problem: 'Leaking toilet' } }), config });
  d = decide({ message: msg('Do you come out to Millbrook?'), state: d.state, llm: llm('question', { answer: 'Yes, Millbrook is in our service area.' }), config });
  assert.match(d.reply, /^Yes, Millbrook is in our service area\. How urgent/);
  assert.equal(d.state.slots.urgency, undefined);
});

test('works without an LLM: keyword fallback starts the form', () => {
  const d = decide({ message: msg('I need to book a plumber for a dripping faucet'), state: {}, llm: null, config });
  assert.equal(d.state.collecting, true);
  assert.equal(d.state.slots.problem, 'I need to book a plumber for a dripping faucet');
});

test('turn limit hands off', () => {
  const d = decide({ message: msg('hello again'), state: { turns: config.max_bot_turns }, llm: llm('greeting', { answer: 'Hi!' }), config });
  assert.equal(d.handoff, true);
  assert.match(d.handoff_note, /turn limit/);
});

test('ticket text is HTML-escaped', () => {
  const d = decide({ message: msg('<script>alert(1)</script> burst pipe'), state: {}, llm: null, config });
  assert.doesNotMatch(d.ticket.description, /<script>/);
  assert.match(d.ticket.description, /&lt;script&gt;/);
});

test('failed ticket creation is admitted and handed off', () => {
  const d = applyTicketId({ reply: "I've opened a service ticket (ref #{TICKET}). Anything else?", handoff: false, state: {} }, undefined);
  assert.doesNotMatch(d.reply, /\{TICKET\}|ref #/);
  assert.equal(d.handoff, true);
  assert.match(d.handoff_note, /FAILED/);
});

test('helpers', () => {
  assert.equal(normPhone('call 555-555-0100 after 5'), '555-555-0100');
  assert.equal(normPhone('555 0100'), '');
  assert.equal(normUrgency('ASAP please'), 'emergency');
  assert.equal(normUrgency('whenever is fine'), 'routine');
  assert.equal(normUrgency('blue'), '');
});
