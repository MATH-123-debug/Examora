# Vercel Deploy Checklist

## Before Push

- Run `npm run build`
- Confirm `.env.local` secrets are not committed
- Confirm Firebase Auth authorized domains include:
  - `localhost`
  - your Vercel preview domain
  - your production domain

## Required Vercel Environment Variables

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

At least one AI provider key is required:

- `OPENAI_API_KEY`
- or `GROQ_API_KEY`
- or `GEMINI_API_KEY`
- or `MISTRAL_API_KEY`
- or `COHERE_API_KEY`
- or `TOGETHER_API_KEY`

Optional model overrides:

- `OPENAI_MODEL`
- `GROQ_MODEL`
- `GEMINI_MODEL`
- `MISTRAL_MODEL`
- `COHERE_MODEL`
- `TOGETHER_MODEL`

## Git Push Flow

1. `git status`
2. `git add .`
3. `git commit -m "feat: prepare study workspace and deploy setup"`
4. `git push origin master`

## Vercel Flow

1. Import the GitHub repository into Vercel
2. Add the environment variables from `.env.example`
3. Deploy
4. Test:
   - `/login`
   - `/signup`
   - `/study`
   - `/test`
   - PDF upload
   - Google sign-in

## MVP Testing Focus

- Can a user sign up and log in?
- Can a user upload a PDF or DOCX and get a useful explanation?
- Does the study chat continue naturally across follow-up prompts?
- Can a user generate questions and move into test mode?
- Are recent sessions being saved and reopened?

## Known MVP Notes

- Rate limiting is currently in-memory and best for light testing, not scale
- AI provider fallback may increase response time
- This is suitable for V1 beta testing, not large public traffic yet
