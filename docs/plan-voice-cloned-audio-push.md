# Plan: Voice-cloned audio push notifications

Adapt the existing dispatch pipeline so a notification can carry a TTS-generated MP3 of the influencer's cloned voice, played inline in the iOS notification UI (with an Android tap-to-play fallback).

## Scope

- iOS-first MVP using Expo's bare workflow (the app is already ejected — `apps/really-simple-app/ios` exists).
- Android parity as a follow-up (custom in-app player, no inline shade playback).
- One voice per "sender"/influencer; clip ≤30s, ≤5 MB MP3 to satisfy APNs attachment limits.
- Out of scope: real-time streaming TTS, multi-voice mixing, in-app voice training UI.

## Architecture changes

### 1. Voice asset model (server)

New tables (Drizzle migration in `apps/server/drizzle/`):

- `voice_profile` — `id`, `customer_id`, `provider` (`elevenlabs` | `cartesia` | `playht`), `provider_voice_id`, `display_name`, `consent_recording_url`, `consent_signed_at`, `status` (`pending` | `ready` | `revoked`), timestamps.
- `voice_clip` — `id`, `voice_profile_id`, `text_hash` (sha256 of `text + voice_id + provider_voice_id`), `s3_key`, `cdn_url`, `duration_ms`, `byte_size`, `created_at`. The hash is the cache key — identical text on the same voice reuses the same MP3.

Repository at `apps/server/repository/voice/` mirroring the integration repo pattern.

### 2. TTS + storage service

`apps/server/services/voice/`:

- `provider.ts` — thin adapter typed via `ts-pattern` `match(provider)` returning `{ synthesize(text): Promise<Buffer> }`. Start with ElevenLabs only; the match is the seam for adding Cartesia/PlayHT.
- `synthesize.ts` — `getOrCreateClip(voiceProfileId, text)`:
  1. Compute `text_hash`. Look up `voice_clip` row; if present, return its `cdn_url`.
  2. Otherwise call provider, get MP3 bytes, enforce `byte_size ≤ 5 MB` and `duration_ms ≤ 30000` (re-synthesize at lower bitrate or truncate text upstream if violated — fail loudly, don't silently truncate).
  3. `PutObject` to a new `VoiceAudioBucket` (SST `sst.aws.Bucket`) under `voice/{voice_profile_id}/{text_hash}.mp3`, content-type `audio/mpeg`, cache-control `public, max-age=31536000, immutable`.
  4. Front the bucket with a `sst.aws.Router` / CloudFront distribution so the URL is HTTPS and low-latency for the NSE 30s download window. Store the public CDN URL on `voice_clip.cdn_url`.
  5. Return the URL.

ElevenLabs API key lives in SST `sst.Secret` (`ElevenLabsApiKey`) and is `link`ed to the worker function only.

### 3. Worker integration

`apps/server/functions/worker/index.ts` is where each enrollment step is currently turned into an Expo push. Add a step type / branch (extend the existing `match()` over step kinds — keep ts-pattern exhaustive) for `audio_push`:

- Resolve `voice_profile_id` for the enrollment (from workflow definition or customer default).
- `getOrCreateClip(voice_profile_id, renderedText)`.
- Build the Expo push payload with:
  - `title`, `body` — keep text fallback for devices/locales that don't render audio.
  - `data: { audio_url, audio_duration_ms, voice_profile_id, text_hash }` — used by the NSE.
  - `mutableContent: true` (Expo SDK exposes this; it sets APNs `mutable-content: 1`).
  - `_contentAvailable: true` is unnecessary — we don't need silent wake.
  - For Android: `data.audio_url` only; no inline playback (see §5).

No changes to receipt polling — receipts still gate on Expo ack/error, not audio fetch success (that lives client-side).

### 4. iOS Notification Service Extension

Add a new target to `apps/really-simple-app/ios/`:

- `NotificationService` target (Swift). In `didReceive(_:withContentHandler:)`:
  1. Read `audio_url` from `request.content.userInfo`.
  2. `URLSession` download to a temp file, watch the 30s soft deadline (set a `DispatchQueue.asyncAfter` timeout at ~25s that calls `contentHandler` with the original content — degrade to text-only).
  3. Move the file to a `.mp3` URL, create `UNNotificationAttachment(identifier:url:options:)` with `UNNotificationAttachmentOptionsTypeHintKey: kUTTypeMP3`.
  4. `bestAttempt.attachments = [attachment]`; `contentHandler(bestAttempt)`.
- Wire the target into the Expo prebuild via an Expo config plugin under `apps/really-simple-app/plugins/notification-service-extension/` (write a small plugin — Expo doesn't ship NSE support out of the box). Register it in `app.json` `plugins`. Document `bunx expo prebuild --clean` as required when the plugin changes.
- App group / shared container: not needed for the MVP (we don't need to write back to the app from the NSE). Add later if we want to cache MP3s for in-app replay.

### 5. Android fallback

- In the RN notification handler (`expo-notifications` `setNotificationHandler` + `addNotificationResponseReceivedListener`), detect `data.audio_url` and:
  - On Android, render a plain notification (text only) with `categoryIdentifier: "audio"`. On tap, deep-link via `expo-router` to a new `/play/[clipId]` screen that streams the MP3 with `expo-av`.
  - On iOS, the NSE already handled inline playback; tap behavior stays the default.
- Acceptable UX gap: Android users open the app to listen; document this in the RFC and the in-app first-run notice.

### 6. Client UX + consent

- New onboarding screen for the influencer/admin in `apps/client/pages/voice/`:
  - Upload 1–5 min reference audio.
  - Record verbal consent statement (ElevenLabs requires a specific phrase — store the recording in S3, link from `voice_profile.consent_recording_url`).
  - "Test phrase" input → calls server preview endpoint → plays back the synthesized clip before saving.
- Public API additions in `apps/server/functions/public/voice.ts`:
  - `POST /voice-profiles` (multipart: reference + consent), `GET /voice-profiles`, `POST /voice-profiles/:id/preview` (text → MP3 URL), `DELETE /voice-profiles/:id` (also revokes at provider).

### 7. Legal + disclosure

- Surface "AI-generated voice" copy in:
  - The first audio notification's body text (e.g. `🔊 AI voice message from {name}`).
  - The in-app player screen.
- Persist `consent_signed_at` and the consent recording. Add `voice_profile.disclosure_text` so we can update the recipient-facing copy without a redeploy.
- Add a kill switch: an admin endpoint that flips `voice_profile.status` to `revoked` and stops the worker from synthesizing new clips for that profile (existing cached clips stay served — document this).

## Implementation order

1. **Day 0.5 — Voice clone setup.** Create ElevenLabs account, clone a test voice, hand-test quality with sample scripts. No code yet; this de-risks the rest.
2. **Day 1 — Server pipeline.**
   - Migration for `voice_profile` + `voice_clip`.
   - `services/voice/synthesize.ts` + ElevenLabs adapter.
   - `VoiceAudioBucket` + Router in `sst.config.ts`.
   - Unit tests in `apps/server/__tests__/voice-synthesize.test.ts` (hash-based caching, size limits, provider error mapping).
3. **Day 1 — Worker + payload.**
   - Extend the worker step match with `audio_push`.
   - Tests covering: clip reuse on identical text, fallback to text-only when synthesis fails, mutable-content flag set.
4. **Day 1 — iOS NSE.**
   - Expo config plugin.
   - Swift NSE with timeout/fallback.
   - Manual device test — confirm the inline play button shows in the notification.
5. **Day 1 — Android fallback + in-app player.**
   - `/play/[clipId]` route, `expo-av` playback, deep link from notification tap.
6. **Day 0.5 — Client consent + preview UI.** Voice profile create/preview/delete flow.
7. **Day 0.5 — Plumbing.** Wire `audio_push` into existing workflow definitions (one workflow uses it end-to-end), receipt poller smoke test, observability counters (synthesis latency, cache hit rate, NSE fallback rate via a client-reported event).

Total: ~5 days for iOS + Android.

## Risks

- **Clone quality on short reference clips.** Mitigation: gate the voice profile behind a "preview & approve" step before any push uses it.
- **5 MB / 30 s NSE limits.** Keep MP3 at 64 kbps mono — that's ~480 KB for 60s, well inside. CloudFront in front of S3 to keep the download under the 30s wall.
- **Provider lock-in / pricing.** The `ts-pattern` provider seam keeps switching cheap. Track per-character cost in `voice_clip` (extra column `synthesis_cost_micros`) so we can see actual spend per workflow.
- **APNs silently dropping audio attachments** if `mutable-content` is missing or the NSE crashes. Add a server-side log + a client-reported "audio attached" event; alert on high fallback rate.
- **Legal — TN ELVIS Act, EU AI Act.** Hard requirement: signed consent + recipient-facing disclosure. Do not ship without both. Loop in legal before the first production send.

## Open questions

- Per-customer voice or per-workflow voice? (Default: per customer, override per workflow.)
- Do we re-render audio when the message template changes mid-enrollment, or freeze the clip URL on the enrollment row at scheduling time? (Recommend: freeze on scheduling — simpler receipts, no surprise re-synthesis costs.)
- Provider choice — ElevenLabs for MVP, but worth a 2-hour bake-off vs Cartesia on the actual reference clip before locking in.
