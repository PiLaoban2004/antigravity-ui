/**
 * Best-effort token accounting from an upstream response. The gateway never asks the upstream for anything
 * extra, so a response with no usage block simply yields nulls ("unknown", not 0).
 *
 * Shapes handled: OpenAI chat (`usage.prompt_tokens/completion_tokens`), OpenAI responses / Claude
 * (`usage.input_tokens/output_tokens`, nested under `response` / `message` in stream events) and Gemini
 * (`usageMetadata.*TokenCount`).
 */
export interface TokenUsage {
  input: number | null;
  output: number | null;
  total: number | null;
}

export const NO_USAGE: TokenUsage = { input: null, output: null, total: null };

const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);

function pick(obj: any): Partial<Record<keyof TokenUsage, number>> | null {
  if (!obj || typeof obj !== 'object') return null;
  const u = obj.usage ?? obj.response?.usage ?? obj.message?.usage;
  if (u && typeof u === 'object') {
    return {
      input: n(u.prompt_tokens) ?? n(u.input_tokens),
      output: n(u.completion_tokens) ?? n(u.output_tokens),
      total: n(u.total_tokens),
    };
  }
  const g = obj.usageMetadata ?? obj.response?.usageMetadata;
  if (g && typeof g === 'object') {
    return { input: n(g.promptTokenCount), output: n(g.candidatesTokenCount), total: n(g.totalTokenCount) };
  }
  return null;
}

function finish(acc: Partial<Record<keyof TokenUsage, number>>): TokenUsage {
  const input = acc.input ?? null;
  const output = acc.output ?? null;
  const total = acc.total ?? (input !== null && output !== null ? input + output : null);
  return { input, output, total };
}

/** Merge usage objects in order; later non-empty fields win (Claude: input in message_start, output in message_delta). */
function mergeAll(objs: Iterable<any>): TokenUsage {
  const acc: Partial<Record<keyof TokenUsage, number>> = {};
  let found = false;
  for (const o of objs) {
    const p = pick(o);
    if (!p) continue;
    for (const k of ['input', 'output', 'total'] as const) {
      if (p[k] !== undefined) {
        acc[k] = p[k];
        found = true;
      }
    }
  }
  return found ? finish(acc) : NO_USAGE;
}

/** Parse a complete JSON response body. */
export function usageFromJson(text: string): TokenUsage {
  try {
    return mergeAll([JSON.parse(text)]);
  } catch {
    return NO_USAGE;
  }
}

/** Parse SSE text (`data: {...}` lines). Tolerates a truncated first/last line. */
export function usageFromSse(text: string): TokenUsage {
  const events: any[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* partial line at a capture boundary */
    }
  }
  return mergeAll(events);
}

const HEAD_BYTES = 8 * 1024;
const TAIL_BYTES = 64 * 1024;
const FULL_BYTES = 1024 * 1024;

/**
 * Collects just enough of a response to find its usage block without holding a whole stream in memory:
 * the first 8 KB (Claude puts input tokens in `message_start`), the last 64 KB (everyone else puts usage at
 * the end), and the full body while it stays under 1 MB (non-streaming JSON).
 */
export class UsageSniffer {
  private head: Uint8Array[] = [];
  private headLen = 0;
  private tail: Uint8Array[] = [];
  private tailLen = 0;
  private full: Uint8Array[] | null = [];
  private fullLen = 0;
  bytes = 0;

  push(chunk: Uint8Array) {
    this.bytes += chunk.byteLength;
    if (this.headLen < HEAD_BYTES) {
      const part = chunk.subarray(0, HEAD_BYTES - this.headLen);
      this.head.push(part);
      this.headLen += part.byteLength;
    }
    this.tail.push(chunk);
    this.tailLen += chunk.byteLength;
    while (this.tail.length > 1 && this.tailLen - this.tail[0].byteLength >= TAIL_BYTES) {
      this.tailLen -= this.tail.shift()!.byteLength;
    }
    if (this.full) {
      this.full.push(chunk);
      this.fullLen += chunk.byteLength;
      if (this.fullLen > FULL_BYTES) this.full = null;
    }
  }

  result(isStream: boolean): TokenUsage {
    const dec = new TextDecoder();
    const text = (parts: Uint8Array[]) => dec.decode(Buffer.concat(parts));
    if (!isStream && this.full) return usageFromJson(text(this.full));
    // Streams: head + tail (they may overlap or be the same bytes for a short stream; duplicates are harmless).
    return usageFromSse(`${text(this.head)}\n${text(this.tail)}`);
  }
}
