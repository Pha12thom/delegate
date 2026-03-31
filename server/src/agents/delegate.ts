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
import * as NotionTools from "../tools/notion";
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
    name: "notion_search_pages",
    description: "Search for Notion pages by title or keyword.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query string",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "notion_create_page",
    description:
      "Create a new Notion page with a title and content. Content can include markdown-style headings (# ## ###), bullets (- or •), and paragraphs.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Page title",
        },
        content: {
          type: "string",
          description:
            "Page content. Use # for headings, - for bullets, plain text for paragraphs.",
        },
        parent_page_id: {
          type: "string",
          description: "Optional parent page ID to nest the new page under",
        },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "notion_get_page",
    description: "Retrieve the text content of a Notion page by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "Notion page ID",
        },
      },
      required: ["page_id"],
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
  if (toolName.startsWith("notion_")) return "notion";
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

  // Fetch vault token for this service
  const { access_token } = connection
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

    case "notion_search_pages":
      return await NotionTools.searchPages(access_token, input.query as string);

    case "notion_create_page":
      return await NotionTools.createPage(
        access_token,
        input.title as string,
        input.content as string,
        { parentPageId: input.parent_page_id as string | undefined }
      );

    case "notion_get_page":
      return await NotionTools.getPageContent(
        access_token,
        input.page_id as string
      );

    case "discord_list_servers":
      return await DiscordTools.listChannels(access_token);

    case "discord_get_messages":
      return await DiscordTools.getChannelMessages(
        access_token,
        input.server_id as string,
        input.channel_id as string,
        {
          hoursBack: (input.hours_back as number) ?? 24,
          limit: (input.limit as number) ?? 50,
        }
      );

    case "discord_post_message":
      return await DiscordTools.postMessage(
        access_token,
        input.channel_id as string,
        input.content as string
      );

    case "discord_get_server_info":
      return await DiscordTools.getServerInfo(
        access_token,
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
  onEvent: (event: AgentEvent) => void
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

  const systemPrompt = `You are Delegate, a personal productivity AI agent.
You help users manage their work across Slack, Notion, and Discord.
You have access to tools that let you read messages, post to channels, search pages, and create content.

Guidelines:
- Always respond in natural language; never output raw JSON in your final reply
- Keep replies concise, useful, and action-oriented
- After tool calls, structure your reply as:
  1) Outcome (1 line)
  2) Key findings (short bullets)
  3) Next best action (1 line)
- When reading messages, summarize decisions, blockers, and urgent items first
- When creating Notion pages, structure content with clear headings and bullets
- Always confirm before posting to Slack or Discord (unless user explicitly says to post now)
- If a tool fails, explain why in plain English and provide a concrete next step
- Avoid repeating the same tool call with identical input unless the previous result was incomplete
- If channel access fails, explicitly ask the user which accessible channel to use from the visible list

Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`;

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
      onEvent({
        type: "text",
        text: `Chat is online, but the AI provider request failed: ${message}`,
      });
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

          if (connection) {
            onEvent({
              type: "auth_required",
              connection,
              tool: toolName,
            });
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
