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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US'
    });

    const page = await context.newPage();

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
      const reqUrl = request.url();

      if (!clarityId) {
        const match = reqUrl.match(/clarity\.ms\/tag\/([a-z0-9]+)/i);
        if (match) clarityId = match[1];
      }

      if (!fbPixelId && reqUrl.includes('facebook.com/tr')) {
        try {
          const urlObj = new URL(reqUrl);
          const id = urlObj.searchParams.get('id');
          if (id) fbPixelId = id;
        } catch {}
      }

      if (!clarityId) {
        try {
          const postData = request.postData();
          if (postData) {
            let json;
            try {
              json = JSON.parse(postData);
            } catch {}
            if (json) {
              const found = findClarityId(json);
              if (found) clarityId = found;
            }
          }
        } catch {}
      }
    });

    // Load main URL
    await page.goto(inputUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Fallback check for clarity ID and fbPixel ID in script tags
    const fallback = await page.evaluate(() => {
      const result = { clarity: null, fbPixel: null };
      const scripts = Array.from(document.querySelectorAll('script'));

      for (const script of scripts) {
        if (!result.clarity && script.src?.includes('clarity.ms/tag/')) {
          const match = script.src.match(/clarity\.ms\/tag\/([a-z0-9]+)/i);
          if (match) result.clarity = match[1];
        }

        if (!result.fbPixel && script.innerText.includes("fbq('init'")) {
          const match = script.innerText.match(/fbq\(['"]init['"],\s*['"](\d{5,})['"]\)/);
          if (match) result.fbPixel = match[1];
        }
      }

      return result;
    });

    if (!clarityId) clarityId = fallback.clarity;
    if (!fbPixelId) fbPixelId = fallback.fbPixel;

    // Footer links
    const footerLinks = await page.evaluate(() => {
      const anchors = new Set();
      const collectLinks = (container) => {
        if (!container) return;
        for (const a of container.querySelectorAll('a')) {
          const href = a.href?.trim();
          const text = a.textContent?.trim();
          if (href) anchors.add(JSON.stringify({ text, href }));
        }
      };
      collectLinks(document.querySelector('footer'));
      document.querySelectorAll('[class*="footer"]').forEach(collectLinks);
      collectLinks(document.querySelector('.footer-links'));
      return Array.from(anchors).map(str => JSON.parse(str));
    });

    // First TRF ad link
    const trfLink = await page.evaluate(() => {
      const a = document.querySelector('a[href*="trf"]');
      return a ? a.href : null;
    });

    // Load &test version to get portfolio ID and sourctag
    let portfolioId = null;
    let sourctag = null;
    const testUrl = inputUrl.includes('?') ? inputUrl + '&test' : inputUrl + '?test';

    try {
      await page.goto(testUrl, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(3000);

      const debugInfo = await page.evaluate(() => {
        const text = document.body.innerText;
        const portfolioMatch = text.match(/portfolio[_\s\-]?id[:=]?\s*([a-zA-Z0-9\-]+)/i);
        const sourctagMatch = text.match(/src=([a-zA-Z0-9\-_]+)/i);
        return {
          portfolioId: portfolioMatch ? portfolioMatch[1] : null,
          sourctag: sourctagMatch ? sourctagMatch[1] : null
        };
      });

      portfolioId = debugInfo.portfolioId;
      sourctag = debugInfo.sourctag;
    } catch (err) {
      console.warn(`⚠️ Test mode page failed: ${err.message}`);
    }

    await browser.close();

    res.json({
      clarityId: clarityId || 'Not Found',
      fbPixelId: fbPixelId || 'Not Found',
      trfLink: trfLink || 'Not Found',
      footerLinks: footerLinks.length > 0 ? footerLinks : ['Not Found'],
      portfolioId: portfolioId || 'Not Found',
      sourctag: sourctag || 'Not Found'
    });

  } catch (err) {
    if (browser) await browser.close();
    console.error('Error analyzing page:', err);
    res.status(500).json({ error: 'Failed to analyze the page' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
