import { handle } from "hono/aws-lambda";
import { db } from "../../db";
import { createEventDefinitionRepo } from "../../repository/event-definition";
import { trackPosthogEvent } from "../../services/public/public";
import { createWebhookApp } from "./handler";

const eventDefinitions = createEventDefinitionRepo(db);

const app = createWebhookApp({
  db,
  trackPosthogEvent: (
    customerId,
    integrationId,
    externalId,
    eventName,
    properties,
    timestamp
  ) =>
    trackPosthogEvent(
      { eventDefinitions },
      customerId,
      integrationId,
      externalId,
      eventName,
      properties,
      timestamp
    ),
});

export const handler = handle(app);
