/**
 * `downloadVoiceover` — the voiceover-intake guardrails (docs/04 §1b), proven
 * against an injected `fetch`, never a socket.
 */

import { AUDIO_EXTENSIONS } from '@facelesspro/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  VoiceoverDownloadError,
  downloadVoiceover,
  extensionOf,
  mimeForAudioExtension,
} from './download';

const HTTPS_URL = 'https://cdn.example.com/audio/narration.mp3';

function okResponse(
  body: Uint8Array | ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status: 200, headers });
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('extensionOf', () => {
  it('reads the extension from the pathname, ignoring case and query', () => {
    expect(extensionOf('https://x.test/a/b/narration.MP3?v=2')).toBe('mp3');
    expect(extensionOf('https://x.test/a/b/narration.flac')).toBe('flac');
    expect(extensionOf('https://x.test/no-extension')).toBeNull();
  });
});

describe('mimeForAudioExtension', () => {
  it('maps every allowed container and nothing else', () => {
    for (const extension of AUDIO_EXTENSIONS) {
      expect(mimeForAudioExtension(extension)).toMatch(/^audio\//u);
    }
    expect(mimeForAudioExtension('txt')).toBeNull();
  });
});

describe('downloadVoiceover', () => {
  it('downloads bytes within the cap and reports the mime', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn(async () => okResponse(bytes));

    const result = await downloadVoiceover(HTTPS_URL, { fetchImpl });

    expect(result.bytes).toEqual(bytes);
    expect(result.mime).toBe('audio/mpeg');
    expect(result.finalUrl).toBe(HTTPS_URL);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects non-https and non-audio urls before any request', async () => {
    const fetchImpl = vi.fn(async () => okResponse(new Uint8Array()));
    for (const url of ['http://cdn.example.com/a.mp3', 'ftp://cdn.example.com/a.mp3']) {
      await expect(downloadVoiceover(url, { fetchImpl })).rejects.toMatchObject({
        code: 'invalid_request',
        retryable: false,
      });
    }
    await expect(
      downloadVoiceover('https://cdn.example.com/a.txt', { fetchImpl }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(downloadVoiceover('not a url', { fetchImpl })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('follows https redirects to another audio file and reports the final url', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://origin.example.net/files/v2/clip.m4a' },
        }),
      )
      .mockResolvedValueOnce(okResponse(new Uint8Array([9])));

    const result = await downloadVoiceover(HTTPS_URL, { fetchImpl });

    expect(result.mime).toBe('audio/mp4');
    expect(result.finalUrl).toBe('https://origin.example.net/files/v2/clip.m4a');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect that leaves https or loses the audio extension', async () => {
    const toHttp = vi.fn(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'http://cdn.example.com/a.mp3' },
        }),
    );
    await expect(downloadVoiceover(HTTPS_URL, { fetchImpl: toHttp })).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: false,
    });

    const toDoc = vi.fn(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://cdn.example.com/page' },
        }),
    );
    await expect(downloadVoiceover(HTTPS_URL, { fetchImpl: toDoc })).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: false,
    });
    expect(toDoc).toHaveBeenCalledOnce();
  });

  it('gives up after too many redirects', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/loop.mp3' },
        }),
    );
    await expect(
      downloadVoiceover(HTTPS_URL, { fetchImpl, maxRedirects: 3 }),
    ).rejects.toMatchObject({ code: 'upstream_failed', retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('rejects an oversized content-length without reading the body', async () => {
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': '5' }),
      body: {
        getReader(): never {
          throw new Error('the body must not be read');
        },
        cancel: async () => undefined,
      },
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => response);
    await expect(
      downloadVoiceover(HTTPS_URL, { fetchImpl, maxBytes: 4 }),
    ).rejects.toMatchObject({ code: 'payload_too_large', retryable: false });
  });

  it('aborts mid-stream when the body crosses the cap', async () => {
    const body = streamOf([new Uint8Array(3), new Uint8Array(3)]);
    const fetchImpl = vi.fn(async () => okResponse(body));

    await expect(
      downloadVoiceover(HTTPS_URL, { fetchImpl, maxBytes: 4 }),
    ).rejects.toMatchObject({ code: 'payload_too_large', retryable: false });
  });

  it('accepts a stream with no content-length up to the cap', async () => {
    const bytes = new Uint8Array([7, 7, 7]);
    const fetchImpl = vi.fn(async () => okResponse(streamOf([bytes])));
    const result = await downloadVoiceover(HTTPS_URL, { fetchImpl });
    expect(result.bytes).toEqual(bytes);
  });

  it('rejects an empty body', async () => {
    const fetchImpl = vi.fn(async () => okResponse(new Uint8Array()));
    await expect(downloadVoiceover(HTTPS_URL, { fetchImpl })).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: false,
    });
  });

  it('maps http failures to the retry taxonomy', async () => {
    const retryable = vi.fn(async () => new Response('down', { status: 503 }));
    await expect(
      downloadVoiceover(HTTPS_URL, { fetchImpl: retryable }),
    ).rejects.toMatchObject({ code: 'upstream_failed', retryable: true });

    const rate = vi.fn(async () => new Response('slow', { status: 429 }));
    await expect(downloadVoiceover(HTTPS_URL, { fetchImpl: rate })).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: true,
    });

    const gone = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(downloadVoiceover(HTTPS_URL, { fetchImpl: gone })).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: false,
    });

    const network = vi.fn(async () => {
      throw new Error('socket hang-up');
    });
    await expect(downloadVoiceover(HTTPS_URL, { fetchImpl: network })).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: true,
    });
  });

  it('surfaces a VoiceoverDownloadError, not a bare Error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const error = await downloadVoiceover(HTTPS_URL, { fetchImpl }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(VoiceoverDownloadError);
  });
});
