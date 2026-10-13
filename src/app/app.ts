import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthStateService } from './auth/auth-state.service';
import { AppIntroComponent } from './shared/app-intro/app-intro';

const INTRO_SESSION_STORAGE_KEY = 'case-management-intro-seen';

@Component({
  imports: [RouterOutlet, AppIntroComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly introSeen = signal(!this.shouldShowIntro());
  private readonly onLoginRoute = signal(this.isBrowser && window.location.pathname === '/login');

  readonly isIntroVisible = computed(() =>
    this.auth.status() === 'authenticated' && !this.onLoginRoute() && !this.introSeen(),
  );

  constructor() {
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.onLoginRoute.set(event.urlAfterRedirects.split(/[?#]/, 1)[0] === '/login'));
    this.auth.ensureSession().subscribe();
  }

  finishIntro() {
    if (!this.isIntroVisible()) {
      return;
    }

    this.markIntroAsSeen();
    this.introSeen.set(true);
  }

  private shouldShowIntro(): boolean {
    if (!this.isBrowser) {
      return false;
    }

    try {
      return window.sessionStorage.getItem(INTRO_SESSION_STORAGE_KEY) !== 'true';
    } catch {
      return true;
    }
  }

  private markIntroAsSeen() {
    if (!this.isBrowser) {
      return;
    }

    try {
      window.sessionStorage.setItem(INTRO_SESSION_STORAGE_KEY, 'true');
    } catch {
      // The application remains usable if session storage is unavailable.
    }
  }
}
