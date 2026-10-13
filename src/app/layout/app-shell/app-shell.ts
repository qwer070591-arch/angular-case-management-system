import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, ViewChild, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, startWith } from 'rxjs';
import { SideNavComponent } from '../side-nav/side-nav';
import { TopbarComponent } from '../topbar/topbar';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, SideNavComponent, TopbarComponent],
  styleUrl: './app-shell.css',
  templateUrl: './app-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  @ViewChild('sideNav', { read: ElementRef }) private sideNav?: ElementRef<HTMLElement>;
  @ViewChild('topbar', { read: ElementRef }) private topbar?: ElementRef<HTMLElement>;

  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly isDesktop = signal(true);
  readonly isMobileNavigationOpen = signal(false);
  readonly mobileDrawerOpen = computed(() => !this.isDesktop() && this.isMobileNavigationOpen());
  readonly pageTitle = signal('Dashboard');

  constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const desktopQuery = window.matchMedia('(min-width: 1024px)');
      this.isDesktop.set(desktopQuery.matches);
      const onBreakpointChange = (event: MediaQueryListEvent) => this.handleBreakpointChange(event.matches);
      desktopQuery.addEventListener('change', onBreakpointChange);
      this.destroyRef.onDestroy(() => desktopQuery.removeEventListener('change', onBreakpointChange));
    }

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.pageTitle.set(this.getCurrentRouteTitle());
        this.closeMobileNavigation();
      });
  }

  toggleMobileNavigation(): void {
    if (this.isDesktop()) return;

    if (this.isMobileNavigationOpen()) {
      this.closeMobileNavigation();
      return;
    }

    this.isMobileNavigationOpen.set(true);
    this.afterRenderFocus(() => this.sideNav?.nativeElement.querySelector<HTMLButtonElement>('.side-nav__close-button'));
  }

  closeMobileNavigation(): void {
    if (!this.isMobileNavigationOpen()) return;

    this.isMobileNavigationOpen.set(false);
    this.afterRenderFocus(() => this.isDesktop() ? null : this.menuButton());
  }

  @HostListener('document:keydown', ['$event'])
  handleDocumentKeydown(event: KeyboardEvent): void {
    if (!this.mobileDrawerOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMobileNavigation();
      return;
    }

    if (event.key !== 'Tab') return;

    const drawer = this.sideNav?.nativeElement;
    const focusable = drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    if (!drawer || !focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !drawer.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  private handleBreakpointChange(desktop: boolean): void {
    if (desktop === this.isDesktop()) return;

    const drawer = this.sideNav?.nativeElement;
    const active = document.activeElement;
    const focusWasOnCloseButton = active?.classList.contains('side-nav__close-button');
    const focusWasInDrawer = !!active && !!drawer?.contains(active);
    this.isDesktop.set(desktop);
    this.isMobileNavigationOpen.set(false);

    if (desktop && focusWasOnCloseButton) {
      this.afterRenderFocus(() => drawer?.querySelector<HTMLElement>('.side-nav__brand'));
    } else if (!desktop && focusWasInDrawer) {
      this.afterRenderFocus(() => this.menuButton());
    }
  }

  private menuButton(): HTMLButtonElement | null {
    return this.topbar?.nativeElement.querySelector<HTMLButtonElement>('.topbar__menu-button') ?? null;
  }

  private afterRenderFocus(target: () => HTMLElement | null | undefined): void {
    afterNextRender(() => {
      if (!this.destroyRef.destroyed) target()?.focus();
    }, { injector: this.injector });
  }

  private getCurrentRouteTitle(): string {
    let route = this.activatedRoute;

    while (route.firstChild) {
      route = route.firstChild;
    }

    return (route.snapshot?.data?.['title'] as string | undefined) ?? '案件管理系統';
  }
}
