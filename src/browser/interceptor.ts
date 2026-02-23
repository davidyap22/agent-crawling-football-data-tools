import { Page, Response } from 'playwright';
import { logger } from '../utils/logger';

/**
 * Capture a single API response matching the URL pattern.
 * JSON parse errors are silently skipped (keeps listening for next match).
 */
export async function captureApiResponse(
  page: Page,
  urlPattern: string,
  timeoutMs: number = 15000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.removeListener('response', handler);
      reject(new Error(`Timeout waiting for API: ${urlPattern}`));
    }, timeoutMs);

    const handler = async (response: Response) => {
      const url = response.url();
      if (url.includes('www.sofascore.com/api/v1') && url.includes(urlPattern) && response.status() === 200) {
        try {
          const json = await response.json();
          clearTimeout(timer);
          page.removeListener('response', handler);
          logger.debug(`Captured API: ${urlPattern}`);
          resolve(json);
        } catch {
          // JSON parse failed (e.g. response body already consumed), keep listening
        }
      }
    };

    page.on('response', handler);
  });
}

/**
 * Capture multiple API responses matching different URL patterns.
 * All patterns are listened for concurrently.
 */
export async function captureMultipleApiResponses(
  page: Page,
  urlPatterns: string[],
  timeoutMs: number = 15000
): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  const remaining = new Set(urlPatterns);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.removeListener('response', handler);
      if (Object.keys(results).length > 0) {
        logger.warn(`Partial capture: got ${Object.keys(results).length}/${urlPatterns.length} APIs`);
        resolve(results);
      } else {
        reject(new Error(`Timeout waiting for APIs: ${urlPatterns.join(', ')}`));
      }
    }, timeoutMs);

    const handler = async (response: Response) => {
      const url = response.url();
      if (!url.includes('www.sofascore.com/api/v1') || response.status() !== 200) return;

      for (const pattern of remaining) {
        if (url.includes(pattern)) {
          try {
            const json = await response.json();
            results[pattern] = json;
            remaining.delete(pattern);
            logger.debug(`Captured API (${remaining.size} remaining): ${pattern}`);

            if (remaining.size === 0) {
              clearTimeout(timer);
              page.removeListener('response', handler);
              resolve(results);
            }
          } catch {
            // Skip parse errors
          }
          break;
        }
      }
    };

    page.on('response', handler);
  });
}

/**
 * Navigate to a page and capture an API response that fires during page load.
 */
export async function navigateAndCapture(
  page: Page,
  url: string,
  apiPattern: string,
  timeoutMs: number = 15000
): Promise<any> {
  const capturePromise = captureApiResponse(page, apiPattern, timeoutMs);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return capturePromise;
}

/**
 * Navigate to a page and capture multiple API responses during load.
 */
export async function navigateAndCaptureMultiple(
  page: Page,
  url: string,
  apiPatterns: string[],
  timeoutMs: number = 15000
): Promise<Record<string, any>> {
  const capturePromise = captureMultipleApiResponses(page, apiPatterns, timeoutMs);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return capturePromise;
}

/**
 * Click an element and capture the API response triggered by it.
 */
export async function clickAndCapture(
  page: Page,
  selector: string,
  apiPattern: string,
  timeoutMs: number = 15000
): Promise<any> {
  const capturePromise = captureApiResponse(page, apiPattern, timeoutMs);
  await page.click(selector);
  return capturePromise;
}

/**
 * Extract __NEXT_DATA__ from the current page (SSR data).
 */
export async function extractNextData(page: Page): Promise<any> {
  return page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    return el ? JSON.parse(el.textContent || '{}') : null;
  });
}

/**
 * Try to click a tab by text content using multiple selectors.
 */
export async function tryClickTab(page: Page, tabName: string): Promise<boolean> {
  const selectors = [
    `text="${tabName}"`,
    `a:has-text("${tabName}")`,
    `button:has-text("${tabName}")`,
    `div[role="tab"]:has-text("${tabName}")`,
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click();
        logger.debug(`Clicked tab: ${tabName}`);
        return true;
      }
    } catch {
      // Try next selector
    }
  }
  logger.debug(`Tab not found: ${tabName}`);
  return false;
}
