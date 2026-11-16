@echo off
rem Relais Logistique Fret sur un PC Windows : double-cliquez, ou lancez-le au démarrage (Planificateur de tâches, voir docs\12-heberger-le-relais.md).
rem Prérequis : Node.js 18 ou plus (nodejs.org, version LTS). Configuration : serveur\relais.env (copie de relais.env.exemple).
cd /d "%~dp0.."
if not exist "serveur\relais.env" (echo Copiez serveur\relais.env.exemple en serveur\relais.env et remplissez-le. & pause & exit /b 1)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("serveur\relais.env") do set "%%a=%%b"
if not defined DONNEES set "DONNEES=%~dp0donnees"
:boucle
node serveur\relais.js
echo Le relais sest arrete : redemarrage dans 5 secondes (fermez cette fenetre pour larreter).
timeout /t 5 >nul
goto boucle
