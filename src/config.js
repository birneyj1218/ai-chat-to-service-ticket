'use strict';
// Default settings for the demo brand "Stonebridge Plumbing" (fictional).
// In n8n these values live in the "Config" node; edit them there.
// Secrets (API keys, tokens) never go here: they live in n8n credentials.

const DEFAULT_CONFIG = {
  business_name: 'Stonebridge Plumbing',
  // Facts the assistant may use to answer questions. Anything not covered here
  // should make the model report low confidence, which hands the chat to a person.
  business_facts: [
    'Stonebridge Plumbing is a residential and light-commercial plumbing company.',
    'Office hours: Monday to Friday, 8am to 5pm. The chat is answered any time; urgent problems get a person right away.',
    'Service area: Stonebridge, Millbrook and Cedar Falls (demo towns).',
    'Services: water heaters (tank and tankless), leaks and burst pipes, drain cleaning, repiping, fixtures (faucets, toilets, sinks), sump pumps, leak detection.',
    'Prices are never quoted in chat: the plumber looks at the job first and gives the price before starting work.',
    'The plumber phones the customer before heading over.',
  ],

  // LLM (any OpenAI-compatible /chat/completions endpoint: OpenAI, a local Ollama or vLLM server, etc.)
  llm_base_url: 'https://api.openai.com/v1',
  llm_model: 'gpt-4o-mini',
  llm_json_mode: true, // send response_format: {type: "json_object"}; turn off if your server rejects it
  llm_max_tokens: 400,
  llm_temperature: 0.2,
  min_confidence: 0.6, // below this, the bot does not answer on its own

  // Odoo
  odoo_url: 'http://odoo:8069',
  odoo_db: 'servicedesk',
  odoo_project_id: 1, // project.project id of the service desk

  // Chatwoot
  chatwoot_url: 'http://chatwoot:3000',
  chatwoot_handoff_team_id: null, // optional: assign handed-off chats to this team

  // Limits
  max_bot_turns: 15, // after this many customer messages the bot hands off
  max_message_chars: 1000, // longer customer messages are truncated before the LLM call
  max_unsure: 2, // consecutive "not sure" turns before handoff
};

module.exports = { DEFAULT_CONFIG };
