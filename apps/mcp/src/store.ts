/**
 * OAuth state for the MCP authorization server (docs/07 §4.3).
 *
 * The store is deliberately an interface: the current implementation lives in
 * process memory, which is enough for a single MCP instance and keeps the
 * server free of the API's database. The consequence is explicit — a restart
 * invalidates registered clients, pending codes, access tokens and refresh
 * tokens, and a client simply re-runs DCR + consent. A Postgres-backed store
 * can implement the same interface later without touching the routes.
 *
 * Security invariants encoded here:
 * - An authorization code is consumed exactly once, and never after its TTL.
 * - A refresh token is consumed exactly once; rotation therefore cannot be
 *   replayed.
 * - Revoking either half of a token pair kills the whole session.
 * - Every token carries the plaintext `vp_` API key that was validated at
 *   consent. Tool calls forward *that* key, never the `at_` token.
 */

export interface RegisteredClient {
  readonly clientId: string;
  /** Exact-match allow-list. Never widen this to a prefix check. */
  readonly redirectUris: readonly string[];
}

export interface AuthorizationCodeRecord {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly workspaceId: string;
  /** The workspace API key proven at consent; forwarded on tool calls. */
  readonly apiKey: string;
  /** S256 challenge: base64url(sha256(code_verifier)). */
  readonly codeChallenge: string;
  /** Unix epoch milliseconds. */
  readonly expiresAt: number;
}

export interface TokenRecord {
  /** Shared by the access/refresh pair; revocation kills the session. */
  readonly sessionId: string;
  readonly workspaceId: string;
  /** The `vp_` key validated at consent. */
  readonly apiKey: string;
}

export interface CreateTokensInput extends TokenRecord {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Unix epoch milliseconds. */
  readonly accessExpiresAt: number;
  /** Unix epoch milliseconds. */
  readonly refreshExpiresAt: number;
}

export interface OAuthStore {
  registerClient(input: RegisteredClient): Promise<void>;
  findClient(clientId: string): Promise<RegisteredClient | null>;

  createAuthorizationCode(input: AuthorizationCodeRecord): Promise<void>;
  /**
   * Read and delete in one step. `null` when the code is unknown or expired,
   * so a second exchange of the same code always fails.
   */
  consumeAuthorizationCode(code: string): Promise<Omit<AuthorizationCodeRecord, 'expiresAt'> | null>;

  createTokens(input: CreateTokensInput): Promise<void>;
  /** Resolve an unexpired access token. */
  readAccessToken(token: string): Promise<TokenRecord | null>;
  /**
   * Read and delete a refresh token in one step. `null` when unknown or
   * expired, so replaying a rotated refresh token always fails.
   */
  consumeRefreshToken(token: string): Promise<TokenRecord | null>;

  /** Revoke a single token; both halves of its session stop working. */
  revokeToken(token: string): Promise<void>;
  /** Revoke every token issued for a session. */
  revokeSession(sessionId: string): Promise<void>;
}

interface StoredToken extends TokenRecord {
  readonly expiresAt: number;
}

export interface MemoryOAuthStoreOptions {
  /** Injectable clock (Unix epoch ms). Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Single-process OAuth store. Not shared between replicas; see the file note.
 */
export class MemoryOAuthStore implements OAuthStore {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly codes = new Map<string, AuthorizationCodeRecord>();
  private readonly accessTokens = new Map<string, StoredToken>();
  private readonly refreshTokens = new Map<string, StoredToken>();
  private readonly now: () => number;

  constructor(options: MemoryOAuthStoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async registerClient(input: RegisteredClient): Promise<void> {
    this.clients.set(input.clientId, {
      clientId: input.clientId,
      redirectUris: [...input.redirectUris],
    });
  }

  async findClient(clientId: string): Promise<RegisteredClient | null> {
    return this.clients.get(clientId) ?? null;
  }

  async createAuthorizationCode(input: AuthorizationCodeRecord): Promise<void> {
    this.codes.set(input.code, { ...input });
  }

  async consumeAuthorizationCode(
    code: string,
  ): Promise<Omit<AuthorizationCodeRecord, 'expiresAt'> | null> {
    const stored = this.codes.get(code);
    if (stored === undefined) return null;
    // Delete before the expiry check: an expired code is still single-use.
    this.codes.delete(code);
    if (stored.expiresAt <= this.now()) return null;
    return {
      code: stored.code,
      clientId: stored.clientId,
      redirectUri: stored.redirectUri,
      workspaceId: stored.workspaceId,
      apiKey: stored.apiKey,
      codeChallenge: stored.codeChallenge,
    };
  }

  async createTokens(input: CreateTokensInput): Promise<void> {
    const base: TokenRecord = {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      apiKey: input.apiKey,
    };
    this.accessTokens.set(input.accessToken, {
      ...base,
      expiresAt: input.accessExpiresAt,
    });
    this.refreshTokens.set(input.refreshToken, {
      ...base,
      expiresAt: input.refreshExpiresAt,
    });
  }

  async readAccessToken(token: string): Promise<TokenRecord | null> {
    return this.read(this.accessTokens, token);
  }

  async consumeRefreshToken(token: string): Promise<TokenRecord | null> {
    const stored = this.refreshTokens.get(token);
    if (stored === undefined) return null;
    this.refreshTokens.delete(token);
    if (stored.expiresAt <= this.now()) return null;
    return {
      sessionId: stored.sessionId,
      workspaceId: stored.workspaceId,
      apiKey: stored.apiKey,
    };
  }

  async revokeToken(token: string): Promise<void> {
    const access = this.accessTokens.get(token);
    const refresh = this.refreshTokens.get(token);
    const sessionId = access?.sessionId ?? refresh?.sessionId;
    if (sessionId === undefined) return;
    await this.revokeSession(sessionId);
  }

  async revokeSession(sessionId: string): Promise<void> {
    for (const [token, stored] of this.accessTokens) {
      if (stored.sessionId === sessionId) this.accessTokens.delete(token);
    }
    for (const [token, stored] of this.refreshTokens) {
      if (stored.sessionId === sessionId) this.refreshTokens.delete(token);
    }
  }

  private read(map: Map<string, StoredToken>, token: string): TokenRecord | null {
    const stored = map.get(token);
    if (stored === undefined) return null;
    if (stored.expiresAt <= this.now()) {
      map.delete(token);
      return null;
    }
    return {
      sessionId: stored.sessionId,
      workspaceId: stored.workspaceId,
      apiKey: stored.apiKey,
    };
  }
}
