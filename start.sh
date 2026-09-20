#!/bin/bash
echo "======================================="
echo "    Avvio di MagLite (Linux/Mac)"
echo "======================================="

echo "Avvio del Backend in corso..."
cd backend
npm run dev &
BACKEND_PID=$!
cd ..

echo "Avvio del Frontend in corso..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo "Finito! I server sono in esecuzione in background."
echo "Il gestionale sara' presto disponibile su http://localhost:5173"
echo "Premi CTRL+C per fermare tutto."

trap "kill $BACKEND_PID $FRONTEND_PID" SIGINT
wait
