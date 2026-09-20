@echo off
echo =======================================
echo     Avvio di MagLite (Windows)
echo =======================================

echo Avvio del Backend in corso...
start "MagLite Backend" cmd /k "cd backend && npm run dev"

echo Avvio del Frontend in corso...
start "MagLite Frontend" cmd /k "cd frontend && npm run dev"

echo Finito! Le console si sono aperte in finestre separate.
echo Il gestionale sara' presto disponibile su http://localhost:5173
pause
