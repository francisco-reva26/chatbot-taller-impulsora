# Webhook del chatbot del taller — Almacén Impulsora

Backend real de WhatsApp Cloud API para el número **+52 667 131 6147**
("Impulsora Del Noroeste"). Sin método de pago, sin BSP, sin servicios de pago.

## Estado (2026-11-12)

| Pieza | Estado |
|---|---|
| App Meta "Almacén Impulsora" (ID 1783963983736374) | Creada y conectada |
| Número 667 131 6147 en WhatsApp Manager | Conectado / Registrado |
| Phone Number ID | 818620465684599 |
| Messaging Account ID | 208939884539844 |
| Business ID | 2179211836326243 |
| Backend (este directorio) | Construido y probado (27/27 pruebas de lógica + pruebas en vivo) |
| Servidor corriendo | Sí, en `http://localhost:3000` (modo DRY-RUN, ver abajo) |
| **Token de acceso de WhatsApp** | **FALTA — es el único dato que bloquea el envío real** |
| **URL pública HTTPS (callback)** | **FALTA — esta VM no tiene entrada pública (ver "URL pública")** |

## Qué hace el backend

- `server.js` — servidor HTTP en Node estándar, sin dependencias.
  - `GET /webhook` — verificación de Meta (`hub.mode`, `hub.verify_token`,
    `hub.challenge`). Con token incorrecto responde 403.
  - `POST /webhook` — recibe mensajes de Meta (texto e imagen). Verifica la
    firma `X-Hub-Signature-256` con `APP_SECRET` cuando está configurado.
  - `GET /health` — estado, respuestas del mes y tope.
  - `GET /inbox` — bandeja de solicitudes en JSON (para Francisco y Manuel).
  - `GET /` — panel simple de estado.
- `bot.js` — la lógica de recepción, sacada de la demo `chatbot-del-taller`:
  - Refacción: solo pide equipo/modelo (o foto). Nunca pide ruta, camión,
    empresa ni chasis. Pregunta la variante cuando el cliente dice solo el
    nombre genérico (presostato baja azul / alta negro, sensor canasta /
    azul / chicote, filtro 304/305 flare / oring, serpentín CC355 derecho /
    izquierdo, fusible 175 o portafusible, Bock 655 / 755, Bosch 150 de 3 o
    2 agarres, tablero 450 007-00161-000 vs CC300 GL-T047, control 163
    GL-W163 vs 210 GL-W210, condensador ventilador vs serpentín).
  - Estatus: pide nombre, empresa, ruta, número de camión o chasis y
    contesta "ya quedó" solo si hay nota de CONTPAQi (ver `units.json`),
    si no "sigue en taller". **Nunca pide la placa.**
  - Servicio / reparación / instalación y proveedores (sin comprometerse
    a comprar nada).
  - **Nunca da precios ni rangos.** La base no contiene precios.
  - Al canalizar dice: *"una persona de almacén lo atenderá a la brevedad"*.
    Nunca dice los nombres de Francisco ni de Manuel al cliente.
  - Al canalizar o contestar el estatus, **cierra la conversación**: no
    manda plantillas ni reabre solo. Solo contesta de nuevo si el cliente
    escribe otra vez. Un "gracias / es todo" después de cerrar no crea
    otra solicitud.
  - **Tope mensual:** 1,000 respuestas de servicio gratis por mes. Al
    llegar, no contesta más y guarda una alerta en `data/alerts.json`
    (y en el log) para avisar a Francisco. Se reinicia solo cada mes.
  - **Ventana de 24 h:** solo responde dentro de las 24 h del último
    mensaje del cliente. Sin método de pago el bot nunca inicia
    conversación ni manda plantillas.
- `kb.json` — base de conocimiento (44 renglones de la demo: catálogo
  Spheros 2025-2026 en 15 secciones + 29 piezas del anaquel con códigos
  y sinónimos). Sin precios.
- `products.json` — 2,671 productos del Excel `CATALOGOREFACCIONES26.xlsx`
  (solo código, nombre, proveedor y categoría; los precios del Excel
  **no** se cargaron).
- `units.json` — unidades del taller con sus notas de CONTPAQi. Hoy está
  vacío (`[]`), igual que la demo. Para que el bot diga "ya quedó" hay
  que agregar la unidad así:
  `{"cliente":"Nombre","empresa":"Empresa","ruta":"Ruta","numeroUnidad":"12","chasis":"XXXX","nota":{"folio":"F-123"}}`
  y reiniciar el servidor.
- `data/` — estado en vivo: `conversations.json`, `solicitudes.json`,
  `usage.json` (respuestas del mes), `alerts.json`, `webhook.log`.

## Avisos a Francisco y Manuel — limitación honesta

Con **sin método de pago**, Meta no permite que el bot le mande un mensaje
de WhatsApp a Francisco (6671181767) ni a Manuel (6674603088) por su cuenta:
eso sería un mensaje iniciado por el negocio (plantilla), que es de pago.
Por eso cada solicitud completa queda guardada en la bandeja
(`GET /inbox` y `data/solicitudes.json`, con hora de creación y campos
para registrar quién la tomó y cuándo la atendió) y el servidor escribe
en el log `[AVISO] Nueva solicitud...`. **Luna es quien avisa a Francisco
y a Manuel por el canal habitual** (o ellos revisan la bandeja).
Si algún día se agrega método de pago y una plantilla de utilidad, el
aviso por WhatsApp se puede activar en `bot.js` (`buildSolicitud.aviso`).

## Cómo correrlo

```bash
cd ~/workspace/goals/workshop-whatsapp-chatbot/webhook
./start.sh        # arranca en segundo plano, PID en data/server.pid
curl localhost:3000/health
node test-bot.js  # 27 pruebas de lógica, sin red
```

Parar: `kill $(cat data/server.pid)`.

## Lo que falta para que conteste de verdad (2 cosas)

### 1. Token de acceso de WhatsApp (lo debe sacar el usuario / Luna en Meta)

En Meta for Developers → app **Almacén Impulsora** → WhatsApp → API Setup:

- **Token temporal** (dura 24 h, sirve para probar): copiarlo y ponerlo
  en `.env` como `WHATSAPP_TOKEN=...`, luego reiniciar el servidor.
- **Token permanente (recomendado):** crear un usuario de sistema en el
  portfolio "Almacén Impulsora", darle permiso `whatsapp_business_messaging`
  y generar su token. Ese token no caduca.
- Opcional pero recomendado: `APP_SECRET` (en la app → Configuración →
  Básica → Secreto de la app) para verificar la firma de los webhooks.

**Nunca** pegar el token en el chat ni en ningún archivo que se comparta:
solo en `.env` (que no se comparte). Sin token el servidor corre en
modo DRY-RUN: procesa todo y registra lo que contestaría, pero no manda
nada a Meta.

### 2. URL pública HTTPS (callback) — lo que no se pudo lograr desde esta VM

Meta exige una URL pública `https://.../webhook`. Esta VM **no tiene
entrada pública**: solo tiene IP privada, Tailscale es solo cliente (no
recibe conexiones), y el hosting de artefactos no expone endpoints de
webhook. Se intentó:

- **Cloudflare quick tunnel** (`cloudflared`): el binario corre, pero su
  registro en `api.trycloudflare.com` falla con error TLS porque ignora
  el proxy de salida de la VM (la VM no tiene internet directo).
- **localhost.run por SSH**: el proxy bloquea la conexión (tiempo agotado).

**Opciones para tener la URL (elegir una):**

- **A. Desplegar este backend en un hosting gratuito** (recomendado):
  es un solo servidor Node sin dependencias. Por ejemplo, Render.com
  (plan gratuito, no pide tarjeta): subir esta carpeta a GitHub, crear
  un "Web Service" con `node server.js`, poner las variables de `.env`
  en el panel de Render y usar la URL `https://...onrender.com/webhook`.
  El plan gratuito se duerme si no recibe tráfico; Meta lo despierta
  con cada mensaje, pero el primer mensaje puede tardar ~30 s.
- **B. Cloudflare Tunnel con cuenta gratuita**: crear cuenta en
  Cloudflare, crear un túnel con nombre y correr `cloudflared` en una
  computadora siempre encendida que tenga el servidor (no en esta VM,
  porque aquí el proxy lo bloquea).

Cuando la URL exista, registrarla en Meta for Developers → app
**Almacén Impulsora** → WhatsApp → Configuración → Webhook:

- **URL de devolución de llamada:** `https://<tu-dominio>/webhook`
- **Token de verificación:** el valor de `VERIFY_TOKEN` en `.env`
  (está en `webhook/.env` y en `webhook/data/verify-token.txt`).
- Suscribirse al campo **`messages`**.

Meta hará un GET de verificación (el servidor responde el `challenge`
si el token coincide) y a partir de ahí los mensajes reales llegan
al `POST /webhook`.

## Pruebas hechas (2026-11-12)

- `node test-bot.js`: **27/27** — refacción completa, pregunta de precio
  (sin precio), presostato/filtro/Bosch ambiguos, código T95177AY,
  estatus (pide localizadores, nunca placa; "sigue en taller" sin nota,
  "ya quedó" con nota), proveedor, cierre sin duplicar solicitud, foto,
  catálogo por código 100BXS y por nombre.
- Servidor en vivo (modo DRY-RUN): verificación GET correcta (token bueno
  devuelve el challenge, token malo 403), POST simulado de Meta con
  refacción CC450 (solicitud creada + mensaje de canalización), presostato
  ambiguo (pregunta baja/alta), estatus (respuesta "sigue en taller").
- Tope mensual: con `MONTHLY_CAP=2` en copia de pruebas, la 3ª respuesta
  se bloqueó y se guardó la alerta. Firma HMAC: sin firma se rechaza
  (`firma_invalida` en el log), con firma válida se procesa.
- Datos de prueba limpiados después de las pruebas (bandeja y uso en cero).
