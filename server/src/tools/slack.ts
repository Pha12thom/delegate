/**
 * Slack Tool
 *
 * All methods receive a vault_token fetched from Auth0 Token Vault.
 * No Slack credentials are stored server-side — tokens come from the vault.
 */

import { WebClient } from "@slack/web-api";

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
  channel: string;
  reactions?: string[];
  thread_reply_count?: number;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  num_members?: number;
}

function formatChannelPreview(channels: SlackChannel[], max = 5): string {
  if (!channels.length) return "none";
  const preview = channels.slice(0, max).map((c) => `#${c.name}`).join(", ");
  return channels.length > max ? `${preview}, ...` : preview;
}

async function resolveChannelForAction(
  token: string,
  channelNameOrId: string,
  action: "read messages" | "post messages"
): Promise<{ id: string; name: string; is_member: boolean }> {
  const channels = await listChannels(token);

  const isChannelId = /^[CG]/.test(channelNameOrId);
  const byId = isChannelId
    ? channels.find((c) => c.id === channelNameOrId)
    : null;

  const normalizedName = channelNameOrId.replace(/^#/, "").toLowerCase();
  const byName = !isChannelId
    ? channels.find((c) => c.name.toLowerCase() === normalizedName)
    : null;

  const found = byId ?? byName;

  if (!found) {
    throw new Error(
      `Channel ${channelNameOrId.startsWith("#") ? channelNameOrId : `#${channelNameOrId}`} not found. Visible channels: ${formatChannelPreview(channels)}.`
    );
  }

  if (!found.is_member) {
    throw new Error(
      `I can see #${found.name}, but I'm not a member so I can't ${action}. Please invite the app/bot to #${found.name} and try again.`
    );
  }

  return found;
}

/**
 * List channels the user is a member of.
 */
export async function listChannels(token: string): Promise<SlackChannel[]> {
  const client = new WebClient(token);
  const result = await client.conversations.list({
    types: "public_channel,private_channel",
    exclude_archived: true,
    limit: 50,
  });

  return (result.channels || []).map((c) => ({
    id: c.id!,
    name: c.name!,
    is_member: c.is_member ?? false,
    num_members: c.num_members,
  }));
}

/**
 * Fetch recent messages from a channel, optionally filtered by time window.
 */
export async function getChannelMessages(
  token: string,
  channelNameOrId: string,
  options: { hoursBack?: number; limit?: number } = {}
): Promise<SlackMessage[]> {
  const client = new WebClient(token);
  const { hoursBack = 24, limit = 50 } = options;

  const resolved = await resolveChannelForAction(
    token,
    channelNameOrId,
    "read messages"
  );
  const channelId = resolved.id;

  const oldest = String(Date.now() / 1000 - hoursBack * 3600);
  let result;
  try {
    result = await client.conversations.history({
      channel: channelId,
      oldest,
      limit,
      inclusive: true,
    });
  } catch (err: any) {
    const code = err?.data?.error || err?.code || "unknown_error";
    if (code === "not_in_channel") {
      throw new Error(
        `I can see #${resolved.name}, but I'm not in it. Invite the app/bot to #${resolved.name} and try again.`
      );
    }
    if (code === "missing_scope") {
      throw new Error(
        "Slack token is missing required read scopes for this action. Please update Slack scopes and reconnect."
      );
    }
    throw err;
  }

  const messages = result.messages || [];

  // Resolve user IDs to display names
  const userCache: Record<string, string> = {};
  const resolvedMessages = await Promise.all(
    messages.map(async (m) => {
      if (m.user && !userCache[m.user]) {
        const info = await client.users.info({ user: m.user }).catch(() => null);
        userCache[m.user] =
          info?.user?.profile?.display_name || info?.user?.name || m.user;
      }
      return {
        ts: m.ts!,
        user: userCache[m.user || ""] || "unknown",
        text: m.text || "",
        channel: channelId,
        thread_reply_count: m.reply_count,
      } as SlackMessage;
    })
  );

  return resolvedMessages.reverse(); // chronological order
}

/**
 * Post a message to a channel.
 */
export async function postMessage(
  token: string,
  channelNameOrId: string,
  text: string,
  options: { blocks?: object[] } = {}
): Promise<{ ts: string; channel: string }> {
  const client = new WebClient(token);

  const resolved = await resolveChannelForAction(
    token,
    channelNameOrId,
    "post messages"
  );
  const channelId = resolved.id;

  let result;
  try {
    result = await client.chat.postMessage({
      channel: channelId,
      text,
      ...(options.blocks ? { blocks: options.blocks as any } : {}),
    });
  } catch (err: any) {
    const code = err?.data?.error || err?.code || "unknown_error";
    if (code === "not_in_channel") {
      throw new Error(
        `I can see #${resolved.name}, but I'm not in it yet. Invite the app/bot to #${resolved.name} and retry.`
      );
    }
    if (code === "missing_scope") {
      throw new Error(
        "Slack token is missing required write scopes for this action. Please update Slack scopes and reconnect."
      );
    }
    throw err;
  }

  return { ts: result.ts!, channel: result.channel! };
}

/**
 * Fetch a specific Slack thread.
 */
export async function getThread(
  token: string,
  channelId: string,
  threadTs: string
): Promise<SlackMessage[]> {
  const client = new WebClient(token);
  const result = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
  });

  return (result.messages || []).map((m) => ({
    ts: m.ts!,
    user: m.user || "unknown",
    text: m.text || "",
    channel: channelId,
  }));
}
