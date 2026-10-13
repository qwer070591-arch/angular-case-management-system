import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { AuthStateService } from '../../auth/auth-state.service';
import { TopbarComponent } from './topbar';

describe('TopbarComponent', () => {
  const currentUser = signal({ id: 2, name: '陳怡君', email: 'user@example.test', role: 'manager' as const });
  let logout: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    currentUser.set({ id: 2, name: '陳怡君', email: 'user@example.test', role: 'manager' });
    logout = vi.fn();
    TestBed.configureTestingModule({
      imports: [TopbarComponent],
      providers: [provideRouter([]), { provide: AuthStateService, useValue: { currentUser, logout } }],
    });
  });

  it('shows the real employee name and role rather than a fixed admin', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.componentRef.setInput('title', '案件管理');
    fixture.componentRef.setInput('isMobileNavigationOpen', false);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('陳怡君');
    expect(element.textContent).toContain('經理');
    expect(element.querySelector('.topbar__user')?.getAttribute('aria-label')).toContain('陳怡君');
  });

  it('waits for logout confirmation before navigating and prevents duplicate requests', () => {
    const pending = new Subject<void>();
    logout.mockReturnValue(pending);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.componentRef.setInput('title', '案件管理');
    fixture.componentRef.setInput('isMobileNavigationOpen', false);
    fixture.detectChanges();
    fixture.componentInstance.logout();
    fixture.componentInstance.logout();
    expect(logout).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    pending.next();
    pending.complete();
    expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });

  it('does not navigate when logout fails', () => {
    const pending = new Subject<void>();
    logout.mockReturnValue(pending);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.componentRef.setInput('title', '案件管理');
    fixture.componentRef.setInput('isMobileNavigationOpen', false);
    fixture.detectChanges();
    fixture.componentInstance.logout();
    pending.error(new Error('network'));
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.logoutError()).toContain('登出未完成');
  });
});
