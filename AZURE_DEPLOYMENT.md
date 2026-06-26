# Azure Deployment Setup

This repository is prepared for Azure with:

- `Azure Static Web Apps` for the frontend
- `Azure App Service` for the Spring Boot backend
- `Azure Database for PostgreSQL Flexible Server` for the database
- GitHub Actions workflows for both deployments

## Recommended Azure layout

- Frontend: `Azure Static Web Apps`
- Backend: `Azure App Service` on Linux with Java 21
- Database: `Azure Database for PostgreSQL Flexible Server`

## 1. Create the PostgreSQL database on Azure

In Azure Portal:

1. Create `Azure Database for PostgreSQL Flexible Server`
2. Use a small development/burstable tier
3. Create a database named `careeros`
4. Note:
   - server name
   - admin username
   - admin password

Your JDBC URL format will be:

`jdbc:postgresql://<server-name>.postgres.database.azure.com:5432/careeros?sslmode=require`

## 2. Create the backend on Azure

In Azure Portal:

1. Create a `Resource Group`
2. Create a `Web App`
3. Use:
   - Publish: `Code`
   - Runtime stack: `Java 21`
   - Operating System: `Linux`
4. Note the app URL:
   - `https://<your-backend-app>.azurewebsites.net`

## 3. Configure backend application settings

In the Azure Web App, open `Settings > Environment variables` and add:

- `SPRING_DATASOURCE_URL=jdbc:postgresql://<server-name>.postgres.database.azure.com:5432/careeros?sslmode=require`
- `SPRING_DATASOURCE_USERNAME=<your-postgres-username>`
- `SPRING_DATASOURCE_PASSWORD=<your-postgres-password>`
- `SPRING_DATASOURCE_DRIVER_CLASS_NAME=org.postgresql.Driver`
- `SPRING_JPA_HIBERNATE_DIALECT=org.hibernate.dialect.PostgreSQLDialect`
- `CORS_ALLOWED_ORIGINS=https://<your-static-web-app-host>`
- `OPENAI_API_KEY=...`
- `ANTHROPIC_API_KEY=...`
- `GEMINI_API_KEY=...`
- `PERPLEXITY_API_KEY=...`

Notes:

- The app still supports SQLite locally, but Azure should use PostgreSQL.
- If Azure shows a username format like `adminuser@server-name`, use exactly that value.

## 4. Add GitHub backend deployment settings

In GitHub repo settings:

### Actions variable

- `AZURE_BACKEND_APP_NAME`
  - Example: `careeros-backend-student`

### Actions secret

- `AZURE_BACKEND_WEBAPP_PUBLISH_PROFILE`
  - Get this from Azure Portal:
    - `Web App > Overview > Get publish profile`

## 5. Deploy backend

Run the GitHub Actions workflow:

- `Deploy Backend To Azure App Service`

After deployment, test:

- `https://<your-backend-app>.azurewebsites.net/api/health`

## 6. Create the frontend on Azure

In Azure Portal:

1. Create `Static Web App`
2. Link the GitHub repo
3. Use any placeholder build settings in Azure if asked
4. After creation, get the deployment token from:
   - `Static Web App > Manage deployment token`

## 7. Add GitHub frontend deployment settings

In GitHub repo settings:

### Actions variable

- `AZURE_BACKEND_API_BASE_URL`
  - Example:
  - `https://<your-backend-app>.azurewebsites.net/api`

### Actions secret

- `AZURE_STATIC_WEB_APPS_API_TOKEN`
  - Use the deployment token from the Static Web App

## 8. Deploy frontend

Run the GitHub Actions workflow:

- `Deploy Frontend To Azure Static Web Apps`

## 9. Notes about the current repo

- The existing `.github/workflows/deploy.yml` still handles GitHub Pages deployment.
- The new Azure workflows are:
  - `.github/workflows/azure-backend.yml`
  - `.github/workflows/azure-frontend.yml`
- The backend CORS policy now supports environment-based configuration through:
  - `CORS_ALLOWED_ORIGINS`

## 10. Suggested first test flow

1. Create PostgreSQL
2. Set backend environment variables
3. Deploy backend
4. Verify `/api/health`
5. Set `AZURE_BACKEND_API_BASE_URL`
6. Deploy frontend
7. Upload a resume and JD in the Azure-hosted app
8. Generate a document

## 11. Expected limitations on student/free usage

- Azure App Service free/shared tiers are fine for testing, but can be tight for repeated file parsing and AI generation.
- Azure PostgreSQL is a better fit than SQLite, but you should still choose the smallest development tier to stay within student budget.
