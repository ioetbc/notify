import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  connect,
  listEvents,
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
const mockCreateHogFunction = mock<any>();
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
      webhook_secret_encrypted: Buffer.from("ws").toString("base64"),
    },
    connectedAt: new Date(),
    ...overrides,
  } as CustomerIntegration;
}

function makeDeps(): IntegrationDeps {
  const posthogClient: PosthogClient = {
    createHogFunction: mockCreateHogFunction,
    listRecentEvents: mockListRecentEvents,
  };
  return {
    db: {} as any,
    repo: {
      findByCustomerAndProvider: mockFindByCustomerAndProvider,
      create: mockCreate,
      updateConfig: mockUpdateConfig,
      deleteIntegration: mockDeleteIntegration,
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
  mockCreateHogFunction.mockReset();
  mockListRecentEvents.mockReset();
});

describe("connect", () => {
  it("inserts a row, calls the client, and writes back the hog function id", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(null);
    mockCreate.mockImplementation(async (_db: unknown, input: any) =>
      fakeRow({ config: input.config })
    );
    mockCreateHogFunction.mockResolvedValue({ hogFunctionId: HOG_FUNCTION_ID });
    mockUpdateConfig.mockResolvedValue(fakeRow());

    const result = await connect(makeDeps(), {
      customerId: CUSTOMER_ID,
      personalApiKey: PERSONAL_API_KEY,
      projectId: PROJECT_ID,
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
    // webhook_secret is a 32-byte hex string (64 chars when decoded)
    const decodedSecret = Buffer.from(
      createArgs.config.webhook_secret_encrypted,
      "base64"
    ).toString("utf-8");
    expect(decodedSecret).toMatch(/^[0-9a-f]{64}$/);

    expect(mockCreateHogFunction).toHaveBeenCalledTimes(1);
    const [cfg, hogArgs] = mockCreateHogFunction.mock.calls[0] as [any, any];
    expect(cfg).toEqual({
      personalApiKey: PERSONAL_API_KEY,
      projectId: PROJECT_ID,
    });
    expect(hogArgs.webhookUrl).toBe(
      `${WEBHOOK_BASE}/webhooks/posthog/${CUSTOMER_ID}`
    );
    expect(hogArgs.eventNames).toEqual([]);
    expect(hogArgs.customerId).toBe(CUSTOMER_ID);
    expect(hogArgs.webhookSecret).toBe(decodedSecret);

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdateConfig.mock.calls[0];
    expect(updateArgs[1]).toBe(INTEGRATION_ID);
    expect((updateArgs[2] as any).hog_function_id).toBe(HOG_FUNCTION_ID);

    expect(mockDeleteIntegration).not.toHaveBeenCalled();
  });

  it("rolls back the row when the client throws", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(null);
    mockCreate.mockImplementation(async (_db: unknown, input: any) =>
      fakeRow({ config: input.config })
    );
    const boom = new Error("posthog exploded");
    mockCreateHogFunction.mockRejectedValue(boom);

    await expect(
      connect(makeDeps(), {
        customerId: CUSTOMER_ID,
        personalApiKey: PERSONAL_API_KEY,
        projectId: PROJECT_ID,
      })
    ).rejects.toBe(boom);

    expect(mockDeleteIntegration).toHaveBeenCalledTimes(1);
    expect(mockDeleteIntegration.mock.calls[0][1]).toBe(INTEGRATION_ID);
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it("rejects when an integration already exists", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(fakeRow());

    await expect(
      connect(makeDeps(), {
        customerId: CUSTOMER_ID,
        personalApiKey: PERSONAL_API_KEY,
        projectId: PROJECT_ID,
      })
    ).rejects.toBeInstanceOf(IntegrationAlreadyExistsError);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateHogFunction).not.toHaveBeenCalled();
  });
});

describe("disconnect", () => {
  it("deletes the row but does not call the client", async () => {
    mockFindByCustomerAndProvider.mockResolvedValue(fakeRow());
    mockDeleteIntegration.mockResolvedValue(undefined);

    const ok = await disconnect(makeDeps(), { customerId: CUSTOMER_ID });

    expect(ok).toBe(true);
    expect(mockDeleteIntegration).toHaveBeenCalledTimes(1);
    expect(mockDeleteIntegration.mock.calls[0][1]).toBe(INTEGRATION_ID);
    expect(mockCreateHogFunction).not.toHaveBeenCalled();
    expect(mockListRecentEvents).not.toHaveBeenCalled();
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
    mockListRecentEvents.mockResolvedValue([
      { name: "purchase", volume: 12 },
    ]);

    const events = await listEvents(makeDeps(), {
      customerId: CUSTOMER_ID,
      days: 30,
      limit: 50,
      includeAutocaptured: false,
    });

    expect(events).toEqual([{ name: "purchase", volume: 12 }]);
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
