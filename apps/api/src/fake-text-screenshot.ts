/**
 * `POST /v1/fake-text-screenshot` — renders a chat conversation as a PNG image.
 *
 * Reuses the chat-skin SVG renderer to produce a single still image from
 * a conversation payload. Returns the image as `image/png` with the PNG bytes.
 */

import { Hono } from 'hono';

import {
  apiError,
  fakeTextScreenshotRequestSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';
import { renderChatSkin, chatSkinSvgToPng } from '@facelesspro/art';

export interface FakeTextScreenshotRouteDeps extends AuthDeps {
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

export function createFakeTextScreenshotRoutes(
  deps: FakeTextScreenshotRouteDeps,
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();

  app.use('*', withWorkspace(deps));

  app.post('/', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json(
        apiError('invalid_request', 'request body must be JSON'),
        400,
      );
    }

    const parsed = fakeTextScreenshotRequestSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      let field: string | undefined;
      if (issue !== undefined && issue.path.length > 0) {
        field = issue.path.join('.');
      } else if (
        issue !== undefined &&
        issue.code === 'unrecognized_keys' &&
        issue.keys !== undefined &&
        issue.keys.length > 0
      ) {
        field = issue.keys[0];
      }
      return c.json(
        apiError('invalid_request', issue?.message ?? 'invalid request', field),
        400,
      );
    }

    const body = parsed.data.conversation;

    // Build chat options for the renderer
    const chatOptions = {
      template: body.template as 'iphone' | 'iphone-dark' | 'whatsapp' | 'whatsapp-dark' | 'instagram' | 'instagram-dark' | 'tinder' | 'tinder-dark' | 'cantina',
      characters: body.characters.map((ch) => ({
        id: ch.id,
        name: ch.name,
        side: ch.side,
      })),
      messages: body.messages.map((msg) => ({
        text: msg.text,
        side: msg.characterId
          ? body.characters.find((c) => c.id === msg.characterId)?.side ?? 'left'
          : 'left',
        name: msg.characterId
          ? body.characters.find((c) => c.id === msg.characterId)?.name
          : body.characters[0]?.name,
      })),
      groupName: body.groupName,
      width: 1080,
      height: 1920,
    };

    const svg = renderChatSkin(chatOptions);
    const png = await chatSkinSvgToPng(svg, 1080, 1920);

    return new Response(png, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
        'Cache-Control': 'private, max-age=300',
      },
    });
  });

  return app;
}