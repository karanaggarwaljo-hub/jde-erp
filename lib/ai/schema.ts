/** Gemini accepts full JSON Schema; OpenAI-compatible providers (Groq) accept a strict subset
 *  and reject the rest outright. Rather than maintain two copies of every schema, routes write
 *  one Gemini-flavoured schema and this translates it on the way to the other providers.
 *
 *  Supported by strict mode: type, properties, required, additionalProperties, items, enum,
 *  anyOf, $defs, $ref, description. Everything else has to go. Where a dropped keyword carried
 *  real intent (an item cap), it is folded into the description so the model still hears it. */

const SUPPORTED_KEYS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf', '$defs', '$ref', 'description',
]);

type Schema = Record<string, unknown>;

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toStrictJsonSchema(schema: Schema): Schema {
  const out: Schema = {};
  const notes: string[] = [];

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'maxItems' && typeof value === 'number') {
      notes.push(`at most ${value} items`);
      continue;
    }
    if (key === 'minItems' && typeof value === 'number') {
      notes.push(`at least ${value} items`);
      continue;
    }
    if (!SUPPORTED_KEYS.has(key)) continue;

    if (key === 'properties' && isSchema(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, isSchema(child) ? toStrictJsonSchema(child) : child])
      );
    } else if (key === 'items' && isSchema(value)) {
      out.items = toStrictJsonSchema(value);
    } else if ((key === 'anyOf') && Array.isArray(value)) {
      out.anyOf = value.map((child) => (isSchema(child) ? toStrictJsonSchema(child) : child));
    } else if (key === '$defs' && isSchema(value)) {
      out.$defs = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, isSchema(child) ? toStrictJsonSchema(child) : child])
      );
    } else {
      out[key] = value;
    }
  }

  if (notes.length) {
    const existing = typeof out.description === 'string' ? `${out.description} ` : '';
    out.description = `${existing}(${notes.join(', ')})`;
  }

  // Strict mode requires objects to close themselves off and to list every property as
  // required — our schemas already do both, but a future one might forget.
  if (out.type === 'object' && isSchema(out.properties)) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }

  return out;
}
