export interface TransitKey {
  key: CryptoKey;
  epoch: number;
  epochSeconds: number;
}

export type HandshakeFn = (epoch?: number) => Promise<TransitKey>;

const PREFETCH_BEFORE_MS = 60_000;

/**
 * Transit keys by epoch. The server derives each key from the caller's session and
 * the epoch, so a key missing here is fetched again, never recovered from storage.
 */
export class TransitKeyring {
  private readonly keys = new Map<number, Promise<CryptoKey>>();
  private epochSeconds: number | null = null;

  constructor(private readonly handshake: HandshakeFn) {}

  async init(): Promise<void> {
    const result = await this.handshake();
    this.epochSeconds = result.epochSeconds;
    this.keys.set(result.epoch, Promise.resolve(result.key));
  }

  currentEpoch(now: number = Date.now()): number {
    if (this.epochSeconds === null) {
      throw new Error('Transit keyring is not initialised');
    }
    return Math.floor(now / 1000 / this.epochSeconds);
  }

  async current(): Promise<{ key: CryptoKey; epoch: number }> {
    if (this.epochSeconds === null) {
      await this.init();
    }
    const now = Date.now();
    const epoch = this.currentEpoch(now);
    const nextStartsAt = (epoch + 1) * this.epochSeconds! * 1000;
    if (nextStartsAt - now < PREFETCH_BEFORE_MS && !this.keys.has(epoch + 1)) {
      void this.forEpoch(epoch + 1).catch(() => undefined);
    }
    return { key: await this.forEpoch(epoch), epoch };
  }

  forEpoch(epoch: number): Promise<CryptoKey> {
    let pending = this.keys.get(epoch);
    if (!pending) {
      pending = this.handshake(epoch).then(result => {
        this.epochSeconds = result.epochSeconds;
        return result.key;
      });
      pending.catch(() => this.keys.delete(epoch));
      this.keys.set(epoch, pending);
      this.evict(epoch);
    }
    return pending;
  }

  clear(): void {
    this.keys.clear();
  }

  private evict(latest: number): void {
    for (const epoch of this.keys.keys()) {
      if (epoch < latest - 1) this.keys.delete(epoch);
    }
  }
}
