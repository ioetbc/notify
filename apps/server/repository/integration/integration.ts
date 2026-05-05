import { eq, and } from "drizzle-orm";
import { customerIntegration } from "../../db/schema";
import type {
  CustomerIntegration,
  PosthogIntegrationConfig,
  Db,
} from "../../db";

export async function findByCustomerAndProvider(
  db: Db,
  customerId: string,
  provider: "posthog"
): Promise<CustomerIntegration | null> {
  const [row] = await db
    .select()
    .from(customerIntegration)
    .where(
      and(
        eq(customerIntegration.customerId, customerId),
        eq(customerIntegration.provider, provider)
      )
    );
  return row ?? null;
}

export async function create(
  db: Db,
  input: {
    customerId: string;
    provider: "posthog";
    config: PosthogIntegrationConfig;
  }
): Promise<CustomerIntegration> {
  // TODO(encryption): config.*_encrypted fields are base64-encoded plaintext
  // for v1. Swap codec to KMS or libsodium before shipping to customers.
  const [created] = await db
    .insert(customerIntegration)
    .values(input)
    .returning();
  return created;
}

export async function updateConfig(
  db: Db,
  id: string,
  config: PosthogIntegrationConfig
): Promise<CustomerIntegration> {
  const [updated] = await db
    .update(customerIntegration)
    .set({ config })
    .where(eq(customerIntegration.id, id))
    .returning();
  return updated;
}

export async function deleteIntegration(db: Db, id: string): Promise<void> {
  await db.delete(customerIntegration).where(eq(customerIntegration.id, id));
}
