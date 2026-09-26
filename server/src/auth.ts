import crypto from 'crypto';
import { RequestHandler } from 'express';
import { getMcpToken } from './settings';

// Same two ways in as BudgetPro:
//  1. Home Assistant Ingress (the sidebar panel): HA has already logged the
//     user in, and the request comes from the Supervisor's ingress proxy.
//  2. The add-on's own port on the LAN — how an AI client reaches /mcp.
//     That needs the MCP token as a Bearer token.
// Loopback is trusted for `npm run dev` and health checks.
const INGRESS_PROXY = '172.30.32.2';

const remoteIp = (raw: string | undefined) => (raw ?? '').replace(/^::ffff:/, '');

export function viaIngressOrLocal(ip: string | undefined): boolean {
  const a = remoteIp(ip);
  return a === INGRESS_PROXY || a === '127.0.0.1' || a === '::1';
}

function tokenMatches(given: string): boolean {
  const expected = Buffer.from(getMcpToken());
  const got = Buffer.from(given);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export const requireToken: RequestHandler = (req, res, next) => {
  if (viaIngressOrLocal(req.socket.remoteAddress)) return next();
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (bearer && tokenMatches(bearer)) return next();
  res.status(401).json({ error: 'MCP token required (KitchenAid → Settings → AI assistants, opened from the Home Assistant sidebar)' });
};

/** Only from the HA sidebar: showing the token to anyone on the LAN would defeat it. */
export const ingressOnly: RequestHandler = (req, res, next) => {
  if (viaIngressOrLocal(req.socket.remoteAddress)) return next();
  res.status(403).json({ error: 'Open KitchenAid from the Home Assistant sidebar to see or change the MCP token.' });
};
