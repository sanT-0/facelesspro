import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeFrame, fitWithin, probeFrameSize } from './frame-decode';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

interface Response {
  stdout?: Buffer;
  stderr?: string;
  code?: number;
}

const responses = new Map<string, Response>();

function resetSpawn(): void {
  responses.clear();
  mockSpawn.mockImplementation((command: string) => {
    const response = responses.get(command) ?? { code: 0 };
    const listeners: Record<string, Array<(value: unknown) => void>> = {};
    const child = {
      stdout: {
        on: (event: string, callback: (chunk: Buffer) => void) => {
          if (event === 'data' && response.stdout) callback(response.stdout);
        },
      },
      stderr: {
        on: (event: string, callback: (chunk: Buffer) => void) => {
          if (event === 'data' && response.stderr) callback(Buffer.from(response.stderr));
        },
      },
      on: (event: string, callback: (value: unknown) => void) => {
        (listeners[event] ??= []).push(callback);
      },
      kill: vi.fn(),
      emit: (event: string, value?: unknown) => {
        for (const callback of listeners[event] ?? []) callback(value);
      },
    };
    setImmediate(() => child.emit('close', response.code ?? 0));
    return child as unknown as ReturnType<typeof spawn>;
  });
}

function respond(command: string, response: Response): void {
  responses.set(command, response);
}

/** RGB24 bytes for a solid-colour frame. */
function solid(width: number, height: number, rgb: [number, number, number]): Buffer {
  const buffer = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    buffer[index * 3] = rgb[0];
    buffer[index * 3 + 1] = rgb[1];
    buffer[index * 3 + 2] = rgb[2];
  }
  return buffer;
}

describe('fitWithin', () => {
  it('caps the long edge and preserves the aspect ratio', () => {
    expect(fitWithin({ width: 1920, height: 1080 }, 128)).toEqual({ width: 128, height: 72 });
    expect(fitWithin({ width: 1080, height: 1920 }, 128)).toEqual({ width: 72, height: 128 });
  });

  it('never upscales a small frame', () => {
    expect(fitWithin({ width: 64, height: 36 }, 128)).toEqual({ width: 64, height: 36 });
  });

  it('rejects an invalid size or ceiling', () => {
    expect(() => fitWithin({ width: 0, height: 10 }, 128)).toThrow(/invalid frame size/);
    expect(() => fitWithin({ width: 10, height: 10 }, 0)).toThrow(/positive integer/);
  });
});

describe('probeFrameSize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSpawn();
  });

  it('parses the csv size ffprobe returns', async () => {
    respond('ffprobe', { stdout: Buffer.from('1920,1080\n') });
    await expect(probeFrameSize('frame.png')).resolves.toEqual({ width: 1920, height: 1080 });
  });

  it('throws on unparsable output and on a non-zero exit', async () => {
    respond('ffprobe', { stdout: Buffer.from('nonsense') });
    await expect(probeFrameSize('frame.png')).rejects.toThrow(/invalid frame size/);

    respond('ffprobe', { code: 1, stderr: 'no such file' });
    await expect(probeFrameSize('frame.png')).rejects.toThrow(/ffprobe frame size failed with 1/);
  });
});

describe('decodeFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSpawn();
  });

  it('decodes to the scaled size without probing when sourceSize is given', async () => {
    respond('ffmpeg', { stdout: solid(128, 72, [255, 0, 0]) });

    const frame = await decodeFrame('frame.png', {
      maxSize: 128,
      sourceSize: { width: 1920, height: 1080 },
    });

    expect(frame.width).toBe(128);
    expect(frame.height).toBe(72);
    expect(frame.data.length).toBe(128 * 72 * 3);
    expect(frame.data[0]).toBe(255);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0]![0]).toBe('ffmpeg');
  });

  it('probes the size first when it was not supplied', async () => {
    respond('ffprobe', { stdout: Buffer.from('32,32\n') });
    respond('ffmpeg', { stdout: solid(32, 32, [0, 0, 0]) });

    const frame = await decodeFrame('frame.png');

    expect(frame.width).toBe(32);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('rejects a truncated stream instead of analysing it', async () => {
    respond('ffmpeg', { stdout: Buffer.alloc(10) });

    await expect(
      decodeFrame('frame.png', { maxSize: 128, sourceSize: { width: 32, height: 32 } }),
    ).rejects.toThrow(/returned 10 bytes, expected 3072/);
  });

  it('rejects a failed ffmpeg call', async () => {
    respond('ffmpeg', { code: 1, stderr: 'Invalid data found' });

    await expect(
      decodeFrame('frame.png', { maxSize: 128, sourceSize: { width: 32, height: 32 } }),
    ).rejects.toThrow(/ffmpeg frame decode exited with 1/);
  });
});
