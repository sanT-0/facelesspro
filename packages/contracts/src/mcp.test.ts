/**
 * MCP contract tests (docs/01 §10, docs/07 §4).
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_MCP_TOOLS,
  EXTRA_MCP_TOOLS,
  initializeResultSchema,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  MCP_TOOLS,
  oauthAuthorizationServerSchema,
  oauthProtectedResourceSchema,
  toolCallResultSchema,
  toolListResultSchema,
} from './mcp';

describe('MCP contracts', () => {
  it('defines MCP_TOOLS 1:1 with /v1 routes', () => {
    const toolNames = MCP_TOOLS.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'create_ai_video',
      'create_ai_video_v3',
      'create_caption_video',
      'create_fake_text_screenshot',
      'create_fake_text_video',
      'create_quiz_video',
      'create_roblox_video',
      'get_workspace',
      'list_art_styles',
      'list_balance_logs',
      'list_caption_templates',
      'list_credit_logs',
      'list_background_videos',
      'list_sound_effects',
      'list_voices',
      'read',
      'render_video',
      'text_to_speech',
      'upload_file',
    ].sort());
  });

  it('assigns a kind (read/write/spend) to every tool', () => {
    for (const tool of ALL_MCP_TOOLS) {
      expect(['read', 'write', 'spend']).toContain(tool.kind);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('defines extra tools (plan_video, preview_script_split, list_languages)', () => {
    const extraNames = EXTRA_MCP_TOOLS.map((t) => t.name);
    expect(extraNames).toContain('plan_video');
    expect(extraNames).toContain('preview_script_split');
    expect(extraNames).toContain('list_languages');
    for (const tool of EXTRA_MCP_TOOLS) {
      expect(tool.kind).toBe('read');
    }
  });

  it('validates a JSON-RPC 2.0 request', () => {
    const valid = jsonRpcRequestSchema.parse({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(valid.jsonrpc).toBe('2.0');
    expect(valid.id).toBe(1);
    expect(valid.method).toBe('tools/list');

    const withParams = jsonRpcRequestSchema.parse({
      jsonrpc: '2.0',
      id: 'abc',
      method: 'tools/call',
      params: { name: 'get_workspace', arguments: {} },
    });
    expect(withParams.params).toEqual({ name: 'get_workspace', arguments: {} });

    expect(() => jsonRpcRequestSchema.parse({ jsonrpc: '1.0', id: 1, method: 'x' })).toThrow();
  });

  it('validates a JSON-RPC 2.0 response', () => {
    const success = jsonRpcResponseSchema.parse({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    });
    expect(success.result).toEqual({ ok: true });

    const error = jsonRpcResponseSchema.parse({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    });
    expect(error.error?.code).toBe(-32601);
  });

  it('validates tool list result', () => {
    const result = toolListResultSchema.parse({
      tools: [
        {
          name: 'get_workspace',
          description: 'Get workspace details',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe('get_workspace');
  });

  it('validates tool call result', () => {
    const result = toolCallResultSchema.parse({
      content: [{ type: 'text', text: 'Hello, world!' }],
    });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
    expect(result.content[0]!.text).toBe('Hello, world!');
  });

  it('validates initialize result', () => {
    const result = initializeResultSchema.parse({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'facelesspro-mcp', version: '0.1.0' },
    });
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe('facelesspro-mcp');
  });

  it('validates OAuth protected resource metadata', () => {
    const metadata = oauthProtectedResourceSchema.parse({
      resource: 'https://mcp.example.com',
      authorization_servers: ['https://auth.example.com'],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
      revocation_methods_supported: ['header'],
      introspection_methods_supported: ['header'],
      code_challenge_methods_supported: ['S256'],
    });
    expect(metadata.resource).toBe('https://mcp.example.com');
    expect(metadata.authorization_servers).toEqual(['https://auth.example.com']);
  });

  it('validates OAuth authorization server metadata', () => {
    const metadata = oauthAuthorizationServerSchema.parse({
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      revocation_endpoint: 'https://auth.example.com/revoke',
    });
    expect(metadata.issuer).toBe('https://auth.example.com');
    expect(metadata.code_challenge_methods_supported).toContain('S256');
  });
});
