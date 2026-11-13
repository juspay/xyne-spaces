import { describe, it, expect } from 'vitest';
import { parseInboundBody, MalformedBodyError } from './body.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('parseInboundBody', () => {
  it('parses JSON, ignoring content-type parameters', () => {
    expect(parseInboundBody(encode('{"a":1}'), 'application/json; charset=utf-8')).toEqual({ a: 1 });
    expect(parseInboundBody(encode('{"a":1}'), 'application/vnd.api+json')).toEqual({ a: 1 });
  });

  it('parses form-encoded bodies into fields', () => {
    expect(
      parseInboundBody(encode('team_id=T1&text=hello%20world'), 'application/x-www-form-urlencoded'),
    ).toEqual({ team_id: 'T1', text: 'hello world' });
  });

  it('keeps other content types as text', () => {
    expect(parseInboundBody(encode('plain'), 'text/plain')).toBe('plain');
  });

  it('tries JSON when the sender omits the content type, and falls back to text', () => {
    expect(parseInboundBody(encode('{"a":1}'), undefined)).toEqual({ a: 1 });
    expect(parseInboundBody(encode('not json'), undefined)).toBe('not json');
  });

  it('treats an empty body as an empty object', () => {
    expect(parseInboundBody(new Uint8Array(), 'application/json')).toEqual({});
  });

  it('refuses invalid JSON sent as JSON', () => {
    expect(() => parseInboundBody(encode('{oops'), 'application/json')).toThrow(MalformedBodyError);
  });
});
