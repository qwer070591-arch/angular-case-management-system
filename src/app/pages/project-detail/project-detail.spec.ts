import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Project, ProjectStatus } from '../../project';
import { ProjectDetailPage } from './project-detail';

const project = (status: ProjectStatus): Project => ({
  id: 3, projectCode: 'PRJ-2025-0001', name: '後台管理系統', description: null,
  status, priority: 'medium', startDate: null, dueDate: null,
  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z',
});

async function render(status: ProjectStatus) {
  const params = new BehaviorSubject(convertToParamMap({ id: '3' }));
  const queryParams = new BehaviorSubject(convertToParamMap({}));
  await TestBed.configureTestingModule({
    imports: [ProjectDetailPage],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params.asObservable(), queryParamMap: queryParams.asObservable(), snapshot: { paramMap: params.value, queryParamMap: queryParams.value } } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(ProjectDetailPage);
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/projects/3').flush({ data: project(status) });
  await fixture.whenStable();
  return { fixture, http, element: fixture.nativeElement as HTMLElement, params };
}

describe('ProjectDetailPage read-only view', () => {
  it.each<ProjectStatus>(['pending', 'in_progress', 'completed', 'cancelled'])(
    'shows the %s status and a clear management link without workflow actions', async (status) => {
      const { element, http } = await render(status);
      expect(element.querySelector('.project-detail-page__meta app-status-badge')).not.toBeNull();
      expect(element.querySelector('.project-detail-page__manage-link')?.getAttribute('href')).toBe('/projects/3/edit');
      expect(element.querySelector('.project-detail-page__manage-link')?.textContent).toContain('管理案件');
      expect(element.querySelector('.project-detail-page__workflow')).toBeNull();
      expect(Array.from(element.querySelectorAll('button')).some((button) =>
        /開始案件|完成案件|退回待處理|重新開啟案件|恢復案件|取消案件/.test(button.textContent ?? ''))).toBe(false);
      http.verify();
    },
  );

  it('shows not found for HTTP 404', async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectDetailPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: '99' })), queryParamMap: new BehaviorSubject(convertToParamMap({})), snapshot: { paramMap: convertToParamMap({ id: '99' }), queryParamMap: convertToParamMap({}) } } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProjectDetailPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/projects/99').flush({ error: { code: 'PROJECT_NOT_FOUND' } }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('找不到案件');
    http.verify();
  });

  it('offers retry after a network failure', async () => {
    const { fixture, http, element } = await render('pending');
    fixture.componentInstance.reloadProject();
    http.expectOne('/api/projects/3').error(new ProgressEvent('error'));
    await fixture.whenStable();
    const retry = Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.trim() === '重試');
    expect(retry).toBeTruthy();
    retry?.click();
    http.expectOne('/api/projects/3').flush({ data: project('pending') });
    await fixture.whenStable();
    expect(element.textContent).toContain('後台管理系統');
    http.verify();
  });

  it('cancels an older detail response when the route parameter changes', async () => {
    const { fixture, http, params } = await render('pending');
    params.next(convertToParamMap({ id: '5' }));
    const old = http.expectOne('/api/projects/5');
    params.next(convertToParamMap({ id: '6' }));
    expect(old.cancelled).toBe(true);
    http.expectOne('/api/projects/6').flush({ data: { ...project('completed'), id: 6, name: '最新案件' } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('最新案件');
    expect(fixture.nativeElement.textContent).not.toContain('找不到案件');
    http.verify({ ignoreCancelled: true });
  });
});
