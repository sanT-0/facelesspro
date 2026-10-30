import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPreviewClip,
  buildPreviewGrid,
  verifyPreviewClip,
  verifyPreviewGrid,
} from './preview';

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
  mockSpawn.mockReset();
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

function argsOf(callIndex: number): string[] {
  const call = mockSpawn.mock.calls[callIndex];
  if (call === undefined) throw new Error(`spawn call ${callIndex} did not happen`);
  return call[1] as string[];
}

function probeJson(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

const frames = Array.from({ length: 8 }, (_unused, index) => `frame-${index}.png`);

const palette = {
  hex: ['#f1bf4d', '#1a283f', '#fefefe', '#020202', '#e2562d'],
  weights: [0.3751, 0.3613, 0.2083, 0.0414, 0.0139],
};

const request = {
  framePaths: frames,
  palette,
  inkColor: '#020202',
  outPath: 'out/preview.png',
};

beforeEach(() => {
  resetSpawn();
});

describe('buildPreviewGrid', () => {
  it('feeds 8 frames plus a palette card into one 9-input xstack', async () => {
    await buildPreviewGrid(request);

    const args = argsOf(0);
    expect(args.filter((arg) => arg === '-i')).toHaveLength(8);
    expect(args).toContain('-frames:v');
    expect(args).toContain('1');

    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('xstack=inputs=9');
    expect(graph).toContain('layout=16_16|434_16|852_16|16_248|434_248|852_248|16_480|434_480|852_480');
    expect(graph).toContain('scale=410:224:force_original_aspect_ratio=decrease');
    expect(graph).toContain('color=0x020202');
    expect(graph).toContain('pad=1280:720:1:0');
    // Palette bands: 154 + 148 + 85 + 17 + 6 = 410.
    expect(graph).toContain('drawbox=x=0:y=0:w=154:h=224:color=0xf1bf4d:t=fill');
    expect(graph).toContain('drawbox=x=154:y=0:w=148:h=224:color=0x1a283f:t=fill');
    expect(graph).toContain('drawbox=x=387:y=0:w=17:h=224:color=0x020202:t=fill');
    expect(graph).toContain('[v8]');
  });

  it('centre-crops a landscape frame for a 9:16 portrait grid', async () => {
    respond('ffprobe', { stdout: Buffer.from('640,360\n') });

    await buildPreviewGrid({
      ...request,
      canvas: { width: 720, height: 1280 },
      portrait: true,
      outPath: 'out/preview-portrait.png',
    });

    const probeCommand = mockSpawn.mock.calls[0]?.[0];
    expect(probeCommand).toBe('ffprobe');

    const args = argsOf(1);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[0:v]crop=203:360:218:0,');
    expect(graph).toContain('scale=224:410:force_original_aspect_ratio=decrease');
    expect(graph).toContain('pad=720:1280:0:1');
  });

  it('rejects the wrong number of frames and a mismatched palette', async () => {
    await expect(buildPreviewGrid({ ...request, framePaths: frames.slice(0, 7) })).rejects.toThrow(
      /exactly 8 frames/,
    );
    await expect(
      buildPreviewGrid({ ...request, palette: { hex: ['#000000'], weights: [0.5, 0.5] } }),
    ).rejects.toThrow(/one weight per colour/);
    await expect(buildPreviewGrid({ ...request, inkColor: 'black' })).rejects.toThrow(/#rrggbb/);
  });

  it('throws when ffmpeg cannot render the grid', async () => {
    respond('ffmpeg', { code: 1, stderr: 'Invalid argument' });

    await expect(buildPreviewGrid(request)).rejects.toThrow(/preview grid exited with 1.*Invalid argument/);
  });
});

describe('buildPreviewClip', () => {
  it('loops each frame, trims to 20 frames and asks for exactly 180 silent frames', async () => {
    await buildPreviewClip({ ...request, outPath: 'out/preview.mp4' });

    const args = argsOf(0);
    expect(args.filter((arg) => arg === '-loop')).toHaveLength(8);
    expect(args.filter((arg) => arg === '1')).toHaveLength(8);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('trim=end_frame=20');
    expect(graph).toContain('format=yuv420p,fps=30');
    expect(args).toContain('-an');
    expect(args.slice(args.indexOf('-frames:v'), args.indexOf('-frames:v') + 2)).toEqual([
      '-frames:v',
      '180',
    ]);
    expect(args).toContain('libx264');
    expect(args).toContain('+faststart');
  });

  it('throws when ffmpeg cannot render the clip', async () => {
    respond('ffmpeg', { code: 1, stderr: 'Unknown encoder' });

    await expect(buildPreviewClip({ ...request, outPath: 'out/preview.mp4' })).rejects.toThrow(
      /preview clip exited with 1.*Unknown encoder/,
    );
  });
});

describe('verifyPreviewGrid', () => {
  it('accepts a PNG at the expected canvas size', async () => {
    respond('ffprobe', {
      stdout: probeJson({
        streams: [{ codec_type: 'video', codec_name: 'png', width: 1280, height: 720 }],
      }),
    });

    await expect(
      verifyPreviewGrid('preview.png', { width: 1280, height: 720 }),
    ).resolves.toBeUndefined();
  });

  it('rejects a missing stream, the wrong codec and the wrong size', async () => {
    respond('ffprobe', { stdout: probeJson({ streams: [] }) });
    await expect(verifyPreviewGrid('preview.png', { width: 1280, height: 720 })).rejects.toThrow(
      /no video stream/,
    );

    respond('ffprobe', {
      stdout: probeJson({
        streams: [{ codec_type: 'video', codec_name: 'mjpeg', width: 1280, height: 720 }],
      }),
    });
    await expect(verifyPreviewGrid('preview.png', { width: 1280, height: 720 })).rejects.toThrow(
      /expected png/,
    );

    respond('ffprobe', {
      stdout: probeJson({
        streams: [{ codec_type: 'video', codec_name: 'png', width: 640, height: 360 }],
      }),
    });
    await expect(verifyPreviewGrid('preview.png', { width: 1280, height: 720 })).rejects.toThrow(
      /640x360, expected 1280x720/,
    );
  });

  it('rejects invalid ffprobe JSON and a failed probe', async () => {
    respond('ffprobe', { stdout: Buffer.from('not json') });
    await expect(verifyPreviewGrid('preview.png', { width: 1280, height: 720 })).rejects.toThrow(
      /invalid JSON/,
    );

    respond('ffprobe', { code: 2, stderr: 'No such file' });
    await expect(verifyPreviewGrid('preview.png', { width: 1280, height: 720 })).rejects.toThrow(
      /ffprobe preview failed with 2/,
    );
  });
});

describe('verifyPreviewClip', () => {
  const expectation = {
    canvas: { width: 1280, height: 720 },
    fps: 30,
    frames: 180,
    seconds: 6,
  };

  const clipProbe = (overrides: Record<string, unknown> = {}) =>
    probeJson({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1280,
          height: 720,
          nb_frames: '180',
          avg_frame_rate: '30/1',
          ...overrides,
        },
      ],
      format: { duration: '6.000000' },
    });

  it('accepts a silent 6 s, 180-frame clip', async () => {
    respond('ffprobe', { stdout: clipProbe() });

    await expect(verifyPreviewClip('preview.mp4', expectation)).resolves.toBeUndefined();
  });

  it('rejects an audio stream, a wrong frame count and a short duration', async () => {
    respond('ffprobe', {
      stdout: probeJson({
        streams: [
          { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, nb_frames: '180' },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
        format: { duration: '6.0' },
      }),
    });
    await expect(verifyPreviewClip('preview.mp4', expectation)).rejects.toThrow(/audio stream/);

    respond('ffprobe', { stdout: clipProbe({ nb_frames: '179' }) });
    await expect(verifyPreviewClip('preview.mp4', expectation)).rejects.toThrow(
      /179 frames, expected 180/,
    );

    respond('ffprobe', { stdout: clipProbe() });
    responses.set('ffprobe', {
      stdout: probeJson({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1280,
            height: 720,
            nb_frames: '150',
            avg_frame_rate: '30/1',
          },
        ],
        format: { duration: '5.000000' },
      }),
    });
    await expect(verifyPreviewClip('preview.mp4', expectation)).rejects.toThrow(/150 frames/);

    responses.set('ffprobe', {
      stdout: probeJson({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1280,
            height: 720,
            avg_frame_rate: '30/1',
          },
        ],
        format: { duration: '5.900000' },
      }),
    });
    await expect(verifyPreviewClip('preview.mp4', expectation)).rejects.toThrow(
      /5\.900 s, expected 6\.000 s/,
    );
  });

  it('rejects the wrong resolution and frame rate', async () => {
    respond('ffprobe', { stdout: clipProbe({ width: 720, height: 1280 }) });
    await expect(verifyPreviewClip('preview.mp4', expectation)).rejects.toThrow(
      /720x1280, expected 1280x720/,
    );

    respond('ffprobe', { stdout: clipProbe({ avg_frame_rate: '24/1' }) });
    await expect(verifyPreviewClip('preview.mp4', expectation)).rejects.toThrow(
      /24\/1 fps, expected 30/,
    );
  });
});
