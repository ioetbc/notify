import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import { db } from "../../db";
import { EnrollmentWalker } from "../../services/enrollment";
import { sendPushNotification } from "../../services/enrollment/send";

const walker = new EnrollmentWalker({
  db,
  onSend: sendPushNotification,
});

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const { enrollmentId } = JSON.parse(record.body) as { enrollmentId: string };
      await walker.processEnrollment(enrollmentId);
    } catch (error) {
      console.error(
        `[worker] failed messageId=${record.messageId}:`,
        error instanceof Error ? error.stack : error
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
