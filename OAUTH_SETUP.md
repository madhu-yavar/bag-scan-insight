# Password Sign-In Setup Guide

BagScan now uses Supabase email/password sign-in. Magic links are not used by the app login page.

## Create Two Users

Create two real users in Supabase Auth so the app receives normal Supabase sessions and JWTs.

### Option A: Create With Script

Use this if you have the Supabase service-role key. Do not commit this key.

Add these values to `.env.local` or export them in your shell:

```bash
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPERATOR_1_EMAIL=ms.madhugraj@gmail.com
OPERATOR_1_PASSWORD=choose-a-strong-password
OPERATOR_2_EMAIL=operator2@example.com
OPERATOR_2_PASSWORD=choose-a-different-strong-password
```

Then run:

```bash
npm run users:create
```

The script creates missing users and updates existing users' passwords. It also marks emails
confirmed.

### Option B: Create From Dashboard

1. Open Supabase Dashboard for the BagScan project.
2. Go to **Authentication** -> **Users**.
3. Click **Add user** -> **Create new user**.
4. Create the first user:
   - Email: `operator1@godigit.local` or your preferred operator email.
   - Password: set a strong password and store it in your password manager.
   - Auto Confirm User: enabled.
5. Create the second user:
   - Email: `operator2@godigit.local` or your preferred operator email.
   - Password: set a different strong password.
   - Auto Confirm User: enabled.

The email must be confirmed, otherwise `signInWithPassword` can fail depending on the Supabase
project's email-confirmation settings.

## Required Auth Settings

1. Go to **Authentication** -> **Providers** -> **Email**.
2. Keep **Email provider** enabled.
3. Make sure password sign-in is enabled.
4. If you manually create users from the dashboard, either enable **Auto Confirm User** during
   creation or confirm them afterward from the user detail page.

## App URLs

These are still useful for redirects after sign-out or if old callback links exist, but password
login does not depend on email redirect delivery.

1. Go to **Authentication** -> **URL Configuration**.
2. Set **Site URL** to `https://godigit.yavar.ai`.
3. Add these **Redirect URLs**:
   - `https://godigit.yavar.ai/auth/callback`
   - `https://godigit.yavar.ai/reset-password`
   - `http://35.244.7.120:8011/auth/callback`
   - `http://35.244.7.120:8011/reset-password`
   - `http://localhost:5174/auth/callback` (local development only)
   - `http://localhost:5174/reset-password` (local password recovery testing)

If password reset emails still open `http://localhost:3000`, the Supabase **Site URL** is still set
to `localhost:3000` or the recovery email template has a hard-coded localhost URL. Use the default
recovery link template variable instead of a hard-coded URL.

## Test Locally

```bash
cd /Users/yavar/Documents/CoE/godigitag/bag-scan-insight
npm run dev -- --host 0.0.0.0 --port 5174
```

Visit `http://localhost:5174/auth` and sign in with one of the two users.

## Deploy

```bash
cd /Users/yavar/Documents/CoE/godigitag/bag-scan-insight
git add .
git commit -m "fix: switch auth to password login"
git push

# On VM
ssh -i "/Users/yavar/Documents/CoE/godigitag/deployment/yavar-poc 2 (1)" yavar-poc@35.244.7.120
cd poc/godigit && git pull
docker compose build
docker compose up -d
```

## Troubleshooting

### Error: "Invalid login credentials"

- Confirm the user exists in **Authentication** -> **Users**.
- Confirm the email is marked confirmed.
- Reset the user's password from the Supabase Dashboard and retry.

### Password Reset Link Opens localhost:3000

- Go to **Authentication** -> **URL Configuration**.
- Set **Site URL** to `http://localhost:5174` for local recovery testing, or
  `https://godigit.yavar.ai` for production.
- Add `http://localhost:5174/reset-password` to **Redirect URLs**.
- Generate a new reset email after saving the URL settings. Old emails keep the old URL.

### Error: "Email not confirmed"

- Open the user in Supabase Dashboard and confirm the email.
- For manually created operator accounts, use **Auto Confirm User**.

### User Can Sign In But Cannot Scan

- Check that `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are set on the server.
- Check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set for the client build.
- The server functions require a valid Supabase JWT; clearing browser storage and signing in again
  usually fixes stale sessions.

## Security Notes

- Do not commit passwords or service-role keys.
- Use unique passwords for the two users.
- Rotate the exposed Gemini API key before production use.
