const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Get all <a> tags with hrefs containing 'trf'
    const trfLinks = await page.$$eval('a[href*="trf"]', links =>
      links.map(link => link.href).slice(0, 2)
    );

    await browser.close();

    res.json({ trfLinks });

  } catch (err) {
    console.error('Error analyzing page:', err);
    res.status(500).json({ error: 'Failed to analyze the page' });
  }
});

app.get('/', (req, res) => {
  res.send('Server is running. Use POST /analyze with { "url": "https://example.com" }');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
