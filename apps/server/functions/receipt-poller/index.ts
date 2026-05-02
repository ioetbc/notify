import Expo from "expo-server-sdk";
import { db } from "../../db";
import { ReceiptPoller } from "../../services/notification/poll-receipts";

export async function handler() {
  const receiptPoller = new ReceiptPoller({ db, expo: new Expo() })
  await receiptPoller.run()
}
