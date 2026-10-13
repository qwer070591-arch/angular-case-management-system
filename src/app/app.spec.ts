import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AppShellComponent } from './layout/app-shell/app-shell';
import { App } from './app';
import { AuthStateService } from './auth/auth-state.service';

const introSessionKey = 'case-management-intro-seen';

@Component({
  template: '<p data-testid="routed-content">Routed test content</p>',
})
class RoutedTestPage {}

describe('App', () => {
  const authStatus = signal<'checking' | 'authenticated' | 'unauthenticated'>('authenticated');
  const currentUser = signal({ id: 1, name: '測試員工', email: 'staff@example.test', role: 'admin' as const });
  beforeEach(async () => {
    window.sessionStorage.removeItem(introSessionKey);
    authStatus.set('authenticated');

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: AuthStateService, useValue: { status: authStatus, currentUser, ensureSession: () => of('authenticated') } },
        provideRouter([
          { path: 'login', component: RoutedTestPage },
          {
            path: '',
            component: AppShellComponent,
            children: [{ path: '', component: RoutedTestPage, data: { title: '測試頁面' } }],
          },
        ]),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    window.sessionStorage.removeItem(introSessionKey);
  });

  it('creates the root and renders the routed App Shell when Intro was seen', async () => {
    window.sessionStorage.setItem(introSessionKey, 'true');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance).toBeTruthy();
    expect(element.querySelector('app-intro')).toBeNull();
    expect(element.querySelector('.app-root__content')?.hasAttribute('inert')).toBe(false);
    expect(element.querySelector('app-shell')).toBeTruthy();
    expect(element.querySelector('app-side-nav')).toBeTruthy();
    expect(element.querySelector('app-topbar')).toBeTruthy();
    expect(element.querySelector('main router-outlet')).toBeTruthy();
    expect(element.querySelector('[data-testid="routed-content"]')?.textContent).toBe('Routed test content');
  });

  it('shows Intro on first visit, then Skip reveals the app for this session', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.isIntroVisible()).toBe(true);
    expect(element.querySelector('app-intro')).toBeTruthy();
    expect(element.querySelector('.app-root__content')?.hasAttribute('inert')).toBe(true);

    const skip = element.querySelector<HTMLButtonElement>('.app-intro__skip');
    expect(skip?.textContent?.trim()).toBe('跳過');
    skip?.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.isIntroVisible()).toBe(false);
    expect(element.querySelector('app-intro')).toBeNull();
    expect(element.querySelector('.app-root__content')?.hasAttribute('inert')).toBe(false);
    expect(window.sessionStorage.getItem(introSessionKey)).toBe('true');

    const nextFixture = TestBed.createComponent(App);
    nextFixture.detectChanges();
    expect(nextFixture.componentInstance.isIntroVisible()).toBe(false);
    expect((nextFixture.nativeElement as HTMLElement).querySelector('app-intro')).toBeNull();
  });

  it('does not show Intro or an App Shell on the login route', async () => {
    authStatus.set('unauthenticated');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/login');
    await fixture.whenStable();
    expect(fixture.componentInstance.isIntroVisible()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-intro')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-shell')).toBeNull();
  });
});
