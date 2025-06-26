const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/hello', async (req, res) => {
  const inputUrl = req.body.url;
  if (!inputUrl) return res.status(400).json({ error: 'Missing URL in request body' });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US'
    });

    const page = await context.newPage();

    // stealth: remove navigator.webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
    });

    let clarityId = null;
    let fbPixelId = null;

    function findClarityId(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.ms_clarityid) return obj.ms_clarityid;
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const found = findClarityId(obj[key]);
          if (found) return found;
        }
      }
      return null;
    }

    page.on('requestfinished', async (request) => {
      const url = request.url();

      // network-based Clarity ID
      if (!clarityId) {
        const m = url.match(/clarity\.ms\/tag\/([a-z0-9]+)/i);
        if (m) clarityId = m[1];
      }

      // network-based FB Pixel ID
      if (!fbPixelId && url.includes('facebook.com/tr')) {
        try {
          const u = new URL(url);
          const id = u.searchParams.get('id');
          if (id) fbPixelId = id;
        } catch {}
      }

      // POST-body-based Clarity ID
      if (!clarityId) {
        try {
          const data = request.postData();
          if (data) {
            const obj = JSON.parse(data);
            const found = findClarityId(obj);
            if (found) clarityId = found;
          }
        } catch {}
      }
    });

    // — STEP 1: load main page —
    await page.goto(inputUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);

    // fallback via <script> tags
    const fallback = await page.evaluate(() => {
      const r = { clarity: null, fbPixel: null };
      document.querySelectorAll('script').forEach(s => {
        if (!r.clarity && s.src?.includes('clarity.ms/tag/')) {
          const m = s.src.match(/clarity\.ms\/tag\/([a-z0-9]+)/i);
          if (m) r.clarity = m[1];
        }
        if (!r.fbPixel && /fbq\(['"]init['"],\s*['"](\d{5,})['"]\)/.test(s.innerText)) {
          const m = s.innerText.match(/fbq\(['"]init['"],\s*['"](\d{5,})['"]\)/);
          if (m) r.fbPixel = m[1];
        }
      });
      return r;
    });
    if (!clarityId) clarityId = fallback.clarity;
    if (!fbPixelId) fbPixelId = fallback.fbPixel;

    // collect footer links
    const footerLinks = await page.evaluate(() => {
      const set = new Set();
      const collect = container => {
        if (!container) return;
        container.querySelectorAll('a').forEach(a => {
          if (a.href) {
            set.add(JSON.stringify({ text: a.textContent.trim(), href: a.href }));
          }
        });
      };
      collect(document.querySelector('footer'));
      document.querySelectorAll('[class*=footer]').forEach(collect);
      collect(document.querySelector('.footer-links'));
      return Array.from(set).map(j => JSON.parse(j));
    });

    // first TRF link
    const trfLink = await page.evaluate(() => {
      const a = document.querySelector('a[href*="trf"]');
      return a ? a.href : null;
    });

    // — STEP 2: load ?test version for portfolio & sourctag —
    const testUrl = inputUrl.includes('?') ? `${inputUrl}&test` : `${inputUrl}?test`;
    let portfolioId = null;
    let sourctag = null;
    try {
      await page.goto(testUrl, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(3000);
      const info = await page.evaluate(() => {
        const txt = document.body.innerText;
        const p = (txt.match(/portfolio[_\s\-]?id[:=]?\s*([A-Za-z0-9\-]+)/i) || [])[1];
        const s = (txt.match(/src=([A-Za-z0-9\-_]+)/i) || [])[1];
        return { portfolioId: p || null, sourctag: s || null };
      });
      portfolioId = info.portfolioId;
      sourctag = info.sourctag;
    } catch {}

    await browser.close();

    // respond — always include every field, defaulting to "Not Found"
    res.json({
      clarityId: clarityId || 'Not Found',
      fbPixelId: fbPixelId || 'Not Found',
      trfLink: trfLink || 'Not Found',
      footerLinks: footerLinks.length
        ? footerLinks
        : [{ text: 'Not Found', href: '' }],
      portfolioId: portfolioId || 'Not Found',
      sourctag: sourctag || 'Not Found',
    });

  } catch (e) {
    if (browser) await browser.close();
    console.error(e);
    res.status(500).json({ error: 'Failed to analyze the page' });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
