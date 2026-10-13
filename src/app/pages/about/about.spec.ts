import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SideNavComponent } from '../../layout/side-nav/side-nav';
import { AboutPage } from './about';

describe('AboutPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AboutPage, SideNavComponent],
      providers: [
        provideRouter([{ path: 'about', component: AboutPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('introduces the system with a clear heading and the requested description', () => {
    const fixture = TestBed.createComponent(AboutPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toBe('關於系統');
    expect(element.querySelector('#about-intro-title')?.textContent).toBe('案件管理系統');
    expect(element.querySelector('.about-intro__subtitle')?.textContent).toBe('Case Management System');
    expect(element.querySelector('.about-intro__description')?.textContent).toContain('以 Angular 開發的響應式案件管理平台');
  });

  it('renders exactly the six real core features without action controls', () => {
    const fixture = TestBed.createComponent(AboutPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const cards = [...element.querySelectorAll('.about-feature')];

    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual([
      '數據儀表板', '案件管理', '進度追蹤', '搜尋與篩選', '員工登入', '響應式設計',
    ]);
    expect(cards).toHaveLength(6);
    expect(element.querySelector('.about-features button, .about-features a')).toBeNull();
    expect(element.textContent).not.toContain('RBAC');
  });

  it('lists the actual frontend and backend technologies and project practices', () => {
    const fixture = TestBed.createComponent(AboutPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const technologies = [...element.querySelectorAll('.about-tech__tags li')].map((item) => item.textContent);
    const highlights = [...element.querySelectorAll('.about-highlights__list li')].map((item) => item.textContent);

    expect(technologies).toEqual([
      'Angular 22', 'TypeScript', 'HTML5', 'CSS3', 'Angular Signals', 'Reactive Forms',
      'NestJS 11', 'Prisma 7', 'PostgreSQL 17',
    ]);
    expect(highlights).toEqual([
      'Standalone Components', 'Lazy Loading', 'API Integration',
      'Form Validation', 'Responsive Layout', 'Accessibility',
    ]);
    expect(element.querySelectorAll('h1')).toHaveLength(1);
    expect(element.querySelectorAll('h2')).toHaveLength(4);
  });

  it('does not request project or auth data to render the static page', () => {
    const fixture = TestBed.createComponent(AboutPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectNone(() => true);
    TestBed.inject(HttpTestingController).verify();
  });

  it('shows 關於系統 in the Sidebar and keeps RouterLink navigation', async () => {
    const fixture = TestBed.createComponent(SideNavComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const aboutLink = [...element.querySelectorAll<HTMLAnchorElement>('.side-nav__link')]
      .find((link) => link.getAttribute('href') === '/about');

    expect(aboutLink?.textContent?.trim()).toBe('關於系統');
    expect(element.querySelectorAll('.side-nav__link')).toHaveLength(4);
    aboutLink?.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/about');
  });
});
