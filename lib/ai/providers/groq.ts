import { AiProviderError, classifyStatus, classifyError } from '../errors';
import { toStrictJsonSchema } from '../schema';
import type { AiJsonRequest, AiProvider, AiProviderResult } from '../types';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

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

    // Strict schema enforcement is a text-model feature on Groq. The vision model only offers
    // plain JSON mode, so there the schema is spelled out in the instructions instead and the
    // gateway validates the parsed result afterwards.
    const strictSchema = toStrictJsonSchema(request.schema);
    const responseFormat = hasAttachments
      ? { type: 'json_object' as const }
      : {
          type: 'json_schema' as const,
          json_schema: { name: request.schemaName || 'response', strict: true, schema: strictSchema },
        };

    const system = [
      request.system,
      hasAttachments
        ? `Reply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n${JSON.stringify(strictSchema)}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');

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
      throw new AiProviderError(`Groq ${response.status}: ${detail}`, classifyStatus(response.status), 'groq', response.status);
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
