// test-bot.js — Pruebas de la lógica del bot (sin red, sin token de Meta).
// Uso: node test-bot.js
'use strict';
const bot = require('./bot');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FALLA ' + name + (extra ? ' — ' + extra : '')); }
}
function conv() { return bot.newConversation('5216670000000'); }
function say(c, text, imageId) { return bot.handleMessage(c, { text, imageId: imageId || null }); }
const NO_PRICE = (s) => s && !/\$\s?\d|precio|costo|cuesta|vale\s+\$/.test(s.toLowerCase());
const NO_PLACA = (s) => s && !/placa/i.test(s);
const NO_NAMES = (s) => s && !/francisco|manuel/i.test(s);

// 1. Refacción completa CC450 -> canaliza, sin precio, sin placa, sin nombres
let c = conv();
let r = say(c, 'Hola, necesito un compresor para un Spheros CC450');
check('refacción sin nombre pide el nombre', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'Juan Pérez');
check('refacción pide equipo ya dado -> canaliza', !!r.solicitud && r.close, JSON.stringify(r));
check('mensaje de canalización sin nombres', NO_NAMES(r.reply), r.reply);
check('mensaje de canalización sin precio', NO_PRICE(r.reply), r.reply);
check('mensaje de canalización sin placa', NO_PLACA(r.reply), r.reply);
check('solicitud guarda equipo y refacción', r.solicitud && r.solicitud.fields.equipo === 'Spheros CC450', JSON.stringify(r.solicitud && r.solicitud.fields));

// 2. Pregunta de precio -> no da precio, sigue tomando la solicitud
c = conv();
r = say(c, '¿Cuánto cuesta el compresor TM65?');
check('pregunta de precio no da precio', NO_PRICE(r.reply), r.reply);
check('pregunta de precio no pide placa', NO_PLACA(r.reply || ''), r.reply);

// 3. Presostato ambiguo -> pregunta baja/alta
c = conv();
r = say(c, 'Necesito un presostato');
check('presostato ambiguo pregunta baja/alta', r.reply && r.reply.includes('BAJA') && r.reply.includes('ALTA'), r.reply);
r = say(c, 'el de baja, cable azul');
check('presostato baja pide nombre (número no registrado)', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'soy Juan Pérez');
check('presostato baja ya clara canaliza directo sin pedir equipo', !!r.solicitud && r.close, JSON.stringify(r));

// 4. Código solo -> reconoce TM65 y canaliza directo sin pedir equipo
c = conv();
r = say(c, 'T95177AY');
check('código T95177AY pide nombre (número no registrado)', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'María López');
check('código T95177AY reconocido y canaliza sin pedir equipo', !!r.solicitud && r.close, JSON.stringify(r));

// 4b. Compresor TM65 por nombre -> canaliza directo sin pedir equipo
c = conv();
r = say(c, 'Buenas tardes maneja compresor tm65,');
check('compresor TM65 pide nombre', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'Pedro Gómez');
check('compresor TM65 por nombre canaliza sin pedir equipo', !!r.solicitud && r.close, JSON.stringify(r));

// 5. Filtro 304 ambiguo
c = conv();
r = say(c, 'ocupo un filtro 304 para CC355');
check('filtro 304 ambiguo pregunta flare/oring', r.reply && /flare|oring/i.test(r.reply), r.reply);

// 6. Alternador Bosch 150 ambiguo
c = conv();
r = say(c, 'alternador Bosch 150');
check('Bosch 150 pregunta 3 o 2 agarres', r.reply && /3 agarres|2 agarres/.test(r.reply), r.reply);

// 7. Estatus -> pide localizadores, nunca placa
c = conv();
r = say(c, '¿Ya quedó mi unidad?');
check('estatus pide nombre/localizadores', r.reply && /nombre/i.test(r.reply), r.reply);
check('estatus no pide placa', NO_PLACA(r.reply), r.reply);
r = say(c, 'soy Juan Pérez, empresa Transportes Ruiz, ruta 12, camión 45');
check('estatus con datos pide lookup', r.action === 'lookup_status', JSON.stringify(r));
check('estatus sin nota = sigue en taller', bot.statusReply(null).includes('Sigue en taller'));
check('estatus con nota = ya quedó', bot.statusReply({ nota: { folio: 'F-123' } }).includes('Ya quedó'));

// 8. Proveedor -> no se compromete a comprar
c = conv();
r = say(c, 'Soy proveedor, les ofrezco compresores');
check('proveedor se canaliza sin compromiso de compra', !!r.solicitud && r.close, JSON.stringify(r));

// 9. Conversación cerrada + "gracias" -> no duplica solicitud
c = conv();
say(c, 'compresor TM65 para CC450');
say(c, 'Juan Pérez');
r = say(c, 'muchas gracias, es todo');
check('gracias tras cerrar no crea solicitud', !r.solicitud, JSON.stringify(r));
r = say(c, 'ahora ocupo un filtro 305 flare para CC450');
check('mensaje nuevo tras cerrar reabre y canaliza', !!r.solicitud, JSON.stringify(r));

// 10. Foto -> la toma como foto de la pieza
c = conv();
r = say(c, '', 'media123');
check('foto: pide equipo, no precio', r.reply && /equipo/i.test(r.reply), r.reply);

// 11. Catálogo del taller por código
const p = bot.findProduct('100BXS');
check('producto 100BXS del Excel se encuentra', p && p.product.codigo === '100BXS', JSON.stringify(p));
const p2 = bot.findProduct('banda bx 100 sencilla gates');
check('producto por nombre se encuentra', !!p2, JSON.stringify(p2));

// 12. Nunca pedir placa en ningún flujo
c = conv();
for (const t of ['necesito una refacción', '¿ya quedó mi camión?', 'ocupo un servicio de instalación']) {
  r = say(conv(), t);
  check('flujo "' + t + '" no pide placa', !r.reply || NO_PLACA(r.reply), r.reply);
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
