@echo off
echo ===================================================
echo   Vidyashilp University AI Academic Advisor
echo   Improved RAG - Vercel Deployment Utility
echo ===================================================
echo.

cd /d "%~dp0..\app"

echo [1/3] Checking environment configuration...
if exist ".env.local" (
    echo [OK] .env.local found.
) else if exist "..\.env" (
    echo [INFO] Copying .env to app\.env.local...
    copy "..\.env" ".env.local" >nul 2>&1
) else if exist "..\..\.env" (
    echo [INFO] Copying root .env to app\.env.local...
    copy "..\..\.env" ".env.local" >nul 2>&1
) else (
    echo [WARNING] No .env found. Please ensure GROQ_API_KEY and GEMINI_API_KEY are configured in Vercel Dashboard.
)

echo.
echo [2/3] Verifying Next.js production build...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Next.js build failed. Please inspect errors above before deploying.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Deploying to Vercel...
echo (If this is your first time, follow the terminal prompt to log into Vercel)
echo.
call npx -y vercel

echo.
echo To deploy directly to production, execute:
echo   cd rag-improved\app ^&^& npx vercel --prod
echo.
pause
