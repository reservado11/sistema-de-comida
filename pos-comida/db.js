const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

if (process.env.VERCEL && !USE_SUPABASE) {
  throw new Error('Faltan las variables de Supabase.');
}

const supabase = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      realtime: {
        transport: WebSocket
      }
    })
  : null;

const revisions = new WeakMap();

/* ============ DATOS INICIALES ============ */

function defaultData() {
  return {
    counters: {
      product: 4,
      ingredient: 4,
      order: 1,
      table: 5,
      closing: 1
    },

    products: [
      {
        id: 1,
        name: 'Hamburguesa Clásica',
        category: 'Platos fuertes',
        price: 15000,
        cost: 6000,
        recipe: []
      },
      {
        id: 2,
        name: 'Papas Fritas',
        category: 'Acompañantes',
        price: 6000,
        cost: 2000,
        recipe: []
      },
      {
        id: 3,
        name: 'Gaseosa',
        category: 'Bebidas',
        price: 4000,
        cost: 1500,
        recipe: []
      }
    ],

    ingredients: [
      {
        id: 1,
        name: 'Carne de res (kg)',
        unit: 'kg',
        stock: 10,
        minStock: 2
      },
      {
        id: 2,
        name: 'Papa (kg)',
        unit: 'kg',
        stock: 20,
        minStock: 5
      },
      {
        id: 3,
        name: 'Gaseosa (unidad)',
        unit: 'un',
        stock: 50,
        minStock: 10
      }
    ],

    tables: [
      { id: 1, name: 'Mesa 1', status: 'libre' },
      { id: 2, name: 'Mesa 2', status: 'libre' },
      { id: 3, name: 'Mesa 3', status: 'libre' },
      { id: 4, name: 'Mesa 4', status: 'libre' }
    ],

    orders: [],
    closings: [],
    users: [],
    sessions: []
  };
}

/* ============ NORMALIZAR DATOS ============ */

function normalizeData(data) {
  data.counters = data.counters || {};

  const collections = [
    'products',
    'ingredients',
    'tables',
    'orders',
    'closings',
    'users',
    'sessions'
  ];

  for (const key of collections) {
    if (!Array.isArray(data[key])) {
      data[key] = [];
    }
  }

  return data;
}

/* ============ COMPROBAR BASE DE DATOS ============ */

async function ensureDB() {
  if (USE_SUPABASE) {
    const { data, error } = await supabase
      .from('pos_data')
      .select('id')
      .eq('id', 'main')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error(
        'La base de datos todavía no ha sido migrada.'
      );
    }

    return;
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), {
      recursive: true
    });

    fs.writeFileSync(
      DB_PATH,
      JSON.stringify(defaultData(), null, 2)
    );
  }
}

/* ============ LEER BASE DE DATOS ============ */

async function readDB() {
  if (USE_SUPABASE) {
    const { data, error } = await supabase
      .from('pos_data')
      .select('data, revision')
      .eq('id', 'main')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    const db = normalizeData(data.data);

    revisions.set(db, Number(data.revision));

    return db;
  }

  await ensureDB();

  const raw = fs.readFileSync(DB_PATH, 'utf-8');

  return normalizeData(JSON.parse(raw));
}

/* ============ GUARDAR BASE DE DATOS ============ */

async function writeDB(data) {
  if (USE_SUPABASE) {
    const revision = revisions.get(data);

    if (revision === undefined) {
      throw new Error(
        'No se conoce la revisión de los datos.'
      );
    }

    const { data: updated, error } = await supabase
      .from('pos_data')
      .update({
        data,
        revision: revision + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', 'main')
      .eq('revision', revision)
      .select('revision')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!updated) {
      const conflict = new Error(
        'Otro dispositivo modificó los datos. Actualiza e intenta nuevamente.'
      );

      conflict.status = 409;

      throw conflict;
    }

    revisions.set(data, Number(updated.revision));

    return;
  }

  await ensureDB();

  const tmp = DB_PATH + '.tmp';

  fs.writeFileSync(
    tmp,
    JSON.stringify(data, null, 2)
  );

  fs.renameSync(tmp, DB_PATH);
}

/* ============ GENERAR IDENTIFICADORES ============ */

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

  const list = Array.isArray(
    db[COLLECTIONS[counterKey]]
  )
    ? db[COLLECTIONS[counterKey]]
    : [];

  const maxId = list.reduce(
    (max, item) =>
      Math.max(max, Number(item.id) || 0),
    0
  );

  const id = Math.max(
    db.counters[counterKey] || 1,
    maxId + 1
  );

  db.counters[counterKey] = id + 1;

  return id;
}

/* ============ REPARAR IDENTIFICADORES REPETIDOS ============ */

async function repairDB() {
  await ensureDB();

  const db = await readDB();

  let changed = false;

  for (const key of ['product', 'ingredient', 'table']) {
    const list = db[COLLECTIONS[key]];

    if (!Array.isArray(list)) {
      continue;
    }

    const seen = new Set();

    for (const item of list) {
      if (seen.has(item.id)) {
        const oldId = item.id;

        item.id = nextId(db, key);

        changed = true;

        for (const order of db.orders || []) {
          if (order.status !== 'abierto') {
            continue;
          }

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
    if (!USE_SUPABASE) {
      fs.copyFileSync(
        DB_PATH,
        DB_PATH + '.antes-de-reparar'
      );
    }

    await writeDB(db);

    console.log(
      'Se repararon ids repetidos en la base de datos.'
    );
  }
}

/* ============ MIGRAR DATOS A SUPABASE ============ */

async function migrateDB() {
  if (!USE_SUPABASE) {
    throw new Error(
      'Configura las variables de Supabase.'
    );
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      'No se encontró data/db.json.'
    );
  }

  const db = normalizeData(
    JSON.parse(
      fs.readFileSync(DB_PATH, 'utf-8')
    )
  );

  if (!db.users.some(
    u => u.role === 'admin' && u.active
  )) {
    throw new Error(
      'La base local no tiene una cuenta administradora activa.'
    );
  }

  db.sessions = [];

  const { error } = await supabase
    .from('pos_data')
    .insert({
      id: 'main',
      data: db,
      revision: 0,
      updated_at: new Date().toISOString()
    });

  if (error) {
    throw new Error(error.message);
  }

  console.log(
    'Base de datos migrada correctamente.'
  );
}

/* ============ EXPORTAR FUNCIONES ============ */

module.exports = {
  readDB,
  writeDB,
  nextId,
  ensureDB,
  repairDB,
  migrateDB
};