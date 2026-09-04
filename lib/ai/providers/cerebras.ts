import { AiProviderError, classifyOpenAiCompatibleFailure, classifyError } from '../errors';
import { toStrictJsonSchema } from '../schema';
import type { AiJsonRequest, AiProvider, AiProviderResult } from '../types';

/** Cerebras speaks the OpenAI chat API, so this is a plain fetch like the Groq provider — no
 *  extra dependency to install or keep in step with.
 *
 *  Added as a third provider after a day when Google's free allowance ran out and Groq was
 *  carrying every AI feature in the app alone: with two providers, one outage away from nothing
 *  working. Cerebras is deliberately last in both orders — a safety net, not a workhorse.
 *
 *  The free tier is US-hosted and needs no card. gpt-oss-120b is the default because it matches
 *  what Groq already runs, so answers stay consistent whichever provider serves a request;
 *  qwen-3.8-27b is the other public model, selectable with CEREBRAS_MODEL. */
const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';

const TEXT_MODEL = () => process.env.CEREBRAS_MODEL || 'gpt-oss-120b';

export const cerebrasProvider: AiProvider = {
  name: 'cerebras',

  configured: () => Boolean(process.env.CEREBRAS_API_KEY),

  /** Text only. Cerebras' public models read no images at all, so an invoice photo or a scanned
   *  PO must never be routed here — the gateway skips it rather than sending something that
   *  would come back as a confusing failure. Document scanning stays on Gemini and Groq. */
  supports: (request) => !request.attachments?.length,

  async generateJson(request: AiJsonRequest, signal: AbortSignal): Promise<AiProviderResult> {
    const model = TEXT_MODEL();

    // Constrained decoding, the same as Groq: the model is prevented from producing a shape the
    // provider's own validator would then reject, rather than being asked nicely in prose.
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
          Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: request.prompt },
          ],
          response_format: responseFormat,
          temperature: 0.2,
        }),
        signal,
      });
    } catch (error) {
      // Network drop, or the gateway's own timeout aborting us.
      throw new AiProviderError(
        error instanceof Error ? error.message : String(error),
        classifyError(error),
        'cerebras'
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

      // Cerebras caps a strict schema at 5,000 characters and 10 levels of nesting. A schema past
      // either limit is refused with a 400 that says so — which is this provider lacking the
      // capacity for this particular request, not a malformed request of ours, so the chain must
      // carry on to one that can. classifyOpenAiCompatibleFailure makes that call.
      throw new AiProviderError(
        `Cerebras ${response.status}: ${detail}`,
        classifyOpenAiCompatibleFailure(response.status, detail),
        'cerebras',
        response.status
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = payload.choices?.[0];
    const text = choice?.message?.content;

    if (choice?.finish_reason === 'length') {
      throw new AiProviderError('Cerebras hit its output limit before finishing the answer.', 'empty', 'cerebras');
    }
    if (!text) throw new AiProviderError('Cerebras returned an empty response.', 'empty', 'cerebras');

    return { text, model };
  },
};
