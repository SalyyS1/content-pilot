/**
 * Credential Encryption — AES-256-GCM for storing account credentials
 * 
 * Auto-generates CRED_KEY on first run and saves to .env
 * Uses node:crypto only — no external dependencies
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import logger from '../core/logger.js';

const ENV_PATH = resolve(process.cwd(), '.env');

/**
 * Ensure CRED_KEY exists — auto-generate if missing
 */
function ensureCredKey() {
  if (process.env.CRED_KEY) return;

  // Check if already in .env but not loaded
  if (existsSync(ENV_PATH)) {
    const envContent = readFileSync(ENV_PATH, 'utf8');
    const match = envContent.match(/^CRED_KEY=(.+)$/m);
    if (match) {
      process.env.CRED_KEY = match[1].trim();
      return;
    }
  }

  // Generate new key
  const key = randomBytes(32).toString('hex');
  process.env.CRED_KEY = key;

  // Append to .env
  try {
    appendFileSync(ENV_PATH, `\n# Auto-generated encryption key — BACK THIS UP!\nCRED_KEY=${key}\n`);
    logger.warn('🔑 Generated new CRED_KEY and saved to .env. BACK UP THIS KEY!');
  } catch (err) {
    logger.error(`Failed to save CRED_KEY to .env: ${err.message}`);
    logger.warn(`CRED_KEY=${key} — Save this manually!`);
  }
}

// Run on import
ensureCredKey();

/**
 * Encrypt plaintext using AES-256-GCM
 * @returns {string} "iv:authTag:ciphertext" (all hex)
 */
export function encrypt(plaintext) {
  const key = Buffer.from(process.env.CRED_KEY, 'hex');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt ciphertext
 * @param {string} ciphertext - "iv:authTag:encrypted" format
 * @returns {string} plaintext
 */
export function decrypt(ciphertext) {
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  const key = Buffer.from(process.env.CRED_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');
}

/**
 * Test encryption roundtrip
 */
export function testEncryption() {
  const test = 'hello-world-test-' + Date.now();
  const enc = encrypt(test);
  const dec = decrypt(enc);
  return dec === test;
}

export default { encrypt, decrypt, testEncryption };
