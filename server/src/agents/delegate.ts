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

import Anthropic from "@anthropic-ai/sdk";
import { getVaultToken, VaultTokenError, VaultConnection } from "../lib/vault";
import * as SlackTools from "../tools/slack";
import * as NotionTools from "../tools/notion";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Tool definitions for Claude ──────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "slack_list_channels",
    description:
      "List Slack channels the user is a member of. Use this to discover available channels before fetching messages.",
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
];

// ─── Tool → vault connection mapping ──────────────

function toolToConnection(toolName: string): VaultConnection | null {
  if (toolName.startsWith("slack_")) return "slack";
  if (toolName.startsWith("notion_")) return "notion";
  return null;
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
  messages: Anthropic.MessageParam[],
  onEvent: (event: AgentEvent) => void
): Promise<void> {
  const systemPrompt = `You are Delegate, a personal productivity AI agent.
You help users manage their work across Slack and Notion.
You have access to tools that let you read Slack messages, post to channels, search Notion, and create pages.

Guidelines:
- Be concise and action-oriented
- When reading messages, summarize the key points clearly
- When creating Notion pages, structure content with clear headings and bullets
- Always confirm before posting to Slack (unless the user explicitly said to go ahead)
- Surface urgent items first
- If a tool fails due to missing auth, explain clearly what permission is needed

Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`;

  let currentMessages = [...messages];
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages: currentMessages,
    });

    // Stream text blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text) {
        onEvent({ type: "text", text: block.text });
      }
    }

    // If no tool use, we're done
    if (response.stop_reason === "end_turn") {
      break;
    }

    // Process tool calls
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) break;

    // Add assistant message to history
    currentMessages.push({ role: "assistant", content: response.content });

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const input = toolUse.input as Record<string, unknown>;
      onEvent({ type: "tool_call", tool: toolUse.name, input });

      try {
        const result = await executeTool(toolUse.name, input, userId);
        onEvent({ type: "tool_result", tool: toolUse.name, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        if (err instanceof VaultTokenError) {
          onEvent({
            type: "auth_required",
            connection: err.connection,
            tool: toolUse.name,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error: ${err.message}`,
            is_error: true,
          });
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          onEvent({ type: "tool_error", tool: toolUse.name, error: message });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error: ${message}`,
            is_error: true,
          });
        }
      }
    }

    // Add tool results to history and continue
    currentMessages.push({ role: "user", content: toolResults });
  }

  onEvent({ type: "done" });
}
