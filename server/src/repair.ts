import { db } from './db';
import { deleteItem, itemForSlipLine, refreshLatestPrice } from './items';
import { differentProduct } from './productForms';
import { MAX_PACK_PRICE } from './budgetpro';
import { getSetting, setSetting } from './settings';

// One-off clean-ups of data earlier versions got wrong. Each runs once per
// install (remembered in settings) and reports what it changed in the log.

export interface RepairReport {
  badPrices: number;
  relinked: { slip: string; from: string; to: string }[];
  deleted: string[];
}

/**
 * 0.5.0: prices from misread slips (dated in the future, or impossible
 * amounts) are dropped, and items that only existed because of them go;
 * slip lines linked to the wrong kind of item ("Potato chips" → Potato,
 * "Peanut butter energy bar" → Butter) move to an item of their own.
 */
export const repairSlipData = db.transaction((): RepairReport => {
  const latest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const touched = new Set<string>();
  const report: RepairReport = { badPrices: 0, relinked: [], deleted: [] };

  // Misread slips.
  const bad = db
    .prepare('SELECT id, item_id FROM item_prices WHERE seen_at > ? OR pack_price > ?')
    .all(latest, MAX_PACK_PRICE) as { id: string; item_id: string }[];
  for (const p of bad) {
    db.prepare('DELETE FROM item_prices WHERE id = ?').run(p.id);
    touched.add(p.item_id);
  }
  report.badPrices = bad.length;
  // Items whose "last price" came from such a slip even without a history row.
  for (const r of db.prepare('SELECT id FROM items WHERE price_at > ? OR pack_price > ?').all(latest, MAX_PACK_PRICE) as { id: string }[]) {
    touched.add(r.id);
  }

  // Slip lines matched to a different kind of product.
  const links = db
    .prepare(
      `SELECT a.value, a.label, a.item_id, i.name, i.name_key FROM item_aliases a JOIN items i ON i.id = a.item_id
       WHERE a.kind = 'slip' AND a.label IS NOT NULL`
    )
    .all() as { value: string; label: string; item_id: string; name: string; name_key: string }[];
  for (const l of links) {
    if (!differentProduct(l.name_key, l.label)) continue;
    db.prepare("DELETE FROM item_aliases WHERE kind = 'slip' AND value = ?").run(l.value);
    const to = itemForSlipLine(l.label);
    db.prepare('UPDATE item_prices SET item_id = ? WHERE item_id = ? AND pack_label = ?').run(to.id, l.item_id, l.label);
    touched.add(l.item_id);
    touched.add(to.id);
    report.relinked.push({ slip: l.label, from: l.name, to: to.name });
  }

  // Pantry entries "bought" on a misread date.
  db.prepare(
    'UPDATE items SET in_pantry = 0, pantry_quantity = NULL, pantry_unit = NULL, pantry_note = NULL, bought_at = NULL WHERE bought_at > ?'
  ).run(latest);

  for (const id of touched) {
    refreshLatestPrice(id);
    // Made from a misread slip and nothing else: no prices left, no barcodes
    // or other names, not on a shopping list.
    const orphan = db
      .prepare(
        `SELECT i.name FROM items i WHERE i.id = ?
           AND NOT EXISTS (SELECT 1 FROM item_prices p WHERE p.item_id = i.id)
           AND NOT EXISTS (SELECT 1 FROM item_aliases a WHERE a.item_id = i.id AND a.kind != 'slip')
           AND NOT EXISTS (SELECT 1 FROM shopping_items s WHERE s.item_id = i.id)
           AND EXISTS (SELECT 1 FROM item_aliases a WHERE a.item_id = i.id AND a.kind = 'slip')`
      )
      .get(id) as { name: string } | undefined;
    if (orphan) {
      deleteItem(id);
      report.deleted.push(orphan.name);
    }
  }
  return report;
});

export function runRepairs() {
  if (getSetting('repair_slip_data_v1')) return;
  try {
    const r = repairSlipData();
    setSetting('repair_slip_data_v1', new Date().toISOString());
    setSetting('repair_slip_data_v1_report', JSON.stringify(r));
    if (r.badPrices || r.relinked.length || r.deleted.length) {
      console.log(
        `[repair] dropped ${r.badPrices} misread slip prices, deleted ${r.deleted.length} junk items (${r.deleted.join(', ')}), ` +
          `re-linked ${r.relinked.map((x) => `"${x.slip}" ${x.from} → ${x.to}`).join('; ') || 'nothing'}`
      );
    }
  } catch (e: any) {
    console.warn(`[repair] slip data clean-up failed: ${e.message}`);
  }
}
