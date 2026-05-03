import { handle } from "hono/aws-lambda";
import { db } from "../../db";
import { trackPosthogEvent } from "../../services/public/public";
import { createWebhookApp } from "./handler";

const app = createWebhookApp({ db, trackPosthogEvent });

export const handler = handle(app);
