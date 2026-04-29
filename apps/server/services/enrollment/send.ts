import { eq } from "drizzle-orm";
import Expo from "expo-server-sdk";
import { db, pushToken } from "../../db";
import type { SendConfig } from "../../db/schema";

const expo = new Expo();

export async function sendPushNotification({
  userId,
  config,
}: {
  userId: string;
  enrollmentId: string;
  stepId: string;
  config: SendConfig;
}) {
  console.log('[onSend] userId:', userId, 'config:', JSON.stringify(config));

  const tokens = await db
    .select()
    .from(pushToken)
    .where(eq(pushToken.userId, userId));

  console.log('[onSend] tokens found:', tokens.length, JSON.stringify(tokens));

  if (tokens.length === 0) return;

  const messages = tokens
    .filter((t) => Expo.isExpoPushToken(t.token))
    .map((t) => ({
      to: t.token,
      title: config.title,
      body: config.body,
    }));

  console.log('[onSend] messages to send:', messages.length, JSON.stringify(messages));

  if (messages.length === 0) return;

  const tickets = await expo.sendPushNotificationsAsync(messages);
  console.log('[onSend] tickets:', JSON.stringify(tickets));
}
