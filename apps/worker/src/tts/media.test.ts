import { describe, expect, it, vi } from 'vitest';

import { TtsPortError } from '../ports/tts';
import { createMediaTtsPort } from './media';

const PAIR = {
  id: 'valluvar',
  ta: 'ta-IN-ValluvarNeural',
  en: 'ta-IN-ValluvarNeural',
  notes: 'one speaker',
};

const RESPONSE = {
  request_id: 'r1',
  segments: [
    {
      index: 0,
      voice: 'ta-IN-ValluvarNeural',
      text: 'வணக்கம்',
      audio_path: '/media/r1/run-000.wav',
      start_ms: 0,
      duration_ms: 1_000,
      head_trim_ms: 20,
      words: [{ text: 'வணக்கம்', start_ms: 0, end_ms: 900 }],
    },
  ],
  master_path: '/media/r1/master.wav',
  master_mp3_path: '/media/r1/master.mp3',
  total_duration_ms: 1_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('media TTS adapter', () => {
  it('resolves a pair id and parses the catalogue entry', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PAIR));
    const port = createMediaTtsPort({ baseUrl: 'http://media:8000/', fetchImpl });

    await expect(port.resolvePair('valluvar')).resolves.toEqual(PAIR);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://media:8000/voices/valluvar',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each([
    [404, false],
    [422, false],
    [500, true],
    [429, true],
  ])('maps pair HTTP %i to retryable=%s', async (status, retryable) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ detail: 'no such pair' }, status),
    );
    const port = createMediaTtsPort({ fetchImpl });

    await expect(port.resolvePair('nope')).rejects.toMatchObject({
      name: 'TtsPortError',
      status,
      retryable,
    });
  });

  it('treats a network failure as retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const port = createMediaTtsPort({ fetchImpl });

    await expect(port.resolvePair('valluvar')).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('treats an invalid pair body as permanent', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'valluvar' }));
    const port = createMediaTtsPort({ fetchImpl });

    await expect(port.resolvePair('valluvar')).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('synthesizes, reads the encoded master and rebases timings to camelCase', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RESPONSE));
    const readFileImpl = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const port = createMediaTtsPort({ fetchImpl, readFileImpl });

    const result = await port.synthesize({
      segments: [{ text: 'வணக்கம்', voice: 'ta-IN-ValluvarNeural' }],
    });

    expect(result).toEqual({
      requestId: 'r1',
      audio: new Uint8Array([1, 2, 3]),
      mime: 'audio/mpeg',
      durationMs: 1_000,
      segments: [
        {
          index: 0,
          voice: 'ta-IN-ValluvarNeural',
          text: 'வணக்கம்',
          startMs: 0,
          durationMs: 1_000,
          words: [{ text: 'வணக்கம்', startMs: 0, endMs: 900 }],
        },
      ],
    });
    expect(readFileImpl).toHaveBeenCalledWith('/media/r1/master.mp3');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/synthesize',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          segments: [{ text: 'வணக்கம்', voice: 'ta-IN-ValluvarNeural' }],
        }),
      }),
    );
  });

  it('classifies an unreadable or empty master as permanent', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RESPONSE));
    const missing = createMediaTtsPort({
      fetchImpl,
      readFileImpl: async () => {
        throw new Error('ENOENT');
      },
    });
    await expect(
      missing.synthesize({ segments: [{ text: 'x', voice: 'ta-IN-ValluvarNeural' }] }),
    ).rejects.toMatchObject({ retryable: false });

    const empty = createMediaTtsPort({
      fetchImpl,
      readFileImpl: async () => new Uint8Array(),
    });
    await expect(
      empty.synthesize({ segments: [{ text: 'x', voice: 'ta-IN-ValluvarNeural' }] }),
    ).rejects.toBeInstanceOf(TtsPortError);
  });

  it('rejects a malformed request before any HTTP call', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RESPONSE));
    const port = createMediaTtsPort({ fetchImpl });

    await expect(port.synthesize({ segments: [] })).rejects.toMatchObject({
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
