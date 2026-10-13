import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthStateService } from './auth-state.service';
import { authInterceptor } from './auth-interceptor';

describe('authInterceptor', () => {
  const expireSession = vi.fn();
  const status = signal('authenticated');
  let http: HttpTestingController;
  let client: HttpClient;
  let router: Router;

  beforeEach(() => {
    expireSession.mockClear();
    status.set('authenticated');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: AuthStateService, useValue: { expireSession: () => { expireSession(); status.set('unauthenticated'); }, status } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    router = TestBed.inject(Router);
  });
  afterEach(() => http.verify());

  it('expires identity and redirects on a project 401', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    client.get('/api/projects').subscribe({ error: () => undefined });
    http.expectOne('/api/projects').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(expireSession).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/login'], expect.objectContaining({ replaceUrl: true }));
  });

  it('does not redirect or clear identity on login 401', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    client.post('/api/auth/login', {}).subscribe({ error: () => undefined });
    http.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(expireSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('redirects only once when multiple protected requests receive 401', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    client.get('/api/projects').subscribe({ error: () => undefined });
    client.get('/api/projects/stats').subscribe({ error: () => undefined });
    http.expectOne('/api/projects').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/projects/stats').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(expireSession).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('preserves identity on project 403 and leaves its error to the caller', () => {
    let status = 0;
    client.get('/api/projects').subscribe({ error: (error) => status = error.status });
    http.expectOne('/api/projects').flush({ error: { code: 'FORBIDDEN', message: '沒有存取案件的權限。' } },
      { status: 403, statusText: 'Forbidden' });
    expect(status).toBe(403);
    expect(expireSession).not.toHaveBeenCalled();
  });
});
