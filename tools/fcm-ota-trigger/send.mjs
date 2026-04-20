#!/usr/bin/env node
import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const DEFAULT_TOPIC = "airborne_ota_xyne_spaces";

const usage = `
Usage:
  node send.mjs <service-account.json>                  (sends to all devices via default topic)
  node send.mjs <service-account.json> --topic <name>   (sends to a specific topic)
  node send.mjs <service-account.json> --token <token>   (sends to a single device)

Sends an FCM data message with the OTA_Update key so Android's
XyneFirebaseMessagingService enqueues the AirborneInitWorker.
`;

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(usage);
  process.exit(1);
}

const serviceAccountPath = args[0];
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf-8"));

initializeApp({ credential: cert(serviceAccount) });
const messaging = getMessaging();

const data = { OTA_Update: "true" };
const android = { priority: "high" };
const apns = {
  payload: {
    aps: {
      contentAvailable: true,
    },
  },
  headers: {
    "apns-push-type": "background",
    "apns-priority": "5",
    "apns-topic": "net.juspay.xynespacesnative",
  },
};

let result;
if (args[1] === "--token") {
  const token = args[2];
  if (!token) {
    console.error("Missing FCM token after --token");
    process.exit(1);
  }
  result = await messaging.send({ token, data, android, apns });
  console.log("Sent OTA_Update to device:", result);
} else if (args[1] === "--topic") {
  const topic = args[2];
  if (!topic) {
    console.error("Missing topic name after --topic");
    process.exit(1);
  }
  result = await messaging.send({ topic, data, android, apns });
  console.log(`Sent OTA_Update to topic "${topic}":`, result);
} else {
  result = await messaging.send({ topic: DEFAULT_TOPIC, data, android, apns });
  console.log(`Sent OTA_Update to topic "${DEFAULT_TOPIC}":`, result);
}
