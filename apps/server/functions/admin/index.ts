import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { db, user, event, pushToken } from "../../db";
import { eq, sql } from "drizzle-orm";
import { workflows } from "./workflows";
import { EnrollmentWalker } from "../../services/enrollment";
import Expo from "expo-server-sdk";

const expo = new Expo();

const walker = new EnrollmentWalker({
  db,
  onSend: async ({ userId, config }) => {
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
  },
});

const app = new Hono();

function getCustomerId(c: { req: { header: (name: string) => string | undefined } }) {
  const customerId = c.req.header('x-customer-id');
  if (!customerId) throw new Error('Missing X-Customer-Id header');
  return customerId;
}

const routes = app
  .route("/workflows", workflows)
  .get("/user-columns", async (c) => {
    const customerId = getCustomerId(c);

    const result = await db
      .select({
        key: sql<string>`k`,
        values: sql<string[]>`array_agg(DISTINCT v::text)`,
      })
      .from(
        sql`(SELECT k, ${user.attributes} ->> k AS v FROM ${user}, jsonb_object_keys(${user.attributes}) AS k WHERE ${user.customerId} = ${customerId}) AS sub`
      )
      .groupBy(sql`k`);

    const columns = result.map((row) => ({
      name: row.key,
      values: row.values ?? [],
    }));

    return c.json({ columns }, 200);
  })
  .get("/event-names", async (c) => {
    const customerId = getCustomerId(c);

    const result = await db
      .selectDistinct({ eventName: event.eventName })
      .from(event)
      .where(eq(event.customerId, customerId));

    const eventNames = result.map((row) => row.eventName);

    return c.json({ event_names: eventNames }, 200);
  })
  .post("/enrollments/process", async (c) => {
    const result = await walker.processReadyEnrollments();
    return c.json(result, 200);
  });

export type AppType = typeof routes;
export const handler = handle(app);
