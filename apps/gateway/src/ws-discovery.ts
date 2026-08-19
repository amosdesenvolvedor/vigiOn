import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';

export type OnvifCandidate = {
  networkAddress: string;
  servicePort: number;
  endpointReference?: string;
  model?: string;
  hardwareInfo?: string;
  authenticationRequired: false;
  evidence: 'ONVIF_WS_DISCOVERY';
};
type LocalInterface = { name: string; address: string; netmask: string };
const DENIED_INTERFACE = /^(?:lo|docker\d*|br-|veth|virbr|tun|tap|wg|zt|tailscale|vmnet|vboxnet)/iu;
const isPrivate = (address: string) => {
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
};
const ipv4Int = (value: string) =>
  value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
const sameSubnet = (a: string, b: string, mask: string) =>
  (ipv4Int(a) & ipv4Int(mask)) === (ipv4Int(b) & ipv4Int(mask));
export const allowedInterfaces = (): LocalInterface[] =>
  Object.entries(networkInterfaces()).flatMap(([name, addresses]) => {
    if (DENIED_INTERFACE.test(name)) return [];
    return (addresses ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal && isPrivate(item.address))
      .map((item) => ({ name, address: item.address, netmask: item.netmask }));
  });
const decodeXml = (value: string) =>
  value
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .trim();
const xmlValue = (xml: string, localName: string) => {
  const expression = new RegExp(
    `<[A-Za-z0-9_-]*:?${localName}(?:\\s[^>]*)?>([^<]{1,2048})<\\/[A-Za-z0-9_-]*:?${localName}>`,
    'iu',
  );
  return expression.exec(xml)?.[1] ? decodeXml(expression.exec(xml)![1]!) : '';
};
const scopeValue = (scopes: string, key: string) => {
  for (const scope of scopes.split(/\s+/u)) {
    try {
      const url = new URL(scope);
      if (!url.hostname.toLowerCase().endsWith('onvif.org')) continue;
      const parts = url.pathname.split('/').filter(Boolean);
      const index = parts.findIndex((part) => part.toLowerCase() === key.toLowerCase());
      if (index >= 0 && parts[index + 1])
        return decodeURIComponent(parts[index + 1]!).slice(0, 160);
    } catch {
      /* ignore malformed scopes */
    }
  }
  return '';
};

export function parseOnvifResponse(
  data: Buffer,
  source: string,
  local: LocalInterface,
): OnvifCandidate | null {
  if (data.byteLength > 65_535 || !sameSubnet(source, local.address, local.netmask)) return null;
  const xml = data.toString('utf8');
  if (!/(?:ProbeMatches|ProbeMatch)/u.test(xml)) return null;
  const addresses = xmlValue(xml, 'XAddrs').split(/\s+/u).slice(0, 8);
  let port = 80;
  const valid = addresses.some((address) => {
    try {
      const url = new URL(address);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.hostname !== source ||
        url.username ||
        url.password
      )
        return false;
      port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      return Number.isInteger(port) && port > 0 && port <= 65535;
    } catch {
      return false;
    }
  });
  if (!valid) return null;
  const endpointReference = xmlValue(xml, 'Address').slice(0, 255);
  const scopes = xmlValue(xml, 'Scopes');
  const hardwareInfo = scopeValue(scopes, 'hardware');
  return {
    networkAddress: source,
    servicePort: port,
    ...(endpointReference ? { endpointReference } : {}),
    ...(hardwareInfo ? { hardwareInfo } : {}),
    authenticationRequired: false,
    evidence: 'ONVIF_WS_DISCOVERY',
  };
}

const probe = () =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`,
  );

export class WsDiscovery {
  private active = new Map<
    string,
    { controllers: AbortController[]; promise: Promise<OnvifCandidate[]> }
  >();
  start(
    sessionId: string,
    timeoutSeconds: number,
    onProgress: (candidates: OnvifCandidate[]) => Promise<void>,
  ) {
    const current = this.active.get(sessionId);
    if (current) return current.promise;
    const controllers: AbortController[] = [];
    const promise = this.scan(timeoutSeconds, controllers, onProgress).finally(() =>
      this.active.delete(sessionId),
    );
    this.active.set(sessionId, { controllers, promise });
    return promise;
  }
  cancel(sessionId: string) {
    const active = this.active.get(sessionId);
    active?.controllers.forEach((controller) => controller.abort());
    return Boolean(active);
  }
  cleanup() {
    for (const sessionId of this.active.keys()) this.cancel(sessionId);
  }

  private async scan(
    timeoutSeconds: number,
    controllers: AbortController[],
    onProgress: (candidates: OnvifCandidate[]) => Promise<void>,
  ) {
    const timeout = Math.min(60, Math.max(5, timeoutSeconds));
    const found = new Map<string, OnvifCandidate>();
    await Promise.all(
      allowedInterfaces().map(
        (local) =>
          new Promise<void>((resolve) => {
            const controller = new AbortController();
            controllers.push(controller);
            const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
            const finish = () => {
              try {
                socket.close();
              } catch {
                /* already closed */
              }
              resolve();
            };
            const timer = setTimeout(finish, timeout * 1000);
            timer.unref();
            controller.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                finish();
              },
              { once: true },
            );
            socket.on('error', () => {
              clearTimeout(timer);
              finish();
            });
            socket.on('message', (message, remote) => {
              const candidate = parseOnvifResponse(message, remote.address, local);
              if (!candidate) return;
              const key =
                candidate.endpointReference ??
                `${candidate.networkAddress}:${candidate.servicePort}`;
              if (found.has(key) || found.size >= 32) return;
              found.set(key, candidate);
              void onProgress([candidate]);
            });
            socket.bind(0, local.address, () => {
              try {
                socket.setMulticastInterface(local.address);
                socket.setMulticastTTL(1);
                socket.send(probe(), 3702, '239.255.255.250');
              } catch {
                clearTimeout(timer);
                finish();
              }
            });
          }),
      ),
    );
    return [...found.values()];
  }
}
