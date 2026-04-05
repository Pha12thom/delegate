# Delegate

Delegate is an AI agent for Slack and Discord secured by Auth0 Token Vault. It lets a user sign in, connect services, and ask the agent to read messages, summarize activity, and perform approved actions on their behalf.

## Features

- Auth0 login and secure delegated access
- Slack and Discord service connections
- Token Vault-based token retrieval
- Streaming chat UI with tool-call visibility
- Server-side agent execution with SSE responses
- Vercel-ready deployment for the frontend and API routes

## How it works

1. The user signs in with Auth0.
2. The user connects Slack or Discord through Auth0.
3. The backend retrieves the stored access token from Auth0 Token Vault.
4. The agent uses that token to call the service API.
5. Results stream back to the client in real time.

## Project structure

```text
delegate/
├── api/
│   └── index.ts
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css
│   │   └── hooks/useAgent.ts
│   ├── package.json
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── agents/delegate.ts
│   │   ├── lib/vault.ts
│   │   ├── routes/agent.ts
│   │   └── tools/
│   ├── package.json
│   └── tsconfig.json
├── package.json
├── package-lock.json
└── vercel.json
```

## Prerequisites

- Node.js 20+
- Auth0 tenant
- Slack app credentials
- Discord app credentials or bot token
- OpenRouter API key

## Install

```bash
npm install
```

## Environment files

Use separate env files:

- [server/.env](server/.env)
- [client/.env](client/.env)

Server env should contain:

- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_CONNECTION_SLACK`
- `AUTH0_CONNECTION_DISCORD`
- `AUTH0_MGMT_TOKEN` or `AUTH0_M2M_CLIENT_ID` + `AUTH0_M2M_CLIENT_SECRET`
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

Client env should contain:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`
- `VITE_API_URL`
- `VITE_AUTH0_CONNECTION_SLACK`
- `VITE_AUTH0_CONNECTION_DISCORD`

## Run locally

```bash
npm run dev
```

Default local URLs:

- Client: http://localhost:5173
- Server: http://localhost:3001

## Build

```bash
npm run build
```

## Deployment

### Vercel

This repo is set up for Vercel with:

- build command: `npm run build`
- output directory: `client/dist`
- API routes under `api/`

Set production environment variables in the Vercel project dashboard, then redeploy.

### Auth0 production settings

Add your deployed domain to:

- Allowed Callback URLs
- Allowed Logout URLs
- Allowed Web Origins

## Using the app

1. Sign in with Auth0.
2. Connect Slack or Discord.
3. Wait for connections to show as connected.
4. Ask the agent to summarize, read, or post.
5. Approve any auth prompt if the service needs access.

## Troubleshooting

- If `/api/chat` returns 404, check Vercel routing and the deployed API function.
- If a service stays disconnected, verify the Auth0 connection is enabled for the SPA app.
- If build fails, confirm the Vercel install/build commands match the repo workspace layout.
- If the desktop sidebar disappears, refresh on desktop or resize the window after the sidebar auto-open fix.

## Notes

- The app uses OpenRouter in the current implementation.
- Token Vault keeps user OAuth tokens out of the agent and server code paths.
- Do not commit secrets to the repository.

## License

MIT
