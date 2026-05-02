import { handle } from "hono/aws-lambda";
import { db } from "../../db";
import { trackEvent } from "../../services/public/public";
import { createWebhookApp } from "./handler";

const app = createWebhookApp({ db, trackEvent });

export const handler = handle(app);
