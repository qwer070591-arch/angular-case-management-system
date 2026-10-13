import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStateService } from '../../auth/auth-state.service';
import { safeReturnUrl } from '../../auth/auth-routing';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule],
  styleUrl: './login.css',
  templateUrl: './login.html',
})
export class LoginPage {
  readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly error = signal('');
  readonly submitted = signal(false);

  constructor() {
    this.auth.ensureSession().pipe(takeUntilDestroyed()).subscribe((status) => {
      if (status === 'authenticated') void this.goToDestination();
    });
  }

  get emailInvalid(): boolean {
    return this.form.controls.email.invalid && (this.form.controls.email.touched || this.submitted());
  }

  get passwordInvalid(): boolean {
    return this.form.controls.password.invalid && (this.form.controls.password.touched || this.submitted());
  }

  retrySession(): void {
    this.auth.retrySessionCheck().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      if (status === 'authenticated') void this.goToDestination();
    });
  }

  submit(): void {
    if (this.submitting() || this.auth.status() === 'checking') return;
    this.submitted.set(true);
    this.error.set('');
    this.auth.loginError.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.auth.login({
      email: this.form.controls.email.value.trim(),
      password: this.form.controls.password.value,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.submitting.set(false);
        this.form.controls.password.reset('');
        void this.goToDestination();
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        const message = error instanceof HttpErrorResponse && error.status === 429
          ? '登入嘗試次數過多，請稍後再試。'
          : error instanceof HttpErrorResponse && error.status === 401
            ? 'Email 或密碼錯誤。'
            : error instanceof HttpErrorResponse && error.status === 0
              ? '無法連線至登入服務，請檢查連線後重試。'
              : '登入失敗，請稍後重試。';
        this.error.set(message);
        this.auth.loginError.set(message);
      },
    });
  }

  private goToDestination(): Promise<boolean> {
    const returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')) ?? '/dashboard';
    return this.router.navigateByUrl(returnUrl, { replaceUrl: true });
  }
}
