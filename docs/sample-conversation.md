# Sample conversation (fictional)

Stonebridge Plumbing is a demo brand; the customer, address and phone number are made up
(555-01xx numbers are reserved for fiction). The bot replies below are the exact output of
`src/decide.js` for these messages, with the LLM's classification shown in brackets.

The customer filled in the Chatwoot pre-chat form with their name, so the bot does not ask for it again.

| | Message | What happened |
|---|---|---|
| **Customer** | Hi! What are your hours? | LLM: `question`, confidence 0.9, answer drawn from the business facts |
| **Bot** | The office is open Monday to Friday, 8am to 5pm. You can message here any time, and urgent problems get a person right away. | |
| **Customer** | Do you come out to Millbrook? | LLM: `question` |
| **Bot** | Yes, Millbrook is in our service area. Want me to set up a plumber visit? | |
| **Customer** | Yes please. My water heater is leaking from the bottom of the tank. | LLM: `service_request`, extracts `problem`. The bot starts collecting details. |
| **Bot** | Happy to help, Dana. How urgent is it: an emergency right now, in the next day or two, or whenever is convenient? | `name` already known from the pre-chat form |
| **Customer** | How much does a new one cost? | LLM drafted "A new tank usually runs $1,200 to $1,800." |
| **Bot** | We don't quote prices over chat, because every job is different. The plumber looks at it first and tells you the price before starting. How urgent is it: an emergency right now, in the next day or two, or whenever is convenient? | The price guard replaced the drafted answer, then the form continued |
| **Customer** | Not an emergency, but in the next day or two would be good. | `urgency = soon` |
| **Bot** | What's the best phone number to reach you? | |
| **Customer** | 555-555-0142 | Phone accepted (10 digits) |
| **Bot** | What's the address where you need the plumber? | |
| **Customer** | 12 Mill Lane, Millbrook | All five details present: Odoo task created |
| **Bot** | Thanks, Dana. I've opened a service ticket (ref #25). The office will call to confirm a time, and the plumber phones before heading over. Anything else? | See [ticket-example.md](ticket-example.md) |
| **Customer** | Can I talk to a real person about the old one? | Matches the "ask for a person" rule |
| **Bot** | Sure. I'm handing this chat to a person at the office now; they'll reply right here. | Conversation set to **open**; the bot stops |

Private note posted for staff at the handoff (customers do not see it):

> Bot handed off (customer asked for a person). Collected: problem: Water heater leaking from the bottom of the tank; urgency: soon; name: Dana Whitfield; phone: 555-555-0142; address: 12 Mill Lane, Millbrook. Ticket(s): #25.

## Emergency path (no LLM involved)

Safety rules run before the LLM result is even looked at, and they also work when the LLM is down.

| | Message |
|---|---|
| **Customer** | Help, a pipe burst under the kitchen sink and water is everywhere |
| **Bot** | That can't wait. If you can do it safely, turn off the main water valve. I've flagged this as urgent (ref #26) and I'm getting a person on this chat right now. |

An urgent task (priority starred) is opened in Odoo with whatever details are known, the
conversation is opened for staff, and this note is posted:

> Bot handed off (water emergency). Collected: problem: Help, a pipe burst under the kitchen sink and water is everywhere; name: Sam Ortiz; phone: +1 555 555 0199. Ticket #26.

A gas smell gets a fixed "leave the building and call 911 from outside" reply, an urgent ticket and an immediate handoff.
