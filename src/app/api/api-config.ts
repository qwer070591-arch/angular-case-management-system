import { InjectionToken } from '@angular/core';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  // Development uses the Angular /api proxy; production must route /api to the backend.
  factory: () => '/api',
});
