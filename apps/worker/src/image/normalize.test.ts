import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../art-style/frame-decode', () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from '../art-style/frame-decode';
import { normalizeImageToPng } from './normalize';

const mockRun = vi.mocked(runProcess);
const input = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue({ code: 0, stdout: png, stderr: '' });
});

describe('normalizeImageToPng', () => {
  it('centre-crops provider bytes to exact RGB PNG geometry through stdin/stdout', async () => {
    await expect(
      normalizeImageToPng(input, { width: 1024, height: 576 }),
    ).resolves.toEqual(png);

    const [command, args, timeoutMs, stdin] = mockRun.mock.calls[0]!;
    expect(command).toBe('ffmpeg');
    expect(timeoutMs).toBe(120_000);
    expect(stdin).toEqual(input);
    expect(args).toEqual([
      '-v',
      'error',
      '-i',
      'pipe:0',
      '-vf',
      'scale=1024:576:force_original_aspect_ratio=increase,crop=1024:576,setsar=1,format=rgb24',
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      'pipe:1',
    ]);
  });

  it('rejects empty input and invalid target geometry before spawning', async () => {
    await expect(
      normalizeImageToPng(new Uint8Array(), { width: 1024, height: 576 }),
    ).rejects.toThrow(/empty provider image/);
    await expect(normalizeImageToPng(input, { width: 0, height: 576 })).rejects.toThrow(
      /positive integers/,
    );
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('surfaces ffmpeg stderr and rejects an empty or non-PNG output', async () => {
    mockRun.mockResolvedValueOnce({ code: 1, stdout: Buffer.alloc(0), stderr: 'Invalid data' });
    await expect(normalizeImageToPng(input, { width: 1024, height: 576 })).rejects.toThrow(
      /exited with 1.*Invalid data/,
    );

    mockRun.mockResolvedValueOnce({ code: 0, stdout: Buffer.alloc(0), stderr: '' });
    await expect(normalizeImageToPng(input, { width: 1024, height: 576 })).rejects.toThrow(
      /no PNG bytes/,
    );

    mockRun.mockResolvedValueOnce({ code: 0, stdout: Buffer.from('not-png'), stderr: '' });
    await expect(normalizeImageToPng(input, { width: 1024, height: 576 })).rejects.toThrow(
      /not a PNG/,
    );
  });
});
