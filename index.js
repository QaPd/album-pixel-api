const express = require('express');
const sharp = require('sharp');
const axios = require('axios');
const app = express();

app.get('/pixels', async (req, res) => {
  try {
    const { url, size = 32 } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    const response = await axios({ url, responseType: 'arraybuffer' });

    const { data, info } = await sharp(response.data)
      .resize(parseInt(size), parseInt(size))
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = [];
    for (let i = 0; i < data.length; i += 3) {
      pixels.push({ r: data[i], g: data[i+1], b: data[i+2] });
    }

    res.json({ pixels, width: info.width, height: info.height });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));