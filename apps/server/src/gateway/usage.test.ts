import { describe, expect, test } from 'bun:test';
import { NO_USAGE, UsageSniffer, usageFromJson, usageFromSse } from './usage';

const enc = (s: string) => new TextEncoder().encode(s);

describe('usage extraction', () => {
  test('OpenAI chat JSON', () => {
    expect(usageFromJson('{"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}')).toEqual({ input: 10, output: 5, total: 15 });
  });
  test('total is derived when missing', () => {
    expect(usageFromJson('{"usage":{"input_tokens":3,"output_tokens":4}}')).toEqual({ input: 3, output: 4, total: 7 });
  });
  test('Gemini usageMetadata', () => {
    expect(usageFromJson('{"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2,"totalTokenCount":9}}')).toEqual({ input: 7, output: 2, total: 9 });
  });
  test('no usage or garbage -> unknown, never zero', () => {
    expect(usageFromJson('{"choices":[]}')).toEqual(NO_USAGE);
    expect(usageFromJson('not json')).toEqual(NO_USAGE);
    expect(usageFromSse('data: {"x":1}\n\ndata: [DONE]\n')).toEqual(NO_USAGE);
  });
  test('OpenAI stream: usage chunk before [DONE]', () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10}}\n\ndata: [DONE]\n\n';
    expect(usageFromSse(sse)).toEqual({ input: 4, output: 6, total: 10 });
  });
  test('Claude stream merges message_start input with message_delta output', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":42}}',
    ].join('\n');
    expect(usageFromSse(sse)).toEqual({ input: 25, output: 42, total: 67 });
  });
  test('Responses API completed event nests usage under response', () => {
    const sse = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":8,"output_tokens":9,"total_tokens":17}}}\n';
    expect(usageFromSse(sse)).toEqual({ input: 8, output: 9, total: 17 });
  });
  test('negative / non-numeric values are ignored', () => {
    expect(usageFromJson('{"usage":{"prompt_tokens":-1,"completion_tokens":"x"}}')).toEqual(NO_USAGE);
  });
});

describe('UsageSniffer', () => {
  test('small JSON body spread over chunks', () => {
    const s = new UsageSniffer();
    const body = '{"id":"a","usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}';
    s.push(enc(body.slice(0, 20)));
    s.push(enc(body.slice(20)));
    expect(s.result(false)).toEqual({ input: 1, output: 2, total: 3 });
    expect(s.bytes).toBe(body.length);
  });
  test('long stream keeps head (message_start) and tail (final usage) without the middle', () => {
    const s = new UsageSniffer();
    s.push(enc('data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n'));
    for (let i = 0; i < 4000; i++) s.push(enc('data: {"type":"content_block_delta","delta":{"text":"xxxxxxxxxxxxxxxxxxxx"}}\n\n'));
    s.push(enc('data: {"type":"message_delta","usage":{"output_tokens":99}}\n\n'));
    expect(s.result(true)).toEqual({ input: 11, output: 99, total: 110 });
  });
  test('a body over 1 MB falls back to the tail', () => {
    const s = new UsageSniffer();
    s.push(enc('x'.repeat(1_100_000)));
    s.push(enc('\ndata: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n'));
    expect(s.result(true)).toEqual({ input: 1, output: 1, total: 2 });
  });
});
