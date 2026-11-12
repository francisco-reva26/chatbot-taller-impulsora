#!/bin/bash
# Arranca el webhook en segundo plano (sobrevive al cierre de la terminal).
cd "$(dirname "$0")"
nohup node server.js >> data/server.out.log 2>&1 &
echo $! > data/server.pid
echo "Webhook arrancado, PID $(cat data/server.pid). Log: data/server.out.log"
