import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthStateService } from '../../auth/auth-state.service';
import { UserRole } from '../../auth/auth-api.service';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: '管理員',
  manager: '經理',
  staff: '員工',
};

@Component({
  selector: 'app-topbar',
  styleUrl: './topbar.css',
  templateUrl: './topbar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent {
  readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly roleLabels = ROLE_LABELS;
  readonly loggingOut = signal(false);
  readonly logoutError = signal('');

  @Input({ required: true }) title = '';
  @Input({ required: true }) isMobileNavigationOpen = false;
  @Output() menuClicked = new EventEmitter<void>();

  logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.logoutError.set('');
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.loggingOut.set(false);
        void this.router.navigate(['/login'], { replaceUrl: true });
      },
      error: () => {
        this.loggingOut.set(false);
        this.logoutError.set('登出未完成，請檢查連線後重試。');
      },
    });
  }
}
