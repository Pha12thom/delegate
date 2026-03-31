/**
 * Discord Tools
 *
 * Interact with Discord servers, channels, and messages using bot token.
 * The bot token is stored server-side and has Message Content Intent enabled.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.warn(
    "⚠️  DISCORD_BOT_TOKEN not set in env. Discord tools will fail. " +
    "Set DISCORD_BOT_TOKEN in server/.env with your bot token from Discord Developer Portal."
  );
}

function makeBotHeaders(): Record<string, string> {
  return {
    Authorization: `Bot ${BOT_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function normalizeOutboundText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export async function listChannels(): Promise<unknown> {
  if (!BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not configured. Cannot list Discord guilds.");
  }

  try {
    // List guilds the bot is a member of
    const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: makeBotHeaders(),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Discord API error: ${res.status} - ${error}`);
    }

    const guilds = (await res.json()) as any[];
    return {
      servers: guilds.map((g: any) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
      })),
    };
  } catch (err) {
    throw new Error(`Failed to list Discord servers: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getChannelMessages(
  _userToken: string,
  serverId: string,
  channelId: string,
  options: { hoursBack?: number; limit?: number } = {}
): Promise<unknown> {
  if (!BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not configured. Cannot fetch Discord messages.");
  }

  const { hoursBack = 24, limit = 50 } = options;
  const beforeTime = new Date(Date.now() - hoursBack * 3600000);

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`,
      {
        headers: makeBotHeaders(),
      }
    );

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Discord API error: ${res.status} - ${error}`);
    }

    const messages = (await res.json()) as any[];
    return {
      messages: messages
        .filter((m: any) => new Date(m.timestamp) > beforeTime)
        .map((m: any) => ({
          id: m.id,
          author: m.author?.username || "Unknown",
          content: m.content,
          timestamp: m.timestamp,
        })),
    };
  } catch (err) {
    throw new Error(
      `Failed to fetch Discord messages: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function postMessage(
  _userToken: string,
  channelId: string,
  content: string
): Promise<unknown> {
  if (!BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not configured. Cannot post Discord messages.");
  }

  const normalizedContent = normalizeOutboundText(content);

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: makeBotHeaders(),
        body: JSON.stringify({ content: normalizedContent }),
      }
    );

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Discord API error: ${res.status} - ${error}`);
    }

    const message = (await res.json()) as any;
    return {
      id: message.id,
      channel_id: message.channel_id,
      content: message.content,
      timestamp: message.timestamp,
      author: message.author?.username || "Bot",
    };
  } catch (err) {
    throw new Error(
      `Failed to post Discord message: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function getServerInfo(
  _userToken: string,
  serverId: string
): Promise<unknown> {
  if (!BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not configured. Cannot fetch Discord server info.");
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${serverId}`, {
      headers: makeBotHeaders(),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Discord API error: ${res.status} - ${error}`);
    }

    const guild = (await res.json()) as any;
    return {
      id: guild.id,
      name: guild.name,
      description: guild.description,
      member_count: guild.member_count,
      icon: guild.icon,
    };
  } catch (err) {
    throw new Error(
      `Failed to fetch Discord server info: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
