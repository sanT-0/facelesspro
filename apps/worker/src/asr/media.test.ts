import { describe, expect, it, vi } from 'vitest';

import { AsrPortError } from '../ports/asr';
import { createMediaAsrPort } from './media';

const RESPONSE = {
  request_id: 'r1',
  language: 'ta',
  duration_ms: 4_100,
  text: 'வணக்கம் நண்பர்களே. Today we plan.',
  segments: [
    {
      text: 'வணக்கம் நண்பர்களே.',
      start_ms: 120,
      end_ms: 2_240,
      words: [
        { text: 'வணக்கம்', start_ms: 120, end_ms: 980 },
        { text: 'நண்பர்களே', start_ms: 1_020, end_ms: 2_240 },
      ],
    },
    {
      text: 'Today we plan.',
      start_ms: 2_500,
      end_ms: 4_100,
      words: [{ text: 'Today', start_ms: 2_500, end_ms: 2_980 }],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const AUDIO = new Uint8Array([1, 2, 3, 4]);

describe('media ASR adapter', () => {
  it('posts the raw bytes and maps global word timings to camelCase', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(RESPONSE));
    const port = createMediaAsrPort({ baseUrl: 'http://media:8000/', fetchImpl });

    const result = await port.transcribe({ audio: AUDIO, mime: 'audio/mpeg' });

    expect(result).toEqual({
      requestId: 'r1',
      language: 'ta',
      durationMs: 4_100,
      text: 'வணக்கம் நண்பர்களே. Today we plan.',
      segments: [
        {
          text: 'வணக்கம் நண்பர்களே.',
          startMs: 120,
          endMs: 2_240,
          words: [
            { text: 'வணக்கம்', startMs: 120, endMs: 980 },
            { text: 'நண்பர்களே', startMs: 1_020, endMs: 2_240 },
          ],
        },
        {
          text: 'Today we plan.',
          startMs: 2_500,
          endMs: 4_100,
          words: [{ text: 'Today', startMs: 2_500, endMs: 2_980 }],
        },
      ],
    });

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe('http://media:8000/transcribe');
    expect(call?.[1]?.method).toBe('POST');
    // The bytes go up as-is: no multipart, no base64, no JSON wrapper.
    expect(call?.[1]?.body).toBe(AUDIO);
    expect(call?.[1]?.headers).toEqual({ 'Content-Type': 'audio/mpeg' });
  });

  it('refuses an empty upload or a non-audio mime before any request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RESPONSE));
    const port = createMediaAsrPort({ fetchImpl });

    await expect(
      port.transcribe({ audio: new Uint8Array(), mime: 'audio/mpeg' }),
    ).rejects.toMatchObject({ name: 'AsrPortError', retryable: false });

    await expect(
      port.transcribe({ audio: AUDIO, mime: 'text/plain' }),
    ).rejects.toMatchObject({ name: 'AsrPortError', retryable: false });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [404, false],
    [413, false],
    [422, false],
    // A 502 means the engine decoded the audio and found no usable speech.
    // Retrying the same bytes cannot change that, unlike a 503 (engine down).
    [502, false],
    [503, true],
    [500, true],
    [429, true],
  ])('maps transcribe HTTP %i to retryable=%s', async (status, retryable) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ detail: 'no speech detected' }, status),
    );
    const port = createMediaAsrPort({ fetchImpl });

    await expect(
      port.transcribe({ audio: AUDIO, mime: 'audio/mpeg' }),
    ).rejects.toMatchObject({ name: 'AsrPortError', status, retryable });
  });

  it('treats a network failure as retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const port = createMediaAsrPort({ fetchImpl });

    await expect(
      port.transcribe({ audio: AUDIO, mime: 'audio/mpeg' }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('treats unreadable JSON and a schema-invalid transcript as permanent', async () => {
    const broken = createMediaAsrPort({
      fetchImpl: vi.fn(async () => new Response('<html>', { status: 200 })),
    });
    await expect(
      broken.transcribe({ audio: AUDIO, mime: 'audio/mpeg' }),
    ).rejects.toMatchObject({ retryable: false });

    const silent = createMediaAsrPort({
      fetchImpl: vi.fn(async () =>
        jsonResponse({ ...RESPONSE, text: '', segments: [] }),
      ),
    });
    await expect(
      silent.transcribe({ audio: AUDIO, mime: 'audio/mpeg' }),
    ).rejects.toMatchObject({ retryable: false });
  });

  it('surfaces an AsrPortError, not a bare Error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'down' }, 503));
    const port = createMediaAsrPort({ fetchImpl });

    const error = await port
      .transcribe({ audio: AUDIO, mime: 'audio/mpeg' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AsrPortError);
  });
});
