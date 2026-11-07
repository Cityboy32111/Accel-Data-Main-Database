import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";

/** Service-role client for the pipeline worker. Never ship this key to a browser or to Base44. */
export function serviceClient(cfg: WorkerConfig): SupabaseClient {
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": "accel-case-intelligence-worker/0.1" } },
  });
}
