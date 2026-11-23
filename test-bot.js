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
function say(c, text, imageId, extra) { return bot.handleMessage(c, { text, imageId: imageId || null, ...(extra || {}) }); }
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

// 4c. Sello para TM65 -> llega lo que pidió el cliente, no el catálogo
// (el cliente ya dio su nombre en el mismo mensaje: "soy Francisco")
c = conv();
r = say(c, 'Hola soy Francisco, necesito un sello para tm 65 Valeo');
check('sello para tm65 canaliza con lo pedido, no el catálogo', !!r.solicitud && /sello/i.test(r.solicitud.resumen) && !/Catálogo/i.test(r.solicitud.resumen), JSON.stringify(r.solicitud && r.solicitud.resumen));
check('sello para tm65 no es el título del catálogo', r.solicitud && !/Catálogo Spheros 2025/.test(r.solicitud.fields.refaccion || ''), JSON.stringify(r.solicitud && r.solicitud.fields));
check('sello para tm65 guarda el nombre Francisco', r.solicitud && r.solicitud.fields.nombre === 'Francisco', JSON.stringify(r.solicitud && r.solicitud.fields));

// 4d. Solo "algo de Spheros" no inventa refacción del catálogo
c = conv();
r = say(c, 'Hola, necesito algo de Spheros');
check('mención genérica de Spheros no toma el catálogo como pieza', !r.solicitud || !/Catálogo Spheros 2025/.test(r.solicitud.fields.refaccion || ''), JSON.stringify(r));

// 4e. Válvula de expansión para CC355: solo oring o flange, NUNCA la TGE 450
c = conv();
r = say(c, 'ocupo una válvula de expansión para CC355');
check('válvula CC355 pregunta oring o flange, no TGE', r.reply && /oring/i.test(r.reply) && /flange/i.test(r.reply) && !/TGE/i.test(r.reply), r.reply);
r = say(c, 'la de oring');
check('válvula oring pide nombre', r.reply && /nombre/i.test(r.reply), r.reply);
r = say(c, 'Carlos Ruiz');
check('válvula oring 355 canaliza con lo pedido y su código', !!r.solicitud && /TOEX-E0647/i.test(r.solicitud.resumen) && /oring/i.test(r.solicitud.fields.refaccion || '') && !/Termostatos/i.test(r.solicitud.resumen), JSON.stringify(r.solicitud && r.solicitud.resumen));
check('válvula oring 355 es para CC355', r.solicitud && r.solicitud.fields.equipo === 'Spheros CC355', JSON.stringify(r.solicitud && r.solicitud.fields));

// 4e2. Válvula de expansión para CC450: la TGE, directo
c = conv();
r = say(c, 'ocupo una válvula de expansión para CC450');
check('válvula CC450 resuelve TGE sin preguntar', r.reply && /nombre/i.test(r.reply), r.reply);
r = say(c, 'Ana Torres');
check('válvula TGE 450 canaliza para CC450', !!r.solicitud && /067N7161/.test(r.solicitud.resumen || '') && r.solicitud.fields.equipo === 'Spheros CC450', JSON.stringify(r.solicitud));

// 4e3. Válvula sin equipo: pregunta CC450 o CC355 primero
c = conv();
r = say(c, 'ocupo una válvula de expansión');
check('válvula sin equipo pregunta CC450 o CC355', r.reply && /CC450/.test(r.reply) && /CC355/.test(r.reply), r.reply);
r = say(c, 'para CC355');
check('válvula CC355 tras elegir equipo pregunta oring o flange', r.reply && /oring/i.test(r.reply) && /flange/i.test(r.reply), r.reply);

// 4g. Mapeos de equipo revisados: control 163 -> CC355, SBU410 -> CC450,
// sensor azul -> CC450, chicote/canasta -> CC355, presostato -> ambos
c = conv();
r = say(c, 'ocupo un control 163');
check('control 163 pide nombre', r.reply && /nombre/i.test(r.reply), r.reply);
r = say(c, 'Luis Méndez');
check('control 163 es para CC355', !!r.solicitud && r.solicitud.fields.equipo === 'Spheros CC355', JSON.stringify(r.solicitud && r.solicitud.fields));
c = conv();
r = say(c, 'ocupo un SBU410');
r = say(c, 'Luis Méndez');
check('SBU410 es para CC450', !!r.solicitud && r.solicitud.fields.equipo === 'Spheros CC450', JSON.stringify(r.solicitud && r.solicitud.fields));
c = conv();
r = say(c, 'necesito un sensor azul');
r = say(c, 'Luis Méndez');
check('sensor azul es para CC450', !!r.solicitud && r.solicitud.fields.equipo === 'Spheros CC450', JSON.stringify(r.solicitud && r.solicitud.fields));
c = conv();
r = say(c, 'necesito un sensor');
check('sensor genérico pregunta cuál', r.reply && /canasta|azul|chicote/i.test(r.reply), r.reply);
r = say(c, 'chicote');
r = say(c, 'Luis Méndez');
check('chicote es para CC355', !!r.solicitud && r.solicitud.fields.equipo === 'Spheros CC355', JSON.stringify(r.solicitud && r.solicitud.fields));

// 4f. Ventilador genérico: pregunta condensador o evaporador
c = conv();
r = say(c, 'necesito un ventilador');
check('ventilador genérico pregunta condensador o evaporador', r.reply && /condensador/i.test(r.reply) && /evaporador/i.test(r.reply), r.reply);

// 4h. Embrague: primero el compresor, luego el tipo (bobina / polea)
c = conv();
r = say(c, 'ocupo un embrague');
check('embrague genérico pregunta para qué compresor', r.reply && /compresor/i.test(r.reply) && /TM65/.test(r.reply), r.reply);
r = say(c, 'TM65');
check('embrague TM65 pregunta tipo (bobina / polea)', r.reply && /bobina/i.test(r.reply) && /2A/.test(r.reply), r.reply);
r = say(c, 'con bobina, polea 2A');
check('embrague con tipo pide nombre', r.reply && /nombre/i.test(r.reply), r.reply);
r = say(c, 'Pedro Gómez');
check('embrague TM65 con bobina polea 2A canaliza', !!r.solicitud && /Embrague para compresor TM65 con bobina, polea 2A/.test(r.solicitud.resumen || ''), JSON.stringify(r.solicitud && r.solicitud.resumen));
c = conv();
r = say(c, 'ocupo un embrague para Bock');
check('embrague para Bock pregunta tipo directo', r.reply && /bobina/i.test(r.reply), r.reply);
r = say(c, 'sin bobina');
r = say(c, 'Pedro Gómez');
check('embrague Bock sin bobina canaliza', !!r.solicitud && /Embrague para compresor Bock sin bobina/.test(r.solicitud.resumen || ''), JSON.stringify(r.solicitud && r.solicitud.resumen));

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

// 13. Factura (oficina): nombre, empresa, qué necesitan; la atiende Francisco
c = conv();
r = say(c, 'Hola, tengo una duda de una factura');
check('factura pide nombre', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'Juan Pérez');
check('factura con nombre pide empresa', r.reply && /empresa/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'Transportes Ruiz');
check('factura con empresa pregunta qué necesitan', r.reply && /necesita/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'que me la manden por correo');
check('factura canaliza como factura para Francisco', !!r.solicitud && r.solicitud.tipo === 'factura' && r.solicitud.atiende === 'Francisco' && /Transportes Ruiz/.test(r.solicitud.resumen), JSON.stringify(r.solicitud));

// 13a. Factura con la necesidad ya dicha: tras la empresa canaliza directo
c = conv();
r = say(c, 'Hola, me pueden mandar la factura');
r = say(c, 'Juan Pérez');
r = say(c, 'Transportes Ruiz');
check('factura con necesidad ya dicha canaliza tras la empresa', !!r.solicitud && r.solicitud.tipo === 'factura' && r.solicitud.atiende === 'Francisco', JSON.stringify(r.solicitud));

// 13b. Factura con todo en un mensaje canaliza directo
c = conv();
r = say(c, 'Hola soy Juan Pérez, empresa Transportes Ruiz, me pueden mandar la factura');
check('factura completa en un mensaje canaliza', !!r.solicitud && r.solicitud.tipo === 'factura' && r.solicitud.atiende === 'Francisco', JSON.stringify(r.solicitud));

// 13c. Guía y pago: se canalizan para Héctor
c = conv();
r = say(c, 'me mandas la guía del envío a Monterrey');
check('guía con detalle pide nombre', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'Juan Pérez');
check('guía canaliza para Héctor', !!r.solicitud && r.solicitud.tipo === 'guia' && r.solicitud.atiende === 'Héctor' && /Monterrey/.test(r.solicitud.resumen), JSON.stringify(r.solicitud));
c = conv();
r = say(c, 'pago');
check('pago solo pide nombre', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'el pago de la factura 123 por $5,000');
check('pago: el detalle no se pierde al contestar el nombre', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'Juan Pérez');
check('pago canaliza para Héctor con el detalle', !!r.solicitud && r.solicitud.tipo === 'pago' && r.solicitud.atiende === 'Héctor' && /123/.test(r.solicitud.resumen), JSON.stringify(r.solicitud));

// 13d. Garantía: equipo, pieza, cuándo se instaló y qué falla; Manuel primero
c = conv();
r = say(c, 'tengo una garantía de un compresor TM65 para CC450');
check('garantía pide nombre', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'Juan Pérez');
check('garantía con nombre pregunta cuándo se instaló y qué falla', r.reply && /instaló|falla/i.test(r.reply) && !r.solicitud, r.reply);
r = say(c, 'se instaló en mayo y ya no enfría');
check('garantía canaliza para Manuel', !!r.solicitud && r.solicitud.tipo === 'garantia' && r.solicitud.atiende === 'Manuel' && /CC450/.test(r.solicitud.resumen), JSON.stringify(r.solicitud));

// 13e. Saludo primero y luego factura: el intent cambia
c = conv();
r = say(c, 'hola');
check('hola solo saluda sin canalizar', !r.solicitud, JSON.stringify(r));
r = say(c, 'me mandan la factura por favor');
check('factura tras saludo cambia el intent y pide nombre', r.reply && /nombre/i.test(r.reply) && !/refacción/i.test(r.reply), r.reply);

// 12. Nunca pedir placa en ningún flujo
c = conv();
for (const t of ['necesito una refacción', '¿ya quedó mi camión?', 'ocupo un servicio de instalación']) {
  r = say(conv(), t);
  check('flujo "' + t + '" no pide placa', !r.reply || NO_PLACA(r.reply), r.reply);
}

// 14. Fluido, no robótico (caso Beto Cornejo, 2026-11-23)
c = conv();
r = say(c, 'hola');
check('saludo se contesta corto, sin cuestionario', r.reply === 'Hola, ¿en qué le ayudo?' && !r.solicitud, r.reply);
r = say(c, 'necesito un compresor TM65');
check('tras el saludo la refacción se toma normal', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);

// 14b. Respuesta de proveedor con precio: el bot no contesta nada
c = conv();
r = say(c, 'SI TENGO 2921.24 MAS IVA');
check('respuesta de proveedor con precio no contesta', r.reply === null && !r.solicitud, JSON.stringify(r));
c = conv();
r = say(c, 'si tengo, $2,921.24 mas iva');
check('respuesta de proveedor con $ no contesta', r.reply === null && !r.solicitud, JSON.stringify(r));
c = conv();
r = say(c, 'les ofrezco compresores a 2921.24 mas iva');
check('oferta nueva de proveedor sí se canaliza', !!r.solicitud && r.solicitud.tipo === 'proveedor', JSON.stringify(r.solicitud));

// 14c. Respuesta a un mensaje de una persona del taller, sin solicitud: silencio
c = conv();
r = say(c, 'BUENOS DIAS SR', null, { replyToHuman: true });
check('saludo respondiendo a humano no contesta', r.reply === null && !r.solicitud, JSON.stringify(r));
c = conv();
r = say(c, 'ok gracias', null, { replyToHuman: true });
check('gracias respondiendo a humano no contesta', r.reply === null && !r.solicitud, JSON.stringify(r));
c = conv();
r = say(c, 'ocupo un compresor TM65', null, { replyToHuman: true });
check('solicitud respondiendo a humano sí se atiende', r.reply && /nombre/i.test(r.reply) && !r.solicitud, r.reply);
c = conv();
r = say(c, 'hola', null, { replyToHuman: false });
check('saludo respondiendo al bot sí se contesta corto', r.reply === 'Hola, ¿en qué le ayudo?', r.reply);

// 14d. La pregunta por la pieza no se repite igual
c = conv();
r = say(c, 'algo');
check('primera pregunta por la pieza, variante 1', r.reply && /¿Qué pieza busca\?/.test(r.reply), r.reply);
r = say(c, 'no sé');
check('segunda pregunta por la pieza, variante 2', r.reply && /foto de la pieza o me dice el código/.test(r.reply), r.reply);
r = say(c, 'mm');
check('tercera vez: queda al pendiente sin insistir', r.reply && /Quedo al pendiente/.test(r.reply), r.reply);
r = say(c, 'eh');
check('cuarta vez: ya no insiste, silencio', r.reply === null && !r.solicitud, JSON.stringify(r));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
