export {
  createHogFunction,
  updateHogFunctionFilters,
  listRecentEvents,
  PosthogAuthError,
  PosthogClientError,
  PosthogTransientError,
} from "./client";
export type {
  PosthogClientConfig,
  CreateHogFunctionArgs,
  UpdateHogFunctionFiltersArgs,
  ListRecentEventsArgs,
  RecentEvent,
} from "./types";
export { HOG_DESTINATION_SOURCE, HOG_INPUTS_SCHEMA } from "./hog-template";
