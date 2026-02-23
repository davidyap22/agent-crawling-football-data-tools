import { delay } from './delay';
import { logger } from './logger';

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 2,
  retryDelayMs: number = 5000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}. Retrying in ${retryDelayMs}ms...`);
        await delay(retryDelayMs);
      }
    }
  }
  throw lastError;
}
