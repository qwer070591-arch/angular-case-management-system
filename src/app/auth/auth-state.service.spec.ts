import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthStateService } from './auth-state.service';

const user = { id: 1, name: '王小明', email: 'employee@example.test', role: 'admin' };

describe('AuthStateService', () => {
  let state: AuthStateService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    state = TestBed.inject(AuthStateService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('checks /me once for concurrent subscribers and restores an active session', () => {
    state.ensureSession().subscribe();
    state.ensureSession().subscribe();
    expect(state.status()).toBe('checking');
    http.expectOne('/api/auth/me').flush({ data: user });
    expect(state.status()).toBe('authenticated');
    expect(state.currentUser()?.name).toBe('王小明');
    state.ensureSession().subscribe();
    http.expectNone('/api/auth/me');
  });

  it('sets unauthenticated on /me 401', () => {
    state.ensureSession().subscribe();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(state.status()).toBe('unauthenticated');
    expect(state.currentUser()).toBeNull();
  });

  it('keeps a network failure distinct and permits retry', () => {
    state.ensureSession().subscribe();
    http.expectOne('/api/auth/me').error(new ProgressEvent('error'));
    expect(state.status()).toBe('unavailable');
    state.retrySessionCheck().subscribe();
    http.expectOne('/api/auth/me').flush({ data: user });
    expect(state.status()).toBe('authenticated');
  });

  it('initializes CSRF before login and only authenticates after login success', () => {
    state.ensureSession().subscribe();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    state.login({ email: user.email, password: 'secret' }).subscribe();
    expect(state.status()).toBe('unauthenticated');
    http.expectOne('/api/auth/csrf').flush({ data: { csrfToken: 'token' } });
    http.expectOne('/api/auth/login').flush({ data: user });
    expect(state.status()).toBe('authenticated');
  });

  it('does not authenticate if CSRF initialization fails', () => {
    state.login({ email: user.email, password: 'secret' }).subscribe({ error: () => undefined });
    http.expectOne('/api/auth/csrf').flush({}, { status: 500, statusText: 'Error' });
    http.expectNone('/api/auth/login');
    expect(state.currentUser()).toBeNull();
  });

  it('only clears the identity after confirmed logout', () => {
    state.ensureSession().subscribe();
    http.expectOne('/api/auth/me').flush({ data: user });
    state.logout().subscribe();
    http.expectOne('/api/auth/csrf').flush({ data: { csrfToken: 'token' } });
    expect(state.status()).toBe('authenticated');
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(state.status()).toBe('unauthenticated');
    expect(state.currentUser()).toBeNull();
  });

  it('retains the identity when logout fails', () => {
    state.ensureSession().subscribe();
    http.expectOne('/api/auth/me').flush({ data: user });
    state.logout().subscribe({ error: () => undefined });
    http.expectOne('/api/auth/csrf').flush({ data: { csrfToken: 'token' } });
    http.expectOne('/api/auth/logout').flush({}, { status: 500, statusText: 'Error' });
    expect(state.status()).toBe('authenticated');
    expect(state.currentUser()?.id).toBe(1);
  });
});
