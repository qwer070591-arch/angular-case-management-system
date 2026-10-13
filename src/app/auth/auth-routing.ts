import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { map } from 'rxjs';
import { AuthStateService } from './auth-state.service';

/** Accept only routes belonging to this application, never external or protocol-relative URLs. */
export function safeReturnUrl(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return null;
  const path = value.split(/[?#]/, 1)[0];
  return path === '/dashboard' || path === '/projects' || path.startsWith('/projects/') || path === '/about'
    ? value : null;
}

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  return auth.ensureSession().pipe(map((status) => status === 'authenticated'
    ? true
    : router.createUrlTree(['/login'], { queryParams: { returnUrl: safeReturnUrl(state.url) ?? '/dashboard' } })));
};
