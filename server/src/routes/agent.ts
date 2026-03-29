import "dotenv/config";
import { Router, Request, Response } from "express";
import { auth } from "express-oauth2-jwt-bearer";
import { runAgent, AgentEvent } from "../agents/delegate";
import { getUserConnections } from "../lib/vault";
import { z } from "zod";

export const agentRouter = Router();

const auth0Domain = process.env.AUTH0_DOMAIN;
const auth0Audience = process.env.AUTH0_AUDIENCE;

if (!auth0Domain || !auth0Audience) {
  throw new Error(
    "Missing AUTH0 config. Set AUTH0_DOMAIN and AUTH0_AUDIENCE in server/.env (copy from server/.env.example)."
  );
}

// JWT validation middleware — verifies Auth0-issued access tokens
const checkJwt = auth({
  audience: auth0Audience,
  issuerBaseURL: `https://${auth0Domain}`,
});

// ─── GET /api/connections ──────────────────────────
// Returns which services the user has connected via Auth0 Token Vault
agentRouter.get("/connections", checkJwt, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.payload.sub!;
    const connections = await getUserConnections(userId);
    res.json({ connections });
  } catch (err) {
    console.error("connections error:", err);
    res.status(500).json({ error: "Failed to fetch connections" });
  }
});

// ─── POST /api/chat ───────────────────────────────
// Main agent endpoint. Streams Server-Sent Events back to the client.
// The agent loop runs inside and emits events as it thinks + calls tools.

const ChatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })
  ),
});

agentRouter.post("/chat", checkJwt, async (req: Request, res: Response) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const userId = req.auth?.payload.sub!;
  const { messages } = parsed.data;

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: AgentEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    await runAgent(userId, messages, send);
  } catch (err) {
    console.error("Agent error:", err);
    send({
      type: "tool_error",
      tool: "agent",
      error: err instanceof Error ? err.message : "Agent failed unexpectedly",
    });
    send({ type: "done" });
  } finally {
    res.end();
  }
});

// ─── GET /api/health ──────────────────────────────
agentRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
