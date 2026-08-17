'use client';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

/** Downscales an image file in the browser before upload. A typical phone photo (often 3-10MB)
 *  sent as base64 in a JSON body comfortably clears Vercel's ~4.5MB serverless request-size
 *  limit — a hard platform ceiling this app has no way to raise, so the fix has to happen before
 *  the file ever leaves the browser. Caps the longer edge at 1600px (matching the size the
 *  AI-generated catalog photos already target) and always re-encodes as JPEG, which compresses
 *  real photos far better than PNG and sidesteps source formats the server doesn't accept.
 *  Returns just the base64 payload (no data: URL prefix), matching what
 *  /api/catalog-image-upload expects. */
export function resizeImageForUpload(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process this image in your browser.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      const base64 = dataUrl.split(',')[1] ?? '';
      if (!base64) {
        reject(new Error('Could not process this image in your browser.'));
        return;
      }
      resolve({ base64, mimeType: 'image/jpeg' });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read this image file — please try a different photo.'));
    };

    img.src = objectUrl;
  });
}
