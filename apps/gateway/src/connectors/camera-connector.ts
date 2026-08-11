export type ConnectionTestResult =
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT'
  | 'AUTHENTICATION_ERROR'
  | 'UNSUPPORTED_PROTOCOL';

export interface CameraMetadata {
  manufacturer?: string;
  model?: string;
  protocol: string;
}

export interface CameraConnector {
  readonly protocol: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<'CONNECTED' | 'DISCONNECTED'>;
  getMetadata(): Promise<CameraMetadata>;
  testConnection(): Promise<ConnectionTestResult>;
}

export interface StreamSourceConnector extends CameraConnector {
  createStreamSource(configuration: RtspSource): RtspSource;
}

export class RtspConnector implements StreamSourceConnector {
  readonly protocol = 'RTSP';
  createStreamSource(configuration: RtspSource) {
    const { host, port, path } = configuration.stream;
    if (!/^(?!.*[/@?#\s])(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)$/.test(host))
      throw new Error('Invalid RTSP source');
    if (!/^\/(?!\/)[^\s?#]*$/.test(path) || port < 1 || port > 65535)
      throw new Error('Invalid RTSP source');
    return configuration;
  }
  async connect() {
    return;
  }
  async disconnect() {
    return;
  }
  async getStatus(): Promise<'DISCONNECTED'> {
    return 'DISCONNECTED';
  }
  async getMetadata(): Promise<CameraMetadata> {
    return { protocol: this.protocol };
  }
  async testConnection(): Promise<'FAILED'> {
    return 'FAILED';
  }
}

export class PreparedConnector implements CameraConnector {
  constructor(readonly protocol: string) {}
  async connect() {
    throw new Error(`${this.protocol} connector is not configured`);
  }
  async disconnect() {
    return;
  }
  async getStatus(): Promise<'DISCONNECTED'> {
    return 'DISCONNECTED';
  }
  async getMetadata(): Promise<CameraMetadata> {
    return { protocol: this.protocol };
  }
  async testConnection(): Promise<'UNSUPPORTED_PROTOCOL'> {
    return 'UNSUPPORTED_PROTOCOL';
  }
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, CameraConnector>();
  register(connector: CameraConnector) {
    this.connectors.set(connector.protocol, connector);
  }
  get(protocol: string) {
    return this.connectors.get(protocol) ?? new PreparedConnector(protocol);
  }
}
import type { RtspSource } from '../stream-envelope';
