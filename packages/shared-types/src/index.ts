export const HEALTH_QUEUE = 'system-health';
export interface HealthResponse {
  success: true;
  status: 'ready';
  services: { database: 'up'; redis: 'up' };
}
export interface ApiError {
  success: false;
  error: { code: string; message: string };
  requestId: string;
}
