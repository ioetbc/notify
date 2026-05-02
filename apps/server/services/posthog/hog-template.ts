// Hog source executed inside the customer's PostHog project by the destination
// hog function we provision. Computes HMAC-SHA256(webhook_secret, body) and
// POSTs the event to Notify's inbound webhook.
//
// Stdlib note: PostHog's Hog runtime exposes `sha256HmacChainHex(secret, parts[])`
// for HMAC-SHA256 (the same primitive used by their built-in webhook destination).
// Manual smoke test against a real PostHog project is part of Chunk A acceptance.
export const HOG_DESTINATION_SOURCE = `
let body := jsonStringify(event)
let signature := sha256HmacChainHex(inputs.webhook_secret, [body])

fetch(inputs.webhook_url, {
  'method': 'POST',
  'headers': {
    'Content-Type': 'application/json',
    'X-Notify-Signature': signature
  },
  'body': body
})
`.trim();

export const HOG_INPUTS_SCHEMA = [
  {
    key: "webhook_url",
    type: "string",
    label: "Webhook URL",
    required: true,
    secret: false,
  },
  {
    key: "webhook_secret",
    type: "string",
    label: "Webhook secret",
    required: true,
    secret: true,
  },
] as const;
