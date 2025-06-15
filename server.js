const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
  res.json({ success: true, message: 'pong!' });
});

app.get('/random', (req, res) => {
  const min = parseInt(req.query.min) || 0;
  const max = parseInt(req.query.max) || 100;
  if (min > max) {
    return res.status(400).json({ success: false, error: '`min` should be ≤ `max`' });
  }
  const rand = Math.floor(Math.random() * (max - min + 1)) + min;
  res.json({ success: true, min, max, random: rand });
});

app.get('/', (req, res) => {
  res.send('✅ Test API is live ✅');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Test API running on port ${PORT}`);
});
