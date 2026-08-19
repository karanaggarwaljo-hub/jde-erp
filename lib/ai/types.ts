/** A file handed to the model alongside the prompt — an invoice photo, a scanned PO.
 *  Base64 without the `data:` prefix, same shape the Gemini SDK already expects. */
export type AiAttachment = { base64: string; mimeType: string };

/** Everything a route needs to ask for one schema-shaped JSON answer. Deliberately provider-
 *  agnostic: no Gemini types leak in here, so a route never learns which provider served it. */
export type AiJsonRequest = {
  system?: string;
  prompt: string;
  /** JSON Schema the answer must match. Written once, translated per provider. */
  schema: Record<string, unknown>;
  /** Identifies the schema to OpenAI-compatible providers, which require a name. */
  schemaName?: string;
  attachments?: AiAttachment[];
};

export type AiProviderResult = { text: string; model: string };

export interface AiProvider {
  readonly name: string;
  /** False when the key is missing — an unconfigured provider is skipped, never an error. */
  configured(): boolean;
  /** False when this request needs something the provider can't do (e.g. a PDF attachment). */
  supports(request: AiJsonRequest): boolean;
  generateJson(request: AiJsonRequest, signal: AbortSignal): Promise<AiProviderResult>;
}
