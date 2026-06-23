@echo off
REM Build a bulletin: generate private data, compile, and copy PDF.
REM Usage: scripts\build.bat "06 07 2026"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
