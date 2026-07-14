# BagScan Insight

Lovable-generated baggage scan app with an added local Gemini mode.

## Local Gemini Mode

Local Gemini mode uses the local `GEMINI_API_KEY_2` for analysis. `GEMINI_API_KEY` is kept only
as a fallback. Scan and report routes still require Supabase sign-in.

Create `.env.local`:

```bash
GEMINI_API_KEY_2=your_gemini_api_key_here
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

- `/scan-local`: browser captures photos, local server function calls Gemini directly with `GEMINI_API_KEY_2`, requires Supabase auth.
- `/reports-local`: locally saved scan reports and photo sets.
- `/scan`: original cloud mode, requires Supabase auth/storage/database and Lovable AI Gateway config.

## Auth

The app uses Supabase email/password sign-in. Create the two operator accounts in Supabase
Authentication -> Users and mark their emails confirmed. Password recovery links are handled at
`/reset-password`; Supabase Auth URL Configuration must not point to `localhost:3000`.

## Local storage

Completed local scans are saved on this machine:

- SQLite DB: `data/bagscan.sqlite`
- Photos: `data/bagscan-images/<scan-id>/`

The `data/` folder is ignored by git.

Dimensions are returned as Gemini visual estimates from the four same-baggage views, with confidence and basis recorded in the report. If the views are mixed, duplicated, or unusable, the app asks for the specific photo to be retaken.

## Production deployment

Production runs from Docker. Secrets must live in the VM `.env` file and must not be committed or
baked into the image.

```bash
docker compose up -d --build
```

If a Gemini key is exposed, rotate it in Google Cloud/AI Studio, update `GEMINI_API_KEY_2` in the VM
`.env`, and rebuild/restart the container.
