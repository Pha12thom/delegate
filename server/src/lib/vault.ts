/**
 * Auth0 Token Vault Client
 *
 * Fetches user-authorized OAuth tokens for connected services (Slack and Discord)
 * via the Auth0 Token Vault API. The agent never sees raw credentials — it only
 * receives scoped, short-lived access tokens issued by Auth0.
 *
 * Docs: https://auth0.com/docs/secure/tokens/token-vault
 */

import axios from "axios";

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN!;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE!;
const STATIC_MGMT_TOKEN = process.env.AUTH0_MGMT_TOKEN;
const AUTH0_M2M_CLIENT_ID = process.env.AUTH0_M2M_CLIENT_ID;
const AUTH0_M2M_CLIENT_SECRET = process.env.AUTH0_M2M_CLIENT_SECRET;
const VAULT_DEBUG = process.env.AUTH0_VAULT_DEBUG === "true";

let mgmtTokenCache:
  | {
      accessToken: string;
      expiresAtMs: number;
    }
  | null = null;

export type VaultConnection = "slack" | "discord";

const AUTH0_CONNECTION_CONFIG: Record<VaultConnection, string | undefined> = {
  slack: process.env.AUTH0_CONNECTION_SLACK,
  discord: process.env.AUTH0_CONNECTION_DISCORD,
};

export interface VaultToken {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  connection: VaultConnection;
}

interface Auth0Identity {
  provider: string;
  connection?: string;
  access_token?: string;
  scope?: string;
}

interface Auth0UserProfile {
  identities?: Auth0Identity[];
}

function vaultDebug(message: string, payload?: unknown) {
  if (!VAULT_DEBUG) return;
  if (payload === undefined) {
    console.log(`[vault] ${message}`);
    return;
  }
  console.log(`[vault] ${message}`, payload);
}

function tokenPreview(token?: string): string {
  if (!token) return "none";
  if (token.length <= 10) return "present(len<=10)";
  return `${token.slice(0, 6)}...${token.slice(-4)} (len=${token.length})`;
}

function normalize(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function getConnectionAliases(connection: VaultConnection): string[] {
  const canonical = normalize(connection);
  const configured = normalize(AUTH0_CONNECTION_CONFIG[connection]);
  const aliases = [canonical];

  if (configured && configured !== canonical) {
    aliases.push(configured);
  }

  return aliases;
}

function identityMatchesConnection(
  identity: Auth0Identity,
  connection: VaultConnection
): boolean {
  const aliases = getConnectionAliases(connection);
  const provider = normalize(identity.provider);
  const configuredConnection = normalize(identity.connection);

  return aliases.some((alias) => alias === provider || alias === configuredConnection);
}

async function mintManagementToken(): Promise<{
  accessToken: string;
  expiresAtMs: number;
}> {
  if (!AUTH0_M2M_CLIENT_ID || !AUTH0_M2M_CLIENT_SECRET) {
    throw new Error(
      "Missing Auth0 M2M credentials. Set AUTH0_M2M_CLIENT_ID and AUTH0_M2M_CLIENT_SECRET."
    );
  }

  const tokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
  const { data } = await axios.post(tokenUrl, {
    grant_type: "client_credentials",
    client_id: AUTH0_M2M_CLIENT_ID,
    client_secret: AUTH0_M2M_CLIENT_SECRET,
    audience: AUTH0_AUDIENCE,
  });

  if (!data?.access_token || !data?.expires_in) {
    throw new Error("Auth0 did not return a valid management API token");
  }

  return {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + Number(data.expires_in) * 1000,
  };
}

async function getManagementToken(): Promise<string> {
  const now = Date.now();

  if (mgmtTokenCache && mgmtTokenCache.expiresAtMs - now > 60_000) {
    vaultDebug("Using cached Auth0 management token", {
      expiresInMs: mgmtTokenCache.expiresAtMs - now,
      token: tokenPreview(mgmtTokenCache.accessToken),
    });
    return mgmtTokenCache.accessToken;
  }

  if (AUTH0_M2M_CLIENT_ID && AUTH0_M2M_CLIENT_SECRET) {
    try {
      const minted = await mintManagementToken();
      mgmtTokenCache = minted;
      vaultDebug("Minted Auth0 management token via M2M", {
        token: tokenPreview(minted.accessToken),
        expiresAtMs: minted.expiresAtMs,
      });
      return minted.accessToken;
    } catch (err) {
      if (STATIC_MGMT_TOKEN) {
        console.warn(
          "Failed to mint Auth0 management token via M2M credentials. Falling back to AUTH0_MGMT_TOKEN.",
          err
        );
        vaultDebug("Using static AUTH0_MGMT_TOKEN after M2M mint failure", {
          token: tokenPreview(STATIC_MGMT_TOKEN),
        });
        return STATIC_MGMT_TOKEN;
      }

      throw err;
    }
  }

  if (STATIC_MGMT_TOKEN) {
    vaultDebug("Using static AUTH0_MGMT_TOKEN", {
      token: tokenPreview(STATIC_MGMT_TOKEN),
    });
    return STATIC_MGMT_TOKEN;
  }

  throw new Error(
    "No Auth0 management token available. Set AUTH0_MGMT_TOKEN or M2M credentials."
  );
}

/**
 * Fetch a user's vault token for a given connection.
 * Called server-side; the access_token is forwarded to the tool layer.
 *
 * @param userId  - Auth0 user_id (sub) from the JWT
 * @param connection - Which connected service to retrieve a token for
 */
export async function getVaultToken(
  userId: string,
  connection: VaultConnection
): Promise<VaultToken> {
  const url = `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`;
  const managementToken = await getManagementToken();

  const { data: userProfile } = await axios.get<Auth0UserProfile>(url, {
    headers: { Authorization: `Bearer ${managementToken}` },
  });

  const identities = userProfile.identities ?? [];
  const aliases = getConnectionAliases(connection);

  vaultDebug("Fetched Auth0 user identities for vault token lookup", {
    userId,
    requestedConnection: connection,
    aliases,
    identities: identities.map((id) => ({
      provider: id.provider,
      connection: id.connection,
      hasAccessToken: !!id.access_token,
      scope: id.scope,
    })),
  });

  const identity = identities.find((id) => identityMatchesConnection(id, connection));

  vaultDebug("Identity match result", {
    userId,
    requestedConnection: connection,
    matched: !!identity,
    matchedIdentity: identity
      ? {
          provider: identity.provider,
          connection: identity.connection,
          hasAccessToken: !!identity.access_token,
          scope: identity.scope,
        }
      : null,
  });

  if (!identity) {
    throw new VaultTokenError(
      `No ${connection} connection found for user. They need to authorize it first.`,
      "NOT_CONNECTED",
      connection
    );
  }

  if (!identity.access_token) {
    throw new VaultTokenError(
      `${connection} token is missing. The user may need to re-authorize.`,
      "TOKEN_MISSING",
      connection
    );
  }

  vaultDebug("Returning vault token for tool execution", {
    userId,
    connection,
    token: tokenPreview(identity.access_token),
    scope: identity.scope,
  });

  return {
    access_token: identity.access_token,
    token_type: "Bearer",
    connection,
    scope: identity.scope,
  };
}

/**
 * Check which connections a user has authorized in their vault.
 */
export async function getUserConnections(
  userId: string
): Promise<{ connection: VaultConnection; connected: boolean }[]> {
  const url = `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`;
  const managementToken = await getManagementToken();

  const { data: userProfile } = await axios.get<Auth0UserProfile>(url, {
    headers: { Authorization: `Bearer ${managementToken}` },
  });

  const identities = userProfile.identities ?? [];

  const connections: VaultConnection[] = ["slack", "discord"];

  const result = connections.map((c) => ({
    connection: c,
    connected: identities.some((id) => identityMatchesConnection(id, c) && !!id.access_token),
  }));

  vaultDebug("Computed user connection status", {
    userId,
    result,
    identities: identities.map((id) => ({
      provider: id.provider,
      connection: id.connection,
      hasAccessToken: !!id.access_token,
      scope: id.scope,
    })),
  });

  return result;
}

export class VaultTokenError extends Error {
  constructor(
    message: string,
    public code: "NOT_CONNECTED" | "TOKEN_MISSING" | "TOKEN_EXPIRED",
    public connection: VaultConnection
  ) {
    super(message);
    this.name = "VaultTokenError";
  }
}
