export interface HealthResponse {
  status: 'ok';
  service: 'vigioni-api';
  timestamp: string;
  database: 'connected' | 'unavailable';
}
