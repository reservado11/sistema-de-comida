const fs = require('fs');
const path = require('path');

const IS_VERCEL = process.env.VERCEL === '1';

const ORIGINAL_DB_PATH = path.join(__dirname, 'data', 'db.json');

const DB_PATH = IS_VERCEL
  ? path.join('/tmp', 'pos-comida', 'db.json')
  : ORIGINAL_DB_PATH;

function defaultData() {
  return {
    counters: { product: 4, ingredient: 4, order: 1, table: 5, closing: 1 },
    products: [
      { id: 1, name: 'Hamburguesa Clásica', category: 'Platos fuertes', price: 15000, cost: 6000, recipe: [] },
      { id: 2, name: 'Papas Fritas', category: 'Acompañantes', price: 6000, cost: 2000, recipe: [] },
      { id: 3, name: 'Gaseosa', category: 'Bebidas', price: 4000, cost: 1500, recipe: [] }
    ],
    ingredients: [
      { id: 1, name: 'Carne de res (kg)', unit: 'kg', stock: 10, minStock: 2 },
      { id: 2, name: 'Papa (kg)', unit: 'kg', stock: 20, minStock: 5 },
      { id: 3, name: 'Gaseosa (unidad)', unit: 'un', stock: 50, minStock: 10 }
    ],
    tables: [
      { id: 1, name: 'Mesa 1', status: 'libre' },
      { id: 2, name: 'Mesa 2', status: 'libre' },
      { id: 3, name: 'Mesa 3', status: 'libre' },
      { id: 4, name: 'Mesa 4', status: 'libre' }
    ],
    orders: [],
    closings: []
  };
}

function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

    if (IS_VERCEL && fs.existsSync(ORIGINAL_DB_PATH)) {
      fs.copyFileSync(ORIGINAL_DB_PATH, DB_PATH);
    } else {
      fs.writeFileSync(
        DB_PATH,
        JSON.stringify(defaultData(), null, 2)
      );
    }
  }
}

function readDB() {
  ensureDB();

  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  const data = JSON.parse(raw);

  // Compatibilidad con bases de datos creadas antes del cierre diario.

  if (!Array.isArray(data.closings)) data.closings = [];

  data.counters = data.counters || {};

  return data;
}

function writeDB(data) {
  ensureDB();

  const tmp = DB_PATH + '.tmp';

  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));

  fs.renameSync(tmp, DB_PATH);
}

const COLLECTIONS = {
  product: 'products',
  ingredient: 'ingredients',
  table: 'tables',
  order: 'orders',
  closing: 'closings',
  user: 'users'
};

function nextId(db, counterKey) {
  db.counters = db.counters || {};

  const list = Array.isArray(db[COLLECTIONS[counterKey]])
    ? db[COLLECTIONS[counterKey]]
    : [];

  const maxId = list.reduce(
    (max, item) => Math.max(max, Number(item.id) || 0),
    0
  );

  const id = Math.max(
    db.counters[counterKey] || 1,
    maxId + 1
  );

  db.counters[counterKey] = id + 1;

  return id;
}

function repairDB() {
  ensureDB();

  const db = readDB();

  let changed = false;

  for (const key of ['product', 'ingredient', 'table']) {
    const list = db[COLLECTIONS[key]];

    if (!Array.isArray(list)) continue;

    const seen = new Set();

    for (const item of list) {
      if (seen.has(item.id)) {
        const oldId = item.id;

        item.id = nextId(db, key);

        changed = true;

        for (const order of (db.orders || [])) {
          if (order.status !== 'abierto') continue;

          if (
            key === 'table' &&
            order.tableId === oldId &&
            order.tableName === item.name
          ) {
            order.tableId = item.id;
          }

          if (key === 'product') {
            for (const line of order.items || []) {
              if (
                line.productId === oldId &&
                line.name === item.name
              ) {
                line.productId = item.id;
              }
            }
          }
        }
      }

      seen.add(item.id);
    }
  }

  if (changed) {
    fs.copyFileSync(
      DB_PATH,
      DB_PATH + '.antes-de-reparar'
    );

    writeDB(db);

    console.log(
      'Se repararon ids repetidos en la base de datos (copia: data/db.json.antes-de-reparar).'
    );
  }
}

module.exports = {
  readDB,
  writeDB,
  nextId,
  ensureDB,
  repairDB
};