import { AiProviderError, classifyError, classifyOpenAiCompatibleFailure } from '../errors';
import { toStrictJsonSchema } from '../schema';
import type { AiJsonRequest, AiProvider, AiProviderResult } from '../types';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenRouter: one key that reaches many AI companies' models, several of them free. Added at the
 * owner's request (November 2026) as a fourth provider, after Gemini, Groq and Cerebras, so the
 * ERP keeps writing when all three have used up their free allowance for the day.
 *
 * It is a backup only (`backupOnly`): never picked to go first, always asked last, so its small
 * free allowance is kept for when it is needed and its slower free models never hold anyone up.
 *
 * Free models on OpenRouter come and go. Rather than depend on one name, a short list is tried in
 * turn: a model that is gone, busy, or cannot give the strict JSON this app asks for is passed
 * over for the next. OPENROUTER_MODEL replaces the list (one name, or several with commas), for
 * example to use a paid model once credit is added. Text only: invoice photos stay with Gemini
 * and Groq.
 */
export const DEFAULT_OPENROUTER_MODELS = [
  'openai/gpt-oss-120b:free',
  'deepseek/deepseek-chat-v3.1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
];

export function openRouterModels(): string[] {
  const chosen = (process.env.OPENROUTER_MODEL ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  return chosen.length ? chosen : DEFAULT_OPENROUTER_MODELS;
}

/** A failure that says something about this one model (gone, busy, or unable to give strict JSON)
 *  rather than about the key or the account, so the next model in the list is worth asking. A bad
 *  key (401), no credit (402) or a refusal (403) would fail the same for every model. */
export function isModelSpecificFailure(status: number, detail: string): boolean {
  if (status === 404 || status === 408 || status === 429 || status >= 500) return true;
  return status === 400 && /model|no endpoints|not supported|response_format|json_schema|structured/i.test(detail);
}

export const openRouterProvider: AiProvider = {
  name: 'openrouter',
  backupOnly: true,

  configured: () => Boolean(process.env.OPENROUTER_API_KEY),

  supports: (request) => !request.attachments?.length,

  async generateJson(request: AiJsonRequest, signal: AbortSignal): Promise<AiProviderResult> {
    const system = request.system ?? '';
    const body = (model: string) => JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: request.prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName || 'response', strict: true, schema: toStrictJsonSchema(request.schema) },
      },
      // Only route to a host of this model that honours every setting above, the strict JSON
      // above all, instead of one that would quietly ignore it.
      provider: { require_parameters: true },
      temperature: 0.2,
    });

    let last: AiProviderError | undefined;
    for (const model of openRouterModels()) {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            // Names the app on the owner's OpenRouter usage page.
            'X-Title': 'JDE ERP',
          },
          body: body(model),
          signal,
        });
      } catch (error) {
        // A network drop, or the gateway's timeout aborting us: no time left for another model.
        throw new AiProviderError(error instanceof Error ? error.message : String(error), classifyError(error), 'openrouter');
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let detail = text.slice(0, 300);
        try {
          detail = JSON.parse(text)?.error?.message || detail;
        } catch {
          // Not JSON (a proxy or edge error): the raw text is the best detail there is.
        }
        last = new AiProviderError(`OpenRouter ${response.status} (${model}): ${detail}`, classifyOpenAiCompatibleFailure(response.status, detail), 'openrouter', response.status);
        if (isModelSpecificFailure(response.status, detail)) continue;
        throw last;
      }

      const payload = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
      const choice = payload.choices?.[0];
      const content = choice?.message?.content;
      if (choice?.finish_reason === 'length' || !content) {
        last = new AiProviderError(`OpenRouter (${model}) ${content ? 'hit its output limit before finishing' : 'returned an empty answer'}.`, 'empty', 'openrouter');
        continue;
      }
      return { text: content, model };
    }
    throw last ?? new AiProviderError('OpenRouter has no model to try.', 'model_missing', 'openrouter');
  },
};
