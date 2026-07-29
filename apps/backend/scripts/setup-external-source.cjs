#!/usr/bin/env node

/**
 * Single script to encrypt credentials and generate SQL setup file
 *
 * Usage:
 *   ENCRYPTION_KEY=<key> \
 *   SOURCE_NAME=zoho-dashboard \
 *   SOURCE_TYPE=zoho \
 *   DISPLAY_NAME="Zoho (Dashboard Team)" \
 *   CREDENTIALS='{"jwkSet":"...","apiKey":"...","apiUrl":"...","orgId":"..."}' \
 *   ORG_NAME=juspay \
 *   CHANNEL_TITLE="Dashboard Support" \
 *   CHANNEL_DESCRIPTION="Support tickets from Dashboard team" \
 *   CHANNEL_TAGS="zoho,dashboard,support" \
 *   node scripts/setup-external-source.js
 *
 * This script:
 * 1. Encrypts the credentials using ENCRYPTION_KEY
 * 2. Generates a complete SQL file with channel + external_source creation
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
 * Generate SQL file content
 */
function generateSQL(config) {
  const lines = [];

  lines.push('-- Generated External Source Setup SQL');
  lines.push(`-- Generated at: ${new Date().toISOString()}`);
  lines.push(`-- Source: ${config.sourceName}`);
  lines.push(`-- Organization: ${config.orgName}`);
  lines.push('--');
  lines.push('-- Run this file with: psql -d your_database -f <filename>.sql');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  const channelVar = `channel_id_${config.sourceName.replace(/-/g, '_')}`;
  const tags = config.channelTags.split(',').map(t => t.trim());
  const tagsArray = `ARRAY[${tags.map(t => `'${t}'`).join(', ')}]`;

  lines.push('-- ' + '='.repeat(70));
  lines.push(`-- Setup: ${config.sourceName}`);
  lines.push('-- ' + '='.repeat(70));
  lines.push('');
  lines.push('DO $$');
  lines.push('DECLARE');
  lines.push(`  ${channelVar} TEXT;`);
  lines.push('BEGIN');
  lines.push('');
  lines.push('  -- Create channel');
  lines.push('  INSERT INTO channels (');
  lines.push('    "channelId", "scopeType", "scopeId", "title", "description",');
  lines.push('    "topicTags", "visibility", "createdAt", "updatedAt",');
  lines.push('    "lastActivityAt", "createdBy", "orgName"');
  lines.push('  ) VALUES (');
  lines.push('    gen_random_uuid(), \'DEFAULT\', NULL,');
  lines.push(`    '${config.channelTitle}',`);
  lines.push(`    '${config.channelDescription}',`);
  lines.push(`    ${tagsArray}, 'PUBLIC',`);
  lines.push(`    NOW(), NOW(), NOW(), 'system', '${config.orgName}'`);
  lines.push(`  ) RETURNING "channelId" INTO ${channelVar};`);
  lines.push('');
  lines.push('  -- Create external source');
  lines.push('  INSERT INTO external_sources (');
  lines.push('    id, name, "sourceType", "displayName", "channelId",');
  lines.push('    credentials, "isActive", "createdAt", "updatedAt"');
  lines.push('  ) VALUES (');
  lines.push('    gen_random_uuid(),');
  lines.push(`    '${config.sourceName}',`);
  lines.push(`    '${config.sourceType}',`);
  lines.push(`    '${config.displayName}',`);
  lines.push(`    ${channelVar},`);
  lines.push(`    '${config.encryptedCredentials}',`);
  lines.push(`    true, NOW(), NOW()`);
  lines.push('  );');
  lines.push('');
  lines.push('END $$;');
  lines.push('');
  lines.push('COMMIT;');
  lines.push('');

  return lines.join('\n');
}

/**
 * Validate environment variables
 */
function validateEnv() {
  const required = [
    'ENCRYPTION_KEY',
    'SOURCE_NAME',
    'SOURCE_TYPE',
    'DISPLAY_NAME',
    'CREDENTIALS'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('ERROR: Missing required environment variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('\nUsage:');
    console.error('  ENCRYPTION_KEY=<64-char-hex> \\');
    console.error('  SOURCE_NAME=zoho-dashboard \\');
    console.error('  SOURCE_TYPE=zoho \\');
    console.error('  DISPLAY_NAME="Zoho (Dashboard Team)" \\');
    console.error('  CREDENTIALS=\'{"jwkSet":"...","apiKey":"...","apiUrl":"...","orgId":"..."}\' \\');
    console.error('  ORG_NAME=juspay \\');
    console.error('  CHANNEL_TITLE="Dashboard Support" \\');
    console.error('  CHANNEL_DESCRIPTION="Support tickets from Dashboard" \\');
    console.error('  CHANNEL_TAGS="zoho,dashboard,support" \\');
    console.error('  node scripts/setup-external-source.js');
    console.error('\nGenerate ENCRYPTION_KEY:');
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  // Validate CREDENTIALS is valid JSON
  try {
    JSON.parse(process.env.CREDENTIALS);
  } catch (e) {
    console.error('ERROR: CREDENTIALS must be valid JSON');
    console.error(`Got: ${process.env.CREDENTIALS}`);
    process.exit(1);
  }
}

/**
 * Main execution
 */
function main() {
  console.log('='.repeat(70));
  console.log('External Source Setup Generator');
  console.log('='.repeat(70));
  console.log();

  validateEnv();

  const sourceName = process.env.SOURCE_NAME;
  const sourceType = process.env.SOURCE_TYPE;
  const displayName = process.env.DISPLAY_NAME;
  const credentials = process.env.CREDENTIALS;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const orgName = process.env.ORG_NAME || 'default-org';
  const channelTitle = process.env.CHANNEL_TITLE || `${displayName} Support`;
  const channelDescription = process.env.CHANNEL_DESCRIPTION || `Support tickets from ${displayName}`;
  const channelTags = process.env.CHANNEL_TAGS || `${sourceType},support`;

  console.log('Configuration:');
  console.log(`  Source: ${sourceName} (${sourceType})`);
  console.log(`  Display: ${displayName}`);
  console.log(`  Org: ${orgName}`);
  console.log(`  Channel: ${channelTitle}`);
  console.log();

  // Step 1: Encrypt credentials
  console.log('Step 1: Encrypting credentials...');
  const encryptedCredentials = encrypt(credentials, encryptionKey);
  console.log(`  ✓ Encrypted: ${encryptedCredentials.substring(0, 40)}...`);
  console.log();

  // Step 2: Generate SQL
  console.log('Step 2: Generating SQL...');
  const config = {
    sourceName,
    sourceType,
    displayName,
    encryptedCredentials,
    orgName,
    channelTitle,
    channelDescription,
    channelTags
  };

  const sqlContent = generateSQL(config);

  // Step 3: Write to file
  const filename = `${sourceName}-setup.sql`;
  const outputPath = path.join(process.cwd(), filename);
  fs.writeFileSync(outputPath, sqlContent, 'utf8');

  console.log(`  ✓ SQL generated: ${filename}`);
  console.log();

  console.log('='.repeat(70));
  console.log('✅ Setup Complete!');
  console.log('='.repeat(70));
  console.log();
  console.log('Next steps:');
  console.log(`  1. Run SQL: psql -d your_database -f ${filename}`);
  console.log(`  2. Configure webhook: https://your-domain.com/api/external-source-sync/${sourceName}/ingest`);
  console.log('  3. Restart your application');
  console.log();
}

try {
  main();
} catch (error) {
  console.error('\nERROR:', error.message);
  process.exit(1);
}
