import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.string().url().default("https://jsfdewizzkyvbqziniou.supabase.co"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).default("proxy-injected"),
  PIPELINE_USER_AGENT: z
    .string()
    .default("AccelCaseIntelligence/0.1 (+contact: firm administrator)"),
  PIPELINE_MIN_DELAY_MS: z.coerce.number().int().min(500).default(3000),
  PIPELINE_FIRM_ID: z.string().uuid().default("0f000000-0000-4000-8000-000000000001"),
  PIPELINE_CASE_ID: z.string().uuid().default("0c000000-0000-4000-8000-000000000001"),
  PIPELINE_SOURCE_ID: z.string().uuid().default("05000000-0000-4000-8000-000000000001"),
  PIPELINE_DOWNLOAD_DIR: z.string().default("fixtures/equitybuild/downloads"),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return schema.parse(env);
}
