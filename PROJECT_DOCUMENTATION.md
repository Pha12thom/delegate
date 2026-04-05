# Delegate Project Documentation

This document provides a fuller guide to installing, configuring, running, and deploying Delegate.

## Overview

Delegate is an AI assistant for Slack and Discord. It uses Auth0 for authentication and Auth0 Token Vault to securely access user-authorized service tokens.

The app has two parts:

- **Client**: React + Vite chat UI
- **Server**: Express API with an agent loop and streamed responses

## Main capabilities

- Secure sign-in with Auth0
- Connect Slack and Discord through Auth0
- Fetch vault tokens at runtime
- Read and summarize messages
- Post updates and handle approved tool actions
- Stream results back to the browser

## Technology stack

- TypeScript
- React
- Vite
- Node.js
- Express
- Auth0
- Auth0 Token Vault
- OpenRouter
- Slack Web API
- Discord API
- Server-Sent Events
- Vercel

## Repository structure

```text
delegate/
├── api/                      # Vercel serverless entry point
├── client/                   # Frontend app
├── server/                   # Backend API and agent logic
├── package.json              # Workspace root
├── package-lock.json
├── vercel.json               # Deployment config
└── README.md
```

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/Pha12thom/delegate.git
cd delegate
```

### 2. Install dependencies

```bash
npm install
```

The repository uses npm workspaces, so dependencies for both client and server are installed together.

## Environment setup

Create the following files:

- `server/.env`
- `client/.env`

### Server environment variables

Required values:

- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_CONNECTION_SLACK`
- `AUTH0_CONNECTION_DISCORD`
- `AUTH0_MGMT_TOKEN` or `AUTH0_M2M_CLIENT_ID` and `AUTH0_M2M_CLIENT_SECRET`
- `OPENROUTER_API_KEY`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `SLACK_APP_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_BOT_TOKEN`
- `CLIENT_URL`
- `PORT`

### Client environment variables

Required values:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`
- `VITE_API_URL`
- `VITE_AUTH0_CONNECTION_SLACK`
- `VITE_AUTH0_CONNECTION_DISCORD`

## Local development

Run the full app:

```bash
npm run dev
```

Expected local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## Production build

Build the entire project:

```bash
npm run build
```

This builds the client and then compiles the server TypeScript.

## How the app works

### Authentication

The frontend uses Auth0 SPA login. The backend validates access tokens before serving API requests.

### Token Vault flow

When the agent needs Slack or Discord access:

1. The server identifies the user.
2. The server asks Auth0 for the stored connection token.
3. The token is returned only for that request.
4. The agent uses the token to call the service API.

### Chat flow

1. User sends a prompt.
2. Client posts the message to the API.
3. Server runs the agent loop.
4. Tool calls are executed on demand.
5. Events are streamed back using SSE.

## Deployment

### Vercel

The repository is already configured for Vercel.

Key settings:

- Build command: `npm run build`
- Output directory: `client/dist`
- API functions: `api/**/*.ts`

Before deployment, ensure the correct production environment variables are set in the right Vercel project.

### Auth0 settings for production

Make sure the deployed frontend domain is added to:

- Allowed Callback URLs
- Allowed Logout URLs
- Allowed Web Origins

Also confirm the Slack and Discord Auth0 connections are enabled for the SPA application.

## Common issues

### API returns 404

Check that Vercel is deploying the correct branch and that API routes are included.

### Auth connection fails

This usually means the Auth0 connection is not enabled for the SPA application or the connection name does not match the code.

### Sidebar not showing

The UI now auto-opens the sidebar on desktop widths. Refresh after resizing if needed.

### Build exits with 127

This usually points to a command or dependency resolution issue in the build environment. Verify the Vercel install/build settings.

## Extending the project

To add a new service integration:

1. Create a tool module in `server/src/tools/`.
2. Add the tool definition in `server/src/agents/delegate.ts`.
3. Map the tool to a connection or token source.
4. Expose the connection in the frontend if needed.
5. Add the Auth0 connection and enable Token Vault.

## Security notes

- Never commit secrets to the repo.
- Keep production env vars in Vercel and local env vars only on your machine.
- Rotate any credentials that were pasted into chat or shared publicly.
