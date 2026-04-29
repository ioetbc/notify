import { sql } from "drizzle-orm";
import { Resource } from "sst";
import { SQSClient, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import { db } from "../../db";

const sqs = new SQSClient({});

const BATCH_SIZE = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function handler() {
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE workflow_enrollment
    SET status = 'processing'
    WHERE id IN (
      SELECT id FROM workflow_enrollment
      WHERE status = 'active' AND process_at <= NOW()
      ORDER BY process_at
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  const ids = claimed.rows.map((r) => r.id);

  if (ids.length === 0) return { dispatched: 0 };

  const queueUrl = Resource.EnrollmentQueue.url;

  for (const group of chunk(ids, BATCH_SIZE)) {
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: group.map((id) => ({
          Id: id,
          MessageBody: JSON.stringify({ enrollmentId: id }),
        })),
      })
    );
  }

  console.log(`[dispatcher] dispatched ${ids.length} enrollments`);
  return { dispatched: ids.length };
}
