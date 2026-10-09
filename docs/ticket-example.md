# Ticket example

What the bot sends to Odoo at the end of the [sample conversation](sample-conversation.md).
The n8n node **Odoo: create task** posts this to `/json/2/project.task/create` (Odoo 19 JSON-2 API)
with the bot user's API key as a Bearer token:

```json
{
  "vals_list": [
    {
      "name": "Service request: Water heater leaking from the bottom of the tank (Dana Whitfield)",
      "description": "<p><b>Opened by the website chat assistant</b></p><ul><li><b>Customer:</b> Dana Whitfield</li><li><b>Phone:</b> 555-555-0142</li><li><b>Email:</b> dana@example.com</li><li><b>Address:</b> 12 Mill Lane, Millbrook</li><li><b>Problem:</b> Water heater leaking from the bottom of the tank</li><li><b>Urgency:</b> soon</li><li><b>Chat:</b> Chatwoot conversation 7</li></ul><p><b>Last customer message:</b> 12 Mill Lane, Millbrook</p>",
      "project_id": 1,
      "priority": "0"
    }
  ]
}
```

Odoo answers with the new task id, for example `[25]`. The bot puts that number in its reply
("ref #25") and saves it on the Chatwoot conversation.

How it looks to the office in **Project > Service desk**:

| Field | Value |
|---|---|
| Title | Service request: Water heater leaking from the bottom of the tank (Dana Whitfield) |
| Priority | Normal (urgent requests are starred: `priority = "1"`, title starts with `[URGENT]`) |
| Stage | First stage of the project (for example "New") |
| Description | Customer: Dana Whitfield · Phone: 555-555-0142 · Email: dana@example.com · Address: 12 Mill Lane, Millbrook · Problem: Water heater leaking from the bottom of the tank · Urgency: soon · Chat: Chatwoot conversation 7 · Last customer message: 12 Mill Lane, Millbrook |

All customer text is HTML-escaped before it goes into the description.

On Odoo 18 or older, `src/odoo.js` can make the same call through classic JSON-RPC
(`/jsonrpc`, `execute_kw`); see `tests/odoo.test.js` for both.
