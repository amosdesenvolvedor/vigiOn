import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import type { VerificationCredentials } from './stream-envelope';

const MAX_XML_BYTES = 256 * 1024;
const MAX_RTSP_BYTES = 64 * 1024;
const privateIpv4 = (value: string) => {
  const parts = value.split('.').map(Number);
  return (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168))
  );
};
const xmlEscape = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[character]!,
  );
const text = (xml: string, localName: string) => {
  const match = xml.match(
    new RegExp(
      `<(?:(?:[A-Za-z][\\w.-]*):)?${localName}(?:\\s[^>]*)?>([^<]*)<\\/(?:(?:[A-Za-z][\\w.-]*):)?${localName}>`,
      'i',
    ),
  );
  return match?.[1]?.trim();
};
const tags = (xml: string, localName: string) => [
  ...xml.matchAll(new RegExp(`<(?:(?:[A-Za-z][\\w.-]*):)?${localName}(?:\\s[^>]*)?>`, 'gi')),
];

export const assertSafeXml = (xml: string) => {
  if (Buffer.byteLength(xml) > MAX_XML_BYTES) throw new Error('ONVIF_RESPONSE_TOO_LARGE');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) throw new Error('UNSAFE_XML');
  if (
    !/<(?:[A-Za-z][\w.-]*:)?Envelope(?:\s|>)/i.test(xml) ||
    !/<\/(?:[A-Za-z][\w.-]*:)?Envelope>/i.test(xml)
  )
    throw new Error('MALFORMED_XML');
  return xml;
};

const securityHeader = (credentials: VerificationCredentials) => {
  const nonce = randomBytes(16);
  const created = new Date().toISOString();
  const digest = createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(credentials.password)]))
    .digest('base64');
  return `<s:Header><wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${xmlEscape(credentials.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>`;
};
const envelope = (body: string, credentials: VerificationCredentials) =>
  `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">${securityHeader(credentials)}<s:Body>${body}</s:Body></s:Envelope>`;

const soap = async (
  target: { address: string; port: number },
  path: string,
  body: string,
  credentials: VerificationCredentials,
  signal: AbortSignal,
) =>
  new Promise<string>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.address,
        port: target.port,
        path,
        method: 'POST',
        signal,
        timeout: 4_000,
        headers: { 'content-type': 'application/soap+xml; charset=utf-8', connection: 'close' },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_XML_BYTES) response.destroy(new Error('ONVIF_RESPONSE_TOO_LARGE'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode === 401 || response.statusCode === 403)
            return reject(new Error('AUTHENTICATION_FAILED'));
          const xml = assertSafeXml(raw);
          if (/NotAuthorized|Unauthorized/i.test(xml)) reject(new Error('AUTHENTICATION_FAILED'));
          else if ((response.statusCode ?? 500) >= 400) reject(new Error('ONVIF_UNAVAILABLE'));
          else resolve(xml);
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('TIMEOUT')));
    request.on('error', reject);
    request.end(envelope(body, credentials));
  });

export const checkOnvifHealth = async (
  target: { address: string; port: number },
  credentials: VerificationCredentials,
  signal: AbortSignal,
) => {
  try {
    await soap(
      target,
      '/onvif/device_service',
      '<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>',
      credentials,
      signal,
    );
    return 'OK' as const;
  } catch (error) {
    const code = signal.aborted
      ? 'TIMEOUT'
      : error instanceof Error
        ? error.message
        : 'NETWORK_ERROR';
    return /AUTHENTICATION/.test(code)
      ? ('AUTHENTICATION_ERROR' as const)
      : /UNSAFE|MALFORMED|PROTOCOL/.test(code)
        ? ('PROTOCOL_ERROR' as const)
        : ('FAILED' as const);
  }
};

const servicePath = (xml: string, section: 'Media' | 'Media2', address: string) => {
  const sectionXml = xml.match(
    new RegExp(`<(?:\\w+:)?${section}\\b[^>]*>([\\s\\S]{0,32768}?)<\\/(?:\\w+:)?${section}>`, 'i'),
  )?.[1];
  const xaddr = sectionXml && text(sectionXml, 'XAddr');
  if (!xaddr) return '/onvif/device_service';
  const parsed = new URL(xaddr);
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== address ||
    parsed.username ||
    parsed.password
  )
    throw new Error('UNSAFE_ONVIF_XADDR');
  return `${parsed.pathname}${parsed.search}`;
};

export const validateStreamUri = (raw: string, candidateAddress: string) => {
  const uri = new URL(raw);
  if (uri.protocol !== 'rtsp:' || uri.username || uri.password || uri.hostname !== candidateAddress)
    throw new Error('UNSAFE_STREAM_URI');
  const port = uri.port ? Number(uri.port) : 554;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UNSAFE_STREAM_URI');
  return { host: candidateAddress, port, path: `${uri.pathname}${uri.search}` };
};

const digestHeader = (
  challenge: string,
  credentials: VerificationCredentials,
  method: string,
  uri: string,
) => {
  const params = Object.fromEntries(
    [...challenge.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map((match) => [
      match[1]!.toLowerCase(),
      match[2] ?? match[3] ?? '',
    ]),
  );
  if (!params.realm || !params.nonce) throw new Error('AUTHENTICATION_FAILED');
  const hash = (value: string) => createHash('md5').update(value).digest('hex');
  const response = hash(
    `${hash(`${credentials.username}:${params.realm}:${credentials.password}`)}:${params.nonce}:${hash(`${method}:${uri}`)}`,
  );
  return `Digest username="${credentials.username.replace(/["\\]/g, '')}", realm="${params.realm}", nonce="${params.nonce}", uri="${uri}", response="${response}"`;
};

const rtspExchange = (
  target: { host: string; port: number; path: string },
  credentials: VerificationCredentials,
  signal: AbortSignal,
) =>
  new Promise<{ codecs: string[]; tracks: number }>((resolve, reject) => {
    const socket = connect({ host: target.host, port: target.port });
    let buffer = Buffer.alloc(0);
    let retried = false;
    const uri = `rtsp://${target.host}:${target.port}${target.path}`;
    const send = (authorization?: string) =>
      socket.write(
        `DESCRIBE ${uri} RTSP/1.0\r\nCSeq: ${retried ? 2 : 1}\r\nAccept: application/sdp\r\n${authorization ? `Authorization: ${authorization}\r\n` : ''}\r\n`,
      );
    const abort = () => socket.destroy(new Error('CANCELED'));
    signal.addEventListener('abort', abort, { once: true });
    socket.setTimeout(4_000);
    socket.once('connect', () => send());
    socket.on('timeout', () => socket.destroy(new Error('TIMEOUT')));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_RTSP_BYTES)
        return socket.destroy(new Error('RTSP_RESPONSE_TOO_LARGE'));
      const response = buffer.toString('utf8');
      if (!response.includes('\r\n\r\n')) return;
      const status = Number(response.match(/^RTSP\/\d\.\d\s+(\d+)/)?.[1]);
      if (status === 401 && !retried) {
        const challenge = response.match(/WWW-Authenticate:\s*(Basic|Digest)\s+([^\r\n]+)/i);
        if (!challenge) return socket.destroy(new Error('AUTHENTICATION_FAILED'));
        retried = true;
        buffer = Buffer.alloc(0);
        const authorization =
          challenge[1]!.toLowerCase() === 'basic'
            ? `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`
            : digestHeader(challenge[2]!, credentials, 'DESCRIBE', uri);
        return send(authorization);
      }
      if (status === 401 || status === 403)
        return socket.destroy(new Error('AUTHENTICATION_FAILED'));
      if (status < 200 || status >= 300) return socket.destroy(new Error('RTSP_UNAVAILABLE'));
      const sdp = response.slice(response.indexOf('\r\n\r\n') + 4);
      const codecs = [
        ...new Set(
          [...sdp.matchAll(/^a=rtpmap:\d+\s+([^/\s]+)/gim)].map((match) => match[1]!.toUpperCase()),
        ),
      ].slice(0, 16);
      const tracks = [...sdp.matchAll(/^m=/gim)].length;
      socket.end();
      resolve({ codecs, tracks });
    });
    socket.once('error', reject);
    socket.once('close', () => signal.removeEventListener('abort', abort));
  });

export interface VerificationReport {
  result:
    | 'VERIFIED'
    | 'PARTIALLY_VERIFIED'
    | 'AUTHENTICATION_REQUIRED'
    | 'AUTHENTICATION_FAILED'
    | 'ONVIF_UNAVAILABLE'
    | 'RTSP_UNAVAILABLE'
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'UNSUPPORTED'
    | 'CANCELED';
  identity?: Record<string, string>;
  capabilities?: {
    onvif: boolean;
    media: boolean;
    media2: boolean;
    rtsp: boolean;
    ptz: boolean;
    events: boolean;
    imaging: boolean;
    profiles: number;
    codecs: string[];
    tracks: number;
  };
  evidence: {
    onvifDeviceInformation: boolean;
    onvifCapabilities: boolean;
    mediaProfiles: boolean;
    streamUriValidated: boolean;
    rtspHandshake: boolean;
  };
  errorCode?: string;
  stream?: { port: number; path: string; transport: 'tcp' };
}

export const verifyCamera = async (
  target: { address: string; port: number },
  credentials: VerificationCredentials,
  signal: AbortSignal,
): Promise<VerificationReport> => {
  const evidence = {
    onvifDeviceInformation: false,
    onvifCapabilities: false,
    mediaProfiles: false,
    streamUriValidated: false,
    rtspHandshake: false,
  };
  if (
    !privateIpv4(target.address) ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65535
  )
    return { result: 'UNSUPPORTED', evidence, errorCode: 'INVALID_DISCOVERED_TARGET' };
  try {
    const device = await soap(
      target,
      '/onvif/device_service',
      '<GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/>',
      credentials,
      signal,
    );
    evidence.onvifDeviceInformation = true;
    const identity = Object.fromEntries(
      [
        ['manufacturer', text(device, 'Manufacturer')],
        ['model', text(device, 'Model')],
        ['firmwareVersion', text(device, 'FirmwareVersion')],
        ['serialNumber', text(device, 'SerialNumber')],
        ['hardwareId', text(device, 'HardwareId')],
      ].filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const caps = await soap(
      target,
      '/onvif/device_service',
      '<GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl"><Category>All</Category></GetCapabilities>',
      credentials,
      signal,
    );
    evidence.onvifCapabilities = true;
    const media = /Media/i.test(caps);
    const media2 = /ver20\/media/i.test(caps);
    const mediaPath = servicePath(caps, 'Media', target.address);
    const profilesXml = await soap(
      target,
      mediaPath,
      '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>',
      credentials,
      signal,
    );
    evidence.mediaProfiles = true;
    const profiles = tags(profilesXml, 'Profiles').length;
    const token = profilesXml.match(/<(?:\w+:)?Profiles\b[^>]*\btoken="([^"]{1,160})"/i)?.[1];
    if (!token)
      return {
        result: 'PARTIALLY_VERIFIED',
        identity,
        capabilities: {
          onvif: true,
          media,
          media2,
          rtsp: false,
          ptz: /PTZ/i.test(caps),
          events: /Events/i.test(caps),
          imaging: /Imaging/i.test(caps),
          profiles,
          codecs: [],
          tracks: 0,
        },
        evidence,
      };
    const streamXml = await soap(
      target,
      mediaPath,
      `<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl"><StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream><Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport></StreamSetup><ProfileToken>${xmlEscape(token)}</ProfileToken></GetStreamUri>`,
      credentials,
      signal,
    );
    const rawUri = text(streamXml, 'Uri');
    if (!rawUri) throw new Error('RTSP_UNAVAILABLE');
    const stream = validateStreamUri(rawUri, target.address);
    evidence.streamUriValidated = true;
    const rtsp = await rtspExchange(stream, credentials, signal);
    evidence.rtspHandshake = true;
    return {
      result: 'VERIFIED',
      identity,
      capabilities: {
        onvif: true,
        media,
        media2,
        rtsp: true,
        ptz: /PTZ/i.test(caps),
        events: /Events/i.test(caps),
        imaging: /Imaging/i.test(caps),
        profiles,
        codecs: rtsp.codecs,
        tracks: rtsp.tracks,
      },
      evidence,
      stream: { port: stream.port, path: stream.path, transport: 'tcp' },
    };
  } catch (error) {
    const code = signal.aborted
      ? 'CANCELED'
      : error instanceof Error
        ? error.message
        : 'NETWORK_ERROR';
    const result = [
      'AUTHENTICATION_FAILED',
      'TIMEOUT',
      'RTSP_UNAVAILABLE',
      'ONVIF_UNAVAILABLE',
      'CANCELED',
    ].includes(code)
      ? (code as VerificationReport['result'])
      : evidence.onvifDeviceInformation
        ? 'RTSP_UNAVAILABLE'
        : 'NETWORK_ERROR';
    return { result, evidence, errorCode: code.replace(/[^A-Z0-9_]/g, '_').slice(0, 64) };
  }
};
