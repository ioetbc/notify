## Project Stack

This is a React + Vite + SST project using:

- **TypeScript** — strict typing throughout
- **React 19** with React Router
- **SST** for infrastructure and dev orchestration
- **Hono** for API routes
- **Neon** (`@neondatabase/serverless`) for the database
- **TanStack Query** for client-side data fetching
- **Tailwind v4** + Radix UI primitives + `class-variance-authority` for styling
- **ts-pattern** for control flow
- **Bun** as the test runner (via `sst shell`)

Do not introduce Effect, RxJS, or other large runtime/control-flow frameworks. Stick to the libraries already in `package.json`.

---

## Control Flow

Prefer `ts-pattern`'s `match` with `.exhaustive()` over `switch` statements or chained `if/else if` when branching on a discriminated union, status enum, or tagged variant. Exhaustiveness checking catches missed cases at compile time.

```ts
import { match } from "ts-pattern";

const label = match(status)
  .with("pending", () => "Waiting")
  .with("running", () => "In progress")
  .with("done", () => "Complete")
  .exhaustive();
```

Use plain `if`/early returns for simple boolean checks — don't reach for `match` when there's nothing to match against.

---

## Running Tests

Always run tests through SST shell so secrets and bindings are loaded:

```
npx sst shell -- bun test
```

Equivalent to `bun run test`. Bare `bun test` will be missing env vars. Use `npx sst shell` rather than bare `sst shell` — `sst` may not be on PATH in sandboxed environments.

---

## Optional Parameters

Optional parameters are a major source of bugs by omission. Scrutinise them carefully and prioritise correctness over backwards compatibility — if a param should be required, make it required and update callers.

---

## Imports

Use top-level `import` statements for Node built-ins and project modules. Avoid lazy `import()`-style imports unless there's a specific reason (e.g. genuine circular-dep break, dynamic plugin loading).

---

## Public APIs

Any exported function, type, or component intended for use outside its module should have a JSDoc comment explaining its purpose and any non-obvious behavior.

---

## Test Overrides

If a function or module needs different behavior in tests, do not add `@internal` test-only fields to its public type. Instead, take the dependency as an explicit constructor/function parameter and inject a different implementation in tests.

```ts
// BAD
type Config = {
  /** @internal Test-only override. */
  readonly _idleWarningIntervalMs?: number;
};

// GOOD
type Config = {
  readonly idleWarningIntervalMs: number;
};
```

---

## Testing

### Core Principle

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't break unless behavior changed.

### Good Tests

Integration-style tests that exercise real code paths through public APIs. They describe _what_ the system does, not _how_.

```ts
// GOOD: Tests observable behavior through the public interface
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

- Test behavior users/callers care about
- Use the public API only
- Survive internal refactors
- One logical assertion per test

### Bad Tests

```ts
// BAD: Mocks internal collaborator, tests HOW not WHAT
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});

// BAD: Bypasses the interface to verify via database
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});
```

Red flags:

- Mocking internal collaborators (your own classes/modules)
- Testing private methods
- Asserting on call counts/order of internal calls
- Test breaks when refactoring without behavior change
- Test name describes HOW not WHAT
- Verifying through external means (e.g. querying a DB) instead of through the interface

### Mocking

Mock at **system boundaries** only:

- External APIs (payment, email, Neon, etc.)
- Time/randomness
- File system when a real instance isn't practical

**Never mock your own classes/modules or internal collaborators.** If something is hard to test without mocking internals, redesign the interface.

Prefer SDK-style interfaces over generic fetchers at boundaries — each function is independently mockable with a single return shape, no conditional logic in test setup.

### TDD Workflow: Vertical Slices

Do NOT write all tests first, then all implementation. That produces tests that verify _imagined_ behavior and are insensitive to real changes.

Correct approach — one test, one implementation, repeat:

```
RED→GREEN: test1→impl1
RED→GREEN: test2→impl2
RED→GREEN: test3→impl3
```

Each test responds to what you learned from the previous cycle. Never refactor while RED — get to GREEN first.

### Test Location

Tests live in `__tests__/` folders, not co-located with source files. Filenames should not redundantly include `__tests__` in the name.

---

## Interface Design

### Deep Modules

Prefer deep modules: small interface, deep implementation. A few methods with simple params hiding complex logic behind them.

Avoid shallow modules: large interface with many methods that just pass through to thin implementation. When designing, ask: can I reduce the number of methods? Can I simplify the parameters? Can I hide more complexity inside?

### Design for Testability

1. **Accept dependencies, don't create them** — pass external dependencies in rather than constructing them internally.
2. **Return results, don't produce side effects** — a function that returns a value is easier to test than one that mutates state.
3. **Small surface area** — fewer methods = fewer tests needed, fewer params = simpler test setup.

---

## Database Changes

Only modify the Drizzle schema. Never hand-write SQL migration files, and never run migration commands against the database. The user generates and applies migrations themselves.

---

## Documentation

Update design docs/PRDs in `docs/` **before** writing the implementation, not after. Architecture RFCs and plans belong in `docs/` as `.md` files, not in GitHub issues.
