export default function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || "https://ycznroxjicvberxeacba.supabase.co";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
  const apiBaseUrl = process.env.API_BASE_URL || "https://wnkia-backend-production.up.railway.app";
  const checkoutUrl = process.env.CHECKOUT_URL || "";
  const appName = process.env.APP_NAME || "Wink";

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(503).json({
      detail: {
        message: "Supabase configuration is incomplete.",
        missing: [
          ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
          ...(!supabaseAnonKey ? ["SUPABASE_ANON_KEY"] : []),
        ],
      },
    });
  }

  res.status(200).json({
    apiBaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    checkoutUrl,
    appName,
    backendConfigured: Boolean(apiBaseUrl),
    missingBackendConfig: apiBaseUrl ? [] : ["API_BASE_URL"],
  });
}
