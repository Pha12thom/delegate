/**
 * Delegate Agent
 *
 * Runs a Claude-powered agentic loop. Each tool call is intercepted:
 * 1. The vault token for the relevant service is fetched from Auth0 Token Vault
 * 2. The tool is executed with that token
 * 3. Results are fed back to Claude
 *
 * The agent never has direct access to OAuth credentials.
 */

import { getVaultToken, VaultTokenError, VaultConnection } from "../lib/vault";
import * as SlackTools from "../tools/slack";
import * as DiscordTools from "../tools/discord";

const rawOpenRouterKey = process.env.OPENROUTER_API_KEY?.trim();
const hasValidOpenRouterKey =
  !!rawOpenRouterKey &&
  rawOpenRouterKey !== "sk-or-..." &&
  !rawOpenRouterKey.includes("your_");

// ─── Tool definitions ──────────────────

const TOOLS: any[] = [
  {
    name: "slack_list_channels",
    description:
      "List Slack channels visible to the token, including membership status via is_member. Use this to discover where message read/post actions are possible.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "slack_get_messages",
    description:
      "Fetch recent messages from a Slack channel. Returns messages with timestamps and authors.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: {
          type: "string",
          description: "Channel name (e.g. #eng-alerts) or channel ID",
        },
        hours_back: {
          type: "number",
          description: "How many hours back to fetch messages. Default: 24",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return. Default: 50",
        },
      },
      required: ["channel"],
    },
  },
  {
    name: "slack_post_message",
    description: "Post a message to a Slack channel on behalf of the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: {
          type: "string",
          description: "Channel name or ID to post to",
        },
        text: {
          type: "string",
          description: "Message text (supports Slack markdown)",
        },
      },
      required: ["channel", "text"],
    },
  },
  {
    name: "discord_list_servers",
    description: "List Discord servers the user is a member of.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "discord_get_messages",
    description: "Fetch recent messages from a Discord channel.",
    input_schema: {
      type: "object" as const,
      properties: {
        server_id: {
          type: "string",
          description: "Discord server (guild) ID",
        },
        channel_id: {
          type: "string",
          description: "Discord channel ID",
        },
        hours_back: {
          type: "number",
          description: "How many hours back to fetch messages. Default: 24",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return. Default: 50",
        },
      },
      required: ["server_id", "channel_id"],
    },
  },
  {
    name: "discord_post_message",
    description: "Post a message to a Discord channel.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: {
          type: "string",
          description: "Discord channel ID to post to",
        },
        content: {
          type: "string",
          description: "Message content (supports Discord markdown)",
        },
      },
      required: ["channel_id", "content"],
    },
  },
  {
    name: "discord_get_server_info",
    description: "Get information about a Discord server.",
    input_schema: {
      type: "object" as const,
      properties: {
        server_id: {
          type: "string",
          description: "Discord server (guild) ID",
        },
      },
      required: ["server_id"],
    },
  },
];

const OPENROUTER_TOOLS = TOOLS.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));

// ─── Tool → vault connection mapping ──────────────

function toolToConnection(toolName: string): VaultConnection | null {
  if (toolName.startsWith("slack_")) return "slack";
  if (toolName.startsWith("discord_")) return "discord";
  return null;
}

function isProviderAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /(401|invalid_auth|not_authed|token|account_inactive|invalid token|unauthorized)/i.test(
    message
  );
}

function isSlackPermissionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /(invalid_scope|missing_scope|not_allowed_token_type|insufficient_scope|scope)/i.test(
    message
  );
}

// ─── Tool execution ────────────────────────────────

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string
): Promise<unknown> {
  const connection = toolToConnection(toolName);

  // Fetch vault token for this service (Discord uses bot token, not OAuth)
  const { access_token } = connection && connection !== "discord"
    ? await getVaultToken(userId, connection)
    : { access_token: "" };

  switch (toolName) {
    case "slack_list_channels":
      return await SlackTools.listChannels(access_token);

    case "slack_get_messages":
      return await SlackTools.getChannelMessages(
        access_token,
        input.channel as string,
        {
          hoursBack: (input.hours_back as number) ?? 24,
          limit: (input.limit as number) ?? 50,
        }
      );

    case "slack_post_message":
      return await SlackTools.postMessage(
        access_token,
        input.channel as string,
        input.text as string
      );

    case "discord_list_servers":
      return await DiscordTools.listChannels();

    case "discord_get_messages":
      return await DiscordTools.getChannelMessages(
        "",
        input.server_id as string,
        input.channel_id as string,
        {
          hoursBack: (input.hours_back as number) ?? 24,
          limit: (input.limit as number) ?? 50,
        }
      );

    case "discord_post_message":
      return await DiscordTools.postMessage(
        "",
        input.channel_id as string,
        input.content as string
      );

    case "discord_get_server_info":
      return await DiscordTools.getServerInfo(
        "",
        input.server_id as string
      );

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─── Agent event types (for streaming to client) ──

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "tool_error"; tool: string; error: string; code?: string }
  | { type: "auth_required"; connection: VaultConnection; tool: string }
  | { type: "done" };

// ─── Main agent loop ───────────────────────────────

export async function runAgent(
  userId: string,
  messages: any[],
  onEvent: (event: AgentEvent) => void,
  context?: { service?: string; workspaceId?: string; channelId?: string }
): Promise<void> {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  const latestUserText =
    typeof latestUserMessage?.content === "string"
      ? latestUserMessage.content
      : "";

  if (!hasValidOpenRouterKey) {
    const quickReply = latestUserText
      ? `I received your message: "${latestUserText}".\n\nChat is online. To enable full AI responses, set a valid OPENROUTER_API_KEY in server/.env and restart the server.`
      : "Chat is online. To enable full AI responses, set a valid OPENROUTER_API_KEY in server/.env and restart the server.";

    onEvent({ type: "text", text: quickReply });
    onEvent({ type: "done" });
    return;
  }

  const systemPrompt = `You are Delegate, an AI agent for Slack and Discord operations only.
Help users read messages, post updates, and manage channels. Stay focused.

${context?.service ? `ACTIVE: ${context.service}${context.channelId ? ` #${context.channelId}` : ""}` : "Ask user which service/channel first."}

Rules:
- Be extremely concise. One sentence or short bullet list only.
- Never output JSON, markdown symbols (**, #, *), or raw data in final replies.
- For message reads: summarize decisions/blockers only.
- For posts: ask "Ready to post?" unless user says "post now"
- Skip pleasantries and explanations. Go straight to results.
- If tool fails, one line reason + next step.
- This chat auto-clears after 3 hours to save space.

Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
`;

  let currentMessages: any[] = [...messages];
  let iterations = 0; 
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    let response: any;

    try {
      const openRouterMessages = [
        { role: "system", content: systemPrompt },
        ...currentMessages,
      ];

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${rawOpenRouterKey}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          max_tokens: 4096,
          tools: OPENROUTER_TOOLS,
          tool_choice: "auto",
          messages: openRouterMessages,
        }),
      });

      if (!res.ok) {
        const rawBody = await res.text();
        let providerMessage = `API error: ${res.status}`;
        try {
          const parsed = JSON.parse(rawBody) as any;
          providerMessage =
            parsed?.error?.message ||
            parsed?.message ||
            providerMessage;
        } catch {
          if (rawBody?.trim()) {
            providerMessage = `${providerMessage} - ${rawBody.trim()}`;
          }
        }
        throw new Error(providerMessage);
      }

      response = await res.json();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "OpenRouter request failed";
      // Log error but don't spam user with verbose messages
      console.error("OpenRouter error:", message);
      // Silently exit if tools have already executed
      break;
    }

    // Stream text blocks
    const choice = response.choices?.[0];
    if (choice?.message?.content) {
      onEvent({ type: "text", text: choice.message.content });
    }

    // If no tool use, we're done
    if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
      break;
    }

    // Process tool calls
    const toolUseBlocks = choice.message.tool_calls || [];

    if (toolUseBlocks.length === 0) break;

    // Add assistant message to history
    currentMessages.push({
      role: "assistant",
      content: choice.message.content || "",
      tool_calls: toolUseBlocks,
    });

    // Execute each tool and collect results
    const toolResults: any[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolName = toolUse.function?.name;
      const input = JSON.parse(toolUse.function?.arguments || "{}");
      onEvent({ type: "tool_call", tool: toolName, input });

      try {
        const result = await executeTool(toolName, input, userId);
        onEvent({ type: "tool_result", tool: toolName, result });
        toolResults.push({
          role: "tool",
          tool_call_id: toolUse.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        if (err instanceof VaultTokenError) {
          onEvent({
            type: "auth_required",
            connection: err.connection,
            tool: toolName,
          });
          toolResults.push({
            role: "tool",
            tool_call_id: toolUse.id,
            content: `Error: ${err.message}`,
          });
        } else if (isProviderAuthError(err)) {
          const connection = toolToConnection(toolName);
          const message = err instanceof Error ? err.message : "Authorization failed";

          if (connection === "slack" && isSlackPermissionError(err)) {
            const guidance =
              "Slack token is connected but missing required Web API scopes for this action. " +
              "Update Auth0 Slack connection scopes (for example: channels:read channels:history groups:read groups:history chat:write users:read), " +
              "then re-authorize Slack and try again.";

            onEvent({ type: "tool_error", tool: toolName, error: `${message}. ${guidance}` });
            toolResults.push({
              role: "tool",
              tool_call_id: toolUse.id,
              content: `Error: ${message}. ${guidance}`,
            });
            continue;
          }

          // Check if user has no vault token for this service
          if (connection) {
            const notConnectedMsg =
              message.toLowerCase().includes("not connected") || message.toLowerCase().includes("no") 
                ? `You haven't connected ${connection} yet. Please authorize it to use this feature.`
                : `${connection} connection error: ${message}`;

            onEvent({
              type: "auth_required",
              connection,
              tool: toolName,
            });

            onEvent({ type: "tool_error", tool: toolName, error: notConnectedMsg });
            toolResults.push({
              role: "tool",
              tool_call_id: toolUse.id,
              content: `Error: ${notConnectedMsg}`,
            });
            continue;
          }

          onEvent({ type: "tool_error", tool: toolName, error: message });
          toolResults.push({
            role: "tool",
            tool_call_id: toolUse.id,
            content: `Error: ${message}`,
          });
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          onEvent({ type: "tool_error", tool: toolName, error: message });
          toolResults.push({
            role: "tool",
            tool_call_id: toolUse.id,
            content: `Error: ${message}`,
          });
        }
      }
    }

    // Add tool results to history and continue
    currentMessages.push(...toolResults);
  }

  onEvent({ type: "done" });
}
