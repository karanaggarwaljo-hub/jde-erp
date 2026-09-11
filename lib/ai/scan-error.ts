import { AiUnavailableError } from './errors';
import { aiErrorResponse } from './generate';

/**
 * What to say when reading a document with the AI fails.
 *
 * One case needs saying out loud rather than being reported as a general outage: **only Google
 * reads PDFs.** Groq's adapter accepts image attachments only, and Cerebras accepts none, so a PDF
 * has exactly one route through this app. When Google is out of free usage, a photographed invoice
 * still works perfectly and a PDF of the same invoice does not — and without being told that, the
 * owner has no reason to suspect that re-photographing the bill would fix it.
 *
 * This lives here rather than in each scan route because there were two routes carrying their own
 * copy of the sentence, which is two chances for the next one to be written without it.
 */
export function aiScanErrorResponse(error: unknown, mimeType: string, fallback: string): Response {
  if (mimeType === 'application/pdf' && error instanceof AiUnavailableError) {
    return Response.json(
      {
        error:
          'Reading a PDF needs Google’s AI, and it is not available right now — it is the only one of ' +
          'the three services that can read them. Take a photo of the document and scan that instead, ' +
          'which the backup services can read, or try the PDF again in a few minutes.',
      },
      { status: 503 }
    );
  }
  return aiErrorResponse(error, fallback);
}

/** Whether this document can be read at all if Google is unavailable. Exported so a screen can say
 *  so before the upload rather than after it, and so the rule lives in one place. */
export function needsGoogleToRead(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}
