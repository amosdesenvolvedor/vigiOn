import { describe, expect, it } from 'vitest';
import { parseOnvifResponse } from './ws-discovery';

const local = { name: 'eth0', address: '192.168.1.10', netmask: '255.255.255.0' };
const response = (xaddr: string, endpoint = 'urn:uuid:camera-1') =>
  Buffer.from(
    `<?xml version="1.0"?><Envelope><Body><ProbeMatches><ProbeMatch><EndpointReference><Address>${endpoint}</Address></EndpointReference><Types>dn:NetworkVideoTransmitter</Types><Scopes>onvif://www.onvif.org/name/C200 onvif://www.onvif.org/hardware/V1</Scopes><XAddrs>${xaddr}</XAddrs></ProbeMatch></ProbeMatches></Body></Envelope>`,
  );

describe('bounded ONVIF WS-Discovery parsing', () => {
  it('accepts a camera response from the same private subnet', () => {
    expect(
      parseOnvifResponse(
        response('http://192.168.1.21:2020/onvif/device_service'),
        '192.168.1.21',
        local,
      ),
    ).toEqual({
      networkAddress: '192.168.1.21',
      servicePort: 2020,
      endpointReference: 'urn:uuid:camera-1',
      hardwareInfo: 'V1',
      authenticationRequired: false,
      evidence: 'ONVIF_WS_DISCOVERY',
    });
  });
  it('rejects another subnet and an XAddr for a different host', () => {
    expect(
      parseOnvifResponse(response('http://192.168.2.21/onvif'), '192.168.2.21', local),
    ).toBeNull();
    expect(
      parseOnvifResponse(response('http://192.168.1.1/router'), '192.168.1.21', local),
    ).toBeNull();
  });
  it('rejects non-ONVIF, credentialed and oversized responses', () => {
    expect(parseOnvifResponse(Buffer.from('<hello/>'), '192.168.1.21', local)).toBeNull();
    expect(
      parseOnvifResponse(response('http://admin:admin@192.168.1.21/onvif'), '192.168.1.21', local),
    ).toBeNull();
    expect(parseOnvifResponse(Buffer.alloc(65_536), '192.168.1.21', local)).toBeNull();
  });
});
