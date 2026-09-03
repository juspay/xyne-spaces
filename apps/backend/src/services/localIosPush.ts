import { exec } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

import { logger } from '@/utils/logger';

const execAsync = promisify(exec);

const BUNDLE_ID = 'net.juspay.xynespaces';

type SimDevice = {
  udid: string;
  state: string;
  name: string;
  isAvailable?: boolean;
};

export type LocalPushPayload = {
  title: string;
  message: string;
  type: string;
  notificationId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actionUrl?: string;
};

async function getIosSimulators(): Promise<SimDevice[]> {
  const { stdout } = await execAsync('xcrun simctl list devices --json');
  const parsed = JSON.parse(stdout) as {
    devices: Record<string, SimDevice[]>;
  };

  const result: SimDevice[] = [];
  for (const [runtime, devices] of Object.entries(parsed.devices)) {
    if (!runtime.toLowerCase().includes('ios')) continue;
    for (const device of devices) {
      if (device.isAvailable !== false) {
        result.push(device);
      }
    }
  }
  return result;
}

export async function sendLocalIosPush(payload: LocalPushPayload, data: Record<string, string>): Promise<void> {
  let tmpDir: string | undefined;

  try {
    const allDevices = await getIosSimulators();
    
    // Only target currently booted simulators
    const targets = allDevices.filter((d) => d.state === 'Booted');

    if (targets.length === 0) {
      logger.warn('[FCM:local] No booted iOS simulators found. Please launch a simulator first.');
      return;
    }

    logger.info('[FCM:local] Sending via xcrun simctl push', {
      totalDevices: allDevices.length,
      targetCount: targets.length,
    });

    // MODIFIED: Added FCM/Notifee required keys to trigger foreground JS events
    const apnsPayload = {
      'Simulator Target Bundle': BUNDLE_ID,
      'gcm.message_id': `simulated-id-${Date.now()}`,
      aps: {
        alert: { title: payload.title, body: payload.message },
        sound: 'default',
        'mutable-content': 1,
        'content-available': 1, 
      },
      type: payload.type,
      msg_title: payload.title,
      msg_body: payload.message,
      category: payload.type,
      ...(payload.notificationId ? { notificationId: payload.notificationId } : {}),
      ...(payload.actionUrl ? { actionUrl: payload.actionUrl, deeplink: payload.actionUrl } : {}),
      ...(payload.relatedEntityType ? { relatedEntityType: payload.relatedEntityType } : {}),
      ...(payload.relatedEntityId ? { relatedEntityId: payload.relatedEntityId } : {}),
      ...data,
    };

    // Modified to create the temp directory in the current working directory
    tmpDir = await mkdtemp(join(process.cwd(), 'fcm-local-'));
    const apnsFile = join(tmpDir, 'notification.apns');
    logger.info("filefile: ", apnsFile);
    let record: Record<string, boolean> = {};
    
    await writeFile(apnsFile, JSON.stringify(apnsPayload, null, 2), 'utf8');

    await Promise.all(
      targets.map(async (device) => {
        try {
          if(record[device.udid]) {
            logger.info('[FCM:local] Push already sent to this device in this batch, skipping', { device: device.name, udid: device.udid });
            return;
          }
          await execAsync(`xcrun simctl push ${device.udid} ${BUNDLE_ID} ${apnsFile}`);
          record[device.udid] = true;

          logger.info('[FCM:local] Push sent', { device: device.name, udid: device.udid, record });
        } catch (err) {
          logger.warn('[FCM:local] Push failed for device', {
            device: device.name,
            udid: device.udid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
  } catch (err) {
    logger.warn('[FCM:local] sendLocalIosPush failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (tmpDir) {
      // You can uncomment this once you confirm it works to clean up the temp files
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
