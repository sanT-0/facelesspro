/**
 * MCP (Model Context Protocol) contracts (docs/01 §10, docs/07 §4).
 *
 * JSON-RPC 2.0 over Streamable HTTP. Tools are 1:1 with /v1 routes.
 * A failing tool returns error text, not a protocol error.
 */

import { z } from 'zod';

// --- JSON-RPC 2.0 -----------------------------------------------------------

export const jsonrpcSchema = z.literal('2.0');

export const jsonRpcRequestSchema = z.strictObject({
  jsonrpc: jsonrpcSchema,
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

export const jsonRpcResponseSchema = z.strictObject({
  jsonrpc: jsonrpcSchema,
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z
    .strictObject({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;

// --- MCP capabilities -------------------------------------------------------

export const mcpCapabilitiesSchema = z.strictObject({
  tools: z.strictObject({
    listChanged: z.boolean().optional(),
  }),
});
export type McpCapabilities = z.infer<typeof mcpCapabilitiesSchema>;

export const mcpServerInfoSchema = z.strictObject({
  name: z.string(),
  version: z.string(),
});
export type McpServerInfo = z.infer<typeof mcpServerInfoSchema>;

export const initializeRequestSchema = z.strictObject({
  protocolVersion: z.string(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  clientInfo: mcpServerInfoSchema.optional(),
});
export type InitializeRequest = z.infer<typeof initializeRequestSchema>;

export const initializeResultSchema = z.strictObject({
  protocolVersion: z.literal('2024-11-05'),
  capabilities: mcpCapabilitiesSchema,
  serverInfo: mcpServerInfoSchema,
});
export type InitializeResult = z.infer<typeof initializeResultSchema>;

// --- Tool definitions -------------------------------------------------------

export const toolSchema = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type Tool = z.infer<typeof toolSchema>;

export const toolListResultSchema = z.strictObject({
  tools: z.array(toolSchema),
});
export type ToolListResult = z.infer<typeof toolListResultSchema>;

// --- Tool call --------------------------------------------------------------

export const toolCallRequestSchema = z.strictObject({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

export const toolCallResultSchema = z.strictObject({
    content: z.array(
      z.strictObject({
        type: z.literal('text'),
        text: z.string(),
      }),
    ),
    isError: z.boolean().optional(),
  });
export type ToolCallResult = z.infer<typeof toolCallResultSchema>;

// --- Tool definitions (1:1 with /v1 routes, docs/07 §4.1) -------------------

export const MCP_TOOLS: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly kind: 'read' | 'write' | 'spend';
}> = [
  {
    name: 'create_caption_video',
    description: 'Create a caption video from a media file or URL.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Media file URL or path' },
        templateId: { type: 'number', description: 'Caption template ID' },
        render: { type: 'object', description: 'Render options' },
        webhookUrl: { type: 'string', description: 'Webhook callback URL' },
      },
      required: [],
    },
    kind: 'spend',
  },
  {
    name: 'create_ai_video_v3',
    description: 'Create an AI V3 video from a script or voiceover.',
    inputSchema: {
      type: 'object',
      properties: {
        artStyleId: { type: 'string', description: 'Art style ID (UUID)' },
        script: { type: 'string', description: 'Video script (Tamil/English/Tanglish)' },
        voiceoverUrl: { type: 'string', description: 'Voiceover audio URL' },
        size: { type: 'string', enum: ['landscape', 'portrait'] },
        speed: { type: 'string', enum: ['slow', 'standard'] },
        voiceId: { type: 'string', description: 'Voice ID' },
        voiceStyle: { type: 'object', description: 'Voice style settings' },
        captions: { type: 'boolean', description: 'Enable captions' },
        captionTemplateId: { type: 'number', description: 'Caption template ID' },
        render: { type: 'object', description: 'Render options' },
        webhookUrl: { type: 'string', description: 'Webhook callback URL' },
      },
      required: ['artStyleId'],
    },
    kind: 'spend',
  },
  {
    name: 'create_ai_video',
    description: 'Create an AI V2 video with a fixed image style.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Video script' },
        imageStyle: { type: 'string', description: 'Image style preset' },
        size: { type: 'string', enum: ['landscape', 'portrait'] },
        transition: { type: 'string', enum: ['smooth', 'strong-swipe'] },
        voiceId: { type: 'string', description: 'Voice ID' },
        voiceStyle: { type: 'object', description: 'Voice style settings' },
        render: { type: 'object', description: 'Render options' },
        webhookUrl: { type: 'string', description: 'Webhook callback URL' },
      },
      required: ['script'],
    },
    kind: 'spend',
  },
  {
    name: 'create_quiz_video',
    description: 'Create a quiz video with questions and answers.',
    inputSchema: {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Quiz items' },
        template: { type: 'string', enum: ['standard', 'multi-levels'] },
        language: { type: 'string', description: 'Narration language' },
        voiceId: { type: 'string', description: 'Voice ID' },
        answerTemplate: { type: 'string', description: 'Answer template' },
        generateBackgroundImage: { type: 'boolean' },
        backgroundImagePrompt: { type: 'string' },
        generateQuestionImage: { type: 'boolean' },
        imageStyle: { type: 'string' },
        render: { type: 'object', description: 'Render options' },
        webhookUrl: { type: 'string', description: 'Webhook callback URL' },
      },
      required: ['items'],
    },
    kind: 'spend',
  },
  {
    name: 'create_roblox_video',
    description: 'Create a Roblox rant video.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Video script' },
        voiceId: { type: 'string', description: 'Voice ID' },
        voicePitch: { type: 'number' },
        captionWordLimit: { type: 'number' },
        autoAddEmoji: { type: 'boolean' },
        backgroundVideoId: { type: 'string' },
        render: { type: 'object', description: 'Render options' },
        webhookUrl: { type: 'string', description: 'Webhook callback URL' },
      },
      required: ['script'],
    },
    kind: 'spend',
  },
  {
    name: 'create_fake_text_video',
    description: 'Create a fake text conversation video.',
    inputSchema: {
      type: 'object',
      properties: {
        conversations: { type: 'array', description: 'Text conversations' },
        backgroundVideoId: { type: 'string' },
        backgroundVideoStartFrom: { type: 'number' },
        render: { type: 'object', description: 'Render options' },
        webhookUrl: { type: 'string', description: 'Webhook callback URL' },
      },
      required: ['conversations'],
    },
    kind: 'spend',
  },
  {
    name: 'read',
    description: 'Read the status of a video by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Video ID (UUID)' },
      },
      required: ['id'],
    },
    kind: 'read',
  },
  {
    name: 'render_video',
    description: 'Render a completed video to MP4.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Video ID (UUID)' },
        resolution: { type: 'number', enum: [1080, 1440, 2160] },
        frameRate: { type: 'number', enum: [30, 60] },
        format: { type: 'string', enum: ['standard', 'greenscreen'] },
        webhookUrl: { type: 'string', description: 'Webhook callback URL' },
      },
      required: ['id'],
    },
    kind: 'spend',
  },
  {
    name: 'upload_file',
    description: 'Upload a file (multipart).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path or URL' },
      },
      required: ['file'],
    },
    kind: 'write',
  },
  {
    name: 'list_voices',
    description: 'List available voices.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
  {
    name: 'list_sound_effects',
    description: 'List available sound effects.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
  {
    name: 'list_background_videos',
    description: 'List available background videos.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
  {
    name: 'text_to_speech',
    description: 'Synthesize speech from text.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to synthesize' },
        voiceId: { type: 'string', description: 'Voice ID' },
        voiceStyle: { type: 'object', description: 'Voice style settings' },
      },
      required: ['text'],
    },
    kind: 'spend',
  },
  {
    name: 'create_fake_text_screenshot',
    description: 'Create a fake text conversation screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        conversation: { type: 'object', description: 'Conversation data' },
      },
      required: ['conversation'],
    },
    kind: 'write',
  },
  {
    name: 'list_caption_templates',
    description: 'List available caption templates.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
  {
    name: 'list_art_styles',
    description: 'List available art styles.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
  {
    name: 'get_workspace',
    description: 'Get the authenticated workspace details.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
  {
    name: 'list_credit_logs',
    description: 'List credit ledger entries for the workspace.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
  {
    name: 'list_balance_logs',
    description: 'List balance ledger entries for the workspace.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
] as const;

// --- Extra tools (docs/07 §4.2) --------------------------------------------

export const EXTRA_MCP_TOOLS: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly kind: 'read' | 'write' | 'spend';
}> = [
  {
    name: 'plan_video',
    description: 'Dry-run estimate: scene count, duration, language plan. No charge.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Video script' },
        size: { type: 'string', enum: ['landscape', 'portrait'] },
      },
      required: ['script'],
    },
    kind: 'read',
  },
  {
    name: 'preview_script_split',
    description: 'Show how a script would be split into scenes, with language tags.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Video script' },
        size: { type: 'string', enum: ['landscape', 'portrait'] },
      },
      required: ['script'],
    },
    kind: 'read',
  },
  {
    name: 'list_languages',
    description: 'List narration languages and whether a mixed pair exists.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
  },
] as const;

export const ALL_MCP_TOOLS = [...MCP_TOOLS, ...EXTRA_MCP_TOOLS];

// --- OAuth 2.1 -------------------------------------------------------------

export const oauthProtectedResourceSchema = z.strictObject({
  resource: z.string(),
  authorization_servers: z.array(z.string().url()),
  scopes_supported: z.array(z.string()),
  bearer_methods_supported: z.array(z.string()),
  revocation_methods_supported: z.array(z.string()),
  introspection_methods_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()).default(['S256']),
});
export type OAuthProtectedResource = z.infer<typeof oauthProtectedResourceSchema>;

export const oauthAuthorizationServerSchema = z.strictObject({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  revocation_endpoint: z.string().url(),
  code_challenge_methods_supported: z.array(z.string()).default(['S256']),
  grant_types_supported: z.array(z.string()).default(['authorization_code', 'refresh_token']),
  response_types_supported: z.array(z.string()).default(['code']),
  access_token_signing_alg_values_supported: z.array(z.string()).default(['none']),
});
export type OAuthAuthorizationServer = z.infer<typeof oauthAuthorizationServerSchema>;

export const oauthRegisterResponseSchema = z.strictObject({
  client_id: z.string(),
  client_secret: z.string().optional(),
  redirect_uris: z.array(z.string().url()),
  grant_types: z.array(z.string()).default(['authorization_code']),
  token_endpoint_auth_method: z.string().default('none'),
});
export type OAuthRegisterResponse = z.infer<typeof oauthRegisterResponseSchema>;

// --- Token ------------------------------------------------------------------

export const accessTokenSchema = z.strictObject({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});
export type AccessToken = z.infer<typeof accessTokenSchema>;
