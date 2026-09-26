import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../paths';

// Home Assistant writes the add-on's options to /data/options.json; in dev
// there is none and the defaults apply.
interface Options {
  cache_hours: number;
  pnp_store_code: string;
  woolworths_price_zone: string;
  makro_pages: number;
}

const defaults: Options = {
  cache_hours: 24,
  // PnP prices differ per store; WC21 is the one pnp.co.za uses before a
  // shopper picks their own.
  pnp_store_code: 'WC21',
  // Woolworths lists prices per region as p10 / p30 / p60.
  woolworths_price_zone: 'p10',
  makro_pages: 1,
};

function load(): Options {
  const file = path.join(DATA_DIR, 'options.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof Options)[]) {
      if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') (out as any)[key] = raw[key];
    }
    return out;
  } catch {
    return defaults;
  }
}

export const options = load();
