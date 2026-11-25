@echo off
title Symulator ATtiny24 - stanowisko LTM
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serwer\serwer.ps1"
if errorlevel 1 pause
