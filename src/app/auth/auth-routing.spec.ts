import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, ReplaySubject, of } from 'rxjs';
import { AuthStateService, AuthStatus } from './auth-state.service';
import { authGuard, safeReturnUrl } from './auth-routing';

@Component({ selector: 'test-protected-page', template: '<p>Protected page</p>' })
class ProtectedPage {}
@Component({ selector: 'test-login-page', template: '<p>Login page</p>' })
class TestLoginPage {}

describe('auth routing', () => {
  it.each(['/dashboard', '/projects', '/projects/7/edit', '/about'])(
    'accepts internal return URL %s', (url) => expect(safeReturnUrl(url)).toBe(url),
  );
  it.each(['//attacker.test', 'https://attacker.test', '/login', '/dev/api-preview', '/projects\\evil'])(
    'rejects unsafe return URL %s', (url) => expect(safeReturnUrl(url)).toBeNull(),
  );

  let result: Observable<AuthStatus>;
  beforeEach(() => {
    result = of('unauthenticated');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: TestLoginPage },
          { path: 'projects', canActivate: [authGuard], component: ProtectedPage },
        ]),
        { provide: AuthStateService, useValue: { ensureSession: () => result } },
      ],
    });
  });

  it('redirects unauthenticated users to login without constructing protected content', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects');
    expect(harness.routeNativeElement?.textContent).toContain('Login page');
    expect(harness.routeNativeElement?.textContent ?? '').not.toContain('Protected page');
    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Fprojects');
  });

  it('allows an authenticated user', async () => {
    result = of('authenticated');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projects');
    expect(harness.routeNativeElement?.textContent).toContain('Protected page');
  });

  it('keeps the guarded page absent while /me is pending', async () => {
    const pending = new ReplaySubject<AuthStatus>(1);
    result = pending;
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/projects');
    expect(harness.routeNativeElement?.textContent ?? '').not.toContain('Protected page');
    pending.next('unauthenticated');
    pending.complete();
    await navigation;
    expect(harness.routeNativeElement?.textContent).toContain('Login page');
  });
});
