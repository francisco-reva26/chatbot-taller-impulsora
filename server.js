// server.js — Webhook de WhatsApp Cloud API para el chatbot del taller.
// Node estándar, sin dependencias. Lee configuración de .env (ver .env.example).
//   GET  /webhook  -> verificación de Meta (hub.mode / hub.verify_token / hub.challenge)
//   POST /webhook  -> mensajes entrantes de Meta (texto e imagen)
//   GET  /health   -> estado, uso del mes, tope
//   GET  /inbox    -> bandeja de solicitudes (JSON) para Francisco y Manuel
//   GET  /         -> panel simple con el estado
// Sin WHATSAPP_TOKEN el servidor corre en modo DRY-RUN: procesa los
// mensajes, guarda las solicitudes y registra lo que contestaría, pero no
// manda nada a Meta. Eso permite probar sin credenciales reales.
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bot = require('./bot');

const DIR = __dirname;
const DATA = path.join(DIR, 'data');
fs.mkdirSync(path.join(DATA, 'media'), { recursive: true });

// --- .env -----------------------------------------------------------------
// Opcional: en Render las variables vienen del panel, no hay archivo .env.
try {
  for (const line of fs.readFileSync(path.join(DIR, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* sin .env: se usan las variables de entorno del sistema */ }
const PORT = parseInt(process.env.PORT || '3000', 10);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '818620465684599';
const APP_SECRET = process.env.APP_SECRET || '';
const MONTHLY_CAP = parseInt(process.env.MONTHLY_CAP || '1000', 10);
const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v21.0';

// --- Persistencia (JSON) --------------------------------------------------
function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
  catch { return fallback; }
}
function save(name, obj) {
  const tmp = path.join(DATA, name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, path.join(DATA, name));
}
function logLine(obj) {
  fs.appendFileSync(path.join(DATA, 'webhook.log'),
    JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
}

let conversations = load('conversations.json', {});
let solicitudes = load('solicitudes.json', []);
let usage = load('usage.json', { month: '', replies: 0 });
let units = load('units.json', []);
let alerts = load('alerts.json', []);

function monthKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit' }).format(new Date());
}
function usageThisMonth() {
  const m = monthKey();
  if (usage.month !== m) { usage = { month: m, replies: 0 }; save('usage.json', usage); }
  return usage;
}
function capReached() { return usageThisMonth().replies >= MONTHLY_CAP; }
function recordAlert(text) {
  const a = { ts: new Date().toISOString(), text };
  alerts.push(a); save('alerts.json', alerts);
  logLine({ event: 'ALERTA', text });
  console.log('[ALERTA]', text);
}

// --- Envío por WhatsApp Cloud API -----------------------------------------
async function sendWhatsApp(to, body, conv) {
  if (capReached()) {
    recordAlert('Tope mensual de ' + MONTHLY_CAP + ' respuestas alcanzado (' + monthKey() + '). No se contestó a ' + to + '. Avisar a Francisco: se llegó al tope y el bot se pausa hasta el mes siguiente.');
    return { ok: false, blocked: 'cap' };
  }
  // Ventana de 24 h: solo se responde si el cliente escribió en las últimas 24 h.
  if (conv && conv.lastClientAt) {
    const age = Date.now() - new Date(conv.lastClientAt).getTime();
    if (age > 24 * 3600 * 1000) { logLine({ event: 'fuera_de_ventana', to }); return { ok: false, blocked: 'ventana_24h' }; }
  }
  if (!WHATSAPP_TOKEN) {
    logLine({ event: 'dry_run_send', to, body });
    console.log('[DRY-RUN] a', to, ':', body);
    usageThisMonth().replies++; save('usage.json', usage);
    return { ok: true, dryRun: true };
  }
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { logLine({ event: 'send_error', to, status: res.status, data }); return { ok: false, error: data }; }
  usageThisMonth().replies++; save('usage.json', usage);
  logLine({ event: 'sent', to, id: data.messages && data.messages[0] && data.messages[0].id });
  return { ok: true, id: data.messages && data.messages[0] && data.messages[0].id };
}

function downloadMedia(mediaId) {
  if (!WHATSAPP_TOKEN) return;
  fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, { headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN } })
    .then(r => r.json())
    .then(j => j.url ? fetch(j.url, { headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN } }) : null)
    .then(r => r && r.arrayBuffer())
    .then(buf => { if (buf) fs.writeFileSync(path.join(DATA, 'media', mediaId + '.jpg'), Buffer.from(buf)); })
    .catch(e => logLine({ event: 'media_error', mediaId, error: String(e) }));
}

// --- Procesar un mensaje entrante -----------------------------------------
async function processMessage(msg) {
  const waId = msg.from;
  const type = msg.type;
  const text = type === 'text' ? (msg.text && msg.text.body || '') : (msg.caption || '');
  const imageId = type === 'image' ? (msg.image && msg.image.id) : null;
  if (imageId) downloadMedia(imageId);
  if (!conversations[waId]) conversations[waId] = bot.newConversation(waId);
  const conv = conversations[waId];
  const result = bot.handleMessage(conv, { text, imageId });
  if (result.action === 'lookup_status') {
    const unit = bot.findUnit(units, result.fields || conv.fields);
    const reply = bot.statusReply(unit);
    await sendWhatsApp(waId, reply, conv);
    conv.cerrada = true; conv.cerradaAt = new Date().toISOString();
    save('conversations.json', conversations);
    return;
  }
  if (result.solicitud) {
    solicitudes.push(result.solicitud);
    save('solicitudes.json', solicitudes);
    logLine({ event: 'solicitud', solicitud: result.solicitud });
    console.log('[SOLICITUD]', result.solicitud.id, '-', result.solicitud.resumen);
    console.log('[AVISO] Nueva solicitud: avisar a Francisco (6671181767) y a Manuel (6674603088). Sin método de pago Meta no permite mandársela por WhatsApp desde el bot; queda en la bandeja /inbox.');
  }
  if (result.reply) await sendWhatsApp(waId, result.reply, conv);
  if (result.close) { conv.cerrada = true; conv.cerradaAt = new Date().toISOString(); }
  save('conversations.json', conversations);
}

// --- HTTP -----------------------------------------------------------------
function verifySignature(raw, sig) {
  if (!APP_SECRET) return true; // sin APP_SECRET no se puede verificar; se registra
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); }
  catch { return false; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
      res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(challenge);
    } else {
      res.writeHead(403); res.end('Forbidden');
    }
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    const u = usageThisMonth();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mes: u.month, respuestas: u.replies, tope: MONTHLY_CAP, token_configurado: !!WHATSAPP_TOKEN, numero: '526671316147', app: 'Almacén Impulsora' }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/inbox') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ solicitudes: solicitudes.slice().reverse(), uso: usageThisMonth(), alertas: alerts.slice(-10) }, null, 2));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/') {
    const u = usageThisMonth();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>Chatbot del taller — Almacén Impulsora</h1><p>Número: +52 667 131 6147 (Impulsora Del Noroeste)</p><p>Respuestas este mes (${u.month}): ${u.replies} / ${MONTHLY_CAP}</p><p>Solicitudes en bandeja: ${solicitudes.length}</p><p>Token de WhatsApp: ${WHATSAPP_TOKEN ? 'configurado' : 'NO configurado (modo prueba)'}</p><p><a href="/inbox">Ver bandeja (JSON)</a> · <a href="/health">Salud</a></p>`);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/webhook') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      res.writeHead(200); res.end('EVENT_RECEIVED');
      if (!verifySignature(raw, req.headers['x-hub-signature-256'])) {
        logLine({ event: 'firma_invalida' }); return;
      }
      let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (body.object !== 'whatsapp_business_account') return;
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const v = change.value || {};
          for (const m of v.messages || []) { processMessage(m).catch(e => logLine({ event: 'process_error', error: String(e) })); }
          for (const s of v.statuses || []) logLine({ event: 'status', id: s.id, status: s.status });
        }
      }
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Webhook del taller en http://localhost:' + PORT + '/webhook');
  console.log('Modo:', WHATSAPP_TOKEN ? 'REAL (token configurado)' : 'DRY-RUN (sin WHATSAPP_TOKEN: no se manda nada a Meta)');
  console.log('Tope mensual:', MONTHLY_CAP, 'respuestas. Mes:', usageThisMonth().month);
});
