# Delivery Architecture

## Event Ingestion

- `POST /events` → write to SQS → return `202`
- Worker picks up event, looks up matching journey triggers, fans out one SQS message per journey

## Journey Processing

- Worker picks up journey message, processes steps sequentially
- **Wait node**: write `resume_at` to `journey_enrollments`, set status to `waiting`
- **Condition node**: query `events` table fresh to evaluate
- **Send Notification node**: write to `notifications` table + push to SQS, continue immediately

## Wait Node Resumption

- Hourly cron queries `journey_enrollments WHERE status = 'waiting' AND resume_at <= NOW()`
- Fans out one SQS message per user
- Workers resume each user at their current step

## Notification Delivery

- SQS queue with Lambda batch window (30s or 100 messages)
- Lambda pulls notification details from DB, sends batch to Expo
- Updates statuses in DB

## Error Handling

- SQS retries with backoff
- DLQ for persistent failures

## Key Design Decisions

### Why async event ingestion?
Events can trigger multiple journeys. Async processing with fan-out ensures each journey is processed independently and can fail/retry in isolation.

### Why hourly cron for Wait nodes?
Wait times are stored as hours under the hood (e.g., "2 days" = 48 hours). Hourly cron provides acceptable precision (~1 hour max drift) while keeping the system simple. A single cron job queries the DB and fans out to workers.

### Why Lambda batch window for notifications?
Expo's Push API accepts up to 100 notifications per request. Using SQS + Lambda with a batch window (30 seconds or 100 messages, whichever comes first) naturally accumulates notifications for efficient batching without polling or coordination logic.

### Why continue immediately after Send Notification?
For MVP, we don't wait for delivery confirmation before advancing the journey. The notification is queued and the user moves to the next step. Delivery confirmation gating can be added later as a feature enhancement.

### Why query events fresh at Condition nodes?
Events can arrive while a user is in a Wait node. Querying the events table at evaluation time ensures the condition reflects the latest state. No need to interrupt waiting users when new events come in.

### Journey modification while users are waiting
When a journey is deleted or modified, enrolled users are marked accordingly in the DB. The cron and workers check enrollment status before processing and skip cancelled enrollments.

## Database Tables

### journey_enrollments
- `user_id`
- `journey_id`
- `current_step_id`
- `status`: enum (`active`, `waiting`, `completed`, `cancelled`, `error`)
- `resume_at`: timestamp (for Wait nodes)
- `enrolled_at`: timestamp
- `outcome`: enum (`completed`, `filtered_by_condition`, `unsubscribed`, `journey_deleted`, ...)
- `outcome_reason`: text
- `outcome_at`: timestamp

### notifications
- `id`
- `user_id`
- `push_token`
- `title`
- `body`
- `deep_link`
- `status`: enum (`pending`, `sent`, `failed`)
- `expo_ticket_id`
- `created_at`
- `sent_at`

### events
- `id`
- `user_id`
- `customer_id`
- `event_name`
- `properties`: jsonb
- `timestamp`
