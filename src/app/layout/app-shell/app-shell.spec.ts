import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthStateService } from '../../auth/auth-state.service';
import { AppShellComponent } from './app-shell';

@Component({ template: '<h1>測試頁面</h1>' })
class TestPage {}

describe('AppShellComponent mobile navigation', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let element: HTMLElement;
  let desktop = false;
  let breakpointChanged: ((event: MediaQueryListEvent) => void) | undefined;

  const query = (selector: string) => {
    const found = element.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };

  const openMenu = async () => {
    const menu = query('.topbar__menu-button');
    menu.focus();
    menu.click();
    fixture.detectChanges();
    await fixture.whenStable();
    return menu;
  };

  const changeBreakpoint = async (matches: boolean) => {
    desktop = matches;
    breakpointChanged?.({ matches } as MediaQueryListEvent);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    desktop = false;
    breakpointChanged = undefined;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return desktop; },
      media: '(min-width: 1024px)',
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        breakpointChanged = listener;
      },
      removeEventListener: () => { breakpointChanged = undefined; },
    })));

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([
          { path: 'dashboard', component: TestPage },
          { path: 'projects', component: TestPage },
        ]),
        { provide: AuthStateService, useValue: {
          currentUser: signal({ id: 1, name: '測試員工', email: 'staff@example.test', role: 'admin' }),
          logout: () => of(undefined),
        } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppShellComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    // jsdom does not apply media queries; mirror the mobile-only controls' display.
    query('.topbar__menu-button').style.display = 'inline-grid';
    query('.side-nav__close-button').style.display = 'inline-grid';
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps the closed mobile drawer and backdrop out of the tab order', () => {
    expect(query('app-side-nav').hasAttribute('inert')).toBe(true);
    expect(query('.app-shell__backdrop').hasAttribute('inert')).toBe(true);
    expect(query('.topbar__menu-button').getAttribute('aria-expanded')).toBe('false');
    expect(query('.topbar__menu-button').getAttribute('aria-controls')).toBe('primary-navigation');
    expect(query('#primary-navigation').tagName).toBe('NAV');
  });

  it('focuses the drawer, confines Tab and Shift+Tab, then Escape restores the opener', async () => {
    const menu = await openMenu();
    const close = query('.side-nav__close-button');
    const first = query('.side-nav__brand');
    const last = element.querySelectorAll<HTMLElement>('.side-nav__link')[3];
    expect(document.activeElement).toBe(close);
    expect(query('.app-shell__content').hasAttribute('inert')).toBe(true);
    expect(query('.skip-link').hasAttribute('inert')).toBe(true);
    expect(query('app-side-nav').getAttribute('role')).toBe('dialog');
    expect(query('app-side-nav').getAttribute('aria-modal')).toBe('true');
    expect(menu.getAttribute('aria-expanded')).toBe('true');

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);

    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(query('.app-shell__content').hasAttribute('inert')).toBe(false);
    expect(query('.skip-link').hasAttribute('inert')).toBe(false);
  });

  it('lets the close button restore focus and closes on Router navigation', async () => {
    const menu = await openMenu();
    query('.side-nav__close-button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(menu);

    await openMenu();
    await TestBed.inject(Router).navigateByUrl('/projects');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.isMobileNavigationOpen()).toBe(false);
    expect(query('.app-shell__content').hasAttribute('inert')).toBe(false);
    expect(query('app-side-nav').hasAttribute('inert')).toBe(true);
  });

  it('closes on backdrop and on a navigation link without leaving the drawer active', async () => {
    const menu = await openMenu();
    query('.app-shell__backdrop').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(menu);
    expect(query('app-side-nav').hasAttribute('inert')).toBe(true);

    await openMenu();
    query('a.side-nav__link[href="/projects"]').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/projects');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(query('app-side-nav').hasAttribute('inert')).toBe(true);
  });

  it('removes mobile focus restrictions at the desktop breakpoint, then restores mobile closed state', async () => {
    const menu = await openMenu();
    query('.side-nav__close-button').focus();
    await changeBreakpoint(true);
    expect(query('app-side-nav').hasAttribute('inert')).toBe(false);
    expect(query('.app-shell__content').hasAttribute('inert')).toBe(false);
    expect(query('app-side-nav').hasAttribute('role')).toBe(false);
    expect(fixture.componentInstance.isMobileNavigationOpen()).toBe(false);
    expect(document.activeElement).toBe(query('.side-nav__brand'));

    await changeBreakpoint(false);
    expect(query('app-side-nav').hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(menu);
  });
});
