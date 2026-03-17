/**
 * Find the strengths/weaknesses type-to-text mapping from SofaScore JS.
 */

import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect all JS chunks
  const jsContents: string[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('_next/static/chunks') && url.endsWith('.js')) {
      try {
        const text = await response.text();
        // Look for trait/characteristic mappings
        if (
          text.includes('Consistency') ||
          text.includes('Playmaking') ||
          text.includes('Direct free kicks') ||
          text.includes('characteristicType')
        ) {
          jsContents.push(`--- ${url} ---\n`);
          // Extract surrounding context
          for (const keyword of ['Consistency', 'Playmaking', 'Direct free kicks', 'characteristicType', 'CHARACTERISTIC']) {
            const idx = text.indexOf(keyword);
            if (idx !== -1) {
              jsContents.push(`  Found "${keyword}" at index ${idx}:`);
              jsContents.push(`  Context: ...${text.slice(Math.max(0, idx - 100), idx + 200)}...\n`);
            }
          }
        }
      } catch {}
    }
  });

  await page.goto('https://www.sofascore.com/football/player/bruno-fernandes/288205', {
    waitUntil: 'load',
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 8000));

  if (jsContents.length > 0) {
    console.log('Found trait mappings in JS bundles:\n');
    for (const c of jsContents) {
      console.log(c);
    }
  } else {
    console.log('No trait text found in JS bundles. Trying page content...');

    // Try extracting from rendered page
    const strengths = await page.locator('text="Strengths"').first().isVisible().catch(() => false);
    if (strengths) {
      // Get the parent section
      const section = await page.evaluate(() => {
        const el = document.querySelector('[class*="characteristic"]') ||
          Array.from(document.querySelectorAll('div')).find(d => d.textContent?.includes('Strengths') && d.textContent?.includes('Weaknesses'));
        return el?.innerHTML?.slice(0, 2000) || null;
      });
      console.log('Characteristics section HTML:', section);
    }

    // Also try: search all page text for the traits
    const allText = await page.evaluate(() => document.body.innerText);
    const lines = allText.split('\n').filter(l =>
      l.includes('Consistency') || l.includes('Playmaking') || l.includes('Direct free') ||
      l.includes('Strengths') || l.includes('Weaknesses')
    );
    console.log('\nRelevant text from page:');
    for (const line of lines) {
      console.log(`  ${line.trim()}`);
    }
  }

  await browser.close();
}

main().catch(console.error);
