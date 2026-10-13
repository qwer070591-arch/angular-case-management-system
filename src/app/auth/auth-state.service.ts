import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { AuthApiService, LoginInput, UserPublic } from './auth-api.service';

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly api = inject(AuthApiService);
  private checkRequest?: Observable<AuthStatus>;

  readonly status = signal<AuthStatus>('checking');
  readonly currentUser = signal<UserPublic | null>(null);
  readonly loginError = signal('');
  readonly checkError = signal('');

  ensureSession(): Observable<AuthStatus> {
    if (this.status() === 'authenticated' || this.status() === 'unauthenticated') {
      return of(this.status());
    }
    if (this.checkRequest) return this.checkRequest;

    this.status.set('checking');
    this.checkError.set('');
    this.checkRequest = this.api.getCurrentUser().pipe(
      map((user) => {
        this.currentUser.set(user);
        this.status.set('authenticated');
        return 'authenticated' as const;
      }),
      catchError((error: unknown) => {
        this.currentUser.set(null);
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.status.set('unauthenticated');
          return of('unauthenticated' as const);
        }
        this.status.set('unavailable');
        this.checkError.set('無法確認登入狀態，請檢查連線後重試。');
        return of('unavailable' as const);
      }),
      finalize(() => { this.checkRequest = undefined; }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.checkRequest;
  }

  retrySessionCheck(): Observable<AuthStatus> {
    if (this.status() !== 'authenticated') this.status.set('checking');
    return this.ensureSession();
  }

  login(input: LoginInput): Observable<UserPublic> {
    this.loginError.set('');
    // The GET sets an anonymous XSRF cookie. Login rotates it to the new session.
    return this.api.initializeCsrf().pipe(
      switchMap(() => this.api.login(input)),
      tap((user) => {
        this.currentUser.set(user);
        this.status.set('authenticated');
        this.checkError.set('');
      }),
    );
  }

  logout(): Observable<void> {
    // Refresh the session-bound XSRF cookie before the mutation.
    return this.api.initializeCsrf().pipe(
      switchMap(() => this.api.logout()),
      tap(() => this.clearIdentity()),
    );
  }

  expireSession(): void {
    this.clearIdentity();
  }

  private clearIdentity(): void {
    this.currentUser.set(null);
    this.status.set('unauthenticated');
  }
}
