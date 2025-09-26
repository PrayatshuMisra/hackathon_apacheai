# Aura – Intelligent Aviation Weather Briefings (MVP)

A minimal, modern SPA demo built without a build step. Uses Tailwind via CDN and vanilla JS.

Features:
- Landing page with hero and interactive value cards
- Flight plan input with smooth transition to results
- Briefing results with color-coded flight categories, hover tooltips, and route summary
- Global deep aviation blue theme with animated rain overlay

## Run locally
No build required.

1. Open `aura/index.html` directly in your browser, or
2. Serve the folder with a simple static server to enable history navigation:

```bash
# Python 3
python -m http.server 8080
# then open http://localhost:8080/aura/
```

On Windows, you can also open `aura/index.html` by double-clicking it. If direct file navigation causes issues with back/forward navigation, prefer the static server approach.

## Usage
- Click "Start Briefing" on the landing page
- Enter a route like `KRIC KJFK KORD`
- Click "Generate Briefing" to view results

This MVP uses mock data; METAR/TAF integrations and map view are placeholders for future work.

## Design Notes
- Base color: `#0a1a3f`
- Tailwind utility classes + small custom CSS for rain overlay, glow, and transitions
- Flight Category colors: VFR (green), MVFR (blue), IFR (red), LIFR (magenta)

## License
MIT
