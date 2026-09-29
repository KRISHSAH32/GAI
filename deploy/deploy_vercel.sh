#!/usr/bin/env bash
set -e

echo "==================================================="
echo "  Vidyashilp University AI Academic Advisor"
echo "  Improved RAG - Vercel Deployment Utility"
echo "==================================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../app"

echo "[1/3] Checking environment configuration..."
if [ -f ".env.local" ]; then
    echo "[OK] .env.local found."
elif [ -f "../.env" ]; then
    echo "[INFO] Copying .env to app/.env.local..."
    cp "../.env" ".env.local"
elif [ -f "../../.env" ]; then
    echo "[INFO] Copying root .env to app/.env.local..."
    cp "../../.env" ".env.local"
else
    echo "[WARNING] No .env found. Please configure GROQ_API_KEY and GEMINI_API_KEY in the Vercel Dashboard."
fi

echo ""
echo "[2/3] Verifying Next.js production build..."
npm run build

echo ""
echo "[3/3] Deploying to Vercel..."
npx -y vercel

echo ""
echo "To deploy directly to production, run:"
echo "  cd rag-improved/app && npx vercel --prod"
