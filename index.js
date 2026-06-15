const express = require('express');
const sharp = require('sharp');
const axios = require('axios');
const app = express();

// --- Spotify token (auto-refreshes) ---
let spotifyToken = null;
let tokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken;

  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      }
    }
  );

  spotifyToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 5000;
  return spotifyToken;
}

// --- Search albums by name ---
app.get('/album', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'Missing name parameter' });

    const token = await getSpotifyToken();
    const response = await axios.get('https://api.spotify.com/v1/search', {
      headers: { 'Authorization': 'Bearer ' + token },
      params: { q: name, type: 'album', limit: 1 }
    });

    const album = response.data.albums.items[0];
    if (!album) return res.status(404).json({ error: 'Album not found' });

    res.json({
      name: album.name,
      artist: album.artists[0].name,
      imageUrl: album.images[0].url
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Convert image URL to pixels ---
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

// Replace the /album-pixels endpoint with this multi-result version
app.get('/album-pixels', async (req, res) => {
  try {
    const { name, size = 32, limit = 10 } = req.query;
    if (!name) return res.status(400).json({ error: 'Missing name parameter' });

    const token = await getSpotifyToken();
    const searchRes = await axios.get('https://api.spotify.com/v1/search', {
      headers: { 'Authorization': 'Bearer ' + token },
      params: { q: name, type: 'album', limit: Math.min(parseInt(limit), 50) }
    });

    const albums = searchRes.data.albums.items;
    if (!albums.length) return res.status(404).json({ error: 'No albums found' });

    // Fetch pixel data for all albums in parallel
    const results = await Promise.all(albums.map(async (album) => {
      try {
        const imageUrl = album.images[0]?.url;
        if (!imageUrl) return null;

        const imgRes = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        const { data, info } = await sharp(imgRes.data)
          .resize(parseInt(size), parseInt(size))
          .raw()
          .toBuffer({ resolveWithObject: true });

        // Change the pixel building loop in index.js
        const pixels = [];
        for (let i = 0; i < data.length; i += 3) {
          // flat array [r,g,b,r,g,b,...] instead of [{r,g,b},...]
          pixels.push(data[i], data[i+1], data[i+2]);
        }
        
        return {
          albumName: album.name,
          artist: album.artists[0].name,
          pixels,  // now a flat array, 3x smaller JSON
          width: info.width,
          height: info.height
        };
      } catch (e) {
        return null; // skip any album that fails
      }
    }));

    res.json(results.filter(Boolean)); // remove nulls
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
