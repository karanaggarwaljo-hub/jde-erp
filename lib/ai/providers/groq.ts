import { AiProviderError, classifyOpenAiCompatibleFailure, classifyError, type AiFailureKind } from '../errors';
import { toStrictJsonSchema } from '../schema';
import type { AiJsonRequest, AiProvider, AiProviderResult } from '../types';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** How a Groq HTTP failure should be treated by the failover chain.
 *
 *  classifyStatus maps every 400 to bad_request, which deliberately STOPS the chain on the grounds
 *  that a malformed request fails identically everywhere. That reasoning does not hold for two
 *  cases: "failed to validate JSON" means this model produced a bad answer, and an unsupported
 *  response_format means this model lacks a feature. Neither says anything about whether another
 *  provider can do the job — and Gemini demonstrably can. Left as bad_request they surfaced a raw
 *  "Groq 400: Failed to validate JSON" to the owner while a working provider sat untried. */
export function classifyGroqFailure(status: number, detail: string): AiFailureKind {
  return classifyOpenAiCompatibleFailure(status, detail);
}


/** Groq speaks the OpenAI chat API, so this is a plain fetch — no extra dependency to install
 *  or keep in step with. Two models are used: a text model for the JSON routes, and a separate
 *  vision model for invoice scans, because on Groq those capabilities live in different models. */
const TEXT_MODEL = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const VISION_MODEL = () => process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';

type ChatContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export const groqProvider: AiProvider = {
  name: 'groq',

  configured: () => Boolean(process.env.GROQ_API_KEY),

  /** Groq's vision models read images only — a PDF invoice has no path here, so the gateway
   *  skips Groq for those rather than sending something it will reject. */
  supports: (request) => (request.attachments ?? []).every((file) => file.mimeType.startsWith('image/')),

  async generateJson(request: AiJsonRequest, signal: AbortSignal): Promise<AiProviderResult> {
    const hasAttachments = Boolean(request.attachments?.length);
    const model = hasAttachments ? VISION_MODEL() : TEXT_MODEL();

    const userContent: ChatContent = hasAttachments
      ? [
          { type: 'text' as const, text: request.prompt },
          ...(request.attachments ?? []).map((file) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${file.mimeType};base64,${file.base64}` },
          })),
        ]
      : request.prompt;

    // The vision model accepts a strict schema too — verified directly against
    // qwen/qwen3.6-27b. It used to be given plain JSON mode with the schema described in prose
    // instead, which left the model free to answer in a shape Groq's own validator then rejected
    // with "Failed to validate JSON"; constraining generation means it cannot produce that.
    const strictSchema = toStrictJsonSchema(request.schema);
    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: { name: request.schemaName || 'response', strict: true, schema: strictSchema },
    };

    const system = request.system ?? '';

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: userContent },
          ],
          response_format: responseFormat,
          temperature: 0.2,
        }),
        signal,
      });
    } catch (error) {
      // Network drop or the gateway's own timeout aborting us.
      throw new AiProviderError(
        error instanceof Error ? error.message : String(error),
        classifyError(error),
        'groq'
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let detail = body.slice(0, 300);
      try {
        const parsed = JSON.parse(body);
        detail = parsed?.error?.message || detail;
      } catch {
        // Non-JSON error body (a proxy or edge error) — the raw text is the best detail we have.
      }

      // classifyStatus maps every 400 to bad_request, which deliberately STOPS the failover chain
      // on the grounds that a malformed request fails identically everywhere. That reasoning does
      // not hold for these two: "failed to validate JSON" means this model produced a bad answer,
      // and an unsupported response_format means this model lacks a feature — neither says
      // anything about whether Gemini can do the job, and Gemini demonstrably can. Left as
      // bad_request they surfaced a raw "Groq 400" to the owner while a working provider sat
      // untried. Classed as `empty` they are retryable, so the next provider is asked.
      throw new AiProviderError(`Groq ${response.status}: ${detail}`, classifyGroqFailure(response.status, detail), 'groq', response.status);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = payload.choices?.[0];
    const text = choice?.message?.content;

    if (choice?.finish_reason === 'length') {
      throw new AiProviderError('Groq hit its output limit before finishing the answer.', 'empty', 'groq');
    }
    if (!text) throw new AiProviderError('Groq returned an empty response.', 'empty', 'groq');

    return { text, model };
  },
};
