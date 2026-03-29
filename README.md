# Delegate — AI Agent for Slack & Notion

> A personal productivity AI agent that acts on your behalf across Slack and Notion,  
> secured by **Auth0 Token Vault** — your credentials never touch the agent.

---

## What It Does

Delegate is a Claude-powered agent with a chat interface. You talk to it in plain English:

- **"Summarize #eng-alerts from the last 24 hours"** → reads Slack, returns a digest
- **"Create a Notion page with today's highlights"** → Auth0 issues a scoped token, page is created
- **"Post a standup update to #general"** → drafts from your Slack activity, posts with your approval
- **"What's urgent in #product this week?"** → surfaces action items, flags blockers

The key differentiator: **Auth0 Token Vault handles all OAuth flows**. The agent receives short-lived, scoped tokens — it never sees your Slack or Notion credentials.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (React)                     │
│  Auth0 SDK → gets JWT → sends with every API request    │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS + Bearer JWT
┌────────────────────▼────────────────────────────────────┐
│              Express API  (Node.js / TypeScript)         │
│                                                          │
│  1. Validates JWT via Auth0                              │
│  2. Runs Claude agent loop (tool use)                    │
│  3. Per tool call → fetches vault token from Auth0       │
│  4. Executes Slack / Notion API with that token          │
│  5. Streams results back via SSE                         │
└──────────┬──────────────────────────┬───────────────────┘
           │                          │
    ┌──────▼──────┐           ┌───────▼──────┐
    │  Auth0      │           │  Anthropic   │
    │  Token Vault│           │  Claude API  │
    │  (OAuth     │           │  (claude-    │
    │  tokens for │           │  opus-4-5)   │
    │  Slack &    │           └──────────────┘
    │  Notion)    │
    └─────────────┘
```

### Auth0 Token Vault Flow

```
User logs in with Auth0
    ↓
User authorizes Slack connection (Auth0 Social Connection)
    ↓
Auth0 stores the Slack OAuth token encrypted in Token Vault
    ↓
Agent wants to read Slack:
    → Server calls Auth0 Management API: GET /api/v2/users/{id}/identities
    → Auth0 returns the stored access_token for the Slack identity
    → Agent uses that token to call Slack API
    → Token is never stored server-side, never logged
```

---

## Project Structure

```
delegate/
├── package.json              # Workspace root
├── server/
│   ├── src/
│   │   ├── index.ts          # Express entry point
│   │   ├── lib/
│   │   │   └── vault.ts      # Auth0 Token Vault client
│   │   ├── agents/
│   │   │   └── delegate.ts   # Claude agent loop + tool definitions
│   │   ├── tools/
│   │   │   ├── slack.ts      # Slack API wrapper
│   │   │   └── notion.ts     # Notion API wrapper
│   │   └── routes/
│   │       └── agent.ts      # Express routes + SSE streaming
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
└── client/
    ├── src/
    │   ├── main.tsx           # Auth0Provider setup
    │   ├── App.tsx            # Main UI
    │   ├── index.css          # Global styles
    │   └── hooks/
    │       └── useAgent.ts    # SSE streaming hook
    ├── index.html
    ├── .env.example
    ├── package.json
    └── vite.config.ts
```

---

## Setup

### Prerequisites

- Node.js 20+
- An [Auth0](https://auth0.com) account (free tier works)
- An [Anthropic](https://console.anthropic.com) API key
- A Slack app with OAuth scopes
- A Notion OAuth integration

---

### 1. Clone & Install

```bash
git clone https://github.com/your-handle/delegate
cd delegate
npm install
```

---

### 2. Auth0 Setup

#### A. Create an Auth0 Application

1. Go to **Auth0 Dashboard → Applications → Create Application**
2. Choose **Single Page Application**
3. Set **Allowed Callback URLs**: `http://localhost:5173, http://127.0.0.1:5173`
4. Set **Allowed Logout URLs**: `http://localhost:5173, http://127.0.0.1:5173`
5. Set **Allowed Web Origins**: `http://localhost:5173, http://127.0.0.1:5173`
6. Note your **Domain** and **Client ID**

> Use this SPA application's client ID for `VITE_AUTH0_CLIENT_ID` in `client/.env`.

#### B. Create an API (for server JWT validation)

1. Go to **Auth0 Dashboard → APIs → Create API**
2. Set identifier to `https://your-tenant.auth0.com/api/v2/`
3. This is your `AUTH0_AUDIENCE`

#### C. Set Up Slack Social Connection (Token Vault)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Under **OAuth & Permissions**, add scopes:
   - `channels:history`, `channels:read`, `chat:write`, `users:read`
3. Set redirect URL to: `https://your-tenant.auth0.com/login/callback`
4. Note the **Client ID** and **Client Secret**
5. In Auth0: **Authentication → Social → Create Connection → Slack**
6. Enter your Slack Client ID and Secret
7. Enable the connection on your application
8. Under **Advanced → Token Vault**: enable **Store User Access Token**

#### D. Set Up Notion Social Connection (Token Vault)

1. Create a Notion integration at [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Choose **Public integration** with OAuth
3. Set redirect URI: `https://your-tenant.auth0.com/login/callback`
4. Note the **OAuth Client ID** and **Secret**
5. In Auth0: **Authentication → Social → Create Connection → Notion**
6. Enter your Notion credentials
7. Enable on your application
8. Under **Advanced → Token Vault**: enable **Store User Access Token**

#### E. Get a Management API Token

For the server to read vault tokens, it needs a Management API token:

1. Go to **Auth0 Dashboard → APIs → Auth0 Management API → API Explorer**
2. Click **Get Token** (or use Machine-to-Machine app)
3. Ensure scopes include: `read:users`, `read:user_idp_tokens`
4. Copy the token → `AUTH0_MGMT_TOKEN` in your server `.env`

> **Production note**: Use a Machine-to-Machine app with client credentials flow
> instead of a static management token. Rotate regularly.
>
> Keep M2M credentials server-side only. Do **not** put M2M client IDs/secrets in `client/.env`.

---

### 3. Environment Variables

```bash
# Server
cp server/.env.example server/.env
# Fill in: AUTH0_DOMAIN, AUTH0_AUDIENCE, AUTH0_MGMT_TOKEN,
#          AUTH0_M2M_CLIENT_ID, AUTH0_M2M_CLIENT_SECRET, ANTHROPIC_API_KEY

# Client
cp client/.env.example client/.env
# Fill in: VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID (SPA app), VITE_AUTH0_AUDIENCE
```

---

### 4. Run Locally

```bash
npm run dev
```

- Client: [http://localhost:5173](http://localhost:5173)
- Server: [http://localhost:3001](http://localhost:3001)

---

## Deployment

### Server → Railway / Render

```bash
# Set all env vars in your Railway/Render dashboard
# Build command:
npm run build --workspace=server

# Start command:
npm run start --workspace=server
```

### Client → Vercel

```bash
cd client
vercel deploy
# Set VITE_AUTH0_* env vars in Vercel dashboard
# Update Auth0 callback/logout URLs to your Vercel domain
```

---

## How Token Vault Works (The Important Part)

Token Vault is the core of this project's security model. Here's what happens at runtime:

```typescript
// In delegate.ts, before every tool call:
const { access_token } = await getVaultToken(userId, "slack");
//                                            ^^^^^^^^^^^^^^
//           Auth0 Management API → decrypts stored OAuth token
//           Returns short-lived access token scoped to what user authorized
//           Agent code NEVER stores this token

const messages = await SlackTools.getChannelMessages(access_token, "#eng-alerts");
```

If the user hasn't authorized a connection yet, `getVaultToken` throws a `VaultTokenError`. The agent catches this, emits an `auth_required` event, and the UI shows the Auth0 consent prompt — no credentials ever enter the agent's context.

---

## Extending with More Tools

Add a new tool in 3 steps:

**1. Write the tool** (`server/src/tools/github.ts`):
```typescript
export async function listPRs(token: string, repo: string) { ... }
```

**2. Add to the agent** (`server/src/agents/delegate.ts`):
```typescript
// Add to TOOLS array:
{ name: "github_list_prs", description: "...", input_schema: { ... } }

// Add to toolToConnection():
if (toolName.startsWith("github_")) return "github";

// Add to executeTool():
case "github_list_prs": return await GitHubTools.listPRs(access_token, input.repo as string);
```

**3. Add the Auth0 Social Connection** for GitHub in your Auth0 dashboard with Token Vault enabled.

That's it — Auth0 handles the OAuth, vault stores the token, agent uses it.

---

## Judging Notes (Hackathon)

| Requirement | Implementation |
|---|---|
| Uses Token Vault | `server/src/lib/vault.ts` — all tokens fetched via Auth0 Management API |
| Auth0 handles OAuth | Users connect Slack/Notion via Auth0 Social Connections |
| Agent acts on behalf of user | Claude tool-use loop in `server/src/agents/delegate.ts` |
| Consent delegation | `auth_required` events surface Auth0 consent UI in the chat |
| Scoped permissions | Sidebar shows exact granted/denied permissions per service |
| Published app | Deployed on Vercel + Railway |

---

## License

MIT
