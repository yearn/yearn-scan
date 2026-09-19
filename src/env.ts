export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PUBLISH_KEYS: string;
  APP_ORIGIN: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
}
