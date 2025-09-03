@echo off
echo 🚀 Starting DEX CLOB Matching Engine Server...
echo.

cd /d "z:\DEX_CLOB\DEX_CLOB_TEST\dex-clob-project\backend\matching-engine"

echo 📁 Current directory: %CD%
echo.

echo 🔨 Building project...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ❌ Build failed!
    pause
    exit /b 1
)

echo ✅ Build successful!
echo.

echo 🔐 Starting server with security framework...
call npm start
