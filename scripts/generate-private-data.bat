@echo off
REM Script to generate private-data.tex from assets/church/information.md
REM Usage: generate-private-data.bat "content\06 07 2026"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate-private-data.ps1" %*
