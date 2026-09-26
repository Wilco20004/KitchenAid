import fs from 'fs';
import path from 'path';

// Where everything is stored: /data in the add-on, ./data in development.
// Its own module so reading settings doesn't have to open the database.
export const DATA_DIR = process.env.KITCHENAID_DATA_DIR || path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
