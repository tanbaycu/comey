import type { ApiKeyScope } from '@comey/core';

export interface Env {
  DB: D1Database;
  MASTER_ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  INBOUND_EMAIL_DOMAIN: string;
  PUBLIC_BASE_URL: string;
  ALLOW_PUBLIC_SIGNUP?: string;
  ADMIN_BOOTSTRAP_KEY?: string;
}

export interface AuthContextVariables {
  workspaceId: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  apiKeyId?: string;
  apiKeyScopes?: ApiKeyScope[];
  apiKeyRateLimitRpm?: number;
  isTestKey: boolean;
}

export type AppContextEnv = {
  Bindings: Env;
  Variables: AuthContextVariables;
};
