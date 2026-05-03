import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  connect,
  listEvents,
  saveEventSelection,
  disconnect,
  IntegrationAlreadyExistsError,
  type IntegrationDeps,
  type PosthogClient,
} from "../services/integration";
import type { CustomerIntegration } from "../db/schema";

const CUSTOMER_ID = "cust-1";
const INTEGRATION_ID = "integ-1";
const HOG_FUNCTION_ID = "hog-fn-99";
const PERSONAL_API_KEY = "ph-secret-key";
const PROJECT_ID = "42";
const WEBHOOK_BASE = "https://api.notify.test";

const mockFindByCustomerAndProvider = mock<any>();
const mockCreate = mock<any>();
const mockUpdateConfig = mock<any>();
const mockDeleteIntegration = mock<any>();
const mockSetPosthogEventSelection = mock<any>();
const mockListEventSelectionByIntegration = mock<any>();
const mockCreateHogFunction = mock<any>();
const mockUpdateHogFunctionFilters = mock<any>();
const mockDeleteHogFunction = mock<any>();
const mockListRecentEvents = mock<any>();

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

function makeDeps(): IntegrationDeps {
  const posthogClient: PosthogClient = {
    createHogFunction: mockCreateHogFunction,
    listRecentEvents: mockListRecentEvents,
    updateHogFunctionFilters: mockUpdateHogFunctionFilters,
    deleteHogFunction: mockDeleteHogFunction,
  };
  return {
    db: {} as any,
    repo: {
      findByCustomerAndProvider: mockFindByCustomerAndProvider,
      create: mockCreate,
      updateConfig: mockUpdateConfig,
      deleteIntegration: mockDeleteIntegration,
    },
    eventDefinitions: {
      setPosthogEventSelection: mockSetPosthogEventSelection,
      listEventSelectionByIntegration: mockListEventSelectionByIntegration,
    },
    posthog: posthogClient,
    webhookBaseUrl: WEBHOOK_BASE,
  };
}

beforeEach(() => {
  mockFindByCustomerAndProvider.mockReset();
  mockCreate.mockReset();
  mockUpdateConfig.mockReset();
  mockDeleteIntegration.mockReset();
  mockSetPosthogEventSelection.mockReset();
  mockListEventSelectionByIntegration.mockReset();
  mockListEventSelectionByIntegration.mockResolvedValue([]);
  mockCreateHogFunction.mockReset();
  mockUpdateHogFunctionFilters.mockReset();
  mockDeleteHogFunction.mockReset();
  mockListRecentEvents.mockReset();
});

describe("connect", () => {
  it("inserts a row without provisioning the hog function", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(null);
    mockCreate.mockImplementation(async (_db: unknown, input: any) =>
      fakeRow({ config: input.config })
    );

    const result = await connect(makeDeps(), {
      customerId: CUSTOMER_ID,
      personalApiKey: PERSONAL_API_KEY,
      projectId: PROJECT_ID,
      region: "us",
    });

    expect(result).toEqual({ integration_id: INTEGRATION_ID });
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const createArgs = mockCreate.mock.calls[0][1] as any;
    expect(createArgs.customerId).toBe(CUSTOMER_ID);
    expect(createArgs.provider).toBe("posthog");
    expect(createArgs.config.hog_function_id).toBeNull();
    expect(createArgs.config.project_id).toBe(PROJECT_ID);
    // base64 of the api key
    expect(createArgs.config.personal_api_key_encrypted).toBe(
      Buffer.from(PERSONAL_API_KEY).toString("base64")
    );
    expect(mockCreateHogFunction).not.toHaveBeenCalled();
    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(mockDeleteIntegration).not.toHaveBeenCalled();
  });

  it("does not call PostHog during connect", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(null);
    mockCreate.mockImplementation(async (_db: unknown, input: any) =>
      fakeRow({ config: input.config })
    );

    await connect(makeDeps(), {
      customerId: CUSTOMER_ID,
      personalApiKey: PERSONAL_API_KEY,
      projectId: PROJECT_ID,
      region: "us",
    });

    expect(mockCreateHogFunction).not.toHaveBeenCalled();
    expect(mockListRecentEvents).not.toHaveBeenCalled();
  });

  it("rejects when an integration already exists", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(fakeRow());

    await expect(
      connect(makeDeps(), {
        customerId: CUSTOMER_ID,
        personalApiKey: PERSONAL_API_KEY,
        projectId: PROJECT_ID,
        region: "us",
      })
    ).rejects.toBeInstanceOf(IntegrationAlreadyExistsError);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateHogFunction).not.toHaveBeenCalled();
  });
});

describe("disconnect", () => {
  it("deletes the remote hog function before deleting the row", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(
      fakeRow({
        config: {
          personal_api_key_encrypted: Buffer.from(PERSONAL_API_KEY).toString("base64"),
          project_id: PROJECT_ID,
          region: "eu",
          hog_function_id: HOG_FUNCTION_ID,
        },
      })
    );
    mockDeleteHogFunction.mockResolvedValue(undefined);
    mockDeleteIntegration.mockResolvedValue(undefined);

    const ok = await disconnect(makeDeps(), { customerId: CUSTOMER_ID });

    expect(ok).toBe(true);
    expect(mockDeleteHogFunction).toHaveBeenCalledWith(
      {
        personalApiKey: PERSONAL_API_KEY,
        projectId: PROJECT_ID,
        baseUrl: "https://eu.posthog.com",
      },
      { hogFunctionId: HOG_FUNCTION_ID }
    );
    expect(mockDeleteIntegration).toHaveBeenCalledTimes(1);
    expect(mockDeleteIntegration.mock.calls[0][1]).toBe(INTEGRATION_ID);
    expect(mockCreateHogFunction).not.toHaveBeenCalled();
    expect(mockListRecentEvents).not.toHaveBeenCalled();
  });

  it("deletes only the row when there is no remote hog function yet", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(fakeRow());
    mockDeleteIntegration.mockResolvedValue(undefined);

    const ok = await disconnect(makeDeps(), { customerId: CUSTOMER_ID });

    expect(ok).toBe(true);
    expect(mockDeleteHogFunction).not.toHaveBeenCalled();
    expect(mockDeleteIntegration).toHaveBeenCalledTimes(1);
    expect(mockDeleteIntegration.mock.calls[0][1]).toBe(INTEGRATION_ID);
  });

  it("returns false when no integration exists", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(null);

    const ok = await disconnect(makeDeps(), { customerId: CUSTOMER_ID });

    expect(ok).toBe(false);
    expect(mockDeleteIntegration).not.toHaveBeenCalled();
  });
});

describe("listEvents", () => {
  it("decodes the api key and forwards the call", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(fakeRow());
    mockListEventSelectionByIntegration.mockResolvedValue([
      { name: "purchase", volume: 10, active: true },
      { name: "old_event", volume: 3, active: false },
    ]);
    mockListRecentEvents.mockResolvedValue([
      { name: "purchase", volume: 12 },
    ]);

    const events = await listEvents(makeDeps(), {
      customerId: CUSTOMER_ID,
      days: 30,
      limit: 50,
      includeAutocaptured: false,
    });

    expect(events).toEqual([
      { name: "purchase", volume: 12, active: true },
      { name: "old_event", volume: 3, active: false },
    ]);
    const [cfg, args] = mockListRecentEvents.mock.calls[0] as [any, any];
    expect(cfg).toEqual({
      personalApiKey: PERSONAL_API_KEY,
      projectId: PROJECT_ID,
      baseUrl: "https://eu.posthog.com",
    });
    expect(args).toEqual({ days: 30, limit: 50, excludePrefixed: true });
  });

  it("flips excludePrefixed when includeAutocaptured is true", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(fakeRow());
    mockListRecentEvents.mockResolvedValue([]);

    await listEvents(makeDeps(), {
      customerId: CUSTOMER_ID,
      days: 7,
      limit: 10,
      includeAutocaptured: true,
    });

    expect((mockListRecentEvents.mock.calls[0][1] as any).excludePrefixed).toBe(false);
  });

  it("returns null when no integration exists", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(null);

    const events = await listEvents(makeDeps(), {
      customerId: CUSTOMER_ID,
      days: 30,
      limit: 50,
      includeAutocaptured: false,
    });

    expect(events).toBeNull();
    expect(mockListRecentEvents).not.toHaveBeenCalled();
  });
});

describe("saveEventSelection", () => {
  it("creates the hog function on first non-empty selection and stores active events", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(fakeRow());
    mockCreateHogFunction.mockResolvedValue({ hogFunctionId: HOG_FUNCTION_ID });
    mockUpdateConfig.mockResolvedValue(fakeRow());
    mockSetPosthogEventSelection.mockResolvedValue(undefined);

    const result = await saveEventSelection(makeDeps(), {
      customerId: CUSTOMER_ID,
      events: [{ name: "purchase", volume: 12 }],
    });

    expect(result).toEqual({ event_names: ["purchase"] });
    expect(mockCreateHogFunction).toHaveBeenCalledTimes(1);
    const [cfg, args] = mockCreateHogFunction.mock.calls[0] as [any, any];
    expect(cfg).toEqual({
      personalApiKey: PERSONAL_API_KEY,
      projectId: PROJECT_ID,
      baseUrl: "https://eu.posthog.com",
    });
    expect(args.eventNames).toEqual(["purchase"]);
    expect(args.webhookUrl).toBe(`${WEBHOOK_BASE}/webhooks/posthog/${CUSTOMER_ID}`);
    expect(mockUpdateConfig.mock.calls[0][2].hog_function_id).toBe(HOG_FUNCTION_ID);
    expect(mockSetPosthogEventSelection.mock.calls[0][1]).toEqual({
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      events: [{ name: "purchase", volume: 12 }],
    });
  });

  it("updates filters and marks deselected events inactive when hog function exists", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(
      fakeRow({
        config: {
          personal_api_key_encrypted: Buffer.from(PERSONAL_API_KEY).toString("base64"),
          project_id: PROJECT_ID,
          region: "eu",
          hog_function_id: HOG_FUNCTION_ID,
        },
      })
    );
    mockUpdateHogFunctionFilters.mockResolvedValue(undefined);
    mockSetPosthogEventSelection.mockResolvedValue(undefined);

    const result = await saveEventSelection(makeDeps(), {
      customerId: CUSTOMER_ID,
      events: [],
    });

    expect(result).toEqual({ event_names: [] });
    expect(mockCreateHogFunction).not.toHaveBeenCalled();
    expect(mockUpdateHogFunctionFilters).toHaveBeenCalledWith(
      {
        personalApiKey: PERSONAL_API_KEY,
        projectId: PROJECT_ID,
        baseUrl: "https://eu.posthog.com",
      },
      { hogFunctionId: HOG_FUNCTION_ID, eventNames: ["__notify_no_active_posthog_events__"] }
    );
    expect(mockSetPosthogEventSelection.mock.calls[0][1]).toEqual({
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      events: [],
    });
  });

  it("returns null when no integration exists", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(null);

    const result = await saveEventSelection(makeDeps(), {
      customerId: CUSTOMER_ID,
      events: [{ name: "purchase" }],
    });

    expect(result).toBeNull();
    expect(mockCreateHogFunction).not.toHaveBeenCalled();
    expect(mockSetPosthogEventSelection).not.toHaveBeenCalled();
  });
});
