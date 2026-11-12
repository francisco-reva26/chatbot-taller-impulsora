# Despliegue a Render — guía exacta (2026-11-12)

## Lo que ya está listo (verificado hoy)

- Repo git local en `~/workspace/goals/workshop-whatsapp-chatbot/webhook/`,
  commit `e688444` ("Webhook chatbot Almacén Impulsora: backend listo para
  Render"). Archivos: server.js, bot.js, kb.json, products.json (sin precios),
  units.json, test-bot.js, package.json, start.sh, README.md, .env.example,
  .gitignore, render.yaml.
- Verificado con `git ls-files`: **NO** se incluyen `.env`, `data/` (ahí está
  el VERIFY_TOKEN en `data/verify-token.txt`), ni `bin/` (cloudflared).
- Corrección aplicada para Render: `server.js` ya tolera que no exista
  `.env` (antes se caía si faltaba; en Render las variables vienen del panel).
- Pruebas tras la corrección: `node test-bot.js` 27/27; servidor local
  reiniciado y verificado: `/health` OK, verificación con token malo → 403.
- `render.yaml` (Blueprint): Web Service `chatbot-taller-almacen-impulsora`,
  plan free, `node server.js`, healthCheck `/health`, env vars
  VERIFY_TOKEN / WHATSAPP_TOKEN / APP_SECRET marcadas `sync: false`
  (se ponen a mano en el panel de Render, nunca en el repo).

## Por qué no quedó desplegado desde esta VM

1. **No hay cuenta de GitHub disponible**: `gh` no tiene sesión
   ("You are not logged into any GitHub hosts"), no hay `git config` de
   usuario (se puso uno local solo para el commit) y en el Secure Vault no
   hay ningún login guardado de github.com ni de render.com.
2. **No hay API key de Render**: la API de Render (`api.render.com`,
   alcanzable, responde 401 sin clave) exige una clave; no hay ninguna
   en variables de entorno ni guardada.
3. No se inventó ninguna cuenta ni credencial. Render free no pide tarjeta.

## Pasos que faltan (los hace Luna con el navegador, o el usuario)

### Paso 1 — Subir el código a GitHub
- Crear (o usar) una cuenta de GitHub y un repo nuevo, p. ej.
  `chatbot-taller-impulsora`.
- Subir los 12 archivos del commit (por la web de GitHub: Add file →
  Upload files; o con `gh auth login` en esta VM y `git push`).
- El repo puede ser privado: Render lo conecta con su app de GitHub.

### Paso 2 — Crear el servicio en Render (plan gratuito)
- Crear cuenta en render.com (email + contraseña; no pide tarjeta).
- Opción A (Blueprint): New → Blueprint → conectar el repo; Render lee
  `render.yaml` y crea el Web Service.
- Opción B (manual): New → Web Service → conectar el repo → Runtime Node →
  Build Command `npm install --omit=dev || true` → Start Command
  `node server.js`.
- En Environment del servicio, poner estas variables (valores en
  `webhook/.env` de esta VM; el WHATSAPP_TOKEN lo trae Luna por separado):
  `VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `APP_SECRET` (opcional),
  `PHONE_NUMBER_ID=818620465684599`, `MONTHLY_CAP=1000`,
  `GRAPH_VERSION=v21.0`.
- Render dará la URL, p. ej.
  `https://chatbot-taller-almacen-impulsora.onrender.com`

### Paso 3 — Registrar el webhook en Meta
- Meta for Developers → app "Almacén Impulsora" (1783963983736374) →
  WhatsApp → Configuración → Webhook:
  - URL de devolución de llamada: `https://<servicio>.onrender.com/webhook`
  - Token de verificación: el VERIFY_TOKEN de `.env`
    (copia en `webhook/data/verify-token.txt`).
  - Suscribirse al campo `messages`.
- Probar: `curl https://<servicio>.onrender.com/health` debe responder OK.

## Notas
- Plan free de Render se duerme sin tráfico; Meta lo despierta con cada
  mensaje, el primer mensaje puede tardar ~30 s.
- El sistema de archivos de Render free es efímero: `data/` (bandeja, uso
  del mes) se reinicia en cada redeploy. Es aceptable: la bandeja es de
  consulta y Luna avisa las solicitudes por el canal habitual.
- Sin WHATSAPP_TOKEN el servicio corre en DRY-RUN (no manda nada a Meta).
  El token lo consigue Luna en Meta Developers → API Setup (temporal 24 h
  para probar, o permanente de usuario de sistema, recomendado).
