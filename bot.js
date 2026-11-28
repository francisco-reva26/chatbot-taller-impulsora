// bot.js — Lógica de recepción del chatbot del taller "Almacén Impulsora".
// Reglas duras (del usuario, 2026-11-11/12):
//  - NUNCA dar precios ni rangos. Esta base no contiene precios.
//  - NUNCA pedir la placa, para nada. Para localizar una unidad: nombre,
//    empresa, ruta, número de camión o chasis.
//  - Al canalizar, NUNCA decir los nombres de Francisco ni de Manuel al
//    cliente: "una persona de almacén lo atenderá a la brevedad".
//  - Refacción: si la pieza quedó clara por nombre o código (p. ej.
//    compresor TM65), NO se pide el equipo, se canaliza directo. El equipo
//    solo se pregunta cuando el cliente no sabe el número de parte ni los
//    datos de la refacción (p. ej. solo manda foto). NO pedir ruta, camión,
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
//  - Fluido, no robótico (2026-11-23, caso Beto Cornejo): el bot solo
//    habla cuando el mensaje es claramente una solicitud que puede
//    atender. Un saludo se contesta con un saludo corto, nunca con el
//    cuestionario completo. La pregunta por la pieza se hace en dos
//    variantes y no se repite igual; si el cliente sigue sin aclarar,
//    se le dice que se queda al pendiente y ya no se insiste. Si el
//    mensaje es la respuesta de un proveedor (precio o disponibilidad,
//    p. ej. "SI TENGO 2921.24 MAS IVA"), el bot no contesta nada: esa
//    respuesta es para la persona que preguntó. Si el mensaje responde
//    a uno que mandó una persona del taller (no el bot) y no trae una
//    solicitud clara, tampoco contesta: la persona ya está atendiendo.
//  - Más de lo mismo (2026-11-24, caso Héctor Imconsa): un "buen día sí
//    claro", un "mande" o un "?" tampoco son solicitudes: son respuestas
//    a algo que preguntó una persona. El bot se queda callado, salvo que
//    esté esperando una respuesta a su propia pregunta. Si le dicen que
//    se equivocó de número, se disculpa y cierra la conversación.
//  - Avisos e información (2026-11-28, casos Héctor Imconsa y David
//    Avalos): un aviso no es una solicitud. Si el mensaje avisa algo
//    (un cambio de precio, un cierre, un calendario) y no pide nada, el
//    bot no contesta nada: esa información es para las personas del
//    taller. Igual para los temas de oficina: la palabra sola ("factura",
//    "pagos") no es una solicitud; hace falta que la pidan.
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
  const tFlat = t.replace(/[^a-z0-9]/g, ''); // para códigos con espacio: "TM 65" = "TM65"
  const hits = [];
  for (const item of kb.items) {
    // Las secciones del catálogo (p. ej. el título general) no son una
    // refacción: nunca se usan como la pieza que pidió el cliente.
    if (item.seccion) continue;
    const hay = norm([item.titulo, item.detalle, (item.sinonimos || []).join(' '), (item.codigos || []).join(' ')].join(' '));
    // Código exacto (p. ej. 007-00161-000, T95177AY, 023Z0264, TM65/TM 65)
    for (const c of (item.codigos || [])) {
      if (c && (t.includes(norm(c)) || tFlat.includes(norm(c).replace(/[^a-z0-9]/g, '')))) { hits.push({ item, score: 100, via: 'codigo:' + c }); break; }
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
  // Válvula de expansión: la variante depende del equipo (revisado 2026-11-12).
  // TGE 450 es SOLO para CC450; para CC355 son la de oring y la flange/flare.
  if (/\bvalvula de expansion\b/.test(t)) {
    if (t.includes('355')) {
      if (t.includes('oring') || t.includes('toex')) return null; // ya se resolvió por código/sinónimo
      return '¿Es la válvula de oring (Resideo TOEX-E0647) o la Spheros flange (012-00052-000)?';
    }
    if (t.includes('450') || t.includes('tge') || t.includes('067n7161')) return null; // TGE, solo CC450
    if (t.includes('oring') || t.includes('flange') || t.includes('flare')) return null;
    return '¿Para qué equipo es la válvula: CC450 (Danfoss TGE) o CC355 (oring o flange)?';
  }
  // Ventilador genérico: preguntar de condensador o de evaporador.
  if (/\bventilador\b/.test(t) && !t.includes('condensador') && !t.includes('evaporador') && !t.includes('ciroco')) {
    return '¿Es el ventilador del condensador o el del evaporador?';
  }
  // Embrague: primero para qué compresor es.
  if (/\bembrague\b/.test(t) && !/tm ?65|tm ?16|tm ?21|tm ?31|bock|bitzer|valeo/.test(t)) {
    return '¿Para qué compresor es el embrague? TM65, TM16, TM21, TM31, Bock, Bitzer o Valeo.';
  }
  return null;
}

function detectEquipo(text) {
  const t = norm(text);
  // Mapeos confirmados por el usuario (revisados 2026-11-12):
  // SBU410 (SCB-410) -> CC450; control 163 (GL-W163) -> CC355;
  // sensor azul -> CC450; chicote o canasta -> CC355.
  if (/sbu ?410|scb[- ]?410/.test(t)) return 'Spheros CC450';
  if (/control 163|163/.test(t) && /control/.test(t)) return 'Spheros CC355';
  if (t.includes('sensor azul')) return 'Spheros CC450';
  if (t.includes('chicote') || t.includes('canasta')) return 'Spheros CC355';
  if (t.includes('cc450') || t.includes('cc 450')) return 'Spheros CC450';
  if (t.includes('cc355') || t.includes('cc 355')) return 'Spheros CC355';
  if (t.includes('cc300') || t.includes('cc 300')) return 'Globus CC300';
  if (t.includes('eberspacher') || t.includes('ebersp')) return 'Eberspächer';
  if (t.includes('valeo')) return 'Valeo';
  if (t.includes('spheros')) return 'Spheros';
  return null;
}

// Señales de que el mensaje PIDE algo al taller (no solo lo menciona).
// Se prueban contra el texto normalizado (sin acentos). La lista FUERTE
// es para no callar un aviso que además trae un pedido; la AMPLIA
// (fuerte + preguntas y palabras sueltas) es para los temas de oficina.
const REQ_STRONG_WORDS = ['necesito', 'solicito', 'quiero', 'ocupo', 'busco', 'me puedes', 'me puede', 'me pueden', 'por favor', 'favor de', 'me mandas', 'me mandan', 'me envias', 'me envian', 'me pasas', 'me falta', 'me facturas', 'me dices', 'me dice', 'me ayudas', 'me urge', 'se puede', 'podrian', 'podria', 'tengo una duda', 'tengo una garantia', 'tengo un pago', 'facturar', 'reimprimir', 'correccion', 'corregir', 'cuanto debo', 'saldo', 'comprobante', 'abono', 'rastreo', 'seguimiento', 'ya pague', 'hice el pago', 'te transfiero', 'pago pendiente', 'falla', 'fallo', 'danado', 'descompuesto', 'no funciona', 'se descompuso', 'no enfria', 'dejo de'];
const REQ_EXTRA_WORDS = ['cuando', 'donde', 'cuanto', 'nueva', 'nuevo', 'folio', 'me das', 'cuesta', 'vale', 'duda', 'problema'];
const REQUEST_STRONG = new RegExp('\\b(' + REQ_STRONG_WORDS.join('|') + ')\\b');
const REQUEST_BROAD = new RegExp('\\b(' + REQ_STRONG_WORDS.concat(REQ_EXTRA_WORDS).join('|') + ')\\b');

// Un aviso o información (no una solicitud): el que escribe está avisando
// algo al taller (un cambio de precio, un cierre, un calendario), no
// pidiendo nada. El bot no contesta nada: esa información es para las
// personas del taller. Una oferta nueva ("les ofrezco...") NO es esto: sí
// se canaliza. Una pregunta (¿?) o un pedido claro tampoco es esto.
function isAnnouncement(text) {
  const t = norm(text);
  if (!t || text.includes('?')) return false;
  // "Quiero avisar..." es avisar, no pedir: se quita antes de buscar
  // señales de pedido.
  const t2 = t.replace(/quiero avisar(les)?/g, '');
  if (REQUEST_STRONG.test(t2)) return false;
  if (/\b(para comentarle|para comentarles|les comento|les aviso|les informo|voy avisando|quiero avisar(les)?|para avisar(les)?|te aviso|para informarle|para informar(les)?|para que sepan|les comparto|cierre de operaciones|regreso a operaciones|ultimo dia de|inventario general|posada|aviso que|informo que|comento que|subira de precio|sube de precio|se respeta)\b/.test(t)) return true;
  if (/1\)/.test(t) && /2\)/.test(t) && /\b\d{1,2}\/\d{1,2}\b/.test(t)) return true;
  // "El precio es 5000": precio con un número, sin pedir nada. No aplica
  // si se pide el precio de una pieza ("precio del compresor TM65", donde
  // el número es parte del código).
  if (t.includes('precio') && /\b\d[\d,]*(?:\.\d+)?\b/.test(t) && !/\b(precio del?|cuanto cuesta|cuanto vale|que cuesta|cuanto sale|en cuanto|cuanto es|me das precio|cotiz)\b/.test(t)) return true;
  return false;
}

// Pedido claro para los temas de oficina (factura, garantía, guía, pago):
// la palabra sola no basta. Un aviso informativo ("último día de
// recepción de facturas", "último día de pagos") no es una solicitud; un
// pedido ("necesito la factura", "¿cuánto debo?") sí. Un mensaje corto
// que es básicamente el tema ("factura", "la guía") también se toma
// como solicitud.
function isAdminRequest(text, kind) {
  const t = norm(text);
  const kw = {
    factura: /\bfactur/,
    garantia: /\bgarant/,
    guia: /\b(guia|guias|numero de guia|rastreo|seguimiento de envio)\b/,
    pago: /\b(pago|pagos|pagar|deposito|transferencia|abono|cuanto debo|saldo pendiente)\b/,
  }[kind];
  if (!kw || !kw.test(t)) return false;
  if (text.includes('?')) return true;
  if (REQUEST_BROAD.test(t)) return true;
  if (t.split(' ').filter(Boolean).length <= 2) return true;
  return false;
}

function detectIntent(text) {
  const t = norm(text);
  if (/\b(ya quedo|ya quedó|quedo mi|quedó mi|estatus|estado de|como va|cuando queda|cuándo queda|mi unidad|mi camion|mi camión|esta lista|está lista|esta listo|está listo)\b/.test(t)) return 'estatus';
  if (/\b(proveedor|ofrezco|les ofrezco|les vendo|vendo|tengo para vender|distribuidor|soy proveedor)\b/.test(t)) return 'proveedor';
  if (isAdminRequest(text, 'factura')) return 'factura';
  if (isAdminRequest(text, 'garantia')) return 'garantia';
  if (isAdminRequest(text, 'guia')) return 'guia';
  if (isAdminRequest(text, 'pago')) return 'pago';
  if (/\b(servicio|reparacion|reparación|instalar|instalacion|instalación|reparar|no enfria|no enfría|no funciona el clima|falla el clima)\b/.test(t)) return 'servicio';
  return 'refaccion';
}

function asksPrice(text) {
  const t = norm(text);
  // Solo si PIDE un precio ("¿cuánto cuesta?", "precio de..."): un aviso
  // sobre precios ("el gas subirá de precio") no es pedirlo.
  if (/\b(cuanto cuesta|cuanto vale|que cuesta|cuanto sale|en cuanto|cuanto es|me das precio|me puedes dar precio|me pueden dar precio|precio del?|cotiz|cuanto me sale)\b/.test(t)) return true;
  return t.includes('precio') && text.includes('?');
}

function isFarewell(text) {
  return /^(gracias|muchas gracias|es todo|eso es todo|ok|va|perfecto|sale|enterado|de acuerdo)\b/.test(norm(text));
}

function isGreeting(text) {
  return /^(hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|que tal|qué tal)\b/.test(norm(text));
}

// Respuesta de un proveedor a una pregunta que hizo una persona del
// taller (precio o disponibilidad, p. ej. "SI TENGO 2921.24 MAS IVA"):
// el bot no contesta nada, esa respuesta ya la ve la persona que
// preguntó. Una oferta nueva ("les ofrezco...") NO es esto: sí se canaliza.
function isSupplierAnswer(text) {
  const t = norm(text);
  if (/\b(ofrezco|les ofrezco|vendo|les vendo|distribuidor|soy proveedor|tengo para vender)\b/.test(t)) return false;
  if (/\bmas iva\b/.test(t)) return true;
  if (/\$\s?\d/.test(t)) return true;
  if (/\d[\d,]*\.\d{2}\b/.test(t)) return true;
  // "tengo 50 piezas": un número suelto (no pegado a un código como CC450).
  if (/\b(si tengo|tengo|hay|cuenta con)\b/.test(t) && /\b\d{2,}\b/.test(t)) return true;
  return false;
}

// ¿El mensaje trae una solicitud clara? Un saludo, un "gracias" o un
// "ok" no la trae; un equipo, una pieza, un código o un intent distinto
// de refacción sí.
function hasSubstance(text) {
  if (!text) return false;
  if (detectIntent(text) !== 'refaccion') return true;
  if (findKb(text).length) return true;
  if (findProduct(text)) return true;
  if (/\d{3,}/.test(text)) return true;
  if (norm(text).split(' ').filter(Boolean).length > 4) return true;
  return false;
}

// Un "sí claro", "mande", "ok" o un "?" no es una solicitud: es la
// respuesta a algo que preguntó una persona del taller. Un saludo solo
// ("hola", "buen día") NO es esto: eso se contesta con un saludo corto.
function isAck(text) {
  const t = norm(text);
  if (!t) return true; // solo puntuación o emoji
  if (/^(buen dia|buenos dias|buenas tardes|buenas noches)\s+(si|claro)\b/.test(t)) return true;
  const words = t.split(' ').filter(Boolean);
  if (words.length > 3) return false;
  return /^(si|sí|si claro|sí claro|claro|claro que si|ok|va|sale|mande|digame|dígame|enterado|de acuerdo|perfecto|gracias|muchas gracias|con gusto|a sus ordenes|correcto|asi es)\b/.test(t);
}

// --- Estado de conversación ----------------------------------------------
// fields: { nombre, empresa, ruta, numeroUnidad, chasis, equipo, refaccion,
//           falla, tipo, foto (mediaId), producto }
// intent: refaccion | estatus | servicio | proveedor | factura | garantia | guia | pago
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
    // Al reabrir, se conservan el nombre (número ya registrado) y nada más.
    const nombreRegistrado = conv.fields.nombre;
    conv.cerrada = false; conv.cerradaAt = null; conv.intent = null; conv.fields = {};
    if (nombreRegistrado) conv.fields.nombre = nombreRegistrado;
  }
  if (!text && !hasPhoto) return { reply: null, solicitud: null, close: false };

  // Fluido, no robótico: si el mensaje es la respuesta de un proveedor
  // (precio/disponibilidad), no contestar: es para quien preguntó.
  if (text && isSupplierAnswer(text)) return { reply: null, solicitud: null, close: false };
  // Si le dicen que se equivocó de número, disculparse y cerrar: no insistir.
  if (text && /\b(se equivoco|te equivocaste|numero equivocado|número equivocado|no es (aquí|aqui|este numero|este número))\b/.test(norm(text))) {
    conv.cerrada = true; conv.cerradaAt = new Date().toISOString();
    return { reply: 'Disculpe, tiene razón, me equivoqué. Quedo al pendiente.', solicitud: null, close: true };
  }
  // Si el mensaje responde a uno que mandó una persona del taller (no el
  // bot) y no trae una solicitud clara, no interrumpir: esa persona ya
  // está atendiendo la conversación.
  if (text && msg.replyToHuman && !hasSubstance(text)) return { reply: null, solicitud: null, close: false };

  const intentAntes = conv.intent;
  if (!conv.intent) conv.intent = detectIntent(text);
  const f = conv.fields;
  // Si la conversación empezó con un saludo, el intent quedó en
  // 'refaccion'; si el siguiente mensaje es claramente de otro tema
  // (factura, garantía, guía, pago, estatus, servicio, proveedor),
  // cambiar al intent correcto. No se cambia mientras haya una pregunta
  // de desambiguación pendiente.
  if (conv.intent === 'refaccion' && !f._pendiente) {
    const ni = detectIntent(text);
    if (ni !== 'refaccion') conv.intent = ni;
  }
  // true cuando el intent se detectó en este mismo mensaje: solo entonces
  // se toman los datos que el cliente ya dio en ese mensaje; en las
  // respuestas siguientes solo se toman las respuestas a las preguntas.
  const intentNuevo = conv.intent !== intentAntes;
  // Un "sí claro", "mande", "buen día" con afirmación o un "?" no es una
  // solicitud: es la respuesta a algo que preguntó una persona. No
  // contestar, salvo que el bot esté esperando una respuesta a su
  // propia pregunta.
  const esperaRespuesta = f._pendiente || f._pideNombre || f._pideEmpresa || f._pideNecesidad || f._pideDetalle || f._pideRefaccion;
  // Un aviso o información (cambio de precio, cierre, calendario): es
  // para las personas del taller, no una solicitud al bot. Silencio,
  // salvo que el bot esté esperando una respuesta a su propia pregunta
  // o que el mensaje traiga una foto (una foto es de la pieza o unidad).
  if (text && !hasPhoto && !esperaRespuesta && isAnnouncement(text)) return { reply: null, solicitud: null, close: false };
  if (text && !esperaRespuesta && isAck(text)) return { reply: null, solicitud: null, close: false };

  // Guardar lo que el cliente pidió con sus propias palabras (p. ej.
  // "sello para tm65"): es lo que debe llegar en el aviso a almacén, no el
  // título genérico de la sección del catálogo.
  if (conv.intent === 'refaccion' && text && !f.pedido) {
    f.pedido = text.replace(/^(hola|buenas tardes|buenas noches|buenos d[ií]as|qu[eé] tal|buenas)[,\s]*/i, '').trim().slice(0, 120);
  }

  // Foto: es foto de la pieza (refacción) o de la unidad (estatus/servicio)
  if (hasPhoto) {
    f.foto = msg.imageId;
    if (conv.intent === 'refaccion' && !f.refaccion) f.refaccion = 'foto de la pieza';
  }

  // Si se le pidió el nombre (número no registrado) y el cliente contestó,
  // esa respuesta es su nombre, aunque venga sin "soy / me llamo".
  if (f._pideNombre && text) {
    const t = text.replace(/^(soy|me llamo|mi nombre es|es)\s+/i, '').trim();
    if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,3}$/.test(t) && t.length >= 3) {
      f.nombre = t; delete f._pideNombre;
    }
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
    // Válvula: primero el equipo, luego la variante de ese equipo.
    if (f._pendiente === 'valvulaEquipo') {
      if (/450/.test(t)) {
        f.refaccion = 'Válvula de expansión termostática Danfoss TGE — expansión 450 (067N7161)';
        f.equipo = 'Spheros CC450'; delete f._pendiente;
      } else if (/355/.test(t)) {
        f.equipo = 'Spheros CC355'; f._pendiente = 'valvula';
        return { reply: '¿Es la válvula de oring (Resideo TOEX-E0647) o la Spheros flange (012-00052-000)?', solicitud: null, close: false };
      }
    }
    // Embrague: una vez definido el compresor, preguntar el tipo.
    if (f._pendiente === 'embragueCompresor') {
      const comp = (t.match(/tm ?65|tm ?16|tm ?21|tm ?31|bock|bitzer|valeo/) || [])[0] || '';
      const compName = { 'tm65': 'TM65', 'tm 65': 'TM65', 'tm16': 'TM16', 'tm 16': 'TM16', 'tm21': 'TM21', 'tm 21': 'TM21', 'tm31': 'TM31', 'tm 31': 'TM31', 'bock': 'Bock', 'bitzer': 'Bitzer', 'valeo': 'Valeo' }[comp] || comp.toUpperCase();
      if (compName) {
        f.refaccion = 'Embrague para compresor ' + compName;
        f._pendiente = 'embragueTipo';
        return { reply: '¿El embrague es con bobina? ¿La polea es 2A o 2B?', solicitud: null, close: false };
      }
    }
    if (f._pendiente === 'embragueTipo') {
      const add = [];
      if (/sin bobina/.test(t)) add.push('sin bobina');
      else if (/bobina/.test(t)) add.push('con bobina');
      if (/2a\b/.test(t)) add.push('polea 2A');
      if (/2b\b/.test(t)) add.push('polea 2B');
      if (add.length) f.refaccion = (f.refaccion || 'Embrague') + ' ' + add.join(', ');
      delete f._pendiente;
    }
    const P = {
      presostato: [[/baja|azul/, 'Protección baja — presostato de baja presión (cable AZUL)'], [/alta|negro/, 'Protección alta — presostato de alta presión (cable NEGRO)']],
      sensor: [[/canasta/, 'Sensor canasta / sensor azul / chicote (sensor de temperatura) — canasta'], [/azul/, 'Sensor canasta / sensor azul / chicote (sensor de temperatura) — azul'], [/chicote/, 'Sensor canasta / sensor azul / chicote (sensor de temperatura) — chicote']],
      filtro: [[/flare/, null], [/oring/, null]],
      serpentin: [[/derecho/, 'Serpentín CC355 — derecho'], [/izquierdo/, 'Serpentín CC355 — izquierdo']],
      fusible: [[/portafusible/, 'Portafusible 175'], [/^fusible|el fusible|mega/, 'Fusible MEGA 175A']],
      bock: [[/655/, 'Compresor Bock 655 (FKX40/655K)'], [/755/, 'Compresor Bock 755 (FKX40/755K)']],
      bosch150: [[/3 agarres|tres agarres/, 'Alternador Bosch 150 de 3 agarres'], [/2 agarres|dos agarres/, 'Alternador Bosch 150 de 2 agarres']],
      condensador: [[/ventilador|motor|abanico/, 'Ventilador / motor de condensador Spheros Valeo (111150818)'], [/serpentin|serpentín/, 'Serpentín del condensador']],
      valvula: [[/flange|flare/, 'Válvula de expansión Spheros flange — Honeywell TBEX-E0475 (012-00052-000)'], [/oring/, 'Válvula de expansión oring 355 — Resideo / Honeywell (TOEX-E0647)'], [/tge|450/, 'Válvula de expansión termostática Danfoss TGE — expansión 450 (067N7161)'], [/355/, 'Válvula de expansión oring 355 — Resideo / Honeywell (TOEX-E0647)'], [/^si\b|sí|esa|correcto/, 'Válvula de expansión oring 355 — Resideo / Honeywell (TOEX-E0647)']],
      ventilador2: [[/condensador/, 'Ventilador / motor de condensador Spheros Valeo (111150818)'], [/evaporador/, 'Ventilador / motor de evaporador Spheros Valeo — ciroco (111151028)']],
    };
    const opts = P[f._pendiente] || [];
    for (const [re, titulo] of opts) {
      if (re.test(t)) {
        if (titulo) f.refaccion = titulo;
        // Sensor: la variante define el equipo (azul -> CC450; canasta/chicote -> CC355).
        if (f._pendiente === 'sensor') {
          f.equipo = /azul/.test(re.source) ? 'Spheros CC450' : 'Spheros CC355';
        }
        else if (f._pendiente === 'filtro') f.refaccion = (f._filtroBase || 'Filtro deshidratador Danfoss') + ' ' + (t.includes('flare') ? 'flare' : 'oring');
        delete f._pendiente; delete f._filtroBase;
        break;
      }
    }
  }

  // Embrague con el compresor ya dicho en el mismo mensaje: preguntar el tipo.
  if (conv.intent === 'refaccion' && !f._pendiente && /embrague/.test(norm(text))) {
    const comp = (norm(text).match(/tm ?65|tm ?16|tm ?21|tm ?31|bock|bitzer|valeo/) || [])[0] || '';
    const compName = { 'tm65': 'TM65', 'tm 65': 'TM65', 'tm16': 'TM16', 'tm 16': 'TM16', 'tm21': 'TM21', 'tm 21': 'TM21', 'tm31': 'TM31', 'tm 31': 'TM31', 'bock': 'Bock', 'bitzer': 'Bitzer', 'valeo': 'Valeo' }[comp] || '';
    if (compName) {
      f.refaccion = 'Embrague para compresor ' + compName;
      f._pendiente = 'embragueTipo';
      return { reply: '¿El embrague es con bobina? ¿La polea es 2A o 2B?', solicitud: null, close: false };
    }
  }

  // --- Proveedor: qué ofrece, disponibilidad; nunca comprometerse a comprar
  if (conv.intent === 'proveedor') {
    if (!f.refaccion && text) f.refaccion = text.slice(0, 200);
    if (!f.refaccion) return { reply: 'Hola, ¿qué nos ofrece y con qué disponibilidad? Con gusto tomo sus datos y una persona de almacén lo atenderá a la brevedad.', solicitud: null, close: false };
    const sol = buildSolicitud(conv, 'proveedor', 'Proveedor ofrece: ' + (f.refaccion || ''));
    return fin(conv, { reply: CANALIZAR_MSG, solicitud: sol, close: true });
  }

  // --- Factura (oficina): nombre, empresa y qué necesitan de la factura.
  // La atiende Francisco (oficina); nunca se da ni se promete un monto.
  if (conv.intent === 'factura') {
    if (f._pideEmpresa && text) {
      const e = text.replace(/^(la empresa es|es|de|para)\s+/i, '').trim();
      if (e.length >= 2) { f.empresa = e.slice(0, 60); delete f._pideEmpresa; }
    }
    if (f._pideNecesidad && text) {
      f.facturaNecesidad = text.trim().slice(0, 120); delete f._pideNecesidad;
    }
    // Qué necesitan y empresa, si ya lo dijeron en el mensaje que abrió
    // el tema (o al contestar el nombre con algo más que el nombre).
    if (!f.facturaNecesidad && text && (intentNuevo || f._pideNombre) && /\b(mandar|manden|enviar|envien|reenviar|reenvien|correccion|corregir|nueva|nuevo|folio|reimprimir)\b/.test(norm(text))) {
      f.facturaNecesidad = text.replace(/^(hola|buenas tardes|buenas noches|buenos d[ií]as|qué tal|que tal|buenas)[,\s]*/i, '').trim().slice(0, 120);
    }
    if (!f.empresa && text && (intentNuevo || f._pideNombre)) {
      const m = text.match(/empresa[:\s]+([A-Za-z0-9 .&\-]{2,60})/i);
      if (m) f.empresa = m[1].trim();
    }
    if (!f.nombre) { f._pideNombre = true; return { reply: 'Claro, ¿me dice su nombre para registrar la solicitud de la factura?', solicitud: null, close: false }; }
    if (!f.empresa) { f._pideEmpresa = true; return { reply: 'Gracias, ' + f.nombre + '. ¿De qué empresa es la factura?', solicitud: null, close: false }; }
    if (!f.facturaNecesidad) { f._pideNecesidad = true; return { reply: '¿Qué necesita de la factura: que se la manden, una corrección o una factura nueva?', solicitud: null, close: false }; }
    const sol = buildSolicitud(conv, 'factura', 'Factura (oficina): ' + f.nombre + ' — ' + f.empresa + ' — ' + f.facturaNecesidad, { atiende: 'Francisco', para: ['6671181767'] });
    return fin(conv, { reply: CANALIZAR_MSG, solicitud: sol, close: true });
  }

  // --- Guía o pago: se canaliza para Héctor (office boy). Solo se toman
  // los datos; nunca se promete fecha de entrega ni monto.
  if (conv.intent === 'guia' || conv.intent === 'pago') {
    const esGuia = conv.intent === 'guia';
    if (f._pideDetalle && text) {
      f.detalle = text.trim().slice(0, 140); delete f._pideDetalle;
    }
    // Detalle si ya lo dijeron en el mensaje que abrió el tema (o al
    // contestar el nombre con algo más que el nombre).
    if (!f.detalle && text && (intentNuevo || f._pideNombre)) {
      const limpio = norm(text).replace(/^(hola|buenas tardes|buenas noches|buenos dias|que tal|buenas)\s*/, '').replace(/\b(guia|guias|pago|pagos)\b/g, '').replace(/\s+/g, ' ').trim();
      if (limpio.split(' ').filter(Boolean).length >= 2) f.detalle = text.replace(/^(hola|buenas tardes|buenas noches|buenos d[ií]as|qué tal|que tal|buenas)[,\s]*/i, '').trim().slice(0, 140);
    }
    if (!f.nombre) { f._pideNombre = true; return { reply: 'Claro, ¿me dice su nombre para registrarlo?', solicitud: null, close: false }; }
    if (!f.detalle) {
      f._pideDetalle = true;
      return { reply: esGuia ? '¿De qué guía es? Dígame el número de guía o qué se envió y para quién.' : '¿De qué pago es? Dígame el monto o el folio, o para qué es el pago.', solicitud: null, close: false };
    }
    const sol = buildSolicitud(conv, esGuia ? 'guia' : 'pago', (esGuia ? 'Guía (para Héctor): ' : 'Pago (para Héctor): ') + f.nombre + ' — ' + f.detalle, { atiende: 'Héctor', para: ['6671181767'] });
    return fin(conv, { reply: CANALIZAR_MSG, solicitud: sol, close: true });
  }

  // --- Garantía: equipo, pieza, cuándo se instaló y qué falla. La
  // atiende Manuel primero, como las demás solicitudes. Nunca se promete
  // que la garantía procede ni un plazo.
  if (conv.intent === 'garantia') {
    if (f._pideRefaccion && text) {
      if (!f.refaccion) f.refaccion = text.trim().slice(0, 120);
      delete f._pideRefaccion;
    }
    if (f._pideDetalle && text) {
      f.detalle = text.trim().slice(0, 140); delete f._pideDetalle;
    }
    // Detalle si ya lo dijeron en el mensaje que abrió el tema (o al
    // contestar el nombre con algo más que el nombre).
    if (!f.detalle && text && (intentNuevo || f._pideNombre) && /\b(instal|fall|no enfria|dejo de|dejó de|ya no|se descompuso|se dano|se daño)\b/.test(norm(text))) {
      f.detalle = text.replace(/^(hola|buenas tardes|buenas noches|buenos d[ií]as|qué tal|que tal|buenas)[,\s]*/i, '').trim().slice(0, 140);
    }
    if (!f.equipo) return { reply: 'Claro, ¿para qué equipo es la garantía? Valeo, Spheros CC450, CC355 o Eberspächer, o mándeme una foto.', solicitud: null, close: false };
    if (!f.refaccion) { f._pideRefaccion = true; return { reply: '¿Qué pieza es la de la garantía?', solicitud: null, close: false }; }
    if (!f.nombre) { f._pideNombre = true; return { reply: '¿Me dice su nombre para registrar la garantía?', solicitud: null, close: false }; }
    if (!f.detalle) { f._pideDetalle = true; return { reply: '¿Cuándo se instaló la pieza y qué falla presenta?', solicitud: null, close: false }; }
    const sol = buildSolicitud(conv, 'garantia', 'Garantía: ' + f.nombre + ' — ' + f.equipo + ' — ' + f.refaccion + ' — ' + f.detalle, { atiende: 'Manuel' });
    return fin(conv, { reply: CANALIZAR_MSG, solicitud: sol, close: true });
  }

  // --- Estatus: pedir localizadores (nunca placa) y contestar por la nota
  if (conv.intent === 'estatus') {
    if (!f.nombre) { f._pideNombre = true; return { reply: 'Claro, ¿me dice su nombre y la empresa, ruta, número de camión o chasis de la unidad para localizarla?', solicitud: null, close: false }; }
    if (!f.empresa && !f.ruta && !f.numeroUnidad && !f.chasis) {
      return { reply: 'Gracias, ' + f.nombre + '. ¿Me pasa la empresa, la ruta, el número de camión o el chasis de la unidad?', solicitud: null, close: false };
    }
    return { reply: null, solicitud: null, close: false, action: 'lookup_status', fields: f };
  }

  // --- Servicio / reparación / instalación
  if (conv.intent === 'servicio') {
    if (!f.equipo) return { reply: 'Claro, ¿para qué equipo es? Valeo, Spheros CC450, CC355 o Eberspächer, o si gusta mándeme una foto.', solicitud: null, close: false };
    if (!f.nombre) { f._pideNombre = true; return { reply: '¿Me dice su nombre para registrar la solicitud de servicio para el ' + f.equipo + '?', solicitud: null, close: false }; }
    const sol = buildSolicitud(conv, 'servicio', (f.nombre ? f.nombre + ' — servicio para ' : 'Servicio para ') + f.equipo + (f.falla ? ': ' + f.falla : ''));
    return fin(conv, { reply: CANALIZAR_MSG, solicitud: sol, close: true });
  }

  // --- Refacción (flujo principal)
  if (asksPrice(text)) {
    // No se da precio; se sigue tomando la solicitud.
    if (!f.equipo && !f.refaccion) return { reply: SIN_PRECIO_MSG + ' ¿Qué pieza es? Me dice el equipo y el código, o me manda una foto.', solicitud: null, close: false };
  }
  const amb = ambiguousQuestion(text);
  if (amb && !f.refaccion) return askAmb(conv, amb, text);
  if (amb && f.refaccion && /^(¿Es|¿Cuál|¿Necesitas|¿Para)/.test(amb)) {
    // La pregunta de equipo para la válvula aplica aunque ya haya pieza:
    // la variante depende del equipo.
    if (amb.startsWith('¿Para qué equipo es la válvula')) return askAmb(conv, amb, text);
    // La pieza ya se reconoció por código, pero la variante sigue ambigua:
    // preguntar solo si la variante no quedó clara en el texto.
    if (!/baja|alta|azul|negro|flare|oring|derecho|izquierdo|655|755|3 agarres|2 agarres|ventilador|serpentín|serpentin|portafusible/.test(norm(text))) {
      return askAmb(conv, amb, text);
    }
  }
  if (!f.refaccion && !hasPhoto) {
    // Un saludo se contesta con un saludo corto, nunca con el cuestionario.
    if (isGreeting(text)) return { reply: 'Hola, ¿en qué le ayudo?', solicitud: null, close: false };
    // La pregunta por la pieza no se repite igual: dos variantes y luego
    // se deja de insistir (la persona de almacén puede tomar la charla).
    const n = f._preguntoPieza || 0;
    f._preguntoPieza = n + 1;
    if (n === 0) return { reply: '¿Qué pieza busca? Me dice el equipo y el código, o me manda una foto de la pieza.', solicitud: null, close: false };
    if (n === 1) return { reply: '¿Me manda una foto de la pieza o me dice el código que trae?', solicitud: null, close: false };
    if (n === 2) return { reply: 'Quedo al pendiente, en cuanto me diga la pieza o me mande una foto le tomo la solicitud.', solicitud: null, close: false };
    return { reply: null, solicitud: null, close: false };
  }
  // Foto sin datos de la pieza: ahí sí se pregunta el equipo.
  if (f.refaccion === 'foto de la pieza' && !f.equipo) {
    return { reply: 'Ya tengo la foto, ¿para qué equipo es la pieza?', solicitud: null, close: false };
  }
  // Número no registrado (sin nombre): pedir el nombre del cliente antes
  // de canalizar, para que la solicitud llegue con quién la pide.
  // Se repite lo que el cliente pidió con sus palabras, nunca el título
  // genérico de una sección del catálogo.
  if (!f.nombre) {
    f._pideNombre = true;
    // Si preguntó precio, no se le repite su pregunta: se nombra la pieza.
    // Para el embrague se nombra el tipo ya definido, no el pedido genérico.
    const que = asksPrice(text) ? (f.refaccion || 'la refacción') : ((f.refaccion && /embrague/i.test(f.refaccion)) ? f.refaccion : (f.pedido || f.refaccion || 'la refacción'));
    return { reply: 'Claro, con gusto tomo su solicitud de ' + que + (f.equipo ? ' para ' + f.equipo : '') + '. ¿Me dice su nombre para registrarla?', solicitud: null, close: false };
  }
  // Regla del usuario 2026-11-12: si la refacción ya quedó clara (nombre o
  // código reconocido, p. ej. compresor TM65), NO se pide el equipo: se
  // canaliza directo. El equipo solo se pregunta cuando el cliente no sabe
  // el número de parte ni los datos de la refacción (p. ej. solo manda foto).
  // Resumen para el aviso: lo que pidió el cliente con sus palabras, más
  // el código/variante que se resolvió (p. ej. TOEX-E0647) si no venía ahí.
  let detalle = (f.refaccion && /embrague/i.test(f.refaccion)) ? f.refaccion : (f.pedido || f.refaccion || 'refacción');
  const cod = (f.refaccion || '').match(/\(([^)]+)\)/);
  if (cod && detalle && !detalle.toLowerCase().includes(cod[1].toLowerCase().split(' / ')[0])) detalle += ' (' + cod[1] + ')';
  const resumen = (f.nombre ? f.nombre + ' busca ' : 'Cliente busca ') + detalle + (f.equipo ? ' para ' + f.equipo : '');
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
  else if (pregunta.includes('¿Para qué equipo es la válvula')) kind = 'valvulaEquipo';
  else if (pregunta.includes('¿Para qué compresor es el embrague')) kind = 'embragueCompresor';
  else if (pregunta.includes('¿El embrague es con bobina')) kind = 'embragueTipo';
  else if (pregunta.includes('válvula de oring')) kind = 'valvula';
  else if (pregunta.includes('válvula de expansión')) kind = 'valvula';
  else if (pregunta.includes('ventilador del condensador')) kind = 'ventilador2';
  if (kind) conv.fields._pendiente = kind;
  return { reply: pregunta, solicitud: null, close: false };
}

function buildSolicitud(conv, tipo, resumen, opts) {
  const o = opts || {};
  return {
    id: 'SOL-' + Date.now().toString(36).toUpperCase(),
    waId: conv.waId,
    tipo,
    resumen,
    // Quién atiende la solicitud: 'Manuel' (refacción, servicio, estatus,
    // proveedor y garantía), 'Francisco' (factura, oficina) o 'Héctor'
    // (guía o pago). Luna lo usa para el aviso.
    atiende: o.atiende || 'Manuel',
    fields: { ...conv.fields },
    estado: 'nueva',
    creadaAt: new Date().toISOString(),
    tomadaAt: null, tomadaPor: null, atendidaAt: null, atendidaPor: null,
    // Aviso a Francisco y Manuel: SIN método de pago Meta no permite
    // mandarles un mensaje de WhatsApp iniciado por el bot (eso sería una
    // plantilla, de pago). La solicitud queda en la bandeja (/inbox) y en
    // el registro, para que Luna la avise por el canal habitual.
    aviso: { via: 'bandeja', estado: 'pendiente', para: o.para || ['6671181767', '6674603088'] },
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
