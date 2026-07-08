# OAuth Sign-In Setup Guide

Set up Google and LinkedIn OAuth for BagScan.

## Overview

The application supports:
- ✅ Google OAuth (configured via Lovable)
- ✅ LinkedIn OAuth (needs manual setup)

## Step 1: Set up Google OAuth

### 1.1 Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API:
   - Go to "APIs & Services" → "Library"
   - Search for "Google+ API" and enable it

4. Configure OAuth consent screen:
   - Go to "APIs & Services" → "OAuth consent screen"
   - Choose "External" (for production) or "Internal" (for testing)
   - Add required fields:
     - App name: `BagScan`
     - User support email: `your-email@example.com`
     - Developer contact: `your-email@example.com`
   - Add scopes:
     - `openid`
     - `email`
     - `profile`

5. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: `Web application`
   - Name: `BagScan Web`
   - Authorized redirect URIs:
     - `https://godigit.yavar.ai/auth/callback`
     - `http://35.244.7.120:8011/auth/callback`
     - `http://localhost:3000/auth/callback` (for local development)
   - Save and copy:
     - **Client ID**
     - **Client Secret**

### 1.2 Configure in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/spzuiycdiiymapqbrnkl)
2. Navigate to: **Authentication** → **Providers** → **Google**
3. Enable Google provider
4. Add your credentials:
   - **Client ID**: Your Google OAuth client ID
   - **Client Secret**: Your Google OAuth secret
5. Save the configuration

## Step 2: Set up LinkedIn OAuth

### 2.1 Create LinkedIn App

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/)
2. Sign in and go to "Create App"
3. Fill in app details:
   - **App name**: `BagScan`
   - **Description**: `AI-powered baggage scanning application`
   - **LinkedIn Page**: Select your company page (optional)
   - **App logo**: Upload a logo (optional)
   - **Email**: `your-email@example.com`

4. Configure OAuth 2.0 redirect URLs:
   - Add: `https://godigit.yavar.ai/auth/callback`
   - Add: `http://35.244.7.120:8011/auth/callback`
   - Add: `http://localhost:3000/auth/callback` (for local development)

5. Select products:
   - Add **Sign In with LinkedIn** (this enables OAuth)

6. Configure permissions:
   - `r_liteprofile` (Basic profile)
   - `r_emailaddress` (Email address)

7. Save and copy:
   - **Client ID**
   - **Client Secret**

### 2.2 Configure in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/spzuiycdiiymapqbrnkl)
2. Navigate to: **Authentication** → **Providers** → **LinkedIn**
3. Enable LinkedIn provider
4. Add your credentials:
   - **Client ID**: Your LinkedIn OAuth client ID
   - **Client Secret**: Your LinkedIn OAuth secret
5. **Authorized Redirect URLs**:
   - `https://godigit.yavar.ai/auth/callback`
   - `http://35.244.7.120:8011/auth/callback`
6. Save the configuration

## Step 3: Test Locally

```bash
cd /Users/yavar/Documents/CoE/godigitag/bag-scan-insight
npm run dev
```

Visit: `http://localhost:3000/auth`

## Step 4: Deploy to VM

After testing locally:

```bash
cd /Users/yavar/Documents/CoE/godigitag/bag-scan-insight
git add .
git commit -m "feat: Add LinkedIn OAuth sign-in"
git push

# On VM
ssh -i "/Users/yavar/Documents/CoE/godigitag/deployment/yavar-poc 2 (1)" yavar-poc@35.244.7.120
cd poc/godigit && git pull
docker compose build
docker compose up -d
```

## OAuth URLs

| Provider | Callback URL |
|----------|--------------|
| Google | `https://godigit.yavar.ai/auth/callback` |
| LinkedIn | `https://godigit.yavar.ai/auth/callback` |

## Troubleshooting

### Error: "Redirect URI mismatch"
- Ensure all redirect URIs are added in both:
  - OAuth provider settings (Google/LinkedIn)
  - Supabase authentication settings

### Error: "Invalid client credentials"
- Verify Client ID and Client Secret are correct
- Check for extra spaces in credentials

### Error: "Provider not enabled"
- Enable the provider in Supabase Dashboard
- Check provider is listed in Authentication → Providers

## Environment Variables (Optional)

If you want to override provider settings:

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

## Security Notes

- Never commit OAuth secrets to git
- Use different redirect URIs for production and development
- Regularly rotate OAuth secrets
- Monitor OAuth usage in provider dashboards
