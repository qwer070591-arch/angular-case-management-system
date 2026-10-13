import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Project } from '../../project';
import { ProjectsPage } from './projects';

const project: Project = {
  id: 8, projectCode: 'PRJ-2026-0008', name: '官網改版', description: null,
  status: 'pending', priority: 'medium', startDate: null, dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
};

async function setup() {
  await TestBed.configureTestingModule({
    imports: [ProjectsPage],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  }).compileComponents();
  const fixture = TestBed.createComponent(ProjectsPage);
  fixture.detectChanges();
  const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  const http = TestBed.inject(HttpTestingController);
  return { fixture, page: fixture.componentInstance, http, dialog };
}

const deleteRequest = () => ({ id: project.id, trigger: document.createElement('button') });

describe('ProjectsPage server list', () => {
  it('shows loading, server total, and status filter', async () => {
    const { fixture, page, http } = await setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入案件');
    const initial = http.expectOne((r) => r.url === '/api/projects' && r.params.get('limit') === '20');
    initial.flush({ data: [project], meta: { total: 25, limit: 20, offset: 0 } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('共 25 筆案件');
    page.updateSelectedStatus({ target: { value: 'pending' } } as unknown as Event);
    const filtered = http.expectOne((r) => r.params.get('status') === 'pending' && r.params.get('offset') === '0');
    filtered.flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    expect(page.total()).toBe(1);
    http.verify();
  });

  it('paginates using offset and resets it when the filter changes', async () => {
    const { page, http } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 25, limit: 20, offset: 0 } });
    page.changePage(1);
    const next = http.expectOne((r) => r.params.get('offset') === '20');
    next.flush({ data: [project], meta: { total: 25, limit: 20, offset: 20 } });
    page.updateSelectedStatus({ target: { value: 'completed' } } as unknown as Event);
    http.expectOne((r) => r.params.get('offset') === '0' && r.params.get('status') === 'completed')
      .flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    expect(page.offset).toBe(0);
    http.verify();
  });

  it('sends trimmed name search and ignores the superseded query', async () => {
    const { page, http } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    page.updateSearchKeyword({ target: { value: '舊' } } as unknown as Event);
    page.updateSearchKeyword({ target: { value: ' 官網 ' } } as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 280));
    const request = http.expectOne((r) => r.params.get('q') === '官網');
    expect(request.request.params.get('offset')).toBe('0');
    request.flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    expect(page.projects()[0].name).toBe('官網改版');
    http.verify();
  });

  it('keeps the current table and input focus while a debounced search replaces an in-flight request', async () => {
    const { fixture, page, http } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('#project-search') as HTMLInputElement;
    input.focus();
    input.value = '官';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(page.refreshing()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('更新中');
    expect(fixture.nativeElement.textContent).toContain('官網改版');
    expect(document.activeElement).toBe(input);
    await new Promise((resolve) => setTimeout(resolve, 280));
    const older = http.expectOne((r) => r.params.get('q') === '官');
    input.value = '官網';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(older.cancelled).toBe(true);
    expect(page.projects()).toEqual([project]);
    await new Promise((resolve) => setTimeout(resolve, 280));
    http.expectOne((r) => r.params.get('q') === '官網')
      .flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('找不到符合條件的案件');
    expect(page.refreshing()).toBe(false);
    http.verify({ ignoreCancelled: true });
  });

  it('retains the last successful list and a retry action after a refresh error', async () => {
    const { fixture, page, http } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    page.updateSelectedStatus({ target: { value: 'completed' } } as unknown as Event);
    http.expectOne((r) => r.params.get('status') === 'completed').flush({}, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect(page.refreshing()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('上次成功載入');
    expect(fixture.nativeElement.textContent).toContain('官網改版');
    page.loadProjects();
    http.expectOne((r) => r.params.get('status') === 'completed')
      .flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('找不到符合條件的案件');
    http.verify();
  });

  it('waits for the new response before showing an empty state when the last result was empty', async () => {
    const { fixture, page, http } = await setup();
    http.expectOne((r) => r.url === '/api/projects')
      .flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    page.updateSelectedStatus({ target: { value: 'pending' } } as unknown as Event);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('正在更新案件結果');
    expect(fixture.nativeElement.textContent).not.toContain('找不到符合條件的案件');
    http.expectOne((r) => r.params.get('status') === 'pending')
      .flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('找不到符合條件的案件');
    http.verify();
  });

  it('distinguishes HTTP errors from empty data and retries', async () => {
    const { fixture, page, http } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({}, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('重試');
    page.loadProjects();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('目前尚無案件');
    http.verify();
  });

  it('deletes only after confirmation and refreshes total on 204', async () => {
    const { fixture, page, http, dialog } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    page.requestDelete(deleteRequest());
    await fixture.whenStable();
    expect(dialog.open).toBe(true);
    http.expectNone('/api/projects/8');
    page.confirmDelete();
    const deletion = http.expectOne('/api/projects/8');
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    expect(page.total()).toBe(0);
    expect(page.pendingDelete()).toBeNull();
    expect(dialog.open).toBe(false);
    http.verify();
  });

  it('returns to the last valid page after deleting its only row', async () => {
    const { fixture, page, http } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 21, limit: 20, offset: 0 } });
    page.changePage(1);
    http.expectOne((r) => r.params.get('offset') === '20')
      .flush({ data: [project], meta: { total: 21, limit: 20, offset: 20 } });
    page.requestDelete(deleteRequest());
    await fixture.whenStable();
    page.confirmDelete();
    http.expectOne('/api/projects/8').flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne((r) => r.params.get('offset') === '20')
      .flush({ data: [], meta: { total: 20, limit: 20, offset: 20 } });
    http.expectOne((r) => r.params.get('offset') === '0')
      .flush({ data: [], meta: { total: 20, limit: 20, offset: 0 } });
    expect(page.offset).toBe(0);
    expect(page.total()).toBe(20);
    http.verify();
  });

  it('keeps the case visible if deletion fails', async () => {
    const { fixture, page, http, dialog } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    page.requestDelete(deleteRequest());
    await fixture.whenStable();
    page.confirmDelete();
    http.expectOne('/api/projects/8').flush({}, { status: 500, statusText: 'Error' });
    expect(page.projects()).toHaveLength(1);
    expect(page.pendingDelete()?.id).toBe(8);
    expect(page.deleteError()).toBeTruthy();
    expect(dialog.open).toBe(true);
    http.verify();
  });

  it('opens a modal with the case name, focuses cancel, and returns focus to the table trigger', async () => {
    const { fixture, page, http, dialog } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('.project-table-container .project-action--delete') as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    await fixture.whenStable();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('確認刪除案件');
    expect(dialog.textContent).toContain(project.name);
    expect(dialog.textContent).toContain('刪除後將不再顯示於案件列表');
    expect(document.activeElement?.textContent?.trim()).toBe('取消');
    page.cancelDelete();
    await fixture.whenStable();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    http.expectNone('/api/projects/8');
    http.verify();
  });

  it('closes on Escape without sending DELETE and returns focus to the card trigger', async () => {
    const { fixture, http, dialog } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    await fixture.whenStable();
    const cards = fixture.nativeElement.querySelector('.project-cards') as HTMLElement;
    cards.style.display = 'grid'; // Mirror the mobile breakpoint; desktop CSS hides card controls.
    const trigger = fixture.nativeElement.querySelector('.project-card__actions .project-action--delete') as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    await fixture.whenStable();
    const event = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(event);
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    http.expectNone('/api/projects/8');
    http.verify();
  });

  it('prevents duplicate DELETE and keeps the modal open while saving', async () => {
    const { fixture, page, http, dialog } = await setup();
    http.expectOne((r) => r.url === '/api/projects').flush({ data: [project], meta: { total: 1, limit: 20, offset: 0 } });
    page.requestDelete(deleteRequest());
    await fixture.whenStable();
    page.confirmDelete();
    page.confirmDelete();
    const requests = http.match('/api/projects/8');
    expect(requests).toHaveLength(1);
    await fixture.whenStable();
    expect(dialog.querySelectorAll('button:disabled')).toHaveLength(2);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(dialog.open).toBe(true);
    requests[0].flush({}, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('案件服務暫時無法處理請求');
    http.verify();
  });
});
