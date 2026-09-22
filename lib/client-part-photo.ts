import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { resizeImageForUpload } from '@/lib/imageResize';

// Big enough to recognise a part when it is opened, small enough (tens of kilobytes) that a list of
// two hundred of them still loads quickly over a shop's connection.
const PHOTO_DIMENSION = 640;
const PHOTO_QUALITY = 0.8;

/** Shrinks a photo in the browser — a phone photo is several megabytes — then saves it as the
 *  part's own photo, replacing any it had. Returns the updated part. */
export async function savePartPhoto(companyId: string, productId: string, file: File): Promise<Record<string, unknown>> {
  const { base64, mimeType } = await resizeImageForUpload(file, { maxDimension: PHOTO_DIMENSION, quality: PHOTO_QUALITY });
  const response = await fetch('/api/inventory/part-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, productId, base64, mimeType }),
  });
  return await parseJsonOrThrow(response, 'The photo was not saved') as Record<string, unknown>;
}

/** Takes the part's own photo off it. Returns the updated part. */
export async function removePartPhoto(companyId: string, productId: string): Promise<Record<string, unknown>> {
  const response = await fetch('/api/inventory/part-photo', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, productId }),
  });
  return await parseJsonOrThrow(response, 'The photo was not removed') as Record<string, unknown>;
}
