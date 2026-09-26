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
  parse_api_key: string;
  checkers_daily_searches: number;
  checkers_monthly_credits: number;
  checkers_refresh_days: number;
  checkers_keep_days: number;
  checkers_requests_per_minute: number;
}

const defaults: Options = {
  cache_hours: 24,
  // PnP prices differ per store; WC21 is the one pnp.co.za uses before a
  // shopper picks their own.
  pnp_store_code: 'WC21',
  // Woolworths lists prices per region as p10 / p30 / p60.
  woolworths_price_zone: 'p10',
  makro_pages: 1,
  // Checkers comes through Parse (parse.bot), a paid third-party API: off
  // without a key, cached longer and capped per month to save credits.
  parse_api_key: '',
  // A few broad searches a day ("milk", "rice") build a local Checkers
  // catalogue; everything else matches against it for free.
  checkers_daily_searches: 10,
  checkers_monthly_credits: 300,
  checkers_refresh_days: 3,
  checkers_keep_days: 14,
  checkers_requests_per_minute: 5,
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
