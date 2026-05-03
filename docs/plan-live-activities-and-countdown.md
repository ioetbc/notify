# Plan — Live Activities and Countdown Notifications

Differentiator candidates against PostHog's incoming push workflows. Two related but distinct iOS features; estimating both so we can pick the cheaper wedge first.

## TL;DR

- **Countdown notification** (~4 days, iOS): cheap, doesn't break the "Expo abstracts everything, no APNs creds" architecture, immediately demoable.
- **Live Activity** (~8–12 days, iOS): structural — forces direct APNs integration, ships a Widget Extension. Save for later.
- **Recommendation:** ship the countdown first. If customers will install a dev build for it, Live Activities become viable. If not, Live Activities are dead in the water for the same reason and we save the budget.

---

## 1. Live Activity (Dynamic Island / Lock Screen card)

A persistent, updatable mini-UI that lives on the lock screen and Dynamic Island for hours/days (pizza tracker, Uber ETA, sports scores). **Not a push notification** — a separate Apple primitive that we *update* via push.

### Architecture impact

**Mobile app side (heavy lift)**
- iOS 16.1+ only. Android has no equivalent — fallback would be a foreground service + persistent notification.
- Requires a **Widget Extension** in the iOS app target with an `ActivityConfiguration`. SwiftUI bundle shipped *inside* the app binary — UI cannot be defined server-side.
- Expo support: `expo-live-activity` (community) or a custom config plugin around `ActivityKit`. Either path requires a development build, not Expo Go.
- The customer's app calls `Activity.request(...)` to start the activity (e.g. on "Track order" tap). Returns a `pushToken` specific to that activity instance.

**Platform side**
- New token type: `live_activity_token` — short-lived, per-activity, **not** the same as the device push token. New endpoint to receive it; new table mapping `(user_id, activity_type, started_at, expires_at)`.
- Updates sent via APNs with `apns-push-type: liveactivity` and `apns-topic: <bundle>.push-type.liveactivity`. **Expo's Push API does not currently support the Live Activity push type** — we would need to call APNs directly with token-based JWT auth. This breaks our "Expo only, no APNs creds" architecture.
- Live Activities expire after 8 hours (12 with `staleDate`). Final push needs `event: "end"` to terminate cleanly.

**Canvas changes**
- New node: **Start Live Activity** (notification telling app to start one — or, better, app starts on user action and registers the token with us).
- New node: **Update Live Activity** (sends `event: "update"` payload with new content state).
- Trigger types need to handle "activity expired" and "activity dismissed".

### Effort

| Task | Days |
|---|---|
| iOS Widget Extension + Expo config plugin | 3–5 |
| APNs JWT signing + Live Activity push type in dispatcher | 2 |
| Token registration endpoint + schema | 1 |
| Canvas node types + journey engine support | 2–3 |
| Android foreground-service fallback (optional) | 3 |

**~8–12 days for iOS-only MVP.** The Expo→APNs migration is the structural cost — once we do it for Live Activities we are partly off the "Expo abstracts everything" rails.

---

## 2. Countdown inside a regular push notification

Much cheaper. Apple supports countdown timer text inside any notification via SwiftUI's `Text(timerInterval:)`.

### Two flavours

**Option A — Bundled SwiftUI timer (`Text(timerInterval:)`)**
Simplest version. Push includes a `target_date`. Notification body uses iOS's auto-updating timer format. Updates live without an extension beyond a small **Notification Content Extension** to render the SwiftUI view.

**Option B — Notification Content Extension with full custom UI**
Push includes `category: "countdown"` + `target_date`. iOS calls into our Content Extension which renders an arbitrary SwiftUI view (countdown ring, progress bar, branding). User long-presses to expand. Recommended for the differentiator story.

### Architecture impact

**Mobile**
- Add a Notification Content Extension target in the Expo app (config plugin or prebuild).
- Register a notification category (`countdown`) and a deep link.
- Expo payload supports custom `data` — pass `data: { target_date, kind: "countdown" }`; the extension reads it.

**Platform**
- New canvas node: **Send Countdown Notification** — title, body, target date (absolute or relative to enrollment time).
- Dispatcher: include `mutable-content: 1` and `category` in the Expo push request. Expo passes these through to APNs as-is.
- Receipt polling already works unchanged.

### Effort

| Task | Days |
|---|---|
| Notification Content Extension + Expo plugin | 2 |
| Dispatcher payload changes + canvas node | 1 |
| Schema + canvas UI for `target_date` picker | 1 |

**~4 days, iOS only.** Android can fake it with a `Chronometer` widget in a custom notification layout — another 1–2 days.

---

## Decision

Ship countdown (Option B) first. Reasons:

1. 4 days vs. 12.
2. Doesn't break our Expo-only architecture or force APNs key management.
3. Demoable in week one — gives the sales/positioning story against PostHog something concrete.
4. Validates the dev-build adoption question that gates Live Activities anyway.

If countdown lands and customers ask "can it persist on the lock screen?", that is the trigger to invest in Live Activities and the APNs-direct work.

## Open questions

- Do any current pilot customers have apps in production today, or are we shipping to dev builds only? Affects how aggressive we can be with native extensions.
- Is the `Send Countdown Notification` node a separate node type, or a variant flag on the existing `Send Notification` node? Lean toward separate — cleaner canvas UX and avoids per-node conditional rendering.
- Where does `target_date` live in the schema — on the workflow node config, or computed at enrollment time from a relative offset? Probably both: node stores `{ kind: "absolute", date }` or `{ kind: "relative", offset_seconds }`.
