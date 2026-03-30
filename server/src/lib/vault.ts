/**
 * Auth0 Token Vault Client
 *
 * Fetches user-authorized OAuth tokens for connected services (Slack, Notion, etc.)
 * via the Auth0 Token Vault API. The agent never sees raw credentials — it only
 * receives scoped, short-lived access tokens issued by Auth0.
 *
 * Docs: https://auth0.com/docs/secure/tokens/token-vault
 */

import axios from "axios";

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN!;
const MGMT_TOKEN = process.env.AUTH0_MGMT_TOKEN!;

export type VaultConnection = "slack" | "notion" | "discord";

export interface VaultToken {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  connection: VaultConnection;
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
  const url = `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/identities`;

  const { data: identities } = await axios.get(url, {
    headers: { Authorization: `Bearer ${MGMT_TOKEN}` },
  });

  const identity = identities.find(
    (id: { provider: string }) => id.provider === connection
  );

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
  const url = `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/identities`;

  const { data: identities } = await axios.get(url, {
    headers: { Authorization: `Bearer ${MGMT_TOKEN}` },
  });

  const connections: VaultConnection[] = ["slack", "notion", "discord"];

  return connections.map((c) => ({
    connection: c,
    connected: identities.some(
      (id: { provider: string; access_token?: string }) =>
        id.provider === c && !!id.access_token
    ),
  }));
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
