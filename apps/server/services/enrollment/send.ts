import { eq } from "drizzle-orm";
import Expo from "expo-server-sdk";
import { match } from "ts-pattern";
import { db, pushToken } from "../../db";
import type { SendConfig } from "../../db/schema";
const expo = new Expo();

export type DispatchError = {
  message: string;
  details?: { error?: string; expoPushToken?: string };
};

export type DispatchAttempt =
  | { token: string; ackId: string }
  | { token: string; error: DispatchError };

export type SendResult = { provider: "expo"; dispatches: DispatchAttempt[] };

export async function sendPushNotification({
  userId,
  config,
}: {
  userId: string;
  enrollmentId: string;
  stepId: string;
  config: SendConfig;
}): Promise<SendResult | undefined> {
  const tokens = await db
    .select()
    .from(pushToken)
    .where(eq(pushToken.userId, userId));

  if (tokens.length === 0) return undefined;

  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t.token));

  if (validTokens.length === 0) return undefined;

  const messages = validTokens.map((t) => ({
    to: t.token,
    title: config.title,
    body: config.body,
  }));

  const receipts = await expo.sendPushNotificationsAsync(messages);

  if (receipts.length !== validTokens.length) {
    throw new Error(
      `receipt count mismatch: ${receipts.length} receipts for ${validTokens.length} messages`
    );
  }

  return {
    provider: "expo",
    dispatches: validTokens.map((t, i): DispatchAttempt =>
      match(receipts[i])
        .with({ status: "ok" }, (ok) => ({ token: t.token, ackId: ok.id }))
        .with({ status: "error" }, (error) => ({
          token: t.token,
          error: { message: error.message, details: error.details },
        }))
        .exhaustive()
    ),
  };
}
