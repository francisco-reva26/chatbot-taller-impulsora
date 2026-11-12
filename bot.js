// bot.js — Lógica de recepción del chatbot del taller "Almacén Impulsora".
// Reglas duras (del usuario, 2026-11-11/12):
//  - NUNCA dar precios ni rangos. Esta base no contiene precios.
//  - NUNCA pedir la placa, para nada. Para localizar una unidad: nombre,
//    empresa, ruta, número de camión o chasis.
//  - Al canalizar, NUNCA decir los nombres de Francisco ni de Manuel al
//    cliente: "una persona de almacén lo atenderá a la brevedad".
//  - Refacción: solo pedir equipo/modelo (o foto). NO pedir ruta, camión,
//    empresa ni chasis. Estatus: ahí sí pedir nombre, empresa, ruta,
//    número de camión o chasis.
//  - Cerrar la conversación antes de cualquier cobro: una vez canalizada
//    la solicitud o contestado el estatus, se cierra; nunca se manda
//    plantilla ni se reabre solo; solo se contesta de nuevo si el cliente
//    escribe otra vez.
//  - Tope mensual: 1,000 respuestas de servicio gratis/mes. Al llegar,
//    parar y avisar al usuario (ver server.js).
//  - Sin método de pago: el bot solo responde dentro de la ventana de
//    24 h que abre el mensaje del cliente. Nunca inicia conversación.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const kb = JSON.parse(fs.readFileSync(path.join(DIR, 'kb.json'), 'utf8'));
const products = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf8'));

const STOPWORDS = new Set(['para', 'necesito', 'ocupo', 'busco', 'busca', 'quiero', 'tiene', 'tienen', 'tienes', 'cuanto', 'cuesta', 'precio', 'buenas', 'tardes', 'dias', 'hola', 'favor', 'puede', 'puedes', 'seria', 'sería', 'algo', 'este', 'esta', 'esto', 'esas', 'esos', 'unos', 'unas', 'sobre', 'entre', 'cuando', 'donde', 'como', 'mas', 'muy', 'solo', 'sola']);
const CANALIZAR_MSG = 'Listo, ya tomé tu solicitud. Una persona de almacén lo atenderá a la brevedad.';
const SIN_PRECIO_MSG = 'Por aquí no manejo precios, pero con gusto tomo tu solicitud y una persona de almacén lo atenderá a la brevedad.';

const norm = (s) => (s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s/.-]/g, ' ').replace(/\s+/g, ' ').trim();

// --- Búsqueda en la base -------------------------------------------------
function findKb(text) {
  const t = norm(text);
  const hits = [];
  for (const item of kb.items) {
    const hay = norm([item.titulo, item.detalle, (item.sinonimos || []).join(' '), (item.codigos || []).join(' ')].join(' '));
    // Código exacto (p. ej. 007-00161-000, T95177AY, 023Z0264)
    for (const c of (item.codigos || [])) {
      if (c && t.includes(norm(c))) { hits.push({ item, score: 100, via: 'codigo:' + c }); break; }
    }
    if (hits.some(h => h.item.id === item.id)) continue;
    for (const s of (item.sinonimos || [])) {
      if (s && t.includes(norm(s))) { hits.push({ item, score: 80, via: 'sinonimo:' + s }); break; }
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

function findProduct(text) {
  const t = norm(text);
  const exact = products.find(p => p.codigo && norm(p.codigo) === t);
  if (exact) return { product: exact, via: 'codigo exacto' };
  const byCode = products.find(p => p.codigo && t.includes(norm(p.codigo)) && norm(p.codigo).length >= 5);
  if (byCode) return { product: byCode, via: 'codigo' };
  const words = t.split(' ').filter(w => w.length > 3 && !STOPWORDS.has(w));
  let best = null, bestScore = 0;
  for (const p of products) {
    const name = norm(p.nombre);
    let score = 0;
    for (const w of words) if (name.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (best && bestScore >= 2) return { product: best, via: 'nombre' };
  return null;
}

// Ambigüedades que exigen una pregunta (reglas del anaquel)
function ambiguousQuestion(text) {
  const t = ' ' + norm(text) + ' ';
  if (/\b(presostato|proteccion|sensor de presion)\b/.test(t) && !t.includes('baja') && !t.includes('alta') && !t.includes('azul') && !t.includes('negro')) {
    return '¿Es la de BAJA (cable azul) o la de ALTA (cable negro)?';
  }
  if (t.trim() === 'sensor' || /\bsolo (un )?sensor\b/.test(t) || /\bnecesito un sensor\b/.test(t)) {
    return '¿Cuál necesitas: sensor canasta, sensor azul o chicote?';
  }
  if (/\bfiltro 30[45]\b/.test(t) && !t.includes('flare') && !t.includes('oring')) {
    return '¿Es el filtro flare o el de oring?';
  }
  if (t.includes('serpentin cc355') && !t.includes('derecho') && !t.includes('izquierdo')) {
    return '¿Es el serpentín derecho o el izquierdo?';
  }
  if (t.includes('fusible 175') && !t.includes('portafusible')) {
    return '¿Necesitas el fusible (MEGA 175A) o el portafusible?';
  }
  if (t.includes('compresor bock') && !t.includes('655') && !t.includes('755')) {
    return '¿Es el Bock 655 (FKX40/655K) o el 755 (FKX40/755K)?';
  }
  if (t.includes('alternador bosch 150') && !t.includes('3 agarres') && !t.includes('2 agarres') && !t.includes('tres agarres') && !t.includes('dos agarres')) {
    return '¿Es el de 3 agarres o el de 2 agarres?';
  }
  if (t.trim() === 'condensador' || /\bel condensador\b/.test(t)) {
    return '¿Te refieres al ventilador/motor del condensador (el abanico) o al serpentín del condensador?';
  }
  return null;
}

function detectEquipo(text) {
  const t = norm(text);
  if (t.includes('cc450') || t.includes('cc 450')) return 'Spheros CC450';
  if (t.includes('cc355') || t.includes('cc 355')) return 'Spheros CC355';
  if (t.includes('cc300') || t.includes('cc 300')) return 'Globus CC300';
  if (t.includes('eberspacher') || t.includes('ebersp')) return 'Eberspächer';
  if (t.includes('valeo')) return 'Valeo';
  if (t.includes('spheros')) return 'Spheros';
  return null;
}

function detectIntent(text) {
  const t = norm(text);
  if (/\b(ya quedo|ya quedó|quedo mi|quedó mi|estatus|estado de|como va|cuando queda|cuándo queda|mi unidad|mi camion|mi camión|esta lista|está lista|esta listo|está listo)\b/.test(t)) return 'estatus';
  if (/\b(proveedor|ofrezco|les ofrezco|les vendo|vendo|tengo para vender|distribuidor|soy proveedor)\b/.test(t)) return 'proveedor';
  if (/\b(servicio|reparacion|reparación|instalar|instalacion|instalación|reparar|no enfria|no enfría|no funciona el clima|falla el clima)\b/.test(t)) return 'servicio';
  return 'refaccion';
}

function asksPrice(text) {
  return /\b(precio|precios|cuanto cuesta|cuánto cuesta|cuanto vale|cuánto vale|que cuesta|qué cuesta|costo|cuanto sale|en cuanto)\b/.test(norm(text));
}

function isFarewell(text) {
  return /^(gracias|muchas gracias|es todo|eso es todo|ok|va|perfecto|sale|enterado|de acuerdo)\b/.test(norm(text));
}

function isGreeting(text) {
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches|que tal|qué tal)\b/.test(norm(text));
}

// --- Estado de conversación ----------------------------------------------
// fields: { nombre, empresa, ruta, numeroUnidad, chasis, equipo, refaccion,
//           falla, tipo, foto (mediaId), producto }
// intent: refaccion | estatus | servicio | proveedor
function newConversation(waId) {
  return { waId, intent: null, fields: {}, cerrada: false, cerradaAt: null,
           lastClientAt: null, createdAt: new Date().toISOString(), replies: 0 };
}

// Devuelve { reply, solicitud|null, close:boolean, action }
function handleMessage(conv, msg) {
  const text = (msg.text || '').trim();
  const hasPhoto = !!msg.imageId;
  const now = new Date().toISOString();
  conv.lastClientAt = now;

  // Conversación cerrada: solo se reabre si el cliente escribe algo nuevo
  // con sustancia. Un simple "gracias / es todo" no crea otra solicitud.
  if (conv.cerrada) {
    if (isFarewell(text) && !hasPhoto) {
      return { reply: 'Con gusto, quedamos al pendiente.', solicitud: null, close: true };
    }
    conv.cerrada = false; conv.cerradaAt = null; conv.intent = null; conv.fields = {};
  }
  if (!text && !hasPhoto) return { reply: null, solicitud: null, close: false };

  if (!conv.intent) conv.intent = detectIntent(text);
  const f = conv.fields;

  // Foto: es foto de la pieza (refacción) o de la unidad (estatus/servicio)
  if (hasPhoto) {
    f.foto = msg.imageId;
    if (conv.intent === 'refaccion' && !f.refaccion) f.refaccion = 'foto de la pieza';
  }

  // Extraer equipo y refacción del texto
  const equipo = detectEquipo(text);
  if (equipo && !f.equipo) f.equipo = equipo;
  if (text) {
    const kbHits = findKb(text);
    if (kbHits.length && !f.refaccion) f.refaccion = kbHits[0].item.titulo;
    const prod = findProduct(text);
    // Solo se agrega un producto del catálogo si coincidió por CÓDIGO;
    // por nombre solo se usa cuando aún no hay refacción reconocida.
    if (prod && prod.via.startsWith('codigo')) {
      if (!f.refaccion) f.refaccion = prod.product.nombre + ' (' + prod.product.codigo + ')';
      else if (!f.refaccion.includes(prod.product.codigo)) f.refaccion += ' / ' + prod.product.nombre + ' (' + prod.product.codigo + ')';
    } else if (prod && !f.refaccion) {
      f.refaccion = prod.product.nombre + ' (' + prod.product.codigo + ')';
    }
    // Nombre del cliente: "soy X" / "me llamo X" / primer mensaje con nombre
    const m = text.match(/(?:soy|me llamo|mi nombre es)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,40})/i);
    if (m && !f.nombre) f.nombre = m[1].trim();
    const ch = text.match(/chasis[:\s]*([A-Za-z0-9]{4,})/i);
    if (ch && !f.chasis) f.chasis = ch[1].toUpperCase();
    const ruta = text.match(/ruta[:\s]*([A-Za-z0-9 .\-]{2,30})/i);
    if (ruta && !f.ruta) f.ruta = ruta[1].trim();
  }

  // Resolver una pregunta de desambiguación pendiente con la respuesta del cliente
  if (f._pendiente && text) {
    const t = norm(text);
    const P = {
      presostato: [[/baja|azul/, 'Protección baja — presostato de baja presión (cable AZUL)'], [/alta|negro/, 'Protección alta — presostato de alta presión (cable NEGRO)']],
      sensor: [[/canasta/, 'Sensor canasta / sensor azul / chicote (sensor de temperatura) — canasta'], [/azul/, 'Sensor canasta / sensor azul / chicote (sensor de temperatura) — azul'], [/chicote/, 'Sensor canasta / sensor azul / chicote (sensor de temperatura) — chicote']],
      filtro: [[/flare/, null], [/oring/, null]],
      serpentin: [[/derecho/, 'Serpentín CC355 — derecho'], [/izquierdo/, 'Serpentín CC355 — izquierdo']],
      fusible: [[/portafusible/, 'Portafusible 175'], [/^fusible|el fusible|mega/, 'Fusible MEGA 175A']],
      bock: [[/655/, 'Compresor Bock 655 (FKX40/655K)'], [/755/, 'Compresor Bock 755 (FKX40/755K)']],
      bosch150: [[/3 agarres|tres agarres/, 'Alternador Bosch 150 de 3 agarres'], [/2 agarres|dos agarres/, 'Alternador Bosch 150 de 2 agarres']],
      condensador: [[/ventilador|motor|abanico/, 'Ventilador / motor de condensador Spheros Valeo (111150818)'], [/serpentin|serpentín/, 'Serpentín del condensador']],
    };
    const opts = P[f._pendiente] || [];
    for (const [re, titulo] of opts) {
      if (re.test(t)) {
        if (titulo) f.refaccion = titulo;
        else if (f._pendiente === 'filtro') f.refaccion = (f._filtroBase || 'Filtro deshidratador Danfoss') + ' ' + (t.includes('flare') ? 'flare' : 'oring');
        delete f._pendiente; delete f._filtroBase;
        break;
      }
    }
  }

  // --- Proveedor: qué ofrece, disponibilidad; nunca comprometerse a comprar
  if (conv.intent === 'proveedor') {
    if (!f.refaccion && text) f.refaccion = text.slice(0, 200);
    if (!f.refaccion) return { reply: 'Hola, ¿qué nos ofrece y con qué disponibilidad? Con gusto tomo sus datos y una persona de almacén lo atenderá a la brevedad.', solicitud: null, close: false };
    const sol = buildSolicitud(conv, 'proveedor', 'Proveedor ofrece: ' + (f.refaccion || ''));
    return fin(conv, { reply: CANALIZAR_MSG, solicitud: sol, close: true });
  }

  // --- Estatus: pedir localizadores (nunca placa) y contestar por la nota
  if (conv.intent === 'estatus') {
    if (!f.nombre) return { reply: 'Claro, ¿me dice su nombre y la empresa, ruta, número de camión o chasis de la unidad para localizarla?', solicitud: null, close: false };
    if (!f.empresa && !f.ruta && !f.numeroUnidad && !f.chasis) {
      return { reply: 'Gracias, ' + f.nombre + '. ¿Me pasa la empresa, la ruta, el número de camión o el chasis de la unidad?', solicitud: null, close: false };
    }
    return { reply: null, solicitud: null, close: false, action: 'lookup_status', fields: f };
  }

  // --- Servicio / reparación / instalación
  if (conv.intent === 'servicio') {
    if (!f.equipo) return { reply: 'Claro, ¿para qué equipo es? Valeo, Spheros CC450, CC355 o Eberspächer, o si gusta mándeme una foto.', solicitud: null, close: false };
    if (!f.nombre) return { reply: '¿Me dice su nombre para registrar la solicitud de servicio para el ' + f.equipo + '?', solicitud: null, close: false };
    const sol = buildSolicitud(conv, 'servicio', (f.nombre ? f.nombre + ' — servicio para ' : 'Servicio para ') + f.equipo + (f.falla ? ': ' + f.falla : ''));
    return fin(conv, { reply: CANALIZAR_MSG, solicitud: sol, close: true });
  }

  // --- Refacción (flujo principal)
  if (asksPrice(text)) {
    // No se da precio; se sigue tomando la solicitud.
    if (!f.equipo && !f.refaccion) return { reply: SIN_PRECIO_MSG + ' ¿Para qué equipo es la refacción? Valeo, Spheros CC450, CC355 o Eberspächer, o mándeme una foto de la pieza.', solicitud: null, close: false };
  }
  const amb = ambiguousQuestion(text);
  if (amb && !f.refaccion) return askAmb(conv, amb, text);
  if (amb && f.refaccion && /^(¿Es|¿Cuál|¿Necesitas)/.test(amb)) {
    // La pieza ya se reconoció por código, pero la variante sigue ambigua:
    // preguntar solo si la variante no quedó clara en el texto.
    if (!/baja|alta|azul|negro|flare|oring|derecho|izquierdo|655|755|3 agarres|2 agarres|ventilador|serpentín|serpentin|portafusible/.test(norm(text))) {
      return askAmb(conv, amb, text);
    }
  }
  if (!f.refaccion && !hasPhoto) {
    if (isGreeting(text)) return { reply: 'Hola, ¿qué refacción busca? Dígame el equipo (Valeo, Spheros CC450, CC355 o Eberspächer) y la pieza o el código, o mándeme una foto de la pieza.', solicitud: null, close: false };
    return { reply: '¿Qué refacción busca? Dígame el equipo y la pieza o el código, o mándeme una foto de la pieza.', solicitud: null, close: false };
  }
  if (!f.equipo) {
    return { reply: 'Ya la ubiqué: ' + (f.refaccion || 'la pieza') + '. ¿Para qué equipo es? Valeo, Spheros CC450, CC355 o Eberspächer.', solicitud: null, close: false };
  }
  // Solicitud completa: canalizar y cerrar (nunca decir nombres al cliente).
  const resumen = (f.nombre ? f.nombre + ' busca ' : 'Cliente busca ') + (f.refaccion || 'refacción') + ' para ' + f.equipo;
  const sol = buildSolicitud(conv, 'refaccion', resumen);
  return fin(conv, { reply: CANALIZAR_MSG, solicitud: sol, close: true });
}

// Marca la conversación como cerrada al canalizar (el servidor también lo
// hace, pero el bot debe quedar consistente aunque se le llame directo).
function fin(conv, result) {
  if (result.close) { conv.cerrada = true; conv.cerradaAt = new Date().toISOString(); }
  return result;
}

// Registra qué variante quedó pendiente de aclarar, para resolverla con la
// siguiente respuesta del cliente.
function askAmb(conv, pregunta, text) {
  const t = norm(text || '');
  let kind = null;
  if (pregunta.includes('BAJA')) kind = 'presostato';
  else if (pregunta.includes('canasta')) kind = 'sensor';
  else if (pregunta.includes('flare')) { kind = 'filtro'; conv.fields._filtroBase = t.includes('304') ? 'Filtro deshidratador Danfoss DML 304' : 'Filtro deshidratador Danfoss DML 305'; }
  else if (pregunta.includes('derecho')) kind = 'serpentin';
  else if (pregunta.includes('portafusible')) kind = 'fusible';
  else if (pregunta.includes('Bock 655')) kind = 'bock';
  else if (pregunta.includes('agarres')) kind = 'bosch150';
  else if (pregunta.includes('abanico')) kind = 'condensador';
  if (kind) conv.fields._pendiente = kind;
  return { reply: pregunta, solicitud: null, close: false };
}

function buildSolicitud(conv, tipo, resumen) {
  return {
    id: 'SOL-' + Date.now().toString(36).toUpperCase(),
    waId: conv.waId,
    tipo,
    resumen,
    fields: { ...conv.fields },
    estado: 'nueva',
    creadaAt: new Date().toISOString(),
    tomadaAt: null, tomadaPor: null, atendidaAt: null, atendidaPor: null,
    // Aviso a Francisco y Manuel: SIN método de pago Meta no permite
    // mandarles un mensaje de WhatsApp iniciado por el bot (eso sería una
    // plantilla, de pago). La solicitud queda en la bandeja (/inbox) y en
    // el registro, para que Luna la avise por el canal habitual.
    aviso: { via: 'bandeja', estado: 'pendiente', para: ['6671181767', '6674603088'] },
  };
}

// Respuesta de estatus según las unidades (notas CONTPAQi)
function statusReply(unit) {
  if (!unit) return 'Sigue en taller, todavía no queda. Una persona de almacén lo atenderá a la brevedad si gusta más detalle.';
  if (unit.nota) return 'Ya quedó su unidad. La nota es folio ' + unit.nota.folio + '. Una persona de almacén lo atenderá a la brevedad para la entrega.';
  return 'Sigue en taller, todavía no queda. Una persona de almacén lo atenderá a la brevedad si gusta más detalle.';
}

function findUnit(units, f) {
  const norm2 = (s) => norm(String(s || ''));
  return units.find(u => {
    if (f.chasis && u.chasis && norm2(u.chasis) === norm2(f.chasis)) return true;
    if (f.numeroUnidad && u.numeroUnidad && String(u.numeroUnidad) === String(f.numeroUnidad)) return true;
    if (f.nombre && u.cliente && norm2(u.cliente).includes(norm2(f.nombre)) && f.empresa && u.empresa && norm2(u.empresa) === norm2(f.empresa)) return true;
    return false;
  }) || null;
}

module.exports = { handleMessage, statusReply, findUnit, findKb, findProduct, ambiguousQuestion, detectIntent, detectEquipo, norm, CANALIZAR_MSG, SIN_PRECIO_MSG, newConversation };
