import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Project } from '../../project';
import { ProjectDetailPage } from '../project-detail/project-detail';
import { ProjectEditPage } from '../project-edit/project-edit';
import { projectEditCanDeactivate } from '../project-edit/project-edit.guard';
import { ProjectsPage } from './projects';

const project: Project = {
  id: 8, projectCode: 'PRJ-2026-0008', name: '官網改版', description: null,
  status: 'pending', priority: 'medium', startDate: null, dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
};

async function setup(url = '/projects?q=官網&status=pending&page=2') {
  await TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
      provideRouter([
        { path: 'projects', component: ProjectsPage },
        { path: 'projects/:id', component: ProjectDetailPage },
        { path: 'projects/:id/edit', component: ProjectEditPage, canDeactivate: [projectEditCanDeactivate] },
      ])],
  }).compileComponents();
  const router = TestBed.inject(Router);
  router.setUpLocationChangeListener();
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  const http = TestBed.inject(HttpTestingController);
  return { harness, router, http, location: TestBed.inject(Location) };
}

function flushList(http: HttpTestingController, offset: number, total = 25): void {
  const request = http.expectOne((item) => item.url === '/api/projects');
  expect(request.request.params.get('q')).toBe('官網');
  expect(request.request.params.get('status')).toBe('pending');
  expect(request.request.params.get('offset')).toBe(String(offset));
  request.flush({ data: [project], meta: { total, limit: 20, offset } });
}

describe('Projects list route state', () => {
  it('restores q, status, and page from a refreshed URL', async () => {
    const { harness, router, http } = await setup();
    flushList(http, 20);
    await harness.fixture.whenStable();
    const element = harness.routeNativeElement as HTMLElement;
    expect((element.querySelector('#project-search') as HTMLInputElement).value).toBe('官網');
    expect((element.querySelector('#project-status-filter') as HTMLSelectElement).value).toBe('pending');
    expect(element.textContent).toContain('2 / 2');
    expect(router.url).toBe('/projects?q=%E5%AE%98%E7%B6%B2&status=pending&page=2');
    http.verify();
  });

  it('carries list filters through Detail and Manage return links', async () => {
    const { harness, router, http } = await setup();
    flushList(http, 20);
    await harness.fixture.whenStable();
    const element = harness.routeNativeElement as HTMLElement;
    const detail = element.querySelector<HTMLAnchorElement>('.project-table-container .project-name__link');
    const manage = element.querySelector<HTMLAnchorElement>('.project-table-container .project-action--edit');
    expect(detail?.getAttribute('href')).toBe('/projects/8?q=%E5%AE%98%E7%B6%B2&status=pending&page=2');
    expect(manage?.getAttribute('href')).toBe('/projects/8/edit?q=%E5%AE%98%E7%B6%B2&status=pending&page=2');

    detail?.click();
    await harness.fixture.whenStable();
    http.expectOne('/api/projects/8').flush({ data: project });
    await harness.fixture.whenStable();
    const back = harness.routeNativeElement?.querySelector<HTMLAnchorElement>('.project-detail-page__back-link');
    expect(back?.getAttribute('href')).toBe('/projects?q=%E5%AE%98%E7%B6%B2&status=pending&page=2');
    const manageFromDetail = harness.routeNativeElement?.querySelector<HTMLAnchorElement>('.project-detail-page__manage-link');
    manageFromDetail?.click();
    await harness.fixture.whenStable();
    http.expectOne('/api/projects/8').flush({ data: project });
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector<HTMLAnchorElement>('.project-edit-form-card__cancel')?.getAttribute('href'))
      .toBe('/projects?q=%E5%AE%98%E7%B6%B2&status=pending&page=2');
    (harness.routeNativeElement?.querySelector<HTMLAnchorElement>('.project-edit-form-card__cancel'))?.click();
    await harness.fixture.whenStable();
    flushList(http, 20);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects?q=%E5%AE%98%E7%B6%B2&status=pending&page=2');
    http.verify();
  });

  it('resets page for status changes and retains filters during pagination', async () => {
    const { harness, router, http } = await setup();
    flushList(http, 20);
    await harness.fixture.whenStable();
    const page = harness.routeDebugElement?.componentInstance as ProjectsPage;
    page.updateSelectedStatus({ target: { value: 'completed' } } as unknown as Event);
    const filtered = http.expectOne((item) => item.params.get('status') === 'completed');
    expect(filtered.request.params.get('offset')).toBe('0');
    filtered.flush({ data: [project], meta: { total: 25, limit: 20, offset: 0 } });
    await harness.fixture.whenStable();
    expect(router.url).toContain('status=completed');
    expect(router.url).not.toContain('page=');
    page.changePage(1);
    const next = http.expectOne((item) => item.params.get('offset') === '20');
    expect(next.request.params.get('q')).toBe('官網');
    expect(next.request.params.get('status')).toBe('completed');
    next.flush({ data: [project], meta: { total: 25, limit: 20, offset: 20 } });
    await harness.fixture.whenStable();
    expect(router.url).toContain('page=2');
    http.verify();
  });

  it('normalizes invalid list-only params and corrects an out-of-range page', async () => {
    const { harness, router, http } = await setup('/projects?status=bogus&page=-5&unrelated=keep');
    const first = http.expectOne((item) => item.url === '/api/projects');
    expect(first.request.params.get('status')).toBeNull();
    expect(first.request.params.get('offset')).toBe('0');
    first.flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await harness.fixture.whenStable();
    expect(router.url).not.toContain('status=');
    expect(router.url).not.toContain('page=');
    expect(router.url).toContain('unrelated=keep');
    http.verify();
  });

  it('synchronizes browser Back and Forward with filters and API requests', async () => {
    const { harness, router, http, location } = await setup('/projects?q=官網&status=pending');
    flushList(http, 0);
    await harness.fixture.whenStable();
    const page = harness.routeDebugElement?.componentInstance as ProjectsPage;
    page.updateSelectedStatus({ target: { value: 'completed' } } as unknown as Event);
    http.expectOne((item) => item.params.get('status') === 'completed')
      .flush({ data: [project], meta: { total: 25, limit: 20, offset: 0 } });
    await harness.fixture.whenStable();
    expect(router.url).toContain('status=completed');

    location.back();
    await vi.waitFor(() => expect(page.selectedStatus).toBe('pending'));
    flushList(http, 0);
    await harness.fixture.whenStable();
    expect((harness.routeNativeElement?.querySelector('#project-status-filter') as HTMLSelectElement).value).toBe('pending');

    location.forward();
    await vi.waitFor(() => expect(page.selectedStatus).toBe('completed'));
    http.expectOne((item) => item.params.get('status') === 'completed')
      .flush({ data: [project], meta: { total: 25, limit: 20, offset: 0 } });
    await harness.fixture.whenStable();
    expect(router.url).toContain('status=completed');
    http.verify();
  });

  it('resets the page on search and replaces search-history entries while keeping the list visible', async () => {
    const { harness, router, http } = await setup();
    flushList(http, 20);
    await harness.fixture.whenStable();
    const element = harness.routeNativeElement as HTMLElement;
    const input = element.querySelector('#project-search') as HTMLInputElement;
    input.focus();
    input.value = '新';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await harness.fixture.whenStable();
    expect(element.textContent).toContain('官網改版');
    expect(document.activeElement).toBe(input);
    expect(router.url).not.toContain('page=');
    await new Promise((resolve) => setTimeout(resolve, 280));
    const request = http.expectOne((item) => item.params.get('q') === '新');
    expect(request.request.params.get('offset')).toBe('0');
    request.flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await harness.fixture.whenStable();
    expect(element.textContent).toContain('找不到符合條件的案件');
    http.verify();
  });

  it('clears only the search parameter while retaining the status filter', async () => {
    const { harness, router, http } = await setup();
    flushList(http, 20);
    await harness.fixture.whenStable();
    const page = harness.routeDebugElement?.componentInstance as ProjectsPage;
    page.clearSearch();
    const request = http.expectOne((item) => item.params.get('status') === 'pending' && item.params.get('q') === null);
    expect(request.request.params.get('offset')).toBe('0');
    request.flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects?status=pending');
    http.verify();
  });

  it('returns to a valid URL page when a filtered result set shrinks', async () => {
    const { harness, router, http } = await setup('/projects?q=官網&status=pending&page=3');
    const obsolete = http.expectOne((item) => item.params.get('offset') === '40');
    obsolete.flush({ data: [], meta: { total: 25, limit: 20, offset: 40 } });
    flushList(http, 20);
    await harness.fixture.whenStable();
    expect(router.url).toContain('page=2');
    expect((harness.routeDebugElement?.componentInstance as ProjectsPage).currentPage).toBe(2);
    http.verify();
  });

  it('returns an empty filtered result to page one without looping', async () => {
    const { harness, router, http } = await setup();
    http.expectOne((item) => item.params.get('offset') === '20')
      .flush({ data: [], meta: { total: 0, limit: 20, offset: 20 } });
    http.expectOne((item) => item.params.get('offset') === '0')
      .flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await harness.fixture.whenStable();
    expect(router.url).not.toContain('page=');
    expect(harness.routeNativeElement?.textContent).toContain('找不到符合條件的案件');
    http.verify();
  });
});
