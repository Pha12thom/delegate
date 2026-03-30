/**
 * Discord Tools
 *
 * Interact with Discord servers, channels, and messages.
 * All methods receive a vault_token from Auth0 Token Vault.
 */

export async function listChannels(token: string): Promise<unknown> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Discord API error: ${res.status}`);
    }

    const guilds = (await res.json()) as any;
    return {
      servers: guilds.map((g: any) => ({
        id: g.id,
        name: g.name,
      })),
    };
  } catch (err) {
    throw new Error(`Failed to list Discord servers: ${err}`);
  }
}

export async function getChannelMessages(
  token: string,
  serverId: string,
  channelId: string,
  options: { hoursBack?: number; limit?: number } = {}
): Promise<unknown> {
  const { hoursBack = 24, limit = 50 } = options;
  const beforeTime = new Date(Date.now() - hoursBack * 3600000).toISOString();

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) {
      throw new Error(`Discord API error: ${res.status}`);
    }

    const messages = (await res.json()) as any;
    return {
      messages: messages
        .filter((m: any) => new Date(m.timestamp) > new Date(beforeTime))
        .map((m: any) => ({
          id: m.id,
          author: m.author?.username || "Unknown",
          content: m.content,
          timestamp: m.timestamp,
        })),
    };
  } catch (err) {
    throw new Error(`Failed to fetch Discord messages: ${err}`);
  }
}

export async function postMessage(
  token: string,
  channelId: string,
  content: string
): Promise<unknown> {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!res.ok) {
      throw new Error(`Discord API error: ${res.status}`);
    }

    const message = (await res.json()) as any;
    return {
      id: message.id,
      channel_id: message.channel_id,
      content: message.content,
      timestamp: message.timestamp,
    };
  } catch (err) {
    throw new Error(`Failed to post Discord message: ${err}`);
  }
}

export async function getServerInfo(token: string, serverId: string): Promise<unknown> {
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${serverId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Discord API error: ${res.status}`);
    }

    const guild = (await res.json()) as any;
    return {
      id: guild.id,
      name: guild.name,
      description: guild.description,
      member_count: guild.member_count,
    };
  } catch (err) {
    throw new Error(`Failed to fetch Discord server info: ${err}`);
  }
}
