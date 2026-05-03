import { match } from "ts-pattern";
import {
  PosthogAuthError,
  PosthogTransientError,
  type DesiredFunctionState,
  type EventVolume,
  type ListOpts,
  type PosthogCreds,
  type PosthogPort,
} from "./port";

type StoredHogFn = {
  id: string;
  webhookUrl: string;
  eventNames: string[];
  customerId: string;
  enabled: boolean;
};

export type InMemoryPosthogAdapter = PosthogPort & {
  setEvents(projectId: string, events: EventVolume[]): void;
  getHogFunction(projectId: string): StoredHogFn | null;
  setSimulate(simulate: "auth" | "transient" | null): void;
};

function projectKey(creds: PosthogCreds): string {
  return creds.projectId;
}

export function createInMemoryPosthogAdapter(): InMemoryPosthogAdapter {
  const events = new Map<string, EventVolume[]>();
  const hogFunctions = new Map<string, StoredHogFn>();
  let nextId = 1;
  let simulate: "auth" | "transient" | null = null;

  function maybeFault(): void {
    match(simulate)
      .with("auth", () => {
        throw new PosthogAuthError();
      })
      .with("transient", () => {
        throw new PosthogTransientError(503);
      })
      .with(null, () => undefined)
      .exhaustive();
  }

  return {
    setEvents(projectId, ev) {
      events.set(projectId, ev);
    },
    getHogFunction(projectId) {
      return hogFunctions.get(projectId) ?? null;
    },
    setSimulate(value) {
      simulate = value;
    },
    async listRecentEvents(creds: PosthogCreds, _opts: ListOpts) {
      maybeFault();
      return events.get(projectKey(creds)) ?? [];
    },
    async verifyCredentials(_creds: PosthogCreds) {
      maybeFault();
    },
    async reconcileDestination(
      creds: PosthogCreds,
      currentHogFunctionId: string | null,
      desired: DesiredFunctionState
    ) {
      maybeFault();
      const key = projectKey(creds);
      return match({ desired, currentHogFunctionId })
        .returnType<{ hogFunctionId: string | null }>()
        .with(
          { desired: { kind: "absent" }, currentHogFunctionId: null },
          () => ({ hogFunctionId: null })
        )
        .with({ desired: { kind: "absent" } }, () => {
          hogFunctions.delete(key);
          return { hogFunctionId: null };
        })
        .with(
          { desired: { kind: "present" }, currentHogFunctionId: null },
          ({ desired: d }) => {
            const id = `hf_${nextId++}`;
            hogFunctions.set(key, {
              id,
              webhookUrl: d.webhookUrl,
              eventNames: [...d.eventNames],
              customerId: d.customerId,
              enabled: true,
            });
            return { hogFunctionId: id };
          }
        )
        .with({ desired: { kind: "present" } }, ({ desired: d, currentHogFunctionId: id }) => {
          const existing = hogFunctions.get(key);
          if (existing) {
            existing.eventNames = [...d.eventNames];
            existing.webhookUrl = d.webhookUrl;
          }
          return { hogFunctionId: id };
        })
        .exhaustive();
    },
  };
}
