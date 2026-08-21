import { GoogleGenAI, createPartFromBase64, createUserContent } from '@google/genai';
import { AiProviderError, classifyError } from '../errors';
import type { AiJsonRequest, AiProvider, AiProviderResult } from '../types';

/** The primary provider — best answer quality, and the only one here that reads PDFs. */
export const geminiProvider: AiProvider = {
  name: 'gemini',

  configured: () => Boolean(process.env.GEMINI_API_KEY),

  // Gemini takes images and PDFs alike, so nothing this app sends is out of reach.
  supports: () => true,

  async generateJson(request: AiJsonRequest, signal: AbortSignal): Promise<AiProviderResult> {
    const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
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
