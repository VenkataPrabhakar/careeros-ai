# Azure Deployment Setup

This repository is prepared for Azure with:

- `Azure Static Web Apps` for the frontend
- `Azure App Service` for the Spring Boot backend
- GitHub Actions workflows for both deployments

## Recommended Azure layout

- Frontend: `Azure Static Web Apps`
- Backend: `Azure App Service` on Linux with Java 21
- Database for quick testing: SQLite
- Database for longer-term usage: PostgreSQL later

## 1. Create the backend on Azure

In Azure Portal:

1. Create a `Resource Group`
2. Create a `Web App`
3. Use:
   - Publish: `Code`
   - Runtime stack: `Java 21`
   - Operating System: `Linux`
4. Note the app URL:
   - `https://<your-backend-app>.azurewebsites.net`

## 2. Configure backend application settings

In the Azure Web App, open `Settings > Environment variables` and add:

- `SQLITE_DB_PATH=/home/site/data/careeros-ai.db`
- `CORS_ALLOWED_ORIGINS=https://<your-static-web-app-host>`
- `OPENAI_API_KEY=...`
- `ANTHROPIC_API_KEY=...`
- `GEMINI_API_KEY=...`
- `PERPLEXITY_API_KEY=...`

Notes:

- `/home/site/data` is the safest SQLite location for App Service persistence during simple testing.
- For real usage, move to PostgreSQL instead of SQLite.

## 3. Add GitHub backend deployment settings

In GitHub repo settings:

### Actions variable

- `AZURE_BACKEND_APP_NAME`
  - Example: `careeros-backend-student`

### Actions secret

- `AZURE_BACKEND_WEBAPP_PUBLISH_PROFILE`
  - Get this from Azure Portal:
    - `Web App > Overview > Get publish profile`

## 4. Deploy backend

Run the GitHub Actions workflow:

- `Deploy Backend To Azure App Service`

After deployment, test:

- `https://<your-backend-app>.azurewebsites.net/api/health`

## 5. Create the frontend on Azure

In Azure Portal:

1. Create `Static Web App`
2. Link the GitHub repo
3. Use any placeholder build settings in Azure if asked
4. After creation, get the deployment token from:
   - `Static Web App > Manage deployment token`

## 6. Add GitHub frontend deployment settings

In GitHub repo settings:

### Actions variable

- `AZURE_BACKEND_API_BASE_URL`
  - Example:
  - `https://<your-backend-app>.azurewebsites.net/api`

### Actions secret

- `AZURE_STATIC_WEB_APPS_API_TOKEN`
  - Use the deployment token from the Static Web App

## 7. Deploy frontend

Run the GitHub Actions workflow:

- `Deploy Frontend To Azure Static Web Apps`

## 8. Notes about the current repo

- The existing `.github/workflows/deploy.yml` still handles GitHub Pages deployment.
- The new Azure workflows are:
  - `.github/workflows/azure-backend.yml`
  - `.github/workflows/azure-frontend.yml`
- The backend CORS policy now supports environment-based configuration through:
  - `CORS_ALLOWED_ORIGINS`

## 9. Suggested first test flow

1. Deploy backend
2. Verify `/api/health`
3. Set `AZURE_BACKEND_API_BASE_URL`
4. Deploy frontend
5. Upload a resume and JD in the Azure-hosted app
6. Generate a document

## 10. Expected limitations on student/free usage

- Azure App Service free/shared tiers are fine for testing, but can be tight for repeated file parsing and AI generation.
- SQLite is okay for demo use, but not ideal for real multi-session usage.
