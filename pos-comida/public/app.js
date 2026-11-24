const API = '/api';
let CURRENT_USER = null;
let NEEDS_SETUP = false;
let CONFIG = { timezone: 'America/Bogota', today: '' };

/* ===== UTILIDADES ===== */
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const fmt = n => {
  const value = Number(n) || 0;
  return (value < 0 ? '-$' : '$') + Math.abs(value).toLocaleString('es-CO');
};

/* ===== CAMPOS DE DINERO: escribes 12000 y se ve 12.000; siempre se guarda 12000 ===== */
const onlyDigits = v => String(v == null ? '' : v).replace(/\D/g, '');
const dotted = v => onlyDigits(v).replace(/^0+(?=\d)/, '').slice(0, 12).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const moneyValue = el => Number(onlyDigits(el.value)) || 0;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.classList && el.classList.contains('money-input')) el.value = dotted(el.value);
});

const fmtDateTime = iso =>new Date(iso).toLocaleString('es-CO', { timeZone: CONFIG.timezone });
const fmtDay = day => {
  if (!day) return '';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
};

const PAYMENT_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', nequi: 'Nequi', daviplata: 'Daviplata', mixto: 'Pago combinado' };
const paymentLabel = method => PAYMENT_LABELS[method] || method;
const TYPE_LABELS = { mostrador: 'Mostrador', mesa: 'Mesa', domicilio: 'Domicilio' };

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = message;
  document.getElementById('toastHost').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// Llamada a la API: devuelve el JSON o lanza un Error con el mensaje del servidor.
async function api(path, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(API + path, init);
  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
  if (res.status === 401 && !path.startsWith('/auth/')) { location.reload(); throw new Error('Tu sesión venció.'); }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'No se pudo completar la acción.');
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

// Impresión sin ventanas emergentes (no las bloquea el navegador).
const PRINT_CSS = `
  body { font-family: Arial, sans-serif; width: 80mm; margin: 0 auto; padding: 10px; color: #111; }
  h2 { margin: 0 0 4px; font-size: 18px; }
  p { margin: 3px 0; font-size: 12px; }
  .invoice-header { text-align: center; border-bottom: 1px dashed #777; padding-bottom: 10px; }
  .invoice-info { padding-top: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
  th, td { padding: 4px 2px; text-align: left; border-bottom: 1px dotted #aaa; vertical-align: top; }
  th:nth-child(n+2), td:nth-child(n+2) { text-align: right; }
  .inote { display: block; font-size: 10px; font-style: italic; color: #444; }
  .invoice-notes { margin-top: 10px; font-size: 11px; border: 1px dashed #777; padding: 6px; }
  .inv-line { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
  .inv-line.strong { font-size: 15px; font-weight: bold; border-top: 1px dashed #777; margin-top: 6px; padding-top: 6px; }
  .inv-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; margin: 12px 0 4px; border-bottom: 1px dashed #777; padding-bottom: 2px; }
  .invoice-thanks { text-align: center; font-size: 12px; margin-top: 18px; }
  .print-page { break-after: page; page-break-after: always; }
  .kitchen-header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; }
  .kitchen-header h2 { font-size: 20px; letter-spacing: .04em; }
  .kitchen-header p { font-size: 14px; font-weight: bold; }
  .kitchen-meta { padding-top: 6px; }
  .kitchen-meta p { font-size: 14px; font-weight: bold; }
  .kitchen-list { list-style: none; margin: 10px 0; padding: 0; }
  .kitchen-list li { font-size: 18px; font-weight: bold; padding: 8px 0; border-bottom: 1px dashed #777; }
  .kitchen-list .knote { display: block; font-size: 14px; font-weight: normal; font-style: italic; margin-top: 2px; }
  .kitchen-order-note { border: 2px solid #111; padding: 6px; font-size: 14px; margin-top: 10px; }
`;

function printHtml(title, bodyHtml) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 3000);
  }, 250);
}

/* ===== ACCESO ===== */
async function bootstrapAuth() {
  const screen = document.getElementById('authScreen');
  try {
    const statusRes = await fetch(`${API}/auth/status`);
    const status = await statusRes.json();
    NEEDS_SETUP = status.setupRequired;
    if (NEEDS_SETUP) {
      document.getElementById('authTitle').textContent = 'Crear cuenta administradora';
      document.getElementById('authDescription').textContent = 'Configura la primera cuenta para proteger tu negocio.';
      document.getElementById('setupNameField').classList.remove('hidden');
      document.getElementById('authName').required = true;
      document.getElementById('authSubmit').textContent = 'Crear cuenta y entrar';
    }
    const meRes = await fetch(`${API}/auth/me`);
    if (meRes.ok) {
      const data = await meRes.json();
      startApp(data.user);
      return;
    }
    screen.classList.remove('hidden');
  } catch (error) {
    screen.classList.remove('hidden');
    document.getElementById('authMessage').textContent = 'No se pudo conectar con el servidor. Comprueba que ejecutaste npm start.';
  }
}

async function startApp(user) {
  CURRENT_USER = user;
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('currentUserLabel').textContent = `${user.name} · ${user.role === 'admin' ? 'Administradora' : 'Empleado'}`;
  const isAdmin = user.role === 'admin';
  document.querySelectorAll('[data-admin-only="true"], .admin-only-control').forEach(el => {
    el.classList.toggle('hidden', !isAdmin);
  });
  try { CONFIG = await api('/config'); } catch (e) { /* se usan los valores por defecto */ }
  document.getElementById('reportFrom').value = CONFIG.today;
  document.getElementById('reportTo').value = CONFIG.today;
  renderCart();
  loadProducts();
  loadTables();
}

document.getElementById('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('authMessage');
  message.textContent = '';
  const payload = {
    name: document.getElementById('authName').value.trim(),
    username: document.getElementById('authUsername').value.trim(),
    password: document.getElementById('authPassword').value
  };
  try {
    const data = await api(`/auth/${NEEDS_SETUP ? 'setup' : 'login'}`, { method: 'POST', body: payload });
    document.getElementById('authPassword').value = '';
    startApp(data.user);
  } catch (error) {
    message.textContent = error.message || 'Ocurrió un error de conexión.';
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch(`${API}/auth/logout`, { method: 'POST' });
  location.reload();
});

let PRODUCTS = [];
let INGREDIENTS = [];
let TABLES = [];
let CART = []; // {productId, name, price, qty, note, noteOpen}
let currentCategory = 'Todas';

/* ===== PESTAÑAS ===== */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    window.scrollTo({ top: 0 });
    const tab = btn.dataset.tab;
    if (tab === 'mesas') loadTables();
    if (tab === 'pedidos') loadOpenOrders();
    if (tab === 'ventas') loadSales();
    if (tab === 'cierre') { loadClosing(); if (CURRENT_USER && CURRENT_USER.role === 'admin') loadClosingHistory(); }
    if (tab === 'menu') loadProductsTable();
    if (tab === 'inventario') loadIngredientsTable();
    if (tab === 'reportes') runReport();
    if (tab === 'usuarios') loadUsers();
  });
});

/* ===== TIPO DE PEDIDO ===== */
function currentOrderType() {
  return document.querySelector('input[name="orderType"]:checked').value;
}

document.querySelectorAll('input[name="orderType"]').forEach(r => {
  r.addEventListener('change', () => {
    const type = currentOrderType();
    document.getElementById('posTableSelect').classList.toggle('hidden', type !== 'mesa');
    document.getElementById('posDeliveryFields').classList.toggle('hidden', type !== 'domicilio');
    renderCart();
  });
});

document.getElementById('deliveryFee').addEventListener('input', renderTotals);

/* ===== PRODUCTOS EN EL POS ===== */
async function loadProducts() {
  PRODUCTS = await api('/products');
  renderCategories();
  renderProductGrid();
}

function renderCategories() {
  const cats = ['Todas', ...new Set(PRODUCTS.map(p => p.category))];
  if (!cats.includes(currentCategory)) currentCategory = 'Todas';
  const el = document.getElementById('posCategories');
  el.innerHTML = '';
  cats.forEach(cat => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = cat;
    if (cat === currentCategory) b.classList.add('active');
    b.onclick = () => { currentCategory = cat; renderCategories(); renderProductGrid(); };
    el.appendChild(b);
  });
}

function renderProductGrid() {
  const grid = document.getElementById('posProductGrid');
  grid.innerHTML = '';
  const list = currentCategory === 'Todas' ? PRODUCTS : PRODUCTS.filter(p => p.category === currentCategory);
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">Todavía no hay productos en el menú.</div>';
    return;
  }
  list.forEach(p => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'product-card';
    card.innerHTML = `<div class="pname">${escapeHtml(p.name)}</div><div class="pprice">${fmt(p.price)}</div>`;
    card.onclick = () => addToCart(p);
    grid.appendChild(card);
  });
}

/* ===== CARRITO ===== */
function addToCart(product) {
  // Una línea con nota se mantiene aparte; solo se suma a líneas sin nota.
  const existing = CART.find(i => i.productId === product.id && !i.note);
  if (existing) existing.qty += 1;
  else CART.push({ productId: product.id, name: product.name, price: product.price, qty: 1, note: '', noteOpen: false });
  renderCart();
}

function renderCart() {
  const el = document.getElementById('cartItems');
  if (!CART.length) {
    el.innerHTML = '<div class="cart-empty">Aún no hay productos en el pedido.</div>';
  } else {
    el.innerHTML = CART.map((item, idx) => `
      <div class="cart-item">
        <div class="cart-line">
          <span class="cart-name">${escapeHtml(item.name)}</span>
          <span class="cart-sub">${fmt(item.price * item.qty)}</span>
        </div>
        <div class="qty-controls">
          <button type="button" class="icon-btn" onclick="changeQty(${idx}, -1)" aria-label="Quitar uno">${icon('minus')}</button>
          <span class="qty">${item.qty}</span>
          <button type="button" class="icon-btn" onclick="changeQty(${idx}, 1)" aria-label="Agregar uno">${icon('plus')}</button>
          <span class="spacer"></span>
          <button type="button" class="icon-btn ${item.note || item.noteOpen ? 'on' : ''}" onclick="toggleNote(${idx})" aria-label="Nota del producto" title="Nota del producto">${icon('message')}</button>
        </div>
        ${item.note || item.noteOpen ? `<input type="text" class="cart-note-input" maxlength="120" placeholder="Ej. sin cebolla" value="${escapeHtml(item.note)}" oninput="setNote(${idx}, this.value)" aria-label="Nota para ${escapeHtml(item.name)}">` : ''}
      </div>`).join('');
  }
  renderTotals();
}

function deliveryFeeValue() {
  if (currentOrderType() !== 'domicilio') return 0;
  return moneyValue(document.getElementById('deliveryFee'));
}

function renderTotals() {
  const subtotal = CART.reduce((sum, i) => sum + i.price * i.qty, 0);
  const fee = deliveryFeeValue();
  document.getElementById('cartSubtotal').textContent = fmt(subtotal);
  document.getElementById('cartDeliveryRow').classList.toggle('hidden', currentOrderType() !== 'domicilio');
  document.getElementById('cartDelivery').textContent = fmt(fee);
  document.getElementById('cartTotal').textContent = fmt(subtotal + fee);
}

function changeQty(idx, delta) {
  CART[idx].qty += delta;
  if (CART[idx].qty <= 0) CART.splice(idx, 1);
  renderCart();
}

function toggleNote(idx) {
  const item = CART[idx];
  if (item.note) { item.note = ''; item.noteOpen = false; }
  else item.noteOpen = !item.noteOpen;
  renderCart();
  if (item.noteOpen) {
    const inputs = document.querySelectorAll('.cart-note-input');
    const target = inputs[CART.slice(0, idx + 1).filter(i => i.note || i.noteOpen).length - 1];
    if (target) target.focus();
  }
}

function setNote(idx, value) {
  CART[idx].note = value.trim() ? value : '';
}

/* ===== CREAR PEDIDO ===== */
document.getElementById('btnCreateOrder').addEventListener('click', async () => {
  if (CART.length === 0) { toast('Agrega al menos un producto.', 'error'); return; }
  const type = currentOrderType();
  const body = {
    type,
    notes: document.getElementById('orderNotes').value.trim(),
    items: CART.map(i => ({ productId: i.productId, qty: i.qty, note: (i.note || '').trim() }))
  };

  if (type === 'mesa') {
    const tableId = Number(document.getElementById('tableSelect').value);
    if (!tableId) { toast('Selecciona una mesa libre.', 'error'); return; }
    body.tableId = tableId;
  }
  if (type === 'domicilio') {
    body.customerName = document.getElementById('customerName').value.trim();
    body.customerPhone = document.getElementById('customerPhone').value.trim();
    body.customerAddress = document.getElementById('customerAddress').value.trim();
    body.deliveryFee = deliveryFeeValue();
    if (!body.customerName || !body.customerPhone || !body.customerAddress) {
      toast('Completa nombre, teléfono y dirección del cliente.', 'error');
      return;
    }
  }

  const button = document.getElementById('btnCreateOrder');
  button.disabled = true;
  try {
    const order = await api('/orders', { method: 'POST', body });
    CART = [];
    ['customerName', 'customerPhone', 'customerAddress', 'deliveryFee', 'orderNotes'].forEach(id => { document.getElementById(id).value = ''; });
    renderCart();
    toast(`Pedido #${order.id} creado.`);
    showKitchenPreview(order);
    loadTables();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

/* ===== MESAS ===== */
async function loadTables() {
  TABLES = await api('/tables');
  const grid = document.getElementById('tablesGrid');
  grid.innerHTML = TABLES.map(t => `
    <div class="table-card ${t.status}">
      ${icon('grid')}
      <div class="tname">${escapeHtml(t.name)}</div>
      <span class="badge ${t.status}">${t.status === 'libre' ? 'Libre' : 'Ocupada'}</span>
    </div>`).join('');

  const sel = document.getElementById('tableSelect');
  const free = TABLES.filter(t => t.status === 'libre');
  sel.innerHTML = free.length
    ? free.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
    : '<option value="">No hay mesas libres</option>';
}

document.getElementById('btnAddTable').addEventListener('click', async () => {
  const name = document.getElementById('newTableName').value.trim();
  if (!name) return;
  try {
    await api('/tables', { method: 'POST', body: { name } });
    document.getElementById('newTableName').value = '';
    loadTables();
  } catch (error) { toast(error.message, 'error'); }
});

/* ===== PEDIDOS ABIERTOS ===== */
function tableNameOf(order) {
  return order.tableName || (TABLES.find(t => t.id === order.tableId) || {}).name || `Mesa ${order.tableId}`;
}

function orderLabel(order) {
  if (order.type === 'mesa') return tableNameOf(order);
  if (order.type === 'domicilio') return `Domicilio - ${order.customerName || 'sin nombre'}`;
  return 'Mostrador';
}

function itemsListHtml(order) {
  return `<ul class="order-items">${order.items.map(i => `<li>${i.qty} x ${escapeHtml(i.name)}${i.note ? `<span class="item-note">Nota: ${escapeHtml(i.note)}</span>` : ''}</li>`).join('')}</ul>`;
}

function orderMetaHtml(order) {
  let html = '';
  if (order.type === 'domicilio') {
    html += `<div class="order-meta">
      <div class="row">${icon('truck')}<span>${escapeHtml(order.customerName || '')} · ${escapeHtml(order.customerPhone || '')}</span></div>
      <div class="row">${icon('grid')}<span>${escapeHtml(order.customerAddress || '')}</span></div>
      <div class="row">${icon('receipt')}<span>Domicilio: ${fmt(order.deliveryFee || 0)}</span></div>
    </div>`;
  }
  if (order.notes) html += `<div class="order-note">${icon('message')}<span>${escapeHtml(order.notes)}</span></div>`;
  return html;
}

async function loadOpenOrders() {
  try { if (!TABLES.length) TABLES = await api('/tables'); } catch (e) { /* opcional */ }
  const orders = await api('/orders?status=abierto');
  const el = document.getElementById('openOrdersList');
  if (!orders.length) {
    el.innerHTML = '<div class="empty-state">No hay pedidos abiertos.</div>';
    return;
  }
  el.innerHTML = orders.map(o => `
    <div class="order-card">
      <div class="info">
        <div class="order-head"><strong>Pedido #${o.id}</strong><span class="badge badge-neutral">${TYPE_LABELS[o.type] || o.type}</span><span class="muted">${escapeHtml(orderLabel(o))}</span></div>
        ${itemsListHtml(o)}
        ${orderMetaHtml(o)}
        <div class="order-total">Total: <b>${fmt(o.total)}</b></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" onclick="payOrder(${o.id})">${icon('credit-card')}Pagar</button>
        <button class="btn btn-danger" onclick="cancelOrder(${o.id})">${icon('x')}Cancelar</button>
      </div>
    </div>`).join('');
}

/* ===== PAGO (admite pagos combinados) ===== */
let PAY_ORDER = null;
let PAY_ROWS = []; // {method, amount}
let CURRENT_INVOICE = null;
const PAY_METHODS = ['efectivo', 'tarjeta', 'transferencia', 'nequi', 'daviplata'];

async function payOrder(id) {
  try {
    PAY_ORDER = await api(`/orders/${id}`);
  } catch (error) { toast(error.message, 'error'); return; }
  PAY_ROWS = [{ method: 'efectivo', amount: String(PAY_ORDER.total) }];
  document.getElementById('paymentTotal').textContent = fmt(PAY_ORDER.total);
  document.getElementById('paymentOrderLabel').textContent = `Pedido #${PAY_ORDER.id} · ${orderLabel(PAY_ORDER)}`;
  renderPayRows();
  document.getElementById('paymentModal').classList.remove('hidden');
  const first = document.querySelector('#paymentRows .pay-amount');
  if (first) { first.focus(); first.select(); }
}

function renderPayRows() {
  const box = document.getElementById('paymentRows');
  box.innerHTML = PAY_ROWS.map((r, i) => `
    <div class="pay-row" data-i="${i}">
      <select class="pay-method" aria-label="Método de pago">${PAY_METHODS.map(m => `<option value="${m}" ${m === r.method ? 'selected' : ''}>${paymentLabel(m)}</option>`).join('')}</select>
      <input type="text" class="pay-amount money-input" inputmode="numeric" autocomplete="off" placeholder="Valor" value="${dotted(r.amount)}" aria-label="Valor recibido">
      <button type="button" class="icon-btn pay-remove" aria-label="Quitar este pago" ${PAY_ROWS.length === 1 ? 'style="visibility:hidden" tabindex="-1"' : ''}>${icon('x')}</button>
    </div>`).join('');
  recalcPayment();
}

function calcPayment() {
  const total = PAY_ORDER ? PAY_ORDER.total : 0;
  const rows = PAY_ROWS.map(r => ({ method: r.method, amount: Number(r.amount) || 0 })).filter(r => r.amount > 0);
  const cash = rows.filter(r => r.method === 'efectivo').reduce((s, r) => s + r.amount, 0);
  const nonCash = rows.filter(r => r.method !== 'efectivo').reduce((s, r) => s + r.amount, 0);
  const received = cash + nonCash;
  const cashDue = total - nonCash;
  let error = '';
  let change = 0;
  if (nonCash > total) error = 'Los pagos que no son en efectivo no pueden superar el total.';
  else if (cash > 0 && cashDue <= 0) error = 'El total ya está cubierto sin efectivo; quita el pago en efectivo.';
  else if (received >= total) change = cash - cashDue;
  const missing = Math.max(0, total - received);
  return { rows, cash, received, missing, change, error, valid: !error && rows.length > 0 && missing === 0 };
}

function recalcPayment() {
  const c = calcPayment();
  document.getElementById('paymentReceived').textContent = fmt(c.received);
  document.getElementById('paymentMissing').textContent = fmt(c.missing);
  document.getElementById('paymentMissingRow').classList.toggle('hidden', c.missing === 0);
  document.getElementById('paymentMissingRow').classList.toggle('missing', c.missing > 0);
  document.getElementById('paymentChange').textContent = fmt(c.change);
  document.getElementById('paymentChangeRow').classList.toggle('hidden', !PAY_ROWS.some(r => r.method === 'efectivo'));
  document.getElementById('paymentError').textContent = c.error;
  document.getElementById('btnConfirmPayment').disabled = !c.valid;
}

document.getElementById('paymentRows').addEventListener('input', e => {
  const row = e.target.closest('.pay-row');
  if (!row || !e.target.classList.contains('pay-amount')) return;
  PAY_ROWS[Number(row.dataset.i)].amount = onlyDigits(e.target.value);
  recalcPayment();
});
document.getElementById('paymentRows').addEventListener('change', e => {
  const row = e.target.closest('.pay-row');
  if (!row || !e.target.classList.contains('pay-method')) return;
  PAY_ROWS[Number(row.dataset.i)].method = e.target.value;
  recalcPayment();
});
document.getElementById('paymentRows').addEventListener('click', e => {
  const btn = e.target.closest('.pay-remove');
  if (!btn || PAY_ROWS.length === 1) return;
  PAY_ROWS.splice(Number(btn.closest('.pay-row').dataset.i), 1);
  renderPayRows();
});

document.getElementById('btnAddPayment').addEventListener('click', () => {
  const c = calcPayment();
  const used = PAY_ROWS.map(r => r.method);
  const method = PAY_METHODS.find(m => !used.includes(m)) || 'efectivo';
  PAY_ROWS.push({ method, amount: c.missing > 0 ? String(c.missing) : '' });
  renderPayRows();
  const inputs = document.querySelectorAll('#paymentRows .pay-amount');
  const last = inputs[inputs.length - 1];
  if (last) { last.focus(); last.select(); }
});

document.getElementById('btnConfirmPayment').addEventListener('click', async () => {
  if (!PAY_ORDER) return;
  const c = calcPayment();
  if (!c.valid) return;
  const button = document.getElementById('btnConfirmPayment');
  button.disabled = true;
  try {
    const order = await api(`/orders/${PAY_ORDER.id}/pay`, { method: 'POST', body: { payments: c.rows } });
    CURRENT_INVOICE = order;
    closePaymentModal();
    loadOpenOrders();
    loadTables();
    loadSales();
    showInvoice(order);
  } catch (error) {
    document.getElementById('paymentError').textContent = error.message;
    button.disabled = false;
  }
});

function closePaymentModal() {
  document.getElementById('paymentModal').classList.add('hidden');
  PAY_ORDER = null;
  PAY_ROWS = [];
}

/* ===== FACTURA ===== */
function paymentLinesHtml(order) {
  const payments = Array.isArray(order.payments) && order.payments.length
    ? order.payments
    : [{ method: order.paymentMethod, amount: order.total, received: order.amountPaid != null ? order.amountPaid : order.total }];
  const lines = payments.map(p => {
    const shown = p.method === 'efectivo' ? p.received : p.amount;
    return `<div class="inv-line"><span>${paymentLabel(p.method)}</span><span>${fmt(shown)}</span></div>`;
  }).join('');
  const change = Number(order.change) || 0;
  return lines + (change > 0 ? `<div class="inv-line"><span>Cambio</span><span>${fmt(change)}</span></div>` : '');
}

function invoiceHtml(order) {
  const typeText = order.type === 'mesa'
    ? tableNameOf(order)
    : order.type === 'domicilio' ? `Domicilio - ${order.customerName || 'Cliente'}` : 'Mostrador';
  const subtotal = order.subtotal != null ? order.subtotal : order.items.reduce((s, i) => s + i.price * i.qty, 0);
  const fee = order.deliveryFee || 0;
  const delivery = order.type === 'domicilio'
    ? `<p><b>Teléfono:</b> ${escapeHtml(order.customerPhone || '')}</p><p><b>Dirección:</b> ${escapeHtml(order.customerAddress || '')}</p>`
    : '';

  return `
    <div class="invoice">
      <div class="invoice-header">
        <h2>Mi Local de Comida</h2>
        <p>FACTURA / TICKET DE VENTA</p>
        <p>Venta #${order.id}</p>
      </div>
      <div class="invoice-info">
        <p><b>Fecha:</b> ${escapeHtml(fmtDateTime(order.closedAt || order.createdAt))}</p>
        <p><b>Tipo:</b> ${escapeHtml(typeText)}</p>
        ${delivery}
      </div>
      <table class="invoice-table">
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead>
        <tbody>
          ${order.items.map(i => `
            <tr>
              <td>${escapeHtml(i.name)}${i.note ? `<span class="inote">${escapeHtml(i.note)}</span>` : ''}</td>
              <td>${i.qty}</td>
              <td>${fmt(i.price)}</td>
              <td>${fmt(i.price * i.qty)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${order.notes ? `<div class="invoice-notes"><b>Notas:</b> ${escapeHtml(order.notes)}</div>` : ''}
      <div class="invoice-sums">
        <div class="inv-line"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
        ${fee > 0 ? `<div class="inv-line"><span>Domicilio</span><span>${fmt(fee)}</span></div>` : ''}
      </div>
      <div class="invoice-total inv-line strong"><span>TOTAL</span><span>${fmt(order.total)}</span></div>
      <div class="inv-title">Pago</div>
      <div class="invoice-payment">${paymentLinesHtml(order)}</div>
      <p class="invoice-thanks">¡Gracias por su compra!</p>
    </div>`;
}

function setPrintPreviewMode(mode) {
  const button = document.querySelector('#invoiceModal .invoice-actions button');
  const modal = document.getElementById('invoiceModal');
  if (mode === 'kitchen') {
    button.innerHTML = `${icon('printer')}Imprimir comanda`;
    modal.setAttribute('aria-label', 'Comanda para cocina');
  } else {
    button.innerHTML = `${icon('printer')}Imprimir factura`;
    modal.setAttribute('aria-label', 'Factura');
  }
}

function showKitchenPreview(order) {
  CURRENT_INVOICE = order;
  CURRENT_PRINT_MODE = 'kitchen';
  document.getElementById('invoiceContent').innerHTML = `
    <div class="preview-label">Comanda para la cocina</div>
    <div class="preview-sheet">${kitchenTicketHtml(order)}</div>`;
  setPrintPreviewMode('kitchen');
  document.getElementById('invoiceModal').classList.remove('hidden');
}

function showInvoice(order) {
  CURRENT_INVOICE = order;
  CURRENT_PRINT_MODE = 'invoice';
  document.getElementById('invoiceContent').innerHTML = `
    <div class="preview-label">Factura</div>
    <div class="preview-sheet">${invoiceHtml(order)}</div>`;
  setPrintPreviewMode('invoice');
  document.getElementById('invoiceModal').classList.remove('hidden');
}

function closeInvoiceModal() {
  document.getElementById('invoiceModal').classList.add('hidden');
}
function kitchenTicketHtml(order) {
  const where = order.type === 'mesa' ? tableNameOf(order) : (TYPE_LABELS[order.type] || order.type);
  return `
    <div class="kitchen print-page">
      <div class="kitchen-header">
        <h2>COMANDA - COCINA</h2>
        <p>Pedido #${order.id}</p>
      </div>
      <div class="kitchen-meta">
        <p>${escapeHtml(where)}</p>
        <p>${escapeHtml(fmtDateTime(order.createdAt))}</p>
      </div>
      <ul class="kitchen-list">${order.items.map(i => `<li>${i.qty} x ${escapeHtml(i.name)}${i.note ? `<span class="knote">» ${escapeHtml(i.note)}</span>` : ''}</li>`).join('')}</ul>
      ${order.notes ? `<div class="kitchen-order-note"><b>Nota del pedido:</b> ${escapeHtml(order.notes)}</div>` : ''}
    </div>`;
}

async function printKitchenById(id) {
  try {
    const order = await api(`/orders/${id}`);
    printHtml(`Comanda - Pedido #${order.id}`, kitchenTicketHtml(order));
  } catch (error) {
    toast(error.message, 'error');
  }
}

// Cada impresión genera un solo documento: comanda o factura.
let CURRENT_PRINT_MODE = 'invoice';

function printCurrentInvoice() {
  if (!CURRENT_INVOICE) return;
  if (CURRENT_PRINT_MODE === 'kitchen') {
    printHtml(`Comanda - Pedido #${CURRENT_INVOICE.id}`, kitchenTicketHtml(CURRENT_INVOICE));
  } else {
    printHtml(`Factura - Pedido #${CURRENT_INVOICE.id}`, invoiceHtml(CURRENT_INVOICE));
  }
}

async function cancelOrder(id) {
  if (!confirm('¿Cancelar este pedido?')) return;
  try {
    await api(`/orders/${id}/cancel`, { method: 'POST' });
    toast('Pedido cancelado.');
  } catch (error) { toast(error.message, 'error'); }
  loadOpenOrders();
  loadTables();
}

/* ===== VENTAS ===== */
async function loadSales() {
  const sales = await api('/sales');
  const el = document.getElementById('salesList');

  if (!sales.length) {
    el.innerHTML = '<div class="empty-state">No hay ventas registradas todavía.</div>';
    return;
  }

  el.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Venta</th><th>Fecha</th><th>Detalle</th><th>Pago</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${sales.map(o => `
        <tr>
          <td><b>#${o.id}</b><span class="cell-sub">${TYPE_LABELS[o.type] || o.type}</span></td>
          <td>${escapeHtml(fmtDateTime(o.closedAt || o.createdAt))}</td>
          <td>${o.items.map(i => `${i.qty} x ${escapeHtml(i.name)}`).join(', ')}${o.notes ? `<span class="cell-note">Nota: ${escapeHtml(o.notes)}</span>` : ''}</td>
          <td>${paymentLabel(o.paymentMethod)}${o.change > 0 ? `<span class="cell-sub">Cambio ${fmt(o.change)}</span>` : ''}</td>
          <td class="num"><b>${fmt(o.total)}</b></td>
          <td class="actions">
            <button class="btn btn-secondary btn-sm" onclick="showInvoiceById(${o.id})">${icon('file-text')}Ver factura</button>
            <button class="btn btn-secondary btn-sm" onclick="printInvoiceById(${o.id})">${icon('printer')}Imprimir</button>
            <button class="btn btn-secondary btn-sm" onclick="printKitchenById(${o.id})">${icon('printer')}Reimprimir comanda</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

async function showInvoiceById(id) {
  try {
    const order = await api(`/orders/${id}`);
    CURRENT_INVOICE = order;
    showInvoice(order);
  } catch (error) { toast(error.message, 'error'); }
}

async function printInvoiceById(id) {
  try {
    const order = await api(`/orders/${id}`);
    CURRENT_INVOICE = order;
    printHtml(`Factura - Pedido #${order.id}`, invoiceHtml(order));
  } catch (error) { toast(error.message, 'error'); }
}

/* ===== CIERRE DIARIO ===== */
let CLOSING_PREVIEW = null;
let CURRENT_CLOSING = null;

function methodRowsHtml(byMethod) {
  const entries = Object.entries(byMethod || {}).filter(([, v]) => v > 0);
  if (!entries.length) return '<tr><td colspan="2" class="empty">Sin ventas.</td></tr>';
  return entries.map(([m, v]) => `<tr><td>${paymentLabel(m)}</td><td class="num">${fmt(v)}</td></tr>`).join('');
}

function typeRowsHtml(byType) {
  return Object.entries(byType || {}).map(([t, v]) => `<tr><td>${TYPE_LABELS[t] || t}</td><td class="num">${v.count}</td><td class="num">${fmt(v.total)}</td></tr>`).join('');
}

function diffClass(diff) { return diff === 0 ? 'ok' : diff < 0 ? 'short' : 'over'; }
function diffText(diff) { return diff === 0 ? 'Caja cuadrada' : diff < 0 ? `Faltante ${fmt(Math.abs(diff))}` : `Sobrante ${fmt(diff)}`; }

async function loadClosing() {
  const box = document.getElementById('closingPending');
  let p;
  try { p = await api('/closings/preview'); } catch (error) { box.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; return; }
  CLOSING_PREVIEW = p;

  const openAlert = p.openOrders
    ? `<div class="alert alert-warn">${icon('alert')}<span>Hay <b>${p.openOrders}</b> pedido(s) abierto(s) sin pagar por ${fmt(p.openOrdersTotal)}. Cóbralos o cancélalos antes de cerrar el día.</span></div>`
    : '';

  if (!p.ordersCount) {
    box.innerHTML = `${openAlert}<div class="empty-state">No hay ventas pendientes por cerrar.${p.cancelledCount ? ` Hay ${p.cancelledCount} pedido(s) cancelado(s) que se archivarán en el próximo cierre.` : ''}</div>`;
    return;
  }

  const period = p.periodFrom === p.periodTo ? fmtDay(p.periodFrom) : `${fmtDay(p.periodFrom)} al ${fmtDay(p.periodTo)}`;
  const multiDay = p.periodFrom !== p.periodTo;
  box.innerHTML = `
    ${openAlert}
    ${multiDay ? `<div class="alert alert-info">${icon('clock')}<span>Estas ventas abarcan varios días (${period}) porque no se cerró la caja antes.</span></div>` : ''}
    <div class="closing-layout">
      <div>
        <div class="stat-cards">
          <div class="stat-card accent"><label>Ventas por cerrar</label><span>${fmt(p.totalSales)}</span></div>
          <div class="stat-card"><label>Pedidos pagados</label><span>${p.ordersCount}</span></div>
          <div class="stat-card"><label>Cobrado en domicilios</label><span>${fmt(p.deliveryFees)}</span></div>
          <div class="stat-card"><label>Pedidos cancelados</label><span>${p.cancelledCount}</span></div>
        </div>
        <h3 class="section-title">Ventas por método de pago</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Método</th><th class="num">Total</th></tr></thead><tbody>${methodRowsHtml(p.byMethod)}</tbody></table></div>
        <h3 class="section-title">Ventas por tipo de pedido</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Tipo</th><th class="num">Pedidos</th><th class="num">Total</th></tr></thead><tbody>${typeRowsHtml(p.byType)}</tbody></table></div>
      </div>

      <form id="closingForm" class="card cash-box">
        <h3>Cuadre de caja</h3>
        <div class="field"><label for="cOpening">Base inicial de caja</label><input type="text" class="money-input" id="cOpening" inputmode="numeric" autocomplete="off" placeholder="0" value="0"></div>
        <dl class="cash-lines">
          <div><dt>Ventas en efectivo</dt><dd>${fmt(p.cashSales)}</dd></div>
          <div class="strong"><dt>Efectivo esperado</dt><dd id="cExpected">${fmt(p.cashSales)}</dd></div>
        </dl>
        <div class="field"><label for="cCounted">Efectivo contado en caja</label><input type="text" class="money-input" id="cCounted" inputmode="numeric" autocomplete="off" placeholder="Cuenta el dinero y escríbelo aquí" required></div>
        <div id="cDiff" class="diff hidden"></div>
        <div class="field"><label for="cNotes">Observaciones</label><textarea id="cNotes" rows="2" maxlength="500" placeholder="Opcional"></textarea></div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">${icon('calendar-check')}Realizar cierre</button>
      </form>
    </div>`;

  const opening = document.getElementById('cOpening');
  const counted = document.getElementById('cCounted');
  const update = () => {
    const expected = moneyValue(opening) + p.cashSales;
    document.getElementById('cExpected').textContent = fmt(expected);
    const diffBox = document.getElementById('cDiff');
    if (counted.value === '') { diffBox.classList.add('hidden'); return; }
    const diff = moneyValue(counted) - expected;
    diffBox.className = `diff ${diffClass(diff)}`;
    diffBox.innerHTML = `<span>Diferencia</span><span>${diffText(diff)}</span>`;
  };
  opening.addEventListener('input', update);
  counted.addEventListener('input', update);
  document.getElementById('closingForm').addEventListener('submit', submitClosing);
}

async function submitClosing(event) {
  event.preventDefault();
  const body = {
    openingCash: moneyValue(document.getElementById('cOpening')),
    countedCash: document.getElementById('cCounted').value === '' ? '' : moneyValue(document.getElementById('cCounted')),
    notes: document.getElementById('cNotes').value.trim()
  };
  if (!confirm('¿Realizar el cierre? Las ventas incluidas quedarán archivadas y no se podrán volver a cerrar.')) return;

  const submit = async allowOpenOrders => {
    const closing = await api('/closings', { method: 'POST', body: { ...body, allowOpenOrders } });
    toast(`Cierre #${closing.id} guardado.`);
    showClosing(closing);
    loadClosing();
    if (CURRENT_USER.role === 'admin') loadClosingHistory();
  };

  try {
    await submit(false);
  } catch (error) {
    if (error.code === 'OPEN_ORDERS') {
      if (confirm(`${error.message}\n\n¿Cerrar de todas formas? Esos pedidos quedarán abiertos para el siguiente cierre.`)) {
        try { await submit(true); } catch (e) { toast(e.message, 'error'); }
      }
    } else {
      toast(error.message, 'error');
    }
  }
}

function closingHtml(c) {
  const period = c.periodFrom === c.periodTo ? fmtDay(c.periodFrom) : `${fmtDay(c.periodFrom)} al ${fmtDay(c.periodTo)}`;
  const line = (label, value, cls = '') => `<div class="inv-line ${cls}"><span>${label}</span><span>${value}</span></div>`;
  const methods = Object.entries(c.byMethod || {}).filter(([, v]) => v > 0).map(([m, v]) => line(paymentLabel(m), fmt(v))).join('');
  const types = Object.entries(c.byType || {}).filter(([, v]) => v.count > 0).map(([t, v]) => line(`${TYPE_LABELS[t] || t} (${v.count})`, fmt(v.total))).join('');
  return `
    <div class="invoice">
      <div class="invoice-header">
        <h2>Mi Local de Comida</h2>
        <p>CIERRE DIARIO #${c.id}</p>
        <p>${escapeHtml(fmtDateTime(c.closedAt))}</p>
      </div>
      <div class="invoice-info">
        <p><b>Periodo:</b> ${period}</p>
        <p><b>Cerrado por:</b> ${escapeHtml(c.closedBy ? c.closedBy.name : '')}</p>
      </div>
      <div class="inv-title">Ventas</div>
      ${line('Pedidos pagados', c.ordersCount)}
      ${line('Productos', fmt(c.productSales))}
      ${line('Domicilios', fmt(c.deliveryFees))}
      ${line('Pedidos cancelados', c.cancelledCount)}
      ${line('TOTAL VENTAS', fmt(c.totalSales), 'strong')}
      <div class="inv-title">Por método de pago</div>
      ${methods}
      <div class="inv-title">Por tipo de pedido</div>
      ${types}
      <div class="inv-title">Caja</div>
      ${line('Base inicial', fmt(c.openingCash))}
      ${line('Ventas en efectivo', fmt(c.cashSales))}
      ${line('Efectivo esperado', fmt(c.expectedCash))}
      ${line('Efectivo contado', fmt(c.countedCash))}
      ${line('Diferencia', diffText(c.difference), 'strong')}
      ${c.notes ? `<div class="invoice-notes"><b>Observaciones:</b> ${escapeHtml(c.notes)}</div>` : ''}
    </div>`;
}

function showClosing(closing) {
  CURRENT_CLOSING = closing;
  document.getElementById('closingContent').innerHTML = closingHtml(closing);
  document.getElementById('closingModal').classList.remove('hidden');
}

function closeClosingModal() {
  document.getElementById('closingModal').classList.add('hidden');
}

function printCurrentClosing() {
  if (!CURRENT_CLOSING) return;
  printHtml(`Cierre #${CURRENT_CLOSING.id}`, closingHtml(CURRENT_CLOSING));
}

async function loadClosingHistory() {
  const box = document.getElementById('closingHistory');
  let list;
  try { list = await api('/closings'); } catch (error) { box.innerHTML = ''; return; }
  if (!list.length) {
    box.innerHTML = '<div class="empty-state">Todavía no se han realizado cierres.</div>';
    return;
  }
  box.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Cierre</th><th>Fecha</th><th>Cerrado por</th><th class="num">Ventas</th><th class="num">Efectivo esperado</th><th class="num">Contado</th><th class="num">Diferencia</th><th></th></tr></thead>
      <tbody>${list.map(c => `
        <tr>
          <td><b>#${c.id}</b></td>
          <td>${escapeHtml(fmtDateTime(c.closedAt))}${c.periodFrom !== c.periodTo ? `<span class="cell-sub">Ventas del ${fmtDay(c.periodFrom)} al ${fmtDay(c.periodTo)}</span>` : ''}</td>
          <td>${escapeHtml(c.closedBy ? c.closedBy.name : '')}</td>
          <td class="num">${fmt(c.totalSales)}<span class="cell-sub">${c.ordersCount} pedidos</span></td>
          <td class="num">${fmt(c.expectedCash)}</td>
          <td class="num">${fmt(c.countedCash)}</td>
          <td class="num"><span class="${c.difference < 0 ? 'negative' : c.difference > 0 ? '' : 'positive'}">${c.difference === 0 ? 'Cuadrada' : (c.difference < 0 ? 'Faltante ' : 'Sobrante ') + fmt(Math.abs(c.difference))}</span></td>
          <td class="actions"><button class="btn btn-secondary btn-sm" onclick="openClosing(${c.id})">${icon('eye')}Ver detalle</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

async function openClosing(id) {
  try { showClosing(await api(`/closings/${id}`)); } catch (error) { toast(error.message, 'error'); }
}

/* ===== MENÚ (PRODUCTOS) ===== */
async function loadProductsTable() {
  PRODUCTS = await api('/products');
  const tbody = document.querySelector('#productsTable tbody');
  if (!PRODUCTS.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Aún no hay productos.</td></tr>';
    return;
  }
  tbody.innerHTML = PRODUCTS.map(p => {
    const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
    return `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category)}</td><td class="num">${fmt(p.price)}</td><td class="num">${fmt(p.cost)}</td><td class="num">${margin}%</td>
      <td class="actions"><button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id})">${icon('trash')}Eliminar</button></td></tr>`;
  }).join('');
}

document.getElementById('productForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    name: document.getElementById('pName').value.trim(),
    category: document.getElementById('pCategory').value.trim() || 'General',
    price: moneyValue(document.getElementById('pPrice')),
    cost: moneyValue(document.getElementById('pCost'))
  };
  try {
    await api('/products', { method: 'POST', body });
    e.target.reset();
    loadProductsTable();
    loadProducts();
  } catch (error) { toast(error.message, 'error'); }
});

async function deleteProduct(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  try { await api(`/products/${id}`, { method: 'DELETE' }); } catch (error) { toast(error.message, 'error'); }
  loadProductsTable();
  loadProducts();
}

/* ===== INVENTARIO ===== */
async function loadIngredientsTable() {
  INGREDIENTS = await api('/ingredients');
  const tbody = document.querySelector('#ingredientsTable tbody');
  if (!INGREDIENTS.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Aún no hay ingredientes.</td></tr>';
    return;
  }
  tbody.innerHTML = INGREDIENTS.map(i => {
    const low = i.stock <= i.minStock;
    return `<tr><td>${escapeHtml(i.name)}</td><td class="num">${i.stock}</td><td>${escapeHtml(i.unit)}</td><td class="num">${i.minStock}</td>
      <td><span class="badge ${low ? 'badge-low' : 'badge-ok'}">${icon(low ? 'alert' : 'check-circle')}${low ? 'Bajo' : 'En orden'}</span></td>
      <td class="actions"><button class="btn btn-danger btn-sm" onclick="deleteIngredient(${i.id})">${icon('trash')}Eliminar</button></td></tr>`;
  }).join('');
}

document.getElementById('ingredientForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    name: document.getElementById('iName').value.trim(),
    unit: document.getElementById('iUnit').value.trim() || 'un',
    stock: Number(document.getElementById('iStock').value),
    minStock: Number(document.getElementById('iMinStock').value) || 0
  };
  try {
    await api('/ingredients', { method: 'POST', body });
    e.target.reset();
    document.getElementById('iUnit').value = 'un';
    loadIngredientsTable();
  } catch (error) { toast(error.message, 'error'); }
});

async function deleteIngredient(id) {
  if (!confirm('¿Eliminar este ingrediente?')) return;
  try { await api(`/ingredients/${id}`, { method: 'DELETE' }); } catch (error) { toast(error.message, 'error'); }
  loadIngredientsTable();
}

/* ===== REPORTES ===== */
function shiftDay(day, delta) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const today = CONFIG.today;
    const ranges = {
      today: [today, today],
      yesterday: [shiftDay(today, -1), shiftDay(today, -1)],
      week: [shiftDay(today, -6), today],
      month: [today.slice(0, 8) + '01', today]
    };
    const [from, to] = ranges[btn.dataset.preset];
    document.getElementById('reportFrom').value = from;
    document.getElementById('reportTo').value = to;
    runReport();
  });
});

document.getElementById('btnRunReport').addEventListener('click', runReport);

async function runReport() {
  const fromInput = document.getElementById('reportFrom');
  const toInput = document.getElementById('reportTo');
  if (!fromInput.value && !toInput.value) { fromInput.value = CONFIG.today; toInput.value = CONFIG.today; }
  const message = document.getElementById('reportMessage');
  message.textContent = '';
  message.classList.remove('error');

  const params = new URLSearchParams();
  if (fromInput.value) params.set('from', fromInput.value);
  if (toInput.value) params.set('to', toInput.value);

  let data;
  try {
    data = await api(`/reports/summary?${params}`);
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('error');
    return;
  }

  const range = data.from === data.to ? fmtDay(data.from) : `${fmtDay(data.from) || 'inicio'} al ${fmtDay(data.to) || 'hoy'}`;
  message.textContent = `Mostrando: ${range}`;

  document.getElementById('rTotalVentas').textContent = fmt(data.totalVentas);
  document.getElementById('rTotalPedidos').textContent = data.totalPedidos;
  document.getElementById('rTicketProm').textContent = fmt(data.ticketPromedio);
  document.getElementById('rDomicilios').textContent = fmt(data.totalDomicilios);

  document.getElementById('reportByMethod').innerHTML = methodRowsHtml(data.porMetodo);
  document.getElementById('reportByType').innerHTML = typeRowsHtml(data.porTipo);

  const days = Object.entries(data.porDia).sort();
  document.getElementById('reportByDay').innerHTML = days.length
    ? days.map(([day, total]) => `<tr><td>${fmtDay(day)}</td><td class="num">${fmt(total)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">Sin ventas en este periodo.</td></tr>';

  document.getElementById('reportTopProducts').innerHTML = data.topProductos.length
    ? data.topProductos.map(p => `<tr><td>${escapeHtml(p.name)}</td><td class="num">${p.qty}</td><td class="num">${fmt(p.total)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">Sin ventas en este periodo.</td></tr>';

  document.getElementById('reportLowStock').innerHTML = data.ingredientesBajoStock.length
    ? data.ingredientesBajoStock.map(i => `<tr><td>${escapeHtml(i.name)}</td><td class="num">${i.stock}</td><td class="num">${i.minStock}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">Todo el inventario está en buen nivel.</td></tr>';
}

/* ===== USUARIOS Y PERMISOS ===== */
async function loadUsers() {
  let users;
  try { users = await api('/users'); } catch (e) { return; }
  const tbody = document.querySelector('#usersTable tbody');
  tbody.innerHTML = users.map(user => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.username)}</td>
      <td>${user.role === 'admin' ? 'Administradora' : 'Empleado'}</td>
      <td><span class="badge ${user.active ? 'badge-ok' : 'badge-neutral'}">${user.active ? 'Activo' : 'Desactivado'}</span></td>
      <td class="actions">${user.id === CURRENT_USER.id
        ? '<span class="muted">Cuenta actual</span>'
        : `<button class="btn btn-secondary btn-sm" onclick="toggleUser(${user.id}, ${!user.active})">${user.active ? 'Desactivar' : 'Activar'}</button>`}</td>
    </tr>`).join('');
}

document.getElementById('userForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('userMessage');
  message.textContent = '';
  message.classList.remove('error');
  const body = {
    name: document.getElementById('uName').value.trim(),
    username: document.getElementById('uUsername').value.trim(),
    password: document.getElementById('uPassword').value,
    role: document.getElementById('uRole').value
  };
  try {
    const data = await api('/users', { method: 'POST', body });
    event.target.reset();
    message.textContent = `Se creó la cuenta de ${data.name}.`;
    loadUsers();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('error');
  }
});

async function toggleUser(id, active) {
  try {
    await api(`/users/${id}/status`, { method: 'PATCH', body: { active } });
    loadUsers();
  } catch (error) { toast(error.message, 'error'); }
}

/* ===== TECLADO: cerrar modales con Escape ===== */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closePaymentModal();
  closeInvoiceModal();
  closeClosingModal();
});

/* ===== INICIO ===== */
bootstrapAuth();
