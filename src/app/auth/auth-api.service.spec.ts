import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthApiService, UserPublic } from './auth-api.service';

const user: UserPublic = { id: 1, name: '王小明', email: 'employee@example.test', role: 'admin' };

describe('AuthApiService', () => {
  let api: AuthApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(AuthApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('initializes CSRF using the relative API URL', () => {
    let token = '';
    api.initializeCsrf().subscribe((value) => token = value);
    const request = http.expectOne('/api/auth/csrf');
    expect(request.request.method).toBe('GET');
    request.flush({ data: { csrfToken: 'test-token' } });
    expect(token).toBe('test-token');
  });

  it('passes CSRF initialization failure to the caller', () => {
    let status = 0;
    api.initializeCsrf().subscribe({ error: (error) => status = error.status });
    http.expectOne('/api/auth/csrf').flush({}, { status: 500, statusText: 'Error' });
    expect(status).toBe(500);
  });

  it('posts only email/password and unwraps the safe user', () => {
    let actual: UserPublic | undefined;
    api.login({ email: 'employee@example.test', password: 'secret' }).subscribe((value) => actual = value);
    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'employee@example.test', password: 'secret' });
    request.flush({ data: user });
    expect(actual).toEqual(user);
  });

  it('uses Angular default XSRF header on relative login and reads a rotated cookie for logout', () => {
    document.cookie = 'XSRF-TOKEN=anonymous-token; path=/';
    api.login({ email: user.email, password: 'secret' }).subscribe();
    const login = http.expectOne('/api/auth/login');
    expect(login.request.headers.get('X-XSRF-TOKEN')).toBe('anonymous-token');
    login.flush({ data: user });

    document.cookie = 'XSRF-TOKEN=session-token; path=/';
    api.logout().subscribe();
    const logout = http.expectOne('/api/auth/logout');
    expect(logout.request.headers.get('X-XSRF-TOKEN')).toBe('session-token');
    logout.flush(null, { status: 204, statusText: 'No Content' });
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/';
  });

  it.each([401, 429])('preserves login HTTP %i', (status) => {
    let actual = 0;
    api.login({ email: 'a@example.test', password: 'bad' }).subscribe({ error: (error) => actual = error.status });
    http.expectOne('/api/auth/login').flush({ error: { code: 'INVALID_CREDENTIALS' } }, { status, statusText: 'Error' });
    expect(actual).toBe(status);
  });

  it('GETs the current user and unwraps data', () => {
    let actual: UserPublic | undefined;
    api.getCurrentUser().subscribe((value) => actual = value);
    const request = http.expectOne('/api/auth/me');
    expect(request.request.method).toBe('GET');
    request.flush({ data: user });
    expect(actual).toEqual(user);
  });

  it('POSTs logout and accepts 204 without JSON body', () => {
    let completed = false;
    api.logout().subscribe(() => completed = true);
    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(completed).toBe(true);
  });
});
