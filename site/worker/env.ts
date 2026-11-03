// Secrets are set with `wrangler secret put` (prod) or site/.dev.vars (local),
// so `wrangler types` does not know them; declare them here (PLAN.md §11).
export interface Secrets {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  /** Comma-separated numeric GitHub ids. */
  ADMIN_GITHUB_IDS: string;
}

export interface Bindings {
  ASSETS: Fetcher;
  CONTENT: R2Bucket;
  PRIVATE: R2Bucket;
}

export type AppEnv = Bindings & Secrets;
