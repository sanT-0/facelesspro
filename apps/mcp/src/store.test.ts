/**
 * Bounds and eviction for the in-memory OAuth store.
 *
 * These are the properties that keep unauthenticated DCR from growing memory
 * without limit; the token/code semantics themselves are covered by
 * `oauth.test.ts` and `oauth-gate.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { MemoryOAuthStore } from './store';
import type {
  AuthorizationCodeRecord,
  CreateTokensInput,
  RegisteredClient,
} from './store';

const API_KEY = `vp_${'a'.repeat(40)}`;

function client(id: string): RegisteredClient {
  return { clientId: id, redirectUris: ['https://client.example.com/cb'] };
}

function code(value: string, expiresAt: number): AuthorizationCodeRecord {
  return {
    code: value,
    clientId: 'client-1',
    redirectUri: 'https://client.example.com/cb',
    workspaceId: 'workspace-1',
    apiKey: API_KEY,
    codeChallenge: 'challenge',
    expiresAt,
  };
}

function tokens(n: number, now: number): CreateTokensInput {
  return {
    sessionId: `session-${n}`,
    workspaceId: 'workspace-1',
    apiKey: API_KEY,
    accessToken: `at_${n}`,
    refreshToken: `rt_${n}`,
    accessExpiresAt: now + 60_000,
    refreshExpiresAt: now + 120_000,
  };
}

describe('MemoryOAuthStore bounds', () => {
  it('evicts the oldest client at the cap', async () => {
    const store = new MemoryOAuthStore({ maxClients: 2 });

    await store.registerClient(client('a'));
    await store.registerClient(client('b'));
    await store.registerClient(client('c'));

    expect(await store.findClient('a')).toBeNull();
    expect(await store.findClient('b')).not.toBeNull();
    expect(await store.findClient('c')).not.toBeNull();
  });

  it('re-registering an existing client does not evict another', async () => {
    const store = new MemoryOAuthStore({ maxClients: 2 });

    await store.registerClient(client('a'));
    await store.registerClient(client('b'));
    await store.registerClient(client('b'));

    expect(await store.findClient('a')).not.toBeNull();
    expect(await store.findClient('b')).not.toBeNull();
  });

  it('evicts the oldest authorization code at the cap', async () => {
    const store = new MemoryOAuthStore({ maxCodes: 2, now: () => 1_000 });

    await store.createAuthorizationCode(code('one', 10_000));
    await store.createAuthorizationCode(code('two', 10_000));
    await store.createAuthorizationCode(code('three', 10_000));

    expect(await store.consumeAuthorizationCode('one')).toBeNull();
    expect(await store.consumeAuthorizationCode('two')).not.toBeNull();
    expect(await store.consumeAuthorizationCode('three')).not.toBeNull();
  });

  it('evicts the oldest access and refresh tokens at the cap', async () => {
    const store = new MemoryOAuthStore({ maxTokens: 2, now: () => 1_000 });

    await store.createTokens(tokens(1, 1_000));
    await store.createTokens(tokens(2, 1_000));
    await store.createTokens(tokens(3, 1_000));

    expect(await store.readAccessToken('at_1')).toBeNull();
    expect(await store.consumeRefreshToken('rt_1')).toBeNull();
    expect(await store.readAccessToken('at_3')).not.toBeNull();
    expect(await store.consumeRefreshToken('rt_3')).not.toBeNull();
  });

  it('keeps entries while below the cap', async () => {
    const store = new MemoryOAuthStore({
      maxClients: 10,
      maxCodes: 10,
      maxTokens: 10,
      now: () => 1_000,
    });

    await store.registerClient(client('a'));
    await store.createAuthorizationCode(code('one', 10_000));
    await store.createTokens(tokens(1, 1_000));

    expect(await store.findClient('a')).not.toBeNull();
    expect(await store.consumeAuthorizationCode('one')).not.toBeNull();
    expect(await store.readAccessToken('at_1')).not.toBeNull();
  });

  it('does not return an expired access token', async () => {
    let clock = 1_000;
    const store = new MemoryOAuthStore({ now: () => clock });

    await store.createTokens(tokens(1, clock));
    clock += 60_001;

    expect(await store.readAccessToken('at_1')).toBeNull();
  });
});
