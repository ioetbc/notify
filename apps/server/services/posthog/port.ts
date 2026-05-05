export type PosthogCreds = {
  personalApiKey: string;
  projectId: string;
  baseUrl: string;
};

export type ListOpts = {
  days: number;
  limit: number;
  excludePrefixed: boolean;
};

export type EventVolume = { name: string; volume: number };

export type DesiredFunctionState =
  | { kind: "absent" }
  | {
      kind: "present";
      webhookUrl: string;
      eventNames: string[];
      customerId: string;
    };

export type PosthogPort = {
  listRecentEvents(creds: PosthogCreds, opts: ListOpts): Promise<EventVolume[]>;
  reconcileDestination(
    creds: PosthogCreds,
    currentHogFunctionId: string | null,
    desired: DesiredFunctionState
  ): Promise<{ hogFunctionId: string | null }>;
  verifyCredentials(creds: PosthogCreds): Promise<void>;
};

export class PosthogAuthError extends Error {
  constructor(message = "PostHog rejected the personal API key (401)") {
    super(message);
    this.name = "PosthogAuthError";
  }
}

export class PosthogTransientError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly cause?: unknown
  ) {
    super(
      status === null
        ? "PostHog request failed (network error)"
        : `PostHog request failed with status ${status}`
    );
    this.name = "PosthogTransientError";
  }
}

export class PosthogApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`PostHog request failed with status ${status}`);
    this.name = "PosthogApiError";
  }
}
