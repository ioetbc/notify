# Code Smells & Technical Debt

## Critical (Fix Before Production)

- [ ] **Remove .env from git history** - API keys and secrets are exposed in `.env` file
- [ ] **Add API authentication/authorization** - All endpoints in `server/functions/index.ts` lack auth checks
- [ ] **Restrict CORS origins** - Currently set to `allowOrigins: ['*']` in `server/functions/index.ts:32`
- [ ] **Add database transactions** - POST/PUT `/workflows` creates records in separate queries with no rollback on failure

## High Priority

### Data Fetching
- [ ] **Use TanStack Query + Hono RPC** - Currently using raw `fetch()` in components:
  - `src/react-app/pages/canvas/canvas.tsx` (lines 251-264, 273-285, 342-354)
  - `src/react-app/pages/workflow/workflow.tsx` (lines 91-114, 124-138)
  - No caching, no retry logic, no request deduplication
  - Error handling via `console.error()` with no user feedback
  - Uses `alert()` for errors instead of proper UI

### Database
- [ ] **Use SQL ORM (Knex or Drizzle)** - Currently raw SQL queries throughout `server/functions/index.ts`
  - 387 lines of direct SQL in API handler
  - Significant code duplication between POST and PUT handlers (lines 113-173 vs 234-290)
  - No query builders or repository pattern

### Validation
- [ ] **Add input validation with Zod** - No request validation despite Zod being available
  - User input passed directly to SQL without app-level validation
  - No max length checks, no field presence validation
  - `user_column` in branch steps accepts arbitrary values

### Error Handling
- [ ] **Add React Error Boundaries** - Any component error crashes entire page
- [ ] **Create centralized error handling** - Errors scattered across components with inconsistent handling
- [ ] **Remove server error details from responses** - `server/functions/index.ts:178` exposes error messages to client

## Medium Priority

### Code Organization
- [ ] **Extract duplicate POST/PUT workflow code** - Same logic duplicated in `server/functions/index.ts`
- [ ] **Separate concerns in API handler** - Single file handles routing, validation, DB queries, and business logic
- [ ] **Centralize API URL config** - `API_URL` extracted separately in each component

### Type Safety
- [ ] **Add discriminated unions for step types** - Config object uses optional fields for all properties allowing invalid combinations
- [ ] **Add proper input typing** - `c.req.json()` calls have no type annotation
- [ ] **Remove unsafe type casts** - `as StepNodeData` casts in `canvas.tsx:428`

### Testing
- [ ] **Add unit tests** - Zero test files in the codebase
- [ ] **Add integration tests for API endpoints**
- [ ] **Add component tests for React components**

### Features
- [ ] **Implement pagination** - `server/functions/index.ts:74` hardcoded `LIMIT 10` with no offset
- [ ] **Add soft deletes** - Currently hard deletes without audit trail
- [ ] **Wire up home page** - `src/react-app/pages/home/home.tsx` uses mock data only

## Low Priority

### Configuration
- [ ] **Extract magic numbers to constants**
  - Wait hours max hardcoded to 720 (`canvas.tsx:622`)
  - Node ID counter starts at 0 without explanation (`canvas.tsx:79-81`)
  - Hardcoded color values throughout
- [ ] **Update placeholder project names** - `sst.config.ts:14` still has `my-sst-project`
- [ ] **Make database region configurable** - Hardcoded to `aws-us-east-1` in `sst.config.ts:16`

### Logging & Monitoring
- [ ] **Add structured logging** - Only `console.error()` statements exist
- [ ] **Add request ID tracking**
- [ ] **Add audit logging** - No record of who changed what and when

### Performance
- [ ] **Optimize N+1 queries** - GET `/workflows/:id` makes separate queries for each step type
- [ ] **Add field selection** - Queries select all fields instead of only needed columns
- [ ] **Add caching for enum values** - User columns and enums refetched on every component mount

### Cleanup
- [ ] **Remove hardcoded dev data** - `server/functions/index.ts:96` has hardcoded `dev@example.com`
- [ ] **Remove commented-out code** - `server/migrations/seed.ts` has commented workflow creation
- [ ] **Fix silent edge failures** - Edges silently skipped if IDs don't map (`server/functions/index.ts:148, 266`)
