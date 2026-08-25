import { GoogleGenAI, createPartFromBase64, createUserContent } from '@google/genai';
import { AiProviderError, classifyError } from '../errors';
import type { AiJsonRequest, AiProvider, AiProviderResult } from '../types';

/** Pinned deliberately, and NOT to `gemini-flash-latest`.
 *
 *  `gemini-flash-latest` is an alias that always points at Google's newest flash model. That
 *  makes it the worst possible default for a production business app for two separate reasons,
 *  both of which have now actually taken the AI features down:
 *
 *  1. The newest model carries the *smallest* free-tier allowance — as little as 20 requests a
 *     day, after which every call is refused for quota.
 *  2. Being the newest, it is also the most contended: it returns 503 UNAVAILABLE ("experiencing
 *     high demand") under load while pinned versions of the same family answer normally.
 *
 *  A moving alias also means the app's behaviour can change with no deploy and no commit, which
 *  is not something a business should discover through a broken screen. GEMINI_MODEL still
 *  overrides this for anyone who wants to move it. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

/** The primary provider — best answer quality, and the only one here that reads PDFs. */
export const geminiProvider: AiProvider = {
  name: 'gemini',

  configured: () => Boolean(process.env.GEMINI_API_KEY),

  // Gemini takes images and PDFs alike, so nothing this app sends is out of reach.
  supports: () => true,

  async generateJson(request: AiJsonRequest, signal: AbortSignal): Promise<AiProviderResult> {
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

    const contents = request.attachments?.length
      ? createUserContent([
          request.prompt,
          ...request.attachments.map((file) => createPartFromBase64(file.base64, file.mimeType)),
        ])
      : request.prompt;

    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: request.system,
          responseMimeType: 'application/json',
          responseJsonSchema: request.schema,
          abortSignal: signal,
        },
      });
    } catch (error) {
      throw new AiProviderError(
        error instanceof Error ? error.message : String(error),
        classifyError(error),
        'gemini',
        typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : undefined
      );
    }

    if (response.promptFeedback?.blockReason) {
      throw new AiProviderError(`Gemini declined this request (${response.promptFeedback.blockReason}).`, 'blocked', 'gemini');
    }

    const text = response.text;
    if (!text) throw new AiProviderError('Gemini returned an empty response.', 'empty', 'gemini');

    return { text, model };
  },
};
