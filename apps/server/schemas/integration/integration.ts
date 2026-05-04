import { z } from "zod";

export const previewPosthogSchema = z.object({
  pat: z.string().min(1),
  team_id: z.string().min(1),
});

export const connectPosthogSchema = z.object({
  pat: z.string().min(1),
  team_id: z.string().min(1),
  identity_field: z.string().min(1).default("distinct_id"),
  enabled_events: z.array(z.string().min(1)).min(1),
});
