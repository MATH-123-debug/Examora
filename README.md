# Smart Working CBT

Smart Working CBT is an AI-powered study assistant for university students.

## Product Goal

Help students:

- understand difficult course materials faster
- revise more effectively
- practice for both CBT and theory exams

## Version 1 Scope

Version 1 focuses on the core study loop:

- authentication
- beautiful landing page
- beautiful login and signup pages
- dashboard
- input options:
  - PDF upload
  - topic input
  - course outline input
  - plain text input
- AI actions:
  - summarize
  - quick revision
  - explain like lecturer
  - step-by-step explanation
- exam generation:
  - MCQ
  - short answer
  - theory/writing questions
- basic test mode
- score display for objective questions
- model answers for theory questions
- feedback system
- recent study history

## Tech Stack

- Next.js
- Tailwind CSS
- Firebase
- OpenAI API
- pdf-parse

## Branch Strategy

- `main` for stable releases
- `dev` for integration
- `feature/*` for feature work

## Commit Style

Examples:

- `feat: add landing page`
- `feat: implement auth flow`
- `feat: add pdf upload`
- `fix: correct scoring logic`

