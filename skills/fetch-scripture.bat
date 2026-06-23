@echo off
REM Fetch a scripture passage from Bible Gateway (NIV 2011)
REM Usage: fetch-scripture.bat "Genesis 1:1-5"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fetch-scripture.ps1" %*
