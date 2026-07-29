// Recovery service for detecting and recovering stale workflow executions
// This service should be run in a separate pod

import { RecoveryWorker } from '../polling/recovery-worker'

export class RecoveryService {
  private worker: RecoveryWorker

  constructor() {
    this.worker = new RecoveryWorker()
  }

  async start(): Promise<void> {
    await this.worker.start()
  }

  async stop(): Promise<void> {
    await this.worker.stop()
  }
}

export const recoveryService = new RecoveryService()
