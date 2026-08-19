import { describe, expect, it } from 'vitest';
import { assertSafeXml, validateStreamUri } from './camera-verifier';

describe('camera verification security boundaries', () => {
  it('accepts only bounded SOAP envelopes without DTD or entities', () => {
    expect(assertSafeXml('<s:Envelope><s:Body /></s:Envelope>')).toContain('Envelope');
    expect(() => assertSafeXml('<!DOCTYPE x [<!ENTITY file SYSTEM "file:///etc/passwd">]><s:Envelope></s:Envelope>'))
      .toThrow('UNSAFE_XML');
    expect(() => assertSafeXml('<not-soap />')).toThrow('MALFORMED_XML');
    expect(() => assertSafeXml(`<s:Envelope>${'x'.repeat(262_145)}</s:Envelope>`))
      .toThrow('ONVIF_RESPONSE_TOO_LARGE');
  });

  it('rejects RTSP redirects, embedded credentials and addresses not discovered', () => {
    expect(validateStreamUri('rtsp://192.168.1.20:554/live', '192.168.1.20')).toEqual({
      host: '192.168.1.20', port: 554, path: '/live',
    });
    expect(() => validateStreamUri('rtsp://admin:secret@192.168.1.20/live', '192.168.1.20'))
      .toThrow('UNSAFE_STREAM_URI');
    expect(() => validateStreamUri('rtsp://192.168.1.99/live', '192.168.1.20'))
      .toThrow('UNSAFE_STREAM_URI');
    expect(() => validateStreamUri('http://192.168.1.20/live', '192.168.1.20'))
      .toThrow('UNSAFE_STREAM_URI');
  });
});
