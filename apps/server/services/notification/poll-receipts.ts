import { eq, inArray, and, isNull, sql } from "drizzle-orm";
import Expo, { type ExpoPushReceipt, type ExpoPushReceiptId } from "expo-server-sdk";
import { match } from "ts-pattern";
import type { Db } from "../../db";
import { dispatch, pushToken } from "../../db/schema";
import type { Dispatch } from "../../db/schema";
import type { ExpoReceipt } from "./dispatch";

type ExpoClient = Pick<
  Expo,
  "getPushNotificationReceiptsAsync" | "chunkPushNotificationReceiptIds"
>;

export interface ReceiptPollerDeps {
  db: Db;
  expo: ExpoClient;
}

export class ReceiptPoller {
  private readonly db: Db;
  private readonly expo: ExpoClient;

  constructor({ db, expo }: ReceiptPollerDeps) {
    this.db = db;
    this.expo = expo;
  }

  private async findEligibleDispatches(): Promise<Dispatch[]> {
    return this.db
      .select()
      .from(dispatch)
      .where(
        and(eq(dispatch.status, "dispatched"), isNull(dispatch.receiptsPolledAt))
      )
      .limit(500);
  }

  private async fetchExpoReceipts(
    dispatches: Dispatch[]
  ): Promise<Map<string, ExpoPushReceipt>> {
    const receiptIds = dispatches.map((dispatch) => dispatch.ackId!)

    const receiptsById = new Map<string, ExpoPushReceipt>();

    if (receiptIds.length === 0) return receiptsById;
    

    const chunks = this.expo.chunkPushNotificationReceiptIds(receiptIds);

    for (const chunk of chunks) {
      try {
        const fetched = await this.expo.getPushNotificationReceiptsAsync(chunk);
        for (const [id, receipt] of Object.entries(fetched)) {
          receiptsById.set(id, receipt);
        }
      } catch (err) {
        console.error("[poll-receipts] chunk fetch failed:", err);
      }
    }

    return receiptsById;
  }

  private async expireStaleDispatches(): Promise<void> {
    await this.db
      .update(dispatch)
      .set({ status: "expired", receiptsPolledAt: new Date() })
      .where(
        and(
          eq(dispatch.status, "dispatched"),
          sql`${dispatch.createdAt} < NOW() - INTERVAL '24 hours'`
        )
      );
  }

  private async removeDeadTokens(deadTokens: Set<string>): Promise<void> {
    if (deadTokens.size === 0) return;
    await this.db.delete(pushToken).where(inArray(pushToken.token, [...deadTokens]));
  }

  private static toExpoReceipt(r: ExpoPushReceipt): ExpoReceipt {
    return match(r)
      .with({ status: "ok" }, () => ({ status: "ok" as const }))
      .with({ status: "error" }, (e) => ({
        status: "error" as const,
        message: e.message,
        details: e.details,
      }))
      .exhaustive();
  }

  async run(): Promise<void> {
    await this.expireStaleDispatches();

    const dispatches = await this.findEligibleDispatches();
    const receiptsById = await this.fetchExpoReceipts(dispatches);
    const deadTokens = new Set<string>();

    for (const row of dispatches) {
      const receipt = receiptsById.get(row.ackId!);
      if (!receipt) continue;

      const expoReceipt = ReceiptPoller.toExpoReceipt(receipt);

      const status = match(expoReceipt)
        .with({ status: "ok" }, () => "delivered" as const)
        .with({ status: "error" }, () => "undelivered" as const)
        .exhaustive();

      if (
        expoReceipt.status === "error" &&
        expoReceipt.details?.error === "DeviceNotRegistered"
      ) {
        deadTokens.add(row.token);
      }

      await this.db
        .update(dispatch)
        .set({
          status,
          receipt: expoReceipt,
          receiptsPolledAt: new Date(),
        })
        .where(eq(dispatch.id, row.id));
    }

    await this.removeDeadTokens(deadTokens);
  }
}

