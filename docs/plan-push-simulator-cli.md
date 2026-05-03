# Plan: Push Simulator CLI

## Context

Developers currently have no fast way to fire a test push notification with arbitrary parameters. Triggering a real send means signing in, enrolling, waiting for the dispatcher cron, etc. We want a `bun` CLI that takes a push token plus payload knobs and either sends immediately or schedules a delivery — like a local "quick push" — so we can iterate on title/body copy, deep links, rich media, and priority without touching the UI.

## Goal

A single CLI entry point: `bun run push:simulate -- --token <ExponentPushToken[...]> [flags]` that posts a push via Expo and prints the receipt id.

## Flags

- `--token` (repeatable) — Expo push token(s)
- `--title`, `--body` — copy
- `--deep-link` — e.g. `reallysimpleapp://workflow/123` (passed in `data.url`)
- `--image` — remote URL for rich media (`richContent.image` on iOS, `bigPictureUrl`-style on Android via `data`)
- `--priority` — `default` | `high`
- `--at` — ISO timestamp; if in the future, schedule via `workflow_enrollment.process_at` instead of immediate send
- `--data` — JSON blob merged into `data`
- `--dry-run` — print the `ExpoPushMessage` without sending

## Implementation

### Files to add
- `apps/server/scripts/push-simulate.ts` — CLI entry. Parse argv (use `util.parseArgs` from node), build an `ExpoPushMessage`, call the shared sender.

### Files to modify
- `apps/server/services/enrollment/send.ts` — extract a lower-level `sendRaw(messages: ExpoPushMessage[])` helper from `sendPushNotification()` so the CLI can bypass the user/DB token lookup. Reuse `Expo.isExpoPushToken()` validation and the existing `expo.sendPushNotificationsAsync()` call.
- `apps/server/db/schema.ts` — extend `SendConfig` (line ~115) with optional `deepLink?: string` and `imageUrl?: string` so scheduled enrollments can carry the same payload shape the CLI exercises. Update the worker to map these onto `data.url` and `richContent`.
- `package.json` (root + `apps/server`) — add `"push:simulate": "sst shell -- bun run apps/server/scripts/push-simulate.ts"` so it runs with SST-loaded env (DB creds for the `--at` scheduling path).

### Scheduled path (`--at` in future)
Insert a row into `workflowEnrollment` with `status='active'`, `process_at = <at>`, and the new `SendConfig` fields populated. The existing `EnrollmentCron` + dispatcher + worker already handle pickup — no new infra.

## Verification

1. `bun run push:simulate -- --token <real-token> --title "hi" --body "from cli" --deep-link "reallysimpleapp://test"` → device receives push, tapping opens the deep link.
2. `--image https://...png` → image renders in the expanded notification on a physical iOS/Android device.
3. `--at` 2 minutes in the future → no immediate send; enrollment row visible in DB; cron picks it up within ~1 min of `process_at`.
4. `--dry-run` prints the `ExpoPushMessage` JSON and exits 0 without network calls.
5. `sst shell -- bun test apps/server/__tests__/` still green; add a unit test for the new `sendRaw` extraction using the existing mocked-Expo pattern from `poll-receipts.test.ts`.

## Critical files

- `apps/server/services/enrollment/send.ts`
- `apps/server/db/schema.ts` (SendConfig)
- `apps/server/scripts/push-simulate.ts` (new)
- `apps/really-simple-app/app.json` (scheme reference, no edits)
