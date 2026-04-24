# Testing Strategy — Workflow Execution Engine

## Overview

Two test suites covering the two critical paths of the workflow engine. Tests use **Bun's built-in test runner** with mocked repository layers (no real DB).

---

## Area 1: Trigger Endpoints + Enrollment

**File:** `server/services/public/public.test.ts`

Tests that the three API trigger entry points correctly find matching active workflows and enroll users.

**Mocked modules:**
- `server/repository/public` — controls user CRUD, workflow lookup, enrollment creation
- `server/repository/workflow` — controls step/edge lookup for `enrollUser`

### Test Cases

| Function | Scenario | Expected |
|---|---|---|
| `createUser` | Creates user + matching active workflows exist | User created, enrolled into each matching workflow |
| `createUser` | No matching workflows | User created, no enrollment |
| `createUser` | User already exists | Returns `null`, no enrollment |
| `updateUserAttributes` | Updates attrs + `user_updated` workflows exist | Attributes updated, enrolled into matching workflows |
| `updateUserAttributes` | User not found | Returns `null` |
| `trackEvent` | Matching workflows for event name | Enrolls user, returns correct `workflows_triggered` count |
| `trackEvent` | No matching workflows | Event created, `workflows_triggered: 0` |
| `trackEvent` | User not found | Returns `null` |
| `enrollUser` | Workflow has steps and edges | `currentStepId` set to root step (no incoming edges), `processAt` set to now |
| `enrollUser` | Workflow has no steps | Returns `null` |

---

## Area 2: Step Walker + `processReadyEnrollments`

**File:** `server/services/enrollment/enrollment.test.ts`

Tests the core engine that walks enrolled users through workflow steps.

**Mocked modules:**
- `server/repository/enrollment` — controls enrollment queries, user lookup, step/edge loading, enrollment updates

### walkStep (tested indirectly through `processEnrollment`)

`walkStep` is a private function — we test it by setting up specific step/edge graphs via mocks and asserting the `updateEnrollment` calls that result.

| Step Type | Scenario | Expected |
|---|---|---|
| **send** | Has outgoing edge | Continues to next step |
| **send** | No outgoing edge (terminal) | Enrollment `completed` |
| **branch** | `=` matches, true edge exists | Continues down true branch |
| **branch** | `=` doesn't match, false edge exists | Continues down false branch |
| **branch** | Attribute key missing from user | Enrollment `exited` |
| **branch** | `exists` operator, key present | Continues down true branch |
| **branch** | `not_exists` operator, key absent | Continues down true branch |
| **filter** | `=` passes | Continues |
| **filter** | `=` fails | Enrollment `exited` |
| **filter** | `>` / `<` numeric comparison | Correct result |
| **filter** | Attribute key missing | Enrollment `exited` |
| **wait** | Has outgoing edge | Enrollment paused, `processAt` set to future, `currentStepId` = step after wait |
| **wait** | No outgoing edge | Enrollment `completed` |
| **exit** | Always | Enrollment `exited` |

### processEnrollment (multi-step workflows)

| Scenario | Expected |
|---|---|
| Linear: send -> send -> end | Both sends logged, enrollment `completed` |
| Branch true path: branch -> send | Follows true edge, completes |
| Filter fail: filter -> send | Fails filter, enrollment `exited` |
| Wait mid-chain: send -> wait -> send | First send processed, paused with future `processAt` |
| Missing user | Returns without error |
| Dangling `currentStepId` | Enrollment `completed` |

### processReadyEnrollments (orchestration)

| Scenario | Expected |
|---|---|
| No ready enrollments | Returns `{ processed: 0, failed: 0 }` |
| Multiple enrollments | All processed, each locked to `processing` first |
| One enrollment throws | Failed one reset to `active`, others still processed |

---

## Approach: Mock at the Repository Boundary

```
API Endpoint → Service Layer → Repository Layer → DB
                    ^                  ^
                    |                  |
               code under test    mocked here
```

The service layer imports from `../../repository/...`. We mock those modules using `bun:test`'s `mock.module()` so no database connection or SST resource binding is needed.

---

## Running Tests

```bash
bun test                                              # all tests
bun test server/services/public/public.test.ts        # trigger + enrollment
bun test server/services/enrollment/enrollment.test.ts # step walker
```
