@echo off
title MES-API-GSL Integration Service
set NODE_SKIP_PLATFORM_CHECK=1
cd /d "%~dp0"
echo ====================================================
echo      Starting MES-API-GSL Service on 10.140.16.68
echo ====================================================
echo Node version:
node -v
echo.
echo Starting application...
node dist/index.js >> logs\console.log 2>&1
