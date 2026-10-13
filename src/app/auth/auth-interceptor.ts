import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { AuthStateService } from './auth-state.service';
import { safeReturnUrl } from './auth-routing';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  return next(request).pipe(tap({
    error: (error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401
        || !request.url.startsWith('/api/') || request.url.startsWith('/api/auth/')) return;
      if (auth.status() === 'unauthenticated') return;
      auth.expireSession();
      if (!router.url.startsWith('/login')) {
        void router.navigate(['/login'], {
          queryParams: { returnUrl: safeReturnUrl(router.url) ?? '/dashboard' },
          replaceUrl: true,
        });
      }
    },
  }));
};
