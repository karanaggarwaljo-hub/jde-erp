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
  /** Defaults to 'quality'. See AiPriority below. */
  priority?: AiPriority;
  /** How long one provider may take before it is abandoned. Leave unset for the usual budget; a
   *  long piece of writing (a blog article) genuinely needs more than a one-line answer. */
  timeoutMs?: number;
  /** How long the first provider works alone before the next is started alongside it. Leave unset
   *  for the usual few seconds. A long piece of writing gives the better writer (Gemini) longer:
   *  with the usual head start, the faster backup always finished a full article first. */
  hedgeMs?: number;
  /** Always start with the first provider in the configured order (Gemini for 'quality'), instead
   *  of a random one (generate.ts rotateForFairShare). For the occasional long piece of writing,
   *  where the better writer matters more than spreading the free allowances. */
  keepOrder?: boolean;
};

export type AiProviderResult = { text: string; model: string };

export interface AiProvider {
  readonly name: string;
  /** False when the key is missing — an unconfigured provider is skipped, never an error. */
  configured(): boolean;
  /** False when this request needs something the provider can't do (e.g. a PDF attachment). */
  supports(request: AiJsonRequest): boolean;
  /** Asked only after every other provider, and never rotated to go first (generate.ts), even
   *  when the configured order leaves it out. For a provider kept for when the others are spent. */
  readonly backupOnly?: boolean;
  generateJson(request: AiJsonRequest, signal: AbortSignal): Promise<AiProviderResult>;
}

/** How to weigh speed against answer quality for one request.
 *
 *  'speed'   — short, interactive asks where the user is waiting on a field to fill in. Tries
 *              the fastest provider first, which answers in well under a second.
 *  'quality' — analysis and document reading, where the better model is worth a couple of
 *              seconds. This is the default. */
export type AiPriority = 'speed' | 'quality';
