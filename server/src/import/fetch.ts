import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { UPLOADS_DIR } from '../db';

// A browser-shaped User-Agent that still says who it is: plenty of recipe
// sites refuse obvious bots, but this only ever fetches the one page you
// asked for, once. A "prove you're human" page is reported, never worked around.
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 KitchenAid/0.1';
const TIMEOUT_MS = 20000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export class ImportError extends Error {}

export async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImportError("That doesn't look like a web address.");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new ImportError('Only http and https links can be imported.');

  let res: Response;
  try {
    res = await fetch(parsed, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-ZA,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new ImportError(`Couldn't reach ${parsed.hostname}: ${e.cause?.code || e.message}`);
  }
  if (res.status === 404 || res.status === 410) throw new ImportError(`${parsed.hostname} says that page doesn't exist (HTTP ${res.status}).`);
  if (!res.ok) {
    // Some publishers (AllRecipes, Serious Eats and their sister sites answer
    // 402) refuse anything that isn't a real browser, however it's dressed up.
    throw new ImportError(
      `${parsed.hostname} refused the request (HTTP ${res.status}) — it blocks automatic imports. ` +
        'Open the recipe in your browser, press Ctrl+U (view source), select all, copy, and paste it under "Paste text" instead — ' +
        "it's read exactly the same way."
    );
  }
  const type = res.headers.get('content-type') || '';
  if (type && !/html|xml/.test(type)) throw new ImportError(`That link is a ${type.split(';')[0]}, not a web page.`);
  const html = await res.text();
  if (/cf-challenge|challenge-platform|captcha/i.test(html) && !/ld\+json/i.test(html)) {
    throw new ImportError(
      `${parsed.hostname} asked for a human check. Copy the recipe from your browser and paste it under "Paste text" instead.`
    );
  }
  return { html, finalUrl: res.url || parsed.toString() };
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

/** Download an image into uploads; returns its file name, or null if it isn't a usable image. */
export async function downloadImage(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = EXTENSIONS[type];
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    const file = `${uuid()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
    return file;
  } catch {
    return null;
  }
}

export function deleteUpload(file: string | null | undefined) {
  if (!file) return;
  const full = path.join(UPLOADS_DIR, path.basename(file));
  fs.promises.unlink(full).catch(() => undefined);
}
