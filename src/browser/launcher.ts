import { chromium, Browser, BrowserContext } from 'playwright';
import { ENV } from '../config/env';
import { logger } from '../utils/logger';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export async function launchBrowser(headed?: boolean): Promise<BrowserContext> {
  const headless = headed !== undefined ? !headed : ENV.HEADLESS;

  logger.info(`Launching Chrome (headless: ${headless})...`);
  browser = await chromium.launch({
    headless,
    channel: 'chrome',
  });

  context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  // Block unnecessary resources to speed up loading
  await context.route(
    /\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)(\?.*)?$/,
    (route) => route.abort()
  );

  logger.info('Browser launched successfully');
  return context;
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
  logger.info('Browser closed');
}

export function getBrowserContext(): BrowserContext {
  if (!context) throw new Error('Browser not launched. Call launchBrowser() first.');
  return context;
}
