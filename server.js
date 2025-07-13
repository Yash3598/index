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

    // Stealthify
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    let clarityId = null;
    let fbPixelId = null;

    function findClarityId(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.ms_clarityid) return obj.ms_clarityid;
      for (const k in obj) {
        if (typeof obj[k] === 'object') {
          const found = findClarityId(obj[k]);
          if (found) return found;
        }
      }
      return null;
    }

    page.on('requestfinished', async request => {
      const reqUrl = request.url();

      // Clarity from network
      if (!clarityId) {
        const m = reqUrl.match(/clarity\.ms\/tag\/([a-z0-9]+)/i);
        if (m) clarityId = m[1];
      }

      // FB pixel from network
      if (!fbPixelId && reqUrl.includes('facebook.com/tr')) {
        try {
          const u = new URL(reqUrl);
          const id = u.searchParams.get('id');
          if (id) fbPixelId = id;
        } catch {}
      }

      // Clarity inside POST bodies
      if (!clarityId) {
        try {
          const data = request.postData();
          if (data) {
            const obj = JSON.parse(data);
            const f = findClarityId(obj);
            if (f) clarityId = f;
          }
        } catch {}
      }
    });

    // — STEP 1: Main page —
    await page.goto(inputUrl, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(5000);

    // Fallback via <script> tags
    const fallback = await page.evaluate(() => {
      const out = { clarity: null, fbPixel: null };
      for (const s of document.querySelectorAll('script')) {
        if (!out.clarity && s.src?.includes('clarity.ms/tag/')) {
          const m = s.src.match(/clarity\.ms\/tag\/([a-z0-9]+)/i);
          if (m) out.clarity = m[1];
        }
        if (!out.fbPixel && /fbq\(['"]init['"],\s*['"](\d{5,})['"]\)/.test(s.innerText)) {
          const m = s.innerText.match(/fbq\(['"]init['"],\s*['"](\d{5,})['"]\)/);
          if (m) out.fbPixel = m[1];
        }
      }
      return out;
    });
    if (!clarityId) clarityId = fallback.clarity;
    if (!fbPixelId) fbPixelId = fallback.fbPixel;

    // Footer links
    const footerLinks = await page.evaluate(() => {
      const set = new Set();
      function collect(ct) {
        if (!ct) return;
        for (const a of ct.querySelectorAll('a[href]')) {
          set.add(JSON.stringify({ text: a.textContent.trim(), href: a.href }));
        }
      }
      collect(document.querySelector('footer'));
      for (const ct of document.querySelectorAll('[class*=footer]')) collect(ct);
      collect(document.querySelector('.footer-links'));
      return Array.from(set).map(j => JSON.parse(j));
    });

    // First TRF link
    const trfLink = await page.evaluate(() => {
      const a = document.querySelector('a[href*="trf"]');
      return a ? a.href : null;
    });

    // — STEP 2: test URL for portfolioId and sourctag —
    const testUrl = inputUrl.includes('?') ? `${inputUrl}&test` : `${inputUrl}?test`;
    let portfolioId = null;
    let sourctag = null;

    await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(5000);

    ({ portfolioId, sourctag } = await page.evaluate(() => {
      const txt = document.body.innerText;
      const p = (txt.match(/portfolio[_\s\-]?id[:=]?\s*([A-Za-z0-9\-]+)/i) || [])[1] || null;
      const s = (txt.match(/src=([A-Za-z0-9\-_]+)/i) || [])[1] || null;
      return { portfolioId: p, sourctag: s };
    }));

    await browser.close();

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

app.listen(PORT, () => console.log(`✅ Server listening on ${PORT}`));
