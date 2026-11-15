export interface TransitKey {
  key: CryptoKey;
  /** Sealed ticket, also the key id in ciphertext (`tk-…`). */
  ticket: string;
  /** Unix seconds. */
  expiresAt: number;
}

/** Without a ticket, mints a new key; with one, resumes the key that ticket seals. */
export type HandshakeFn = (ticket?: string) => Promise<TransitKey>;

export const TRANSIT_TICKET_HEADER = 'x-transit-ticket';

const RENEW_BEFORE_SECONDS = 5 * 60;
/** Tickets met in ciphertext but not issued to this keyring (other tabs, cached rows). */
const MAX_RESUMED = 32;

/**
 * Transit keys by ticket. One ticket is active for encrypting and is renewed shortly
 * before it expires; any other ticket of the same session is resumed on first sight so
 * data encrypted under it stays readable. Keys never leave memory.
 */
export class TransitKeyring {
  private readonly keys = new Map<string, Promise<CryptoKey>>();
  private active: TransitKey | null = null;
  private renewing: Promise<TransitKey> | null = null;

  constructor(private readonly handshake: HandshakeFn) {}

  async init(): Promise<void> {
    await this.renew();
  }

  async current(): Promise<{ key: CryptoKey; ticket: string }> {
    const now = Date.now() / 1000;
    if (!this.active || this.active.expiresAt <= now) {
      await this.renew();
    } else if (this.active.expiresAt - now < RENEW_BEFORE_SECONDS) {
      void this.renew().catch(() => undefined);
    }
    return { key: this.active!.key, ticket: this.active!.ticket };
  }

  forTicket(ticket: string): Promise<CryptoKey> {
    let pending = this.keys.get(ticket);
    if (!pending) {
      pending = this.handshake(ticket).then(result => result.key);
      pending.catch(() => this.keys.delete(ticket));
      this.keys.set(ticket, pending);
      this.evict();
    }
    return pending;
  }

  clear(): void {
    this.keys.clear();
    this.active = null;
  }

  private renew(): Promise<TransitKey> {
    if (!this.renewing) {
      this.renewing = this.handshake()
        .then(result => {
          this.active = result;
          this.keys.set(result.ticket, Promise.resolve(result.key));
          this.evict();
          return result;
        })
        .finally(() => {
          this.renewing = null;
        });
    }
    return this.renewing;
  }

  private evict(): void {
    for (const ticket of this.keys.keys()) {
      if (this.keys.size <= MAX_RESUMED) return;
      if (ticket !== this.active?.ticket) this.keys.delete(ticket);
    }
  }
}
