import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from './db';
import { DATA_DIR } from './paths';

// Add-on options: Home Assistant's Supervisor writes the Configuration tab to
// /data/options.json before starting the container. Read on every call so a
// changed option doesn't need a code path of its own (a restart applies it anyway).
function readOptions(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function getBudgetProOptions() {
  const o = readOptions();
  const str = (key: string, env: string) => (typeof o[key] === 'string' && (o[key] as string).trim()) || process.env[env] || '';
  return {
    url: str('budgetpro_url', 'BUDGETPRO_URL').replace(/\/+$/, ''),
    token: str('budgetpro_token', 'BUDGETPRO_TOKEN'),
    categories: (str('budgetpro_categories', 'BUDGETPRO_CATEGORIES') || 'Groceries')
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function getSetting(key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// The MCP token is generated server-side with Node's crypto — never in the
// browser, where crypto.randomUUID() is missing over plain http.
export function getMcpToken(): string {
  let token = getSetting('mcp_token');
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    setSetting('mcp_token', token);
  }
  return token;
}

export function regenerateMcpToken(): string {
  const token = crypto.randomBytes(24).toString('base64url');
  setSetting('mcp_token', token);
  return token;
}
