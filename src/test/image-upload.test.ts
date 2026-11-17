import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  encodeWithinBudget,
  prepareImageForUpload,
  MAX_PHOTO_BYTES,
  formatBytes,
} from '@/lib/imageUpload';

/**
 * A canvas stub. jsdom does not implement a 2D context (the `canvas` npm
 * package is not installed), so the encode-and-shrink logic is exercised
 * against a fake canvas with an injected encoder.
 */
function fakeCanvas(width = 256, height = 256) {
  return { width, height } as unknown as HTMLCanvasElement;
}

describe('encodeWithinBudget', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the first encoding that fits the budget', async () => {
    const encoder = vi.fn(async (_c: HTMLCanvasElement, type: string) =>
      new Blob(['x'.repeat(1000)], { type }));

    const blob = await encodeWithinBudget(fakeCanvas(), 50 * 1024, encoder);

    expect(blob.size).toBe(1000);
    expect(encoder).toHaveBeenCalledTimes(1);
  });

  it('steps down through lower qualities until the blob fits', async () => {
    // Every attempt is over budget except the last (lowest quality).
    const encoder = vi.fn(async (_c: HTMLCanvasElement, type: string, quality: number) =>
      new Blob(['x'.repeat(quality === 0.55 ? 100 : 90000)], { type }));

    const blob = await encodeWithinBudget(fakeCanvas(), 50 * 1024, encoder);

    expect(blob.size).toBe(100);
    expect(encoder.mock.calls.length).toBeGreaterThan(1);
  });

  it('throws rather than returning a blob that is over budget', async () => {
    const encoder = vi.fn(async (_c: HTMLCanvasElement, type: string) =>
      new Blob(['x'.repeat(200000)], { type }));

    await expect(encodeWithinBudget(fakeCanvas(), MAX_PHOTO_BYTES, encoder)).rejects.toThrow(
      /Could not compress/i,
    );
  });
});

describe('prepareImageForUpload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a file that is not an allowed image type', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    await expect(prepareImageForUpload(file)).rejects.toThrow(/JPEG, PNG or WebP/i);
  });

  it('rejects a GIF, which the server does not accept either', async () => {
    const file = new File(['x'], 'a.gif', { type: 'image/gif' });
    await expect(prepareImageForUpload(file)).rejects.toThrow(/JPEG, PNG or WebP/i);
  });
});

describe('formatBytes', () => {
  it('renders bytes and kilobytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(18_432)).toBe('18.0 KB');
  });
});
