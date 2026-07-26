const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/search", requireAuth, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "query parameter 'q' is required" });
  }

  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "GIF search isn't configured yet — add GIPHY_API_KEY to backend/.env (see README).",
    });
  }

  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=16&rating=pg-13`;
    const giphyRes = await fetch(url);

    if (!giphyRes.ok) {
      const text = await giphyRes.text().catch(() => "");
      console.error("Giphy API error:", giphyRes.status, text);
      return res.status(502).json({ error: "GIF search failed — the GIF provider returned an error" });
    }

    const data = await giphyRes.json();
    const results = (data.data || [])
      .map((g) => ({
        id: g.id,
        title: g.title || q,
        previewUrl: g.images?.fixed_height_small?.url,
        fullUrl: g.images?.fixed_height?.url || g.images?.downsized?.url,
      }))
      .filter((r) => r.previewUrl && r.fullUrl);

    res.json({ results });
  } catch (err) {
    console.error("GIF search request failed:", err.message);
    res.status(502).json({ error: "couldn't reach the GIF provider — check your internet connection" });
  }
});

module.exports = router;
