// server.js
const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/analyze', async (req, res) => {
  const baseUrl = req.body.url;
  if (!baseUrl) {
    return res.status(400).json({ success: false, message: 'Missing URL' });
  }

  const testUrl = baseUrl + '&test';

  const browser = await chromium.launch({ headless: true });
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
  let fbPixelDetected = false;

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

    if (reqUrl.includes('facebook.com/tr')) {
      fbPixelDetected = true;
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

  try {
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
  } catch {}

  const fallbackIds = await page.evaluate(() => {
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

  clarityId = clarityId || fallbackIds.clarity;
  fbPixelId = fbPixelId || fallbackIds.fbPixel;

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

  const trfUrl = await page.evaluate(() => {
    const trfLinks = Array.from(document.querySelectorAll('a[href*="trf"]'));
    return trfLinks.length > 0 ? trfLinks[0].href : null;
  });

  let portfolioId = null;
  let sourctag = null;
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
  } catch {}

  await browser.close();

  return res.json({
    success: true,
    clarityId,
    fbPixelId,
    fbPixelDetected,
    footerLinks,
    trfUrl,
    portfolioId,
    sourctag
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
