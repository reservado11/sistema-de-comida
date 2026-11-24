const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { readDB, writeDB, nextId, ensureDB, repairDB } = require('./db');

ensureDB();
repairDB();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SESSION_COOKIE = 'pos_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function safeUser(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role, active: user.active };
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  const item = cookies.map(v => v.trim()).find(v => v.startsWith(name + '='));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function createSession(db, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  db.sessions = (db.sessions || []).filter(s => s.expiresAt > Date.now());
  db.sessions.push({ tokenHash, userId: user.id, expiresAt: Date.now() + SESSION_DURATION_MS });

  writeDB(db);
  return token;
}

function requireAuth(req, res, next) {
  const token = getCookie(req, SESSION_COOKIE);

  if (!token) return res.status(401).json({ error: 'Debes iniciar sesión para continuar.' });

  const db = readDB();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const session = (db.sessions || []).find(s => s.tokenHash === tokenHash && s.expiresAt > Date.now());
  const user = session && db.users && db.users.find(u => u.id === session.userId && u.active);

  if (!user) return res.status(401).json({ error: 'Tu sesión venció. Inicia sesión nuevamente.' });

  req.user = user;
  req.db = db;

  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Esta función solo está disponible para la administradora.' });

  next();
}

app.get('/api/auth/status', (req, res) => {
  const db = readDB();
  res.json({ setupRequired: !Array.isArray(db.users) || db.users.length === 0 });
});

app.post('/api/auth/setup', (req, res) => {
  const db = readDB();

  if (Array.isArray(db.users) && db.users.length) return res.status(403).json({ error: 'La cuenta inicial ya fue creada.' });

  const name = String(req.body.name || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !/^[a-z0-9._-]{3,30}$/.test(username) || password.length < 8) {
    return res.status(400).json({ error: 'Ingresa tu nombre, un usuario de 3 a 30 caracteres (letras, números, punto, guion) y una contraseña de mínimo 8 caracteres.' });
  }

  const secured = hashPassword(password);

  const admin = { id: 1, name, username, role: 'admin', active: true, passwordHash: secured.hash, passwordSalt: secured.salt, createdAt: new Date().toISOString() };

  db.users = [admin];
  db.counters = db.counters || {};
  db.counters.user = 2;
  db.sessions = [];

  const token = createSession(db, admin);

  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`);

  res.status(201).json({ user: safeUser(admin) });
});

app.post('/api/auth/login', (req, res) => {
  const db = readDB();

  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = (db.users || []).find(u => u.username === username && u.active);

  if (!user || !crypto.timingSafeEqual(Buffer.from(hashPassword(password, user.passwordSalt).hash, 'hex'), Buffer.from(user.passwordHash, 'hex'))) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  const token = createSession(db, user);

  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`);

  res.json({ user: safeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);
  const db = readDB();

  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    db.sessions = (db.sessions || []).filter(s => s.tokenHash !== tokenHash);

    writeDB(db);
  }

  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: safeUser(req.user) }));

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();
  res.json((db.users || []).map(safeUser));
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const name = String(req.body.name || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role === 'employee' ? 'employee' : 'admin';

  if (!name || !/^[a-z0-9._-]{3,30}$/.test(username) || password.length < 8) {
    return res.status(400).json({ error: 'Completa el nombre, un usuario válido y una contraseña de mínimo 8 caracteres.' });
  }

  if ((db.users || []).some(u => u.username === username)) return res.status(409).json({ error: 'Ese nombre de usuario ya existe.' });

  const secured = hashPassword(password);

  const user = { id: nextId(db, 'user'), name, username, role, active: true, passwordHash: secured.hash, passwordSalt: secured.salt, createdAt: new Date().toISOString() };

  db.users.push(user);

  writeDB(db);

  res.status(201).json(safeUser(user));
});

app.patch('/api/users/:id/status', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const user = (db.users || []).find(u => u.id === Number(req.params.id));

  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  if (user.id === req.user.id) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });

  if (!req.body.active && user.role === 'admin' && (db.users || []).filter(u => u.role === 'admin' && u.active).length <= 1) {
    return res.status(400).json({ error: 'Debe quedar al menos una cuenta administradora activa.' });
  }

  user.active = Boolean(req.body.active);

  if (!user.active) db.sessions = (db.sessions || []).filter(s => s.userId !== user.id);

  writeDB(db);

  res.json(safeUser(user));
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();

  return requireAuth(req, res, next);
});

/* ============ PRODUCTOS (MENÚ) ============ */

app.get('/api/products', (req, res) => {
  const db = readDB();
  res.json(db.products);
});

app.post('/api/products', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const { name, category, price, cost, recipe } = req.body;

  if (!name || price == null) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });

  const product = {
    id: nextId(db, 'product'),
    name,
    category: category || 'General',
    price: Number(price),
    cost: Number(cost) || 0,
    recipe: Array.isArray(recipe) ? recipe : [] // [{ingredientId, qty}]
  };

  db.products.push(product);

  writeDB(db);

  res.status(201).json(product);
});

app.put('/api/products/:id', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const id = Number(req.params.id);
  const idx = db.products.findIndex(p => p.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });

  db.products[idx] = { ...db.products[idx], ...req.body, id };

  writeDB(db);

  res.json(db.products[idx]);
});

app.delete('/api/products/:id', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const id = Number(req.params.id);

  db.products = db.products.filter(p => p.id !== id);

  writeDB(db);

  res.json({ ok: true });
});

/* ============ INGREDIENTES (INVENTARIO) ============ */

app.get('/api/ingredients', (req, res) => {
  const db = readDB();
  res.json(db.ingredients);
});

app.post('/api/ingredients', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const { name, unit, stock, minStock } = req.body;

  if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });

  const ingredient = {
    id: nextId(db, 'ingredient'),
    name,
    unit: unit || 'un',
    stock: Number(stock) || 0,
    minStock: Number(minStock) || 0
  };

  db.ingredients.push(ingredient);

  writeDB(db);

  res.status(201).json(ingredient);
});

app.put('/api/ingredients/:id', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const id = Number(req.params.id);
  const idx = db.ingredients.findIndex(i => i.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Ingrediente no encontrado' });

  db.ingredients[idx] = { ...db.ingredients[idx], ...req.body, id };

  writeDB(db);

  res.json(db.ingredients[idx]);
});

app.delete('/api/ingredients/:id', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const id = Number(req.params.id);

  db.ingredients = db.ingredients.filter(i => i.id !== id);

  writeDB(db);

  res.json({ ok: true });
});

/* ============ MESAS ============ */

app.get('/api/tables', (req, res) => {
  const db = readDB();
  res.json(db.tables);
});

app.post('/api/tables', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const { name } = req.body;

  const table = { id: nextId(db, 'table'), name: name || `Mesa ${db.counters.table}`, status: 'libre' };

  db.tables.push(table);

  writeDB(db);

  res.status(201).json(table);
});

app.put('/api/tables/:id', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const id = Number(req.params.id);
  const idx = db.tables.findIndex(t => t.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Mesa no encontrada' });

  db.tables[idx] = { ...db.tables[idx], ...req.body, id };

  writeDB(db);

  res.json(db.tables[idx]);
});

app.delete('/api/tables/:id', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const id = Number(req.params.id);

  db.tables = db.tables.filter(t => t.id !== id);

  writeDB(db);

  res.json({ ok: true });
});

/* ============ UTILIDADES (zona horaria, textos, pagos) ============ */

const TIMEZONE = process.env.POS_TIMEZONE || 'America/Bogota';

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

const localDay = value => dayFormatter.format(new Date(value));
const todayLocal = () => localDay(new Date());
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'transferencia', 'nequi', 'daviplata'];
const ORDER_TYPES = ['mostrador', 'mesa', 'domicilio'];

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Devuelve los pagos de un pedido. Los pedidos antiguos (un solo método) se convierten al formato nuevo.

function orderPayments(order) {
  if (Array.isArray(order.payments) && order.payments.length) return order.payments;

  const method = PAYMENT_METHODS.includes(order.paymentMethod) ? order.paymentMethod : 'efectivo';

  return [{ method, amount: order.total, received: order.amountPaid != null ? order.amountPaid : order.total }];
}

function buildItems(db, items) {
  if (!Array.isArray(items)) return { error: 'La lista de productos no es válida.' };

  const result = [];

  for (const it of items) {
    const product = db.products.find(p => p.id === Number(it.productId));

    if (!product) continue;

    const qty = it.qty == null ? 1 : Number(it.qty);

    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return { error: 'Cada producto debe tener una cantidad entera entre 1 y 999.' };

    const line = { productId: product.id, name: product.name, price: product.price, qty };

    const note = cleanText(it.note, 120);

    if (note) line.note = note;

    result.push(line);
  }

  return { items: result };
}

function computeTotals(order) {
  order.subtotal = order.items.reduce((sum, i) => sum + i.price * i.qty, 0);

  order.deliveryFee = order.type === 'domicilio' ? money(order.deliveryFee || 0) : 0;

  order.total = order.subtotal + order.deliveryFee;
}

function resolvePayments(body, total) {
  let list = body.payments;

  if (!Array.isArray(list)) {
    const method = body.paymentMethod || 'efectivo';

    list = [{ method, amount: method === 'efectivo' ? body.amountPaid : total }];
  }

  if (!list.length) return { error: 'Registra al menos un pago.' };

  const received = {};

  for (const p of list) {
    const method = String(p.method || '');
    const amount = money(p.amount);

    if (!PAYMENT_METHODS.includes(method)) return { error: 'Método de pago inválido.' };

    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Cada pago debe tener un valor mayor a cero.' };

    received[method] = money((received[method] || 0) + amount);
  }

  const cashReceived = received.efectivo || 0;

  const nonCash = money(Object.entries(received).filter(([m]) => m !== 'efectivo').reduce((s, [, v]) => s + v, 0));

  if (nonCash > total) return { error: 'Los pagos que no son en efectivo no pueden superar el total del pedido.' };

  const cashDue = money(total - nonCash);

  if (cashReceived > 0 && cashDue <= 0) return { error: 'El total ya está cubierto sin efectivo; quita el pago en efectivo.' };

  if (money(cashReceived + nonCash) < total) return { error: 'El dinero recibido no puede ser menor al total.' };

  const payments = Object.entries(received).map(([method, amount]) => (
    method === 'efectivo'
      ? { method, amount: cashDue, received: cashReceived }
      : { method, amount, received: amount }
  ));

  const change = money(cashReceived - cashDue);

  return { payments, change, amountPaid: money(cashReceived + nonCash) };
}

/* ============ CONFIGURACIÓN ============ */

app.get('/api/config', (req, res) => {
  res.json({ timezone: TIMEZONE, today: todayLocal() });
});

/* ============ PEDIDOS ============ */

app.get('/api/orders', (req, res) => {
  const db = readDB();

  let orders = db.orders;

  const { status, date } = req.query;

  if (status) orders = orders.filter(o => o.status === status);

  if (date) orders = orders.filter(o => localDay(o.createdAt) === date);

  res.json([...orders].sort((a, b) => b.id - a.id));
});

app.get('/api/orders/:id', (req, res) => {
  const db = readDB();

  const order = db.orders.find(o => o.id === Number(req.params.id));

  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  res.json(order);
});

// Crear un pedido nuevo (mostrador, mesa o domicilio)

app.post('/api/orders', (req, res) => {
  const db = readDB();

  const { type, tableId, items } = req.body;

  if (!type || !ORDER_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Tipo de pedido inválido (mostrador, mesa o domicilio)' });
  }

  const built = buildItems(db, items);

  if (built.error) return res.status(400).json({ error: built.error });

  if (!built.items.length) return res.status(400).json({ error: 'Agrega al menos un producto al pedido.' });

  const order = {
    id: nextId(db, 'order'),
    type,
    tableId: null,
    tableName: null,
    customerName: null,
    customerPhone: null,
    customerAddress: null,
    deliveryFee: 0,
    notes: cleanText(req.body.notes, 300),
    items: built.items, // {productId, name, price, qty, note?}
    subtotal: 0,
    total: 0,
    status: 'abierto', // abierto -> pagado / cancelado
    createdAt: new Date().toISOString(),
    closedAt: null
  };

  if (type === 'mesa') {
    const table = db.tables.find(t => t.id === Number(tableId));

    if (!table) return res.status(400).json({ error: 'Selecciona una mesa válida.' });

    if (table.status !== 'libre') return res.status(409).json({ error: `${table.name} ya está ocupada.` });

    order.tableId = table.id;
    order.tableName = table.name;

    table.status = 'ocupada';
  }

  if (type === 'domicilio') {
    order.customerName = cleanText(req.body.customerName, 80);
    order.customerPhone = cleanText(req.body.customerPhone, 25);
    order.customerAddress = cleanText(req.body.customerAddress, 160);

    const fee = req.body.deliveryFee == null || req.body.deliveryFee === '' ? 0 : money(req.body.deliveryFee);

    if (!order.customerName || !order.customerPhone || !order.customerAddress) {
      return res.status(400).json({ error: 'En un domicilio debes indicar nombre, teléfono y dirección del cliente.' });
    }

    if (!/^[0-9+()\-\s]{7,25}$/.test(order.customerPhone)) {
      return res.status(400).json({ error: 'El teléfono del cliente no es válido.' });
    }

    if (!Number.isFinite(fee) || fee < 0 || fee > 1000000) {
      return res.status(400).json({ error: 'El valor del domicilio no es válido.' });
    }

    order.deliveryFee = fee;
  }

  computeTotals(order);

  db.orders.push(order);

  writeDB(db);

  res.status(201).json(order);
});

app.put('/api/orders/:id/items', (req, res) => {
  const db = readDB();

  const order = db.orders.find(o => o.id === Number(req.params.id));

  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  if (order.status !== 'abierto') return res.status(400).json({ error: 'El pedido ya está cerrado' });

  const built = buildItems(db, req.body.items);

  if (built.error) return res.status(400).json({ error: built.error });

  if (!built.items.length) return res.status(400).json({ error: 'El pedido debe tener al menos un producto.' });

  order.items = built.items;

  if (req.body.notes !== undefined) order.notes = cleanText(req.body.notes, 300);

  computeTotals(order);

  writeDB(db);

  res.json(order);
});

app.post('/api/orders/:id/pay', (req, res) => {
  const db = readDB();

  const order = db.orders.find(o => o.id === Number(req.params.id));

  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  if (order.status !== 'abierto') return res.status(400).json({ error: 'El pedido ya está cerrado' });

  const result = resolvePayments(req.body, order.total);

  if (result.error) return res.status(400).json({ error: result.error });

  for (const item of order.items) {
    const product = db.products.find(p => p.id === item.productId);

    if (product && Array.isArray(product.recipe)) {
      for (const ing of product.recipe) {
        const ingredient = db.ingredients.find(i => i.id === ing.ingredientId);

        if (ingredient) ingredient.stock = Math.max(0, ingredient.stock - Number(ing.qty || 0) * item.qty);
      }
    }
  }

  order.status = 'pagado';
  order.closedAt = new Date().toISOString();
  order.payments = result.payments;
  order.paymentMethod = result.payments.length > 1 ? 'mixto' : result.payments[0].method;
  order.amountPaid = result.amountPaid;
  order.change = result.change;
  order.paidBy = { id: req.user.id, name: req.user.name };

  if (order.type === 'mesa' && order.tableId) {
    const table = db.tables.find(t => t.id === order.tableId);

    if (table) table.status = 'libre';
  }

  writeDB(db);

  res.json(order);
});

app.post('/api/orders/:id/cancel', (req, res) => {
  const db = readDB();

  const order = db.orders.find(o => o.id === Number(req.params.id));

  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  // Un pedido pagado no se cancela: ya descontó inventario y suma en caja.

  if (order.status !== 'abierto') return res.status(400).json({ error: 'Solo se pueden cancelar pedidos abiertos.' });

  order.status = 'cancelado';
  order.closedAt = new Date().toISOString();

  if (order.type === 'mesa' && order.tableId) {
    const table = db.tables.find(t => t.id === order.tableId);

    if (table) table.status = 'libre';
  }

  writeDB(db);

  res.json(order);
});

/* ============ VENTAS ============ */

app.get('/api/sales', (req, res) => {
  const db = readDB();

  const sales = db.orders
    .filter(o => o.status === 'pagado')
    .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

  res.json(sales);
});

/* ============ REPORTES ============ */

function summarizeOrders(paid) {
  const byMethod = {};

  const byType = { mostrador: { count: 0, total: 0 }, mesa: { count: 0, total: 0 }, domicilio: { count: 0, total: 0 } };

  let totalSales = 0;
  let deliveryFees = 0;

  for (const o of paid) {
    totalSales += o.total;
    deliveryFees += o.deliveryFee || 0;

    if (byType[o.type]) {
      byType[o.type].count += 1;
      byType[o.type].total += o.total;
    }

    for (const p of orderPayments(o)) byMethod[p.method] = money((byMethod[p.method] || 0) + p.amount);
  }

  return {
    totalSales,
    ordersCount: paid.length,
    deliveryFees,
    productSales: totalSales - deliveryFees,
    byMethod,
    byType,
    cashSales: byMethod.efectivo || 0
  };
}

app.get('/api/reports/summary', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();

  const today = todayLocal();

  const from = isDay(req.query.from) ? req.query.from : (isDay(req.query.to) ? null : today);

  const to = isDay(req.query.to) ? req.query.to : (isDay(req.query.from) ? null : today);

  if (from && to && from > to) return res.status(400).json({ error: 'La fecha "Desde" no puede ser posterior a "Hasta".' });

  const inRange = iso => {
    const day = localDay(iso);

    return (!from || day >= from) && (!to || day <= to);
  };

  const filtered = db.orders.filter(o => o.status === 'pagado' && o.closedAt && inRange(o.closedAt));

  const cancelled = db.orders.filter(o => o.status === 'cancelado' && o.closedAt && inRange(o.closedAt));

  const summary = summarizeOrders(filtered);

  // Ventas por día

  const porDia = {};

  for (const o of filtered) {
    const day = localDay(o.closedAt);

    porDia[day] = (porDia[day] || 0) + o.total;
  }

  // Productos más vendidos

  const productCount = {};

  for (const o of filtered) {
    for (const item of o.items) {
      if (!productCount[item.name]) productCount[item.name] = { qty: 0, total: 0 };

      productCount[item.name].qty += item.qty;
      productCount[item.name].total += item.price * item.qty;
    }
  }

  const topProductos = Object.entries(productCount)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.qty - a.qty);

  res.json({
    from, to, timezone: TIMEZONE,
    totalVentas: summary.totalSales,
    totalPedidos: summary.ordersCount,
    ticketPromedio: summary.ordersCount ? Math.round(summary.totalSales / summary.ordersCount) : 0,
    totalDomicilios: summary.deliveryFees,
    pedidosCancelados: cancelled.length,
    porMetodo: summary.byMethod,
    porTipo: summary.byType,
    porDia,
    topProductos,
    ingredientesBajoStock: db.ingredients.filter(i => i.stock <= i.minStock)
  });
});

function pendingClosing(db) {
  const paid = db.orders.filter(o => o.status === 'pagado' && !o.closingId);

  const cancelled = db.orders.filter(o => o.status === 'cancelado' && !o.closingId);

  const open = db.orders.filter(o => o.status === 'abierto');

  return { paid, cancelled, open };
}

function periodOf(paid) {
  if (!paid.length) return { periodFrom: null, periodTo: null };

  const days = paid.map(o => localDay(o.closedAt)).sort();

  return { periodFrom: days[0], periodTo: days[days.length - 1] };
}

app.get('/api/closings/preview', (req, res) => {
  const db = readDB();

  const { paid, cancelled, open } = pendingClosing(db);

  res.json({
    today: todayLocal(),
    ...periodOf(paid),
    ...summarizeOrders(paid),
    cancelledCount: cancelled.length,
    openOrders: open.length,
    openOrdersTotal: open.reduce((s, o) => s + o.total, 0)
  });
});

app.post('/api/closings', (req, res) => {
  const db = readDB();

  const { paid, cancelled, open } = pendingClosing(db);

  if (!paid.length) return res.status(400).json({ error: 'No hay ventas pendientes por cerrar.' });

  if (open.length && !req.body.allowOpenOrders) {
    return res.status(409).json({ code: 'OPEN_ORDERS', error: `Hay ${open.length} pedido(s) abierto(s) sin pagar. Cóbralos o cancélalos antes de cerrar el día.` });
  }

  const openingCash = req.body.openingCash === '' || req.body.openingCash == null ? 0 : money(req.body.openingCash);

  const countedCash = req.body.countedCash === '' || req.body.countedCash == null ? NaN : money(req.body.countedCash);

  if (!Number.isFinite(openingCash) || openingCash < 0) return res.status(400).json({ error: 'La base inicial de caja no es válida.' });

  if (!Number.isFinite(countedCash) || countedCash < 0) return res.status(400).json({ error: 'Ingresa el efectivo contado en caja.' });

  const summary = summarizeOrders(paid);

  const expectedCash = money(openingCash + summary.cashSales);

  const now = new Date().toISOString();

  const closing = {
    id: nextId(db, 'closing'),
    businessDate: localDay(now),
    closedAt: now,
    closedBy: { id: req.user.id, name: req.user.name },
    ...periodOf(paid),
    ...summary,
    cancelledCount: cancelled.length,
    openOrdersAtClose: open.length,
    openingCash,
    expectedCash,
    countedCash,
    difference: money(countedCash - expectedCash),
    notes: cleanText(req.body.notes, 500),
    orderIds: paid.map(o => o.id)
  };

  for (const o of paid) o.closingId = closing.id;

  for (const o of cancelled) o.closingId = closing.id;

  db.closings.push(closing);

  writeDB(db);

  res.status(201).json(closing);
});

app.get('/api/closings', requireAdmin, (req, res) => {
  const db = readDB();

  const list = [...db.closings].sort((a, b) => b.id - a.id).map(({ orderIds, ...rest }) => rest);

  res.json(list);
});

app.get('/api/closings/:id', requireAdmin, (req, res) => {
  const db = readDB();

  const closing = db.closings.find(c => c.id === Number(req.params.id));

  if (!closing) return res.status(404).json({ error: 'Cierre no encontrado.' });

  const orders = db.orders
    .filter(o => (closing.orderIds || []).includes(o.id))
    .map(o => ({ id: o.id, type: o.type, total: o.total, closedAt: o.closedAt, paymentMethod: o.paymentMethod }));

  res.json({ ...closing, orders });
});

/* ============ INICIO DEL SERVIDOR ============ */


if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\nSistema de ventas corriendo en: http://localhost:${PORT}`);
    console.log(`Zona horaria del negocio: ${TIMEZONE}`);
    console.log('Para usarlo desde otro dispositivo en la misma red, usa la IP de esta computadora.\n');
  });
}

module.exports = app;
