// server.js
const express = require('express');
const cors = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());          // optional, but handy
app.use(express.json());  // optional, in case you add POST routes later

// GET /
app.get('/', (req, res) => {
  res.send('Hello World');
});

// (Optional) POST /hello → JSON response
app.post('/hello', (req, res) => {
  res.json({ message: 'Hello World' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
