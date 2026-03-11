export interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export type Env = {
  DB: D1Database;
  DUMPS: R2Bucket;
  SYMBOLS: R2Bucket;
  PE_FILES: R2Bucket;
  INGEST_LIMITER: RateLimitBinding;
  PUBLIC_LIMITER: RateLimitBinding;

  APP_ORIGIN: string;
  API_ORIGIN: string;
  PROJECT_QUOTA_BYTES: string;
  PROJECT_DAILY_CRASH_CAP: string;

  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
};

import type { User } from "./lib/session";

export type AppEnv = {
  Bindings: Env;
  Variables: { user: User };
};
