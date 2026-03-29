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

  // Resolve channel name → ID if needed
  let channelId = channelNameOrId;
  if (!channelNameOrId.startsWith("C")) {
    const name = channelNameOrId.replace(/^#/, "");
    const channels = await listChannels(token);
    const found = channels.find((c) => c.name === name);
    if (!found) throw new Error(`Channel #${name} not found or not joined.`);
    channelId = found.id;
  }

  const oldest = String(Date.now() / 1000 - hoursBack * 3600);
  const result = await client.conversations.history({
    channel: channelId,
    oldest,
    limit,
    inclusive: true,
  });

  const messages = result.messages || [];

  // Resolve user IDs to display names
  const userCache: Record<string, string> = {};
  const resolved = await Promise.all(
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

  return resolved.reverse(); // chronological order
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

  let channelId = channelNameOrId;
  if (!channelNameOrId.startsWith("C")) {
    const name = channelNameOrId.replace(/^#/, "");
    const channels = await listChannels(token);
    const found = channels.find((c) => c.name === name);
    if (!found) throw new Error(`Channel #${name} not found or not joined.`);
    channelId = found.id;
  }

  const result = await client.chat.postMessage({
    channel: channelId,
    text,
    blocks: options.blocks,
  });

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
