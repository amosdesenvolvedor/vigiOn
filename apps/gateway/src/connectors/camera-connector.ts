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
