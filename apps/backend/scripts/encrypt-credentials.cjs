#!/usr/bin/env node

/**
 * Standalone script to encrypt/decrypt credentials
 *
 * Usage:
 *   ENCRYPTION_KEY=<key> CREDENTIALS_TO_ENCRYPT=<data> node scripts/encrypt-credentials.js
 *
 * Example:
 *   ENCRYPTION_KEY=abc123... CREDENTIALS_TO_ENCRYPT='{"jwkSet":"...","apiKey":"..."}' node scripts/encrypt-credentials.js
 *
 * This script:
 * 1. Reads ENCRYPTION_KEY (32-byte hex string)
 * 2. Reads CREDENTIALS_TO_ENCRYPT (JSON string or any text)
 * 3. Encrypts the data using AES-256-CBC
 * 4. Outputs encrypted string in format: IV:ciphertext
 * 5. Decrypts to verify it works
 */

const crypto = require('crypto');
require('dotenv').config();

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypt plaintext using AES-256-CBC
 */
function encrypt(plaintext, encryptionKey) {
  const keyBuffer = Buffer.from(encryptionKey, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt ciphertext using AES-256-CBC
 */
function decrypt(encryptedData, encryptionKey) {
  const keyBuffer = Buffer.from(encryptionKey, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  const parts = encryptedData.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted data format. Expected "IV:ciphertext"');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length. Expected ${IV_LENGTH} bytes`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Main execution
 */
function main() {
  console.log('='.repeat(70));
  console.log('Credential Encryption Tool');
  console.log('='.repeat(70));
  console.log();

  // Check for encryption key
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error('ERROR: ENCRYPTION_KEY not found in environment variables');
    console.error('\nGenerate a key with:');
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    console.error('\nUsage:');
    console.error('  ENCRYPTION_KEY=<key> CREDENTIALS_TO_ENCRYPT=<data> node scripts/encrypt-credentials.js');
    process.exit(1);
  }

  // Check for data to encrypt
  const dataToEncrypt = process.env.CREDENTIALS_TO_ENCRYPT;
  if (!dataToEncrypt) {
    console.error('ERROR: CREDENTIALS_TO_ENCRYPT not found in environment variables');
    console.error('\nUsage:');
    console.error('  ENCRYPTION_KEY=<key> CREDENTIALS_TO_ENCRYPT=<data> node scripts/encrypt-credentials.js');
    console.error('\nExample:');
    console.error('  CREDENTIALS_TO_ENCRYPT=\'{"jwkSet":"...","apiKey":"..."}\' node scripts/encrypt-credentials.js');
    process.exit(1);
  }

  // Validate if it's valid JSON (optional - just for display)
  let isJson = false;
  try {
    JSON.parse(dataToEncrypt);
    isJson = true;
  } catch (e) {
    // Not JSON, that's fine - encrypt as plain text
  }

  console.log('Original Data:');
  if (isJson) {
    console.log(JSON.stringify(JSON.parse(dataToEncrypt), null, 2));
  } else {
    console.log(dataToEncrypt);
  }
  console.log();

  // Encrypt
  const encrypted = encrypt(dataToEncrypt, encryptionKey);
  console.log('Encrypted (IV:ciphertext):');
  console.log(encrypted);
  console.log();

  // Decrypt to verify
  const decrypted = decrypt(encrypted, encryptionKey);
  console.log('Decrypted (verification):');
  if (isJson) {
    console.log(JSON.stringify(JSON.parse(decrypted), null, 2));
  } else {
    console.log(decrypted);
  }
  console.log();

  // Verify match
  if (decrypted === dataToEncrypt) {
    console.log('✓ Encryption/Decryption verified successfully!');
  } else {
    console.error('✗ ERROR: Decrypted data does not match original!');
    process.exit(1);
  }
  console.log();
  console.log('='.repeat(70));
  console.log('Copy the encrypted string above to store in your database.');
  console.log('='.repeat(70));
}

// Run the script
try {
  main();
} catch (error) {
  console.error('\nERROR:', error.message);
  process.exit(1);
}
