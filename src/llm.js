'use strict';
// The LLM does two jobs per customer message, in one call:
//   1. classify the message (question, service request, wants a person, other)
//   2. pull out any job details it contains (name, phone, address, problem, urgency)
// and, for questions, draft a short answer from the business facts only.
// The reply is strict JSON. Anything malformed is treated as "no LLM result",
// and the decision logic falls back to safe rules (ask again, or hand off).

const INTENTS = ['question', 'service_request', 'human', 'greeting', 'other'];
const FIELDS = ['name', 'phone', 'address', 'problem', 'urgency'];
const URGENCY = ['emergency', 'soon', 'routine'];

function systemPrompt(config) {
  return [
    `You are the website chat assistant for ${config.business_name}.`,
    'Read the customer message and reply with ONE JSON object, no other text:',
    '{"intent": "question" | "service_request" | "human" | "greeting" | "other",',
    ' "answer": string (a short, friendly reply, 1-3 sentences, plain text),',
    ' "fields": {"name"?: string, "phone"?: string, "address"?: string, "problem"?: string,',
    '            "urgency"?: "emergency" | "soon" | "routine"},',
    ' "confidence": number between 0 and 1 (how sure you are that "answer" is correct and fully supported by the facts)}',
    '',
    'Rules:',
    '- Use ONLY the business facts below. If the facts do not answer the question, set confidence below 0.5.',
    '- Never quote prices, discounts or time estimates. Never claim licences, insurance or certifications.',
    '- "service_request" = the customer wants a plumber to come out, or reports a problem with a past job.',
    '- "human" = the customer asks for a person, the office, a manager, or to be called.',
    '- Only put details in "fields" that the customer actually wrote. Do not guess.',
    '',
    'Business facts:',
    ...config.business_facts.map((f) => `- ${f}`),
  ].join('\n');
}

function userPrompt(text, state) {
  const slots = (state && state.slots) || {};
  const known = FIELDS.filter((f) => slots[f]).map((f) => `${f}=${JSON.stringify(slots[f])}`);
  return [
    `Details already collected: ${known.length ? known.join(', ') : 'none'}.`,
    state && state.asking ? `The assistant just asked the customer for: ${state.asking}.` : '',
    `Customer message: ${JSON.stringify(text)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// Body for POST {llm_base_url}/chat/completions
function buildLlmRequest(config, text, state) {
  const body = {
    model: config.llm_model,
    temperature: config.llm_temperature,
    max_tokens: config.llm_max_tokens,
    messages: [
      { role: 'system', content: systemPrompt(config) },
      { role: 'user', content: userPrompt(String(text).slice(0, config.max_message_chars), state) },
    ],
  };
  if (config.llm_json_mode) body.response_format = { type: 'json_object' };
  return body;
}

function clip(v, n) {
  return typeof v === 'string' ? v.trim().slice(0, n) : '';
}

// Normalise an OpenAI-compatible response into {intent, answer, fields, confidence}, or null.
function parseLlmResponse(resp) {
  try {
    if (!resp || resp.error) return null;
    const content = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
    if (typeof content !== 'string') return null;
    const m = content.match(/\{[\s\S]*\}/); // tolerate ```json fences or a stray sentence
    if (!m) return null;
    const j = JSON.parse(m[0]);
    if (!INTENTS.includes(j.intent)) return null;
    const fields = {};
    const src = j.fields && typeof j.fields === 'object' ? j.fields : {};
    for (const f of FIELDS) {
      const v = clip(src[f], 300);
      if (v) fields[f] = v;
    }
    if (fields.urgency && !URGENCY.includes(fields.urgency.toLowerCase())) delete fields.urgency;
    else if (fields.urgency) fields.urgency = fields.urgency.toLowerCase();
    let confidence = Number(j.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.min(1, Math.max(0, confidence));
    return { intent: j.intent, answer: clip(j.answer, 600), fields, confidence };
  } catch (_) {
    return null;
  }
}

module.exports = { buildLlmRequest, parseLlmResponse, systemPrompt, INTENTS, FIELDS, URGENCY };
