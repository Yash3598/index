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

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US'
  });

  const page = await context.newPage();

  await page.goto(inputUrl, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);

  const trfLink = await page.evaluate(() => {
    const a = document.querySelector('a[href*="trf"]');
    return a ? a.href : null;
  });

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

  await browser.close();

  res.json({
    trfLink,
    footerLinks
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
