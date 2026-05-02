import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { eq, and, isNull, sql } from "drizzle-orm";
import type { ExpoPushReceipt, ExpoPushReceiptId } from "expo-server-sdk";
import { createTestDb, resetTestDb, type TestDb } from "../../test/db";
import {
  customer,
  user,
  workflow,
  step,
  workflowEnrollment,
  communicationLog,
  dispatch,
  pushToken,
} from "../../db/schema";
import { ReceiptPoller } from "./poll-receipts";

let db: TestDb;
let client: PGlite;

const customerId = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";
const workflowId = "00000000-0000-0000-0000-000000000003";
const enrollmentId = "00000000-0000-0000-0000-000000000004";
const stepId = "00000000-0000-0000-0000-000000000010";

async function seed() {
  await db.insert(customer).values({ id: customerId, email: "t@e.com", name: "T" });
  await db.insert(user).values({ id: userId, customerId, externalId: "ext-1", attributes: {} });
  await db.insert(workflow).values({
    id: workflowId,
    customerId,
    name: "W",
    triggerType: "system",
    triggerEvent: "t",
    status: "active",
  });
  await db.insert(step).values({
    id: stepId,
    workflowId,
    type: "send",
    config: { title: "Hi", body: "body" },
  });
  await db.insert(workflowEnrollment).values({
    id: enrollmentId,
    userId,
    workflowId,
    currentStepId: stepId,
    status: "active",
  });
}

async function insertLog(id: string) {
  await db.insert(communicationLog).values({
    id,
    enrollmentId,
    stepId,
    userId,
    config: { title: "Hi", body: "body" },
    status: "dispatched",
    sentAt: new Date(),
  });
}

async function insertDispatch(opts: {
  id: string;
  communicationLogId: string;
  token: string;
  ackId: string;
  status?: "dispatched" | "delivered" | "undelivered";
  createdAt?: Date;
  receiptsPolledAt?: Date | null;
}) {
  await db.insert(dispatch).values({
    id: opts.id,
    communicationLogId: opts.communicationLogId,
    provider: "expo",
    token: opts.token,
    ackId: opts.ackId,
    error: null,
    status: opts.status ?? "dispatched",
    receiptsPolledAt: opts.receiptsPolledAt ?? null,
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  });
}

function fakeExpo(receipts: Record<ExpoPushReceiptId, ExpoPushReceipt>) {
  return {
    getPushNotificationReceiptsAsync: async (ids: ExpoPushReceiptId[]) => {
      const out: Record<string, ExpoPushReceipt> = {};
      for (const id of ids) if (receipts[id]) out[id] = receipts[id];
      return out;
    },
    chunkPushNotificationReceiptIds: (ids: ExpoPushReceiptId[]) => [ids],
  };
}

async function getDispatch(id: string) {
  const rows = await db.select().from(dispatch).where(eq(dispatch.id, id));
  return rows[0];
}

async function getLog(id: string) {
  const rows = await db.select().from(communicationLog).where(eq(communicationLog.id, id));
  return rows[0];
}

async function eligibleDispatches() {
  return db
    .select()
    .from(dispatch)
    .where(and(eq(dispatch.status, "dispatched"), isNull(dispatch.receiptsPolledAt)));
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await resetTestDb(client);
  await seed();
});

describe("ReceiptPoller", () => {
  it("happy path — delivered", async () => {
    const logId = "00000000-0000-0000-0000-0000000000a1";
    const dispatchId = "00000000-0000-0000-0000-0000000000b1";
    await insertLog(logId);
    await insertDispatch({
      id: dispatchId,
      communicationLogId: logId,
      token: "ExponentPushToken[1]",
      ackId: "r-1",
    });

    await new ReceiptPoller({
      db,
      expo: fakeExpo({ "r-1": { status: "ok" } }),
    }).run();

    const d = await getDispatch(dispatchId);
    expect(d.status).toBe("delivered");
    expect(d.receipt).toEqual({ status: "ok" });
    expect(d.receiptsPolledAt).toBeInstanceOf(Date);

    const log = await getLog(logId);
    expect(log.status).toBe("dispatched");
  });

  it("receipt error → undelivered", async () => {
    const logId = "00000000-0000-0000-0000-0000000000a2";
    const dispatchId = "00000000-0000-0000-0000-0000000000b2";
    await insertLog(logId);
    await insertDispatch({
      id: dispatchId,
      communicationLogId: logId,
      token: "ExponentPushToken[1]",
      ackId: "r-1",
    });

    await new ReceiptPoller({
      db,
      expo: fakeExpo({
        "r-1": { status: "error", message: "boom", details: { error: "MessageTooBig" } },
      }),
    }).run();

    const d = await getDispatch(dispatchId);
    expect(d.status).toBe("undelivered");
    expect(d.receipt?.status).toBe("error");
  });

  it("two dispatches, mixed outcome — log unaffected", async () => {
    const logId = "00000000-0000-0000-0000-0000000000a3";
    const d1 = "00000000-0000-0000-0000-0000000000b3";
    const d2 = "00000000-0000-0000-0000-0000000000b4";
    await insertLog(logId);
    await insertDispatch({
      id: d1,
      communicationLogId: logId,
      token: "ExponentPushToken[1]",
      ackId: "r-1",
    });
    await insertDispatch({
      id: d2,
      communicationLogId: logId,
      token: "ExponentPushToken[2]",
      ackId: "r-2",
    });

    await new ReceiptPoller({
      db,
      expo: fakeExpo({
        "r-1": { status: "ok" },
        "r-2": { status: "error", message: "boom", details: { error: "MessageTooBig" } },
      }),
    }).run();

    expect((await getDispatch(d1)).status).toBe("delivered");
    expect((await getDispatch(d2)).status).toBe("undelivered");
    expect((await getLog(logId)).status).toBe("dispatched");
  });

  it("DeviceNotRegistered → push_token deleted", async () => {
    const tokenA = "ExponentPushToken[A]";
    const tokenB = "ExponentPushToken[B]";
    await db.insert(pushToken).values([
      { userId, token: tokenA },
      { userId, token: tokenB },
    ]);

    const logId = "00000000-0000-0000-0000-0000000000a4";
    const dA = "00000000-0000-0000-0000-0000000000b5";
    const dB = "00000000-0000-0000-0000-0000000000b6";
    await insertLog(logId);
    await insertDispatch({ id: dA, communicationLogId: logId, token: tokenA, ackId: "r-A" });
    await insertDispatch({ id: dB, communicationLogId: logId, token: tokenB, ackId: "r-B" });

    await new ReceiptPoller({
      db,
      expo: fakeExpo({
        "r-A": {
          status: "error",
          message: "gone",
          details: { error: "DeviceNotRegistered" },
        },
        "r-B": { status: "ok" },
      }),
    }).run();

    const remaining = await db.select().from(pushToken).where(eq(pushToken.userId, userId));
    expect(remaining.map((t) => t.token)).toEqual([tokenB]);
  });

  it("receipt not ready — dispatch row stays dispatched, receiptsPolledAt null", async () => {
    const logId = "00000000-0000-0000-0000-0000000000a5";
    const dispatchId = "00000000-0000-0000-0000-0000000000b7";
    await insertLog(logId);
    await insertDispatch({
      id: dispatchId,
      communicationLogId: logId,
      token: "ExponentPushToken[1]",
      ackId: "r-1",
    });

    await new ReceiptPoller({ db, expo: fakeExpo({}) }).run();

    const d = await getDispatch(dispatchId);
    expect(d.status).toBe("dispatched");
    expect(d.receiptsPolledAt).toBeNull();
  });

  it("idempotency — running twice produces same end state", async () => {
    const logId = "00000000-0000-0000-0000-0000000000a6";
    const dispatchId = "00000000-0000-0000-0000-0000000000b8";
    await insertLog(logId);
    await insertDispatch({
      id: dispatchId,
      communicationLogId: logId,
      token: "ExponentPushToken[1]",
      ackId: "r-1",
    });

    const expo = fakeExpo({ "r-1": { status: "ok" } });
    const poller = new ReceiptPoller({ db, expo });

    await poller.run();
    const after1 = await getDispatch(dispatchId);

    await poller.run();
    const after2 = await getDispatch(dispatchId);

    expect(after2.status).toBe(after1.status);
    expect(after2.receiptsPolledAt?.getTime()).toBe(after1.receiptsPolledAt?.getTime());
    expect(after2.receipt).toEqual(after1.receipt);
  });

  it("handler query predicate excludes rows older than 23h", async () => {
    const logId1 = "00000000-0000-0000-0000-0000000000a7";
    const logId2 = "00000000-0000-0000-0000-0000000000a8";
    const stepId2 = "00000000-0000-0000-0000-000000000011";
    await db.insert(step).values({
      id: stepId2,
      workflowId,
      type: "send",
      config: { title: "Hi2", body: "body2" },
    });
    await insertLog(logId1);
    await db.insert(communicationLog).values({
      id: logId2,
      enrollmentId,
      stepId: stepId2,
      userId,
      config: { title: "Hi2", body: "body2" },
      status: "dispatched",
      sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    await insertDispatch({
      id: "00000000-0000-0000-0000-0000000000b9",
      communicationLogId: logId1,
      token: "ExponentPushToken[fresh]",
      ackId: "r-fresh",
    });
    await insertDispatch({
      id: "00000000-0000-0000-0000-0000000000ba",
      communicationLogId: logId2,
      token: "ExponentPushToken[stale]",
      ackId: "r-stale",
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const eligible = await db
      .select()
      .from(dispatch)
      .where(
        and(
          eq(dispatch.status, "dispatched"),
          isNull(dispatch.receiptsPolledAt),
          sql`${dispatch.createdAt} > NOW() - INTERVAL '23 hours'`
        )
      );

    expect(eligible).toHaveLength(1);
    expect(eligible[0].token).toBe("ExponentPushToken[fresh]");
  });
});
