import { isSupportedCatalogImageType, updateRow, uploadCatalogImage } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { catalogId, base64, mimeType } = await request.json();
  if (typeof catalogId !== 'string' || !catalogId) {
    return Response.json({ error: 'catalogId is required' }, { status: 400 });
  }
  if (typeof base64 !== 'string' || !base64 || typeof mimeType !== 'string' || !mimeType) {
    return Response.json({ error: 'Missing file data.' }, { status: 400 });
  }
  if (!isSupportedCatalogImageType(mimeType)) {
    return Response.json({ error: 'Please upload a JPEG, PNG, or WebP image.' }, { status: 400 });
  }

  try {
    const imageUrl = await uploadCatalogImage(catalogId, base64, mimeType);
    const row = await updateRow('catalog_products', catalogId, {
      image_url: imageUrl,
      image_status: 'ready',
      generation_error: null,
    });
    return Response.json(row);
  } catch (error) {
    console.error('catalog-image-upload route failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error uploading image.';
    return Response.json({ error: message }, { status: 500 });
  }
}
