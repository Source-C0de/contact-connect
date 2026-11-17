/**
 * Client-side image preparation for profile pictures.
 *
 * The server enforces a hard 50 KB limit, so the browser must not send a
 * full-resolution photo. We decode the file, draw it into a square canvas,
 * and re-encode it as a small JPEG/WebP that always fits the budget.
 *
 * Re-encoding has a privacy upside too: the canvas output carries no EXIF
 * metadata, so GPS coordinates from a phone camera are never stored.
 */

/** Must match the server's MAX_UPLOAD_BYTES (server/index.js). */
export const MAX_PHOTO_BYTES = 50 * 1024;

/** The longest edge of the produced picture. */
export const PHOTO_SIZE = 256;

/** Formats we accept. Mirrors the server's allowlist. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AcceptedType = (typeof ACCEPTED_TYPES)[number];

export interface PreparedImage {
  blob: Blob;
  /** MIME type of the produced blob. */
  type: AcceptedType;
  /** Byte length of the produced blob. */
  size: number;
}

/**
 * An encoder turns a canvas into a blob at a given type and quality.
 * Injecting it keeps the size-budget logic testable without a real canvas
 * implementation (jsdom does not provide one).
 */
export type Encoder = (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) => Promise<Blob | null>;

/**
 * Encode a canvas, shrinking the quality (and then the dimensions) until the
 * result fits the byte budget.
 *
 * A 256x256 picture is only 65 536 pixels, so even the pathological worst
 * case (high-entropy noise) is ~25-35 KB as JPEG at quality 0.85. The
 * 192x192 fallback is comfortably under 10 KB.
 */
export async function encodeWithinBudget(
  canvas: HTMLCanvasElement,
  budget: number,
  encode: Encoder,
): Promise<Blob> {
  // WebP first: it preserves alpha and is smaller. JPEG is the fallback for
  // browsers without WebP canvas encoding.
  const attempts: { type: AcceptedType; quality: number }[] = [
    { type: 'image/webp', quality: 0.82 },
    { type: 'image/jpeg', quality: 0.85 },
    { type: 'image/jpeg', quality: 0.7 },
    { type: 'image/jpeg', quality: 0.55 },
  ];

  let smallest: Blob | null = null;
  let smallestType: AcceptedType = 'image/jpeg';

  for (const attempt of attempts) {
    const blob = await encode(canvas, attempt.type, attempt.quality);
    if (!blob) continue;
    if (blob.size <= budget) return blob;
    if (!smallest || blob.size < smallest.size) {
      smallest = blob;
      smallestType = attempt.type;
    }
  }

  // Still too big at the smallest size — halve the dimensions and retry.
  const side = Math.max(64, Math.floor(Math.min(canvas.width, canvas.height) / 2));
  const shrunk = document.createElement('canvas');
  shrunk.width = side;
  shrunk.height = side;
  const ctx = get2dContext(shrunk);
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, side, side);
    for (const quality of [0.7, 0.55, 0.4]) {
      const blob = await encode(shrunk, 'image/jpeg', quality);
      if (blob && blob.size <= budget) return blob;
    }
  }

  if (smallest && smallest.size <= budget) return smallest;

  throw new Error(
    `Could not compress this image below ${Math.round(budget / 1024)} KB. Please choose a smaller picture.`,
  );
}

/**
 * Get a 2D context, tolerating environments without a canvas
 * implementation (jsdom throws "not implemented" rather than returning
 * null).
 */
function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** Encode a canvas via `toBlob`. */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise(resolve => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Decode a file into something drawable.
 *
 * `createImageBitmap` is preferred because `{ imageOrientation: 'from-image' }`
 * applies the EXIF rotation — the default is `'none'`, i.e. NOT applied. The
 * `<img>` fallback gets the same result for free in every browser that
 * matters (CSS `image-orientation: from-image` is the default since Chrome 81
 * / Firefox 26 / Safari 13.1).
 */
async function decode(file: File): Promise<{ width: number; height: number; source: CanvasImageSource }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bitmap.width, height: bitmap.height, source: bitmap };
    } catch {
      // Fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read this image.'));
      el.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, source: img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Turn a picked file into a small square picture that fits the byte budget.
 *
 * The image is centre-cropped to a square (avatars are rendered in a
 * `rounded-full` circle with `object-cover`) and never upscaled.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.includes(file.type as AcceptedType)) {
    throw new Error('Unsupported image type. Please use a JPEG, PNG or WebP image.');
  }

  const { width, height, source } = await decode(file);
  if (!width || !height) {
    throw new Error('Could not read this image.');
  }

  // Centre-crop the largest square.
  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = (height - side) / 2;
  // Never upscale — it adds bytes without adding detail.
  const outSize = Math.min(PHOTO_SIZE, side);

  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;

  const ctx = get2dContext(canvas);
  if (!ctx) {
    throw new Error('This browser cannot process images. Please choose a JPEG or PNG under 50 KB.');
  }

  // Fill with a light grey first so a transparent PNG composites to light
  // grey rather than black in the JPEG fallback.
  ctx.fillStyle = '#E5E7EB';
  ctx.fillRect(0, 0, outSize, outSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, side, side, 0, 0, outSize, outSize);

  const blob = await encodeWithinBudget(canvas, MAX_PHOTO_BYTES, (c, type, quality) =>
    canvasToBlob(c, type, quality),
  );

  // `toBlob` silently falls back to PNG when the requested type is
  // unsupported, so only accept a type we know the server allows.
  const type: AcceptedType = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

  return { blob, type, size: blob.size };
}

/** Human-readable byte size, e.g. "18.4 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
