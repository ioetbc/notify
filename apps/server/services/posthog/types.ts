import { z } from "zod";

export const PosthogClientConfigSchema = z.object({
  baseUrl: z.string().url().default("https://us.posthog.com"),
  personalApiKey: z.string().min(1),
  projectId: z.string().min(1),
});

export type PosthogClientConfig = z.input<typeof PosthogClientConfigSchema>;

export const CreateHogFunctionArgsSchema = z.object({
  webhookUrl: z.string().url(),
  eventNames: z.array(z.string().min(1)),
  customerId: z.string().min(1),
});

export type CreateHogFunctionArgs = z.infer<typeof CreateHogFunctionArgsSchema>;

export const UpdateHogFunctionFiltersArgsSchema = z.object({
  hogFunctionId: z.string().min(1),
  eventNames: z.array(z.string().min(1)),
});

export type UpdateHogFunctionFiltersArgs = z.infer<
  typeof UpdateHogFunctionFiltersArgsSchema
>;

export const DeleteHogFunctionArgsSchema = z.object({
  hogFunctionId: z.string().min(1),
});

export type DeleteHogFunctionArgs = z.infer<typeof DeleteHogFunctionArgsSchema>;

export const ListRecentEventsArgsSchema = z.object({
  days: z.number().int().positive().default(30),
  excludePrefixed: z.boolean().default(true),
  limit: z.number().int().positive().default(50),
});

export type ListRecentEventsArgs = z.input<typeof ListRecentEventsArgsSchema>;

export const HogFunctionCreateResponseSchema = z
  .object({ id: z.string().min(1) })
  .passthrough();

export const HogQlQueryResponseSchema = z
  .object({
    results: z.array(z.tuple([z.string(), z.union([z.number(), z.string()])])),
  })
  .passthrough();

export type RecentEvent = { name: string; volume: number };
