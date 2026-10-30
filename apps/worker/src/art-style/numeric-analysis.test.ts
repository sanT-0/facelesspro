import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeFrames } from './numeric-analysis';

vi.mock('./frame-decode', () => ({
  probeFrameSize: vi.fn(),
  decodeFrame: vi.fn(),
}));

import { decodeFrame, probeFrameSize } from './frame-decode';

const mockProbe = vi.mocked(probeFrameSize);
const mockDecode = vi.mocked(decodeFrame);

type Rgb = [number, number, number];

function frame(width: number, height: number, pixelAt: (x: number, y: number) => Rgb) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = (y * width + x) * 3;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
    }
  }
  return { data, width, height };
}

/** Feed one decoded frame per path, in order. */
function serve(frames: Array<ReturnType<typeof frame>>, size = { width: 32, height: 32 }): void {
  mockProbe.mockResolvedValue(size);
  let call = 0;
  mockDecode.mockImplementation(async () => {
    const next = frames[call] ?? frames[frames.length - 1]!;
    call += 1;
    return next;
  });
}

describe('analyzeFrames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes one palette across every frame, not one per frame', async () => {
    serve([
      frame(32, 32, () => [255, 0, 0]),
      frame(32, 32, () => [0, 0, 255]),
    ]);

    const profile = await analyzeFrames(['a.png', 'b.png']);

    expect(profile.frameCount).toBe(2);
    expect(profile.palette.hex).toHaveLength(2);
    expect(profile.palette.weights[0]).toBeCloseTo(0.5, 2);
    expect(profile.palette.weights[1]).toBeCloseTo(0.5, 2);
    expect(profile.palette.hex).toContain('#ff0000');
    expect(profile.palette.hex).toContain('#0000ff');
  });

  it('reports a flat reference as zero ink and zero saturation', async () => {
    serve([frame(32, 32, () => [128, 128, 128])]);

    const profile = await analyzeFrames(['a.png']);

    expect(profile.line.edgeEnergy).toBe(0);
    expect(profile.line.strokeDensity).toBe(0);
    expect(profile.tone.saturation.mean).toBe(0);
    expect(profile.palette.hex).toEqual(['#808080']);
  });

  it('averages ink metrics across frames', async () => {
    const flat = frame(32, 32, () => [255, 255, 255]);
    const striped = frame(32, 32, (x) =>
      Math.floor(x / 2) % 2 === 0 ? [0, 0, 0] : [255, 255, 255],
    );

    serve([striped]);
    const stripedOnly = await analyzeFrames(['b.png']);

    serve([flat, striped, flat]);
    const profile = await analyzeFrames(['a.png', 'b.png', 'c.png']);

    expect(profile.line.edgeEnergy).toBeGreaterThan(0);
    expect(profile.line.edgeEnergy).toBeLessThan(stripedOnly.line.edgeEnergy);
  });

  it('takes aspect and orientation from the native frame size', async () => {
    serve([frame(32, 32, () => [10, 20, 30])], { width: 1080, height: 1920 });

    const profile = await analyzeFrames(['a.png']);

    expect(profile.aspect).toEqual({
      width: 1080,
      height: 1920,
      ratio: 0.5625,
      orientation: 'portrait',
    });
  });

  it('is deterministic for the same frames', async () => {
    const frames = [frame(24, 24, (x, y) => [(x * 9) % 256, (y * 5) % 256, 40])];
    serve(frames);

    const first = await analyzeFrames(['a.png']);
    serve(frames);
    const second = await analyzeFrames(['a.png']);

    expect(second).toEqual(first);
  });

  it('echoes the safe-area margin it measured with', async () => {
    serve([frame(32, 32, () => [0, 0, 0])]);

    const profile = await analyzeFrames(['a.png'], { margin: 0.1 });

    expect(profile.safeArea.margin).toBe(0.1);
  });

  it('rejects an empty frame list', async () => {
    await expect(analyzeFrames([])).rejects.toThrow(/at least one frame/);
  });
});
