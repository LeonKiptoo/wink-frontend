/**
 * WINK — Environment configuration
 *
 * 1. Copy this file to env.js in the same directory as index.html
 * 2. Fill in your real values
 * 3. Add env.js to .gitignore — never commit real keys
 *
 * On Vercel: inject these at build time via a _headers file or
 * a tiny /api/env.js serverless function that reads process.env.*
 */
window.WINK_CONFIG = {
  API_BASE: "https://your-railway-backend.up.railway.app",
  SB_URL:   "https://yourproject.supabase.co",
  SB_KEY:   "your-supabase-anon-key-here"
};
