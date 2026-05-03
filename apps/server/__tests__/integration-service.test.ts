import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  makePosthogIntegration,
  PosthogIntegrationError,
  type IntegrationDeps,
  type PosthogIntegrationPort,
} from "../services/integration";
import {
  createInMemoryPosthogAdapter,
  type InMemoryPosthogAdapter,
} from "../services/posthog";
import type { CustomerIntegration } from "../db/schema";
import type {
  EventDefinitionCommand,
  EventDefinitionRepo,
  EventDefinitionResult,
} from "../repository/event-definition";

type StoredRow = { name: string; active: boolean; volume: number | null };

function createInMemoryEventDefinitionRepo(): EventDefinitionRepo & {
  rows: Map<string, Map<string, StoredRow>>;
} {
  const rows = new Map<string, Map<string, StoredRow>>();
  const forIntegration = (id: string) => {
    let m = rows.get(id);
    if (!m) {
      m = new Map();
      rows.set(id, m);
    }
    return m;
  };

  const run = async (cmd: EventDefinitionCommand): Promise<EventDefinitionResult> => {
    if (cmd.kind === "recordSeen") {
      const m = forIntegration(cmd.integrationId);
      const existing = m.get(cmd.eventName);
      if (existing) {
        existing.volume = cmd.volume ?? existing.volume;
        return { kind: "recordSeen", id: cmd.eventName, active: existing.active };
      }
      m.set(cmd.eventName, {
        name: cmd.eventName,
        active: false,
        volume: cmd.volume ?? null,
      });
      return { kind: "recordSeen", id: cmd.eventName, active: false };
    }
    if (cmd.kind === "replaceSelection") {
      const m = forIntegration(cmd.integrationId);
      const selected = new Set(cmd.events.map((e) => e.name));
      for (const [name, row] of m.entries()) {
        if (!selected.has(name)) row.active = false;
      }
      for (const e of cmd.events) {
        m.set(e.name, { name: e.name, active: true, volume: e.volume ?? null });
      }
      return { kind: "replaceSelection", activated: [...selected] };
    }
    if (cmd.kind === "listForIntegration") {
      const m = forIntegration(cmd.integrationId);
      return {
        kind: "listForIntegration",
        rows: [...m.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    if (cmd.kind === "listActiveNames") {
      const out: string[] = [];
      for (const m of rows.values()) {
        for (const r of m.values()) if (r.active) out.push(r.name);
      }
      return { kind: "listActiveNames", names: out.sort() };
    }
    throw new Error(`unhandled: ${(cmd as { kind: string }).kind}`);
  };

  return { run: run as EventDefinitionRepo["run"], rows };
}

const CUSTOMER_ID = "cust-1";
const INTEGRATION_ID = "integ-1";
const PERSONAL_API_KEY = "ph-secret-key";
const PROJECT_ID = "42";
const WEBHOOK_BASE = "https://api.notify.test";

const mockFindByCustomerAndProvider = mock<any>();
const mockCreate = mock<any>();
const mockUpdateConfig = mock<any>();
const mockDeleteIntegration = mock<any>();

let eventDefinitions: ReturnType<typeof createInMemoryEventDefinitionRepo>;
let posthog: InMemoryPosthogAdapter;
let integration: PosthogIntegrationPort;
let storedRow: CustomerIntegration | null = null;

function fakeRow(overrides?: Partial<CustomerIntegration>): CustomerIntegration {
  return {
    id: INTEGRATION_ID,
    customerId: CUSTOMER_ID,
    provider: "posthog",
    config: {
      personal_api_key_encrypted: Buffer.from(PERSONAL_API_KEY).toString("base64"),
      project_id: PROJECT_ID,
      region: "eu",
      hog_function_id: null,
    },
    connectedAt: new Date(),
    ...overrides,
  } as CustomerIntegration;
}

function buildDeps(): IntegrationDeps {
  return {
    db: {} as any,
    repo: {
      findByCustomerAndProvider: mockFindByCustomerAndProvider,
      create: mockCreate,
      updateConfig: mockUpdateConfig,
      deleteIntegration: mockDeleteIntegration,
    },
    eventDefinitions,
    posthog,
    webhookBaseUrl: WEBHOOK_BASE,
  };
}

beforeEach(() => {
  mockFindByCustomerAndProvider.mockReset();
  mockCreate.mockReset();
  mockUpdateConfig.mockReset();
  mockDeleteIntegration.mockReset();
  eventDefinitions = createInMemoryEventDefinitionRepo();
  posthog = createInMemoryPosthogAdapter();
  storedRow = null;
  integration = makePosthogIntegration(buildDeps());

  // Wire repo mocks to a tiny in-memory row so context loading works after create.
  mockFindByCustomerAndProvider.mockImplementation(async () => storedRow);
  mockCreate.mockImplementation(async (_db: unknown, input: any) => {
    storedRow = fakeRow({ config: input.config });
    return storedRow;
  });
  mockUpdateConfig.mockImplementation(async (_db: unknown, _id: string, config: any) => {
    if (storedRow) storedRow = { ...storedRow, config };
    return storedRow!;
  });
  mockDeleteIntegration.mockImplementation(async () => {
    storedRow = null;
  });
});

describe("connect", () => {
  it("verifies credentials and inserts a row without provisioning the hog function", async () => {
    const result = await integration.connect({
      customerId: CUSTOMER_ID,
      personalApiKey: PERSONAL_API_KEY,
      projectId: PROJECT_ID,
      region: "us",
    });

    expect(result).toEqual({ integrationId: INTEGRATION_ID });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0][1] as any;
    expect(createArgs.config.hog_function_id).toBeNull();
    expect(createArgs.config.project_id).toBe(PROJECT_ID);
    expect(createArgs.config.personal_api_key_encrypted).toBe(
      Buffer.from(PERSONAL_API_KEY).toString("base64")
    );
    expect(posthog.getHogFunction(PROJECT_ID)).toBeNull();
  });

  it("throws auth_failed and writes no row when credentials are bad", async () => {
    posthog.setSimulate("auth");

    await expect(
      integration.connect({
        customerId: CUSTOMER_ID,
        personalApiKey: PERSONAL_API_KEY,
        projectId: PROJECT_ID,
        region: "us",
      })
    ).rejects.toMatchObject({
      detail: { kind: "auth_failed" },
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(storedRow).toBeNull();
  });

  it("rejects with already_exists when an integration is already there", async () => {
    storedRow = fakeRow();

    await expect(
      integration.connect({
        customerId: CUSTOMER_ID,
        personalApiKey: PERSONAL_API_KEY,
        projectId: PROJECT_ID,
        region: "us",
      })
    ).rejects.toMatchObject({ detail: { kind: "already_exists" } });

    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("saveEvents", () => {
  it("creates the hog function on first non-empty selection and stores active events", async () => {
    storedRow = fakeRow();

    const result = await integration.saveEvents({
      customerId: CUSTOMER_ID,
      events: [{ name: "purchase", volume: 12 }],
    });

    expect(result).toEqual({ eventNames: ["purchase"] });
    const fn = posthog.getHogFunction(PROJECT_ID);
    expect(fn).not.toBeNull();
    expect(fn!.eventNames).toEqual(["purchase"]);
    expect(fn!.webhookUrl).toBe(`${WEBHOOK_BASE}/webhooks/posthog/${CUSTOMER_ID}`);
    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    expect((mockUpdateConfig.mock.calls[0][2] as any).hog_function_id).toBe(fn!.id);

    const stored = await eventDefinitions.run({
      kind: "listForIntegration",
      integrationId: INTEGRATION_ID,
    });
    expect(stored.rows).toEqual([{ name: "purchase", active: true, volume: 12 }]);
  });

  it("patches filters on subsequent saves without re-creating", async () => {
    storedRow = fakeRow();

    await integration.saveEvents({
      customerId: CUSTOMER_ID,
      events: [{ name: "purchase", volume: 1 }],
    });
    const firstId = posthog.getHogFunction(PROJECT_ID)!.id;

    await integration.saveEvents({
      customerId: CUSTOMER_ID,
      events: [{ name: "signup", volume: 2 }],
    });

    const fn = posthog.getHogFunction(PROJECT_ID)!;
    expect(fn.id).toBe(firstId);
    expect(fn.eventNames).toEqual(["signup"]);
  });

  it("applies the disabled-sentinel filter when the selection becomes empty", async () => {
    storedRow = fakeRow();
    await integration.saveEvents({
      customerId: CUSTOMER_ID,
      events: [{ name: "purchase", volume: 1 }],
    });

    const result = await integration.saveEvents({
      customerId: CUSTOMER_ID,
      events: [],
    });

    expect(result).toEqual({ eventNames: [] });
    // The in-memory adapter records desired event names verbatim; the sentinel
    // is a wire-level concern of the http adapter. What matters at this layer
    // is that the stored selection is now empty and the function still exists.
    const fn = posthog.getHogFunction(PROJECT_ID)!;
    expect(fn.eventNames).toEqual([]);
    const stored = await eventDefinitions.run({
      kind: "listForIntegration",
      integrationId: INTEGRATION_ID,
    });
    expect(stored.rows.every((r) => r.active === false)).toBe(true);
  });

  it("surfaces transient PostHog outages without persisting selection", async () => {
    storedRow = fakeRow();
    posthog.setSimulate("transient");

    await expect(
      integration.saveEvents({
        customerId: CUSTOMER_ID,
        events: [{ name: "purchase", volume: 1 }],
      })
    ).rejects.toMatchObject({ detail: { kind: "transient" } });

    expect(posthog.getHogFunction(PROJECT_ID)).toBeNull();
    const stored = await eventDefinitions.run({
      kind: "listForIntegration",
      integrationId: INTEGRATION_ID,
    });
    expect(stored.rows).toEqual([]);
  });

  it("throws not_found when no integration exists", async () => {
    storedRow = null;

    await expect(
      integration.saveEvents({
        customerId: CUSTOMER_ID,
        events: [{ name: "purchase" }],
      })
    ).rejects.toMatchObject({ detail: { kind: "not_found" } });
  });
});

describe("listEvents", () => {
  it("merges stored selection with the PostHog catalogue and dedupes by name", async () => {
    storedRow = fakeRow();
    await eventDefinitions.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [{ name: "purchase", volume: 10 }],
    });
    await eventDefinitions.run({
      kind: "recordSeen",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      eventName: "old_event",
      volume: 3,
    });
    posthog.setEvents(PROJECT_ID, [{ name: "purchase", volume: 12 }]);

    const events = await integration.listEvents({
      customerId: CUSTOMER_ID,
      days: 30,
      limit: 50,
      includeAutocaptured: false,
    });

    expect(events).toEqual([
      { name: "purchase", volume: 12, active: true },
      { name: "old_event", volume: 3, active: false },
    ]);
  });

  it("throws not_found when no integration exists", async () => {
    storedRow = null;

    await expect(
      integration.listEvents({
        customerId: CUSTOMER_ID,
        days: 30,
        limit: 50,
        includeAutocaptured: false,
      })
    ).rejects.toBeInstanceOf(PosthogIntegrationError);
  });
});

describe("disconnect", () => {
  it("removes the remote hog function and the integration row, idempotent on re-run", async () => {
    storedRow = fakeRow();
    await integration.saveEvents({
      customerId: CUSTOMER_ID,
      events: [{ name: "purchase", volume: 1 }],
    });
    expect(posthog.getHogFunction(PROJECT_ID)).not.toBeNull();

    const ok = await integration.disconnect({ customerId: CUSTOMER_ID });
    expect(ok).toBe(true);
    expect(posthog.getHogFunction(PROJECT_ID)).toBeNull();
    expect(storedRow).toBeNull();

    const second = await integration.disconnect({ customerId: CUSTOMER_ID });
    expect(second).toBe(false);
  });

  it("returns false when no integration exists", async () => {
    storedRow = null;

    const ok = await integration.disconnect({ customerId: CUSTOMER_ID });
    expect(ok).toBe(false);
    expect(mockDeleteIntegration).not.toHaveBeenCalled();
  });
});
