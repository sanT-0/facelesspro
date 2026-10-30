import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VISION_MAX_FRAMES,
  encodeVisionFrame,
  loadVisionFrames,
  selectVisionFrames,
} from './frames';

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

const respond = (command: string, response: Response): void => {
  responses.set(command, response);
};

describe('selectVisionFrames', () => {
  it('keeps every frame when the list is already small', () => {
    expect(selectVisionFrames(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it(`caps at ${VISION_MAX_FRAMES} with an even spread, first and last included`, () => {
    const paths = Array.from({ length: 24 }, (_, index) => `f${index}.png`);
    const selected = selectVisionFrames(paths);

    expect(selected).toHaveLength(VISION_MAX_FRAMES);
    expect(selected[0]).toBe('f0.png');
    expect(selected.at(-1)).toBe('f23.png');
    expect(new Set(selected).size).toBe(VISION_MAX_FRAMES);
  });

  it('returns the middle frame when only one is allowed', () => {
    expect(selectVisionFrames(['a', 'b', 'c', 'd', 'e'], 1)).toEqual(['c']);
  });

  it('rejects an empty list and a non-positive cap', () => {
    expect(() => selectVisionFrames([])).toThrow(/at least one frame/);
    expect(() => selectVisionFrames(['a'], 0)).toThrow(/positive integer/);
  });
});

describe('encodeVisionFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSpawn();
  });

  it('downscales to the 384 px long edge and returns base64 JPEG', async () => {
    respond('ffprobe', { stdout: Buffer.from('1920,1080\n') });
    respond('ffmpeg', { stdout: Buffer.from('jpeg-bytes') });

    const frame = await encodeVisionFrame('frame.png');

    expect(frame.mimeType).toBe('image/jpeg');
    expect(frame.data).toBe(Buffer.from('jpeg-bytes').toString('base64'));
    expect(frame.path).toBe('frame.png');

    const args = mockSpawn.mock.calls[1]![1] as string[];
    expect(args).toContain('scale=384:216:flags=lanczos');
  });

  it('never upscales a small frame', async () => {
    respond('ffprobe', { stdout: Buffer.from('64,36\n') });
    respond('ffmpeg', { stdout: Buffer.from('x') });

    await encodeVisionFrame('small.png');

    const args = mockSpawn.mock.calls[1]![1] as string[];
    expect(args).toContain('scale=64:36:flags=lanczos');
  });

  it('rejects a failed ffmpeg call', async () => {
    respond('ffprobe', { stdout: Buffer.from('1920,1080\n') });
    respond('ffmpeg', { code: 1, stderr: 'Invalid data found' });

    await expect(encodeVisionFrame('frame.png')).rejects.toThrow(
      /ffmpeg vision encode exited with 1/,
    );
  });

  it('rejects an empty encode instead of sending zero bytes', async () => {
    respond('ffprobe', { stdout: Buffer.from('1920,1080\n') });
    respond('ffmpeg', { stdout: Buffer.alloc(0) });

    await expect(encodeVisionFrame('frame.png')).rejects.toThrow(/returned no bytes/);
  });
});

describe('loadVisionFrames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSpawn();
  });

  it('selects, then encodes one frame per ffmpeg call', async () => {
    respond('ffprobe', { stdout: Buffer.from('1920,1080\n') });
    respond('ffmpeg', { stdout: Buffer.from('jpeg') });

    const paths = Array.from({ length: 10 }, (_, index) => `f${index}.png`);
    const frames = await loadVisionFrames(paths);

    expect(frames).toHaveLength(VISION_MAX_FRAMES);
    expect(frames[0]!.path).toBe('f0.png');
    expect(frames.at(-1)!.path).toBe('f9.png');
  });
});
