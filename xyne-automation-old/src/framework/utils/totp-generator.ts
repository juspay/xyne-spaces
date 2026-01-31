/**
 * TOTP (Time-based One-Time Password) Generator
 * TypeScript equivalent of Python's pyotp library
 */

import * as crypto from 'crypto';

export class TOTPGenerator {
  private secret: string;
  private period: number;
  private digits: number;
  private algorithm: string;

  constructor(secret: string, period: number = 30, digits: number = 6, algorithm: string = 'sha1') {
    this.secret = secret;
    this.period = period;
    this.digits = digits;
    this.algorithm = algorithm;
  }

  /**
   * Generate current TOTP code
   * Equivalent to pyotp.TOTP(secret).now()
   */
  generateCurrentCode(): string {
    const timeCounter = Math.floor(Date.now() / 1000 / this.period);
    return this.generateCode(timeCounter);
  }

  /**
   * Generate TOTP code for specific time counter
   */
  private generateCode(timeCounter: number): string {
    // Convert secret from base32 to buffer
    const secretBuffer = this.base32ToBuffer(this.secret);
    
    // Create time counter buffer (8 bytes, big-endian)
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeUInt32BE(Math.floor(timeCounter / 0x100000000), 0);
    timeBuffer.writeUInt32BE(timeCounter & 0xffffffff, 4);

    // Generate HMAC
    const hmac = crypto.createHmac(this.algorithm, secretBuffer);
    hmac.update(timeBuffer);
    const hmacResult = hmac.digest();

    // Dynamic truncation
    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    const code = (
      ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff)
    ) % Math.pow(10, this.digits);

    // Pad with leading zeros
    return code.toString().padStart(this.digits, '0');
  }

  /**
   * Convert base32 string to buffer
   */
  private base32ToBuffer(base32: string): Buffer {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleanBase32 = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
    
    let bits = '';
    for (const char of cleanBase32) {
      const index = base32Chars.indexOf(char);
      if (index === -1) continue;
      bits += index.toString(2).padStart(5, '0');
    }

    const bytes: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
      const byte = bits.substr(i, 8);
      if (byte.length === 8) {
        bytes.push(parseInt(byte, 2));
      }
    }

    return Buffer.from(bytes);
  }

  /**
   * Get time remaining until next code generation
   */
  getTimeRemaining(): number {
    return this.period - (Math.floor(Date.now() / 1000) % this.period);
  }

  /**
   * Check if current time is near code expiration
   */
  isNearExpiration(threshold: number = 3): boolean {
    return this.getTimeRemaining() <= threshold;
  }

  /**
   * Wait for new code if current one is about to expire
   */
  async waitForNewCodeIfNeeded(threshold: number = 3): Promise<void> {
    if (this.isNearExpiration(threshold)) {
      const waitTime = this.getTimeRemaining() * 1000;
      console.log(`TOTP code expires in ${this.getTimeRemaining()}s, waiting for new code...`);
      await new Promise(resolve => setTimeout(resolve, waitTime + 1000)); // Add 1s buffer
    }
  }

  /**
   * Generate TOTP code with smart timing
   * Waits for new code if current one is about to expire
   */
  async generateCodeWithTiming(threshold: number = 3): Promise<string> {
    await this.waitForNewCodeIfNeeded(threshold);
    const code = this.generateCurrentCode();
    console.log(`Generated TOTP code: ${code} (expires in ${this.getTimeRemaining()}s)`);
    return code;
  }

  /**
   * Verify if a given code is valid
   */
  verifyCode(code: string, window: number = 1): boolean {
    const currentTime = Math.floor(Date.now() / 1000 / this.period);
    
    for (let i = -window; i <= window; i++) {
      const testCode = this.generateCode(currentTime + i);
      if (testCode === code) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Create TOTP generator from environment variable
   */
  static fromEnvironment(secretEnvVar: string = 'TOTP_SECRET_KEY'): TOTPGenerator {
    const secret = process.env[secretEnvVar];
    if (!secret) {
      throw new Error(`Environment variable ${secretEnvVar} is not set`);
    }
    return new TOTPGenerator(secret);
  }
}

/**
 * Utility function to create TOTP generator
 */
export function createTOTPGenerator(secret: string): TOTPGenerator {
  return new TOTPGenerator(secret);
}

/**
 * Quick function to generate current TOTP code
 */
export function generateTOTPCode(secret: string): string {
  const totp = new TOTPGenerator(secret);
  return totp.generateCurrentCode();
}
