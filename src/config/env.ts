import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',

  HEADLESS: process.env.HEADLESS !== 'false',
  PAGE_DELAY_MS: parseInt(process.env.PAGE_DELAY_MS || '3000', 10),
  TAB_DELAY_MS: parseInt(process.env.TAB_DELAY_MS || '2000', 10),
  PLAYER_DELAY_MS: parseInt(process.env.PLAYER_DELAY_MS || '120000', 10),

  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '2', 10),
  RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS || '5000', 10),

  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

export function validateEnv(): void {
  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  }
}
