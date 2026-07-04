# BagScan Insight

Lovable-generated baggage scan app with an added local Gemini mode.

## Local Mode

Local mode does not require Supabase, Lovable Cloud, or a Lovable API key.

Create `.env.local`:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

Run:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

Open:

- Mac: `http://localhost:5174/scan-local`
- Phone on same Wi-Fi: use the network URL printed by Vite

## Modes

- `/scan-local`: browser captures photos, local server function calls Gemini directly with `GEMINI_API_KEY`, no Supabase.
- `/reports-local`: locally saved scan reports and photo sets.
- `/scan`: original cloud mode, requires Supabase auth/storage/database and Lovable AI Gateway config.

## Local storage

Completed local scans are saved on this machine:

- SQLite DB: `data/bagscan.sqlite`
- Photos: `data/bagscan-images/<scan-id>/`

The `data/` folder is ignored by git.

Dimensions are returned as Gemini visual estimates from the four same-baggage views, with confidence and basis recorded in the report. If the views are mixed, duplicated, or unusable, the app asks for the specific photo to be retaken.
