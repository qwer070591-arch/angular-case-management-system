import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthStateService, AuthStatus } from '../../auth/auth-state.service';
import { UserPublic } from '../../auth/auth-api.service';
import { LoginPage } from './login';

const user: UserPublic = { id: 1, name: '王小明', email: 'employee@example.test', role: 'admin' };

describe('LoginPage', () => {
  const status = signal<AuthStatus>('unauthenticated');
  const checkError = signal('');
  const loginError = signal('');
  let login: ReturnType<typeof vi.fn<(input: { email: string; password: string }) => Observable<UserPublic>>>;

  beforeEach(() => {
    status.set('unauthenticated');
    checkError.set('');
    loginError.set('');
    login = vi.fn(() => of(user));
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthStateService, useValue: {
          status, checkError, loginError,
          ensureSession: () => of('unauthenticated'),
          retrySessionCheck: () => of('unauthenticated'),
          login: (input: { email: string; password: string }) => login(input),
        } },
      ],
    });
  });

  function createPage() {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    return fixture;
  }

  it('shows visible labels and password controls outside the App Shell', () => {
    const fixture = createPage();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toBe('員工登入');
    expect(element.querySelector('label[for="login-email"]')).toBeTruthy();
    expect(element.querySelector('label[for="login-password"]')).toBeTruthy();
    expect(element.querySelector<HTMLInputElement>('#login-password')?.type).toBe('password');
    expect(element.querySelector('app-shell')).toBeNull();
    expect(element.querySelector('app-intro')).toBeNull();
    element.querySelector<HTMLButtonElement>('.login-card__reveal')?.click();
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('#login-password')?.type).toBe('text');
  });

  it('validates the form before contacting login', () => {
    const fixture = createPage();
    fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(login).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);
  });

  it('prevents duplicate login and navigates only after success', () => {
    const pending = new Subject<UserPublic>();
    login.mockReturnValue(pending);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = createPage();
    fixture.componentInstance.form.setValue({ email: user.email, password: 'secret' });
    fixture.componentInstance.submit();
    fixture.componentInstance.submit();
    expect(login).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    pending.next(user);
    pending.complete();
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
    expect(fixture.componentInstance.form.controls.password.value).toBe('');
  });

  it.each([
    [401, 'Email 或密碼錯誤。'],
    [429, '登入嘗試次數過多'],
  ])('shows a safe error for login HTTP %i', (code, expected) => {
    login.mockReturnValue(throwError(() => new HttpErrorResponse({ status: code })));
    const fixture = createPage();
    fixture.componentInstance.form.setValue({ email: user.email, password: 'wrong' });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toContain(expected);
    expect(fixture.componentInstance.form.controls.email.value).toBe(user.email);
    expect(fixture.componentInstance.submitting()).toBe(false);
  });

  it('does not render a login form while checking the session', () => {
    status.set('checking');
    const fixture = createPage();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('正在確認登入狀態');
  });
});
