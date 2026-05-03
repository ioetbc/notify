// Hog source executed inside the customer's PostHog project by the destination
// hog function we provision. It POSTs the event to Notify's inbound webhook.
export const HOG_DESTINATION_SOURCE = `
let body := jsonStringify(event)

fetch(inputs.webhook_url, {
  'method': 'POST',
  'headers': {
    'Content-Type': 'application/json'
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
] as const;
