# CareerOS AI

CareerOS AI is a local-first career operating system built with Next.js 15, TypeScript, Tailwind CSS, Zustand, React Hook Form, Java 21, Spring Boot 3, SQLite, and GitHub Pages deployment automation.

## Included features

- Dashboard for resumes, job descriptions, applications, interview pipeline, certifications, and study progress
- Persistent workspace modules for resumes, job descriptions, applications, STAR stories, interview notes, certifications, study plans, and company research
- Job description analyzer for PDF, DOCX, and TXT uploads
- AI generation for ATS resumes, cover letters, LinkedIn messages, recruiter emails, interview prep, company research, and text humanization
- Runtime provider switching across OpenAI, Claude, Gemini, and Perplexity
- Local fallback generation when provider keys are not configured
- Knowledge search across stored career artifacts
- DOCX, PDF, and Markdown export from generated artifacts
- GitHub Pages deployment workflow for the frontend
- Azure deployment workflows for Static Web Apps and App Service

## Structure

- `frontend/` Next.js application
- `backend/` Spring Boot API with SQLite persistence

## Run locally

Backend:

```bash
cd backend
./gradlew bootRun
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` for the app and `http://localhost:8080/api/health` for the backend health check.

## Optional provider keys

The backend works without API keys by falling back to local template generation. To enable live provider calls, set any needed keys before starting the backend:

```bash
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GEMINI_API_KEY=...
export PERPLEXITY_API_KEY=...
```

## Verification

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

Backend:

```bash
cd backend
./gradlew test
```

## Deployment

The GitHub Pages workflow publishes the static frontend export to:

`https://<github-username>.github.io/careeros-ai/`

### Render backend

To deploy the Spring Boot backend on Render:

1. Create a new `Web Service`
2. Select this GitHub repo
3. Use:
   - Branch: `main`
   - Root Directory: `backend`
   - Runtime: `Docker`
   - Dockerfile Path: `backend/Dockerfile` if Render asks for a path from repo root, or `./Dockerfile` if it resolves from the root directory
   - Plan: `Free`
4. Add environment variables:
   - `SPRING_PROFILES_ACTIVE=prod`
   - `SQLITE_DB_PATH=/tmp/careeros-ai.db`
   - `OPENAI_API_KEY=...`
   - `ANTHROPIC_API_KEY=...`
   - `GEMINI_API_KEY=...`
   - `PERPLEXITY_API_KEY=...`
5. After Render gives you the backend URL, rebuild the frontend with:
   - `NEXT_PUBLIC_API_BASE_URL=https://<your-render-service>.onrender.com/api`

## Notes

- The SQLite database is created locally as `backend/careeros-ai.db`
- The repository is initialized at the workspace root on branch `main`

## Azure deployment

This repo is now prepared for Azure Student deployment.

- Frontend workflow: [.github/workflows/azure-frontend.yml](.github/workflows/azure-frontend.yml)
- Backend workflow: [.github/workflows/azure-backend.yml](.github/workflows/azure-backend.yml)
- Full setup guide: [AZURE_DEPLOYMENT.md](AZURE_DEPLOYMENT.md)

Main GitHub variables and secrets you need:

- Variable: `AZURE_BACKEND_APP_NAME`
- Variable: `AZURE_BACKEND_API_BASE_URL`
- Secret: `AZURE_BACKEND_WEBAPP_PUBLISH_PROFILE`
- Secret: `AZURE_STATIC_WEB_APPS_API_TOKEN`
