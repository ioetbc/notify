export type ExpoAck =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string; expoPushToken?: string } };

export type ExpoReceipt =
  | { status: "ok" }
  | { status: "error"; message: string; details?: { error?: string } };
