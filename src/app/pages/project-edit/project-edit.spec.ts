import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Project, ProjectStatus } from '../../project';
import { ProjectEditPage } from './project-edit';

const project: Project = {
  id: 4, projectCode: 'PRJ-2026-0004', name: '編輯前', description: '描述',
  status: 'pending', priority: 'high', startDate: '2026-01-01', dueDate: '2026-02-01',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
};

async function setup() {
  const paramMap = convertToParamMap({ id: '4' });
  const queryParamMap = convertToParamMap({});
  await TestBed.configureTestingModule({
    imports: [ProjectEditPage],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(paramMap), queryParamMap: new BehaviorSubject(queryParamMap), snapshot: { paramMap, queryParamMap } } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(ProjectEditPage);
  const http = TestBed.inject(HttpTestingController);
  return { fixture, page: fixture.componentInstance, http, router: TestBed.inject(Router) };
}

async function renderWorkflow(status: ProjectStatus) {
  const result = await setup();
  result.http.expectOne('/api/projects/4').flush({ data: { ...project, status } });
  await result.fixture.whenStable();
  const element = result.fixture.nativeElement as HTMLElement;
  const button = (label: string) => Array.from(element.querySelectorAll('button'))
    .find((item) => item.textContent?.trim() === label);
  const badge = () => element.querySelector('.project-workflow app-status-badge')?.textContent?.trim();
  return { ...result, element, button, badge };
}

function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.focus();
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function submitWithEnter(form: HTMLFormElement, input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function mockLeaveDialog(fixture: { nativeElement: HTMLElement }): HTMLDialogElement {
  const dialog = fixture.nativeElement.querySelector('.project-edit-leave-dialog') as HTMLDialogElement;
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  return dialog;
}

describe('ProjectEditPage API update', () => {
  it('replaces an already-rendered loading state after GET 200', async () => {
    const { fixture, http } = await setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入案件資訊');
    http.expectOne('/api/projects/4').flush({ data: { ...project, startDate: null, dueDate: null } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('正在載入案件資訊');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    expect((fixture.nativeElement.querySelector('#project-edit-name') as HTMLInputElement).value).toBe('編輯前');
    expect((fixture.nativeElement.querySelector('#project-edit-description') as HTMLTextAreaElement).value).toBe('描述');
    expect((fixture.nativeElement.querySelector('#project-edit-priority') as HTMLSelectElement).value).toBe('high');
    expect((fixture.nativeElement.querySelector('#project-edit-start-date') as HTMLInputElement).value).toBe('');
    expect((fixture.nativeElement.querySelector('#project-edit-due-date') as HTMLInputElement).value).toBe('');
    http.verify();
  });
  it('waits for GET and PATCH success, then keeps the user on Manage with the saved data', async () => {
    const { fixture, page, http, router } = await setup();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    expect(page.loading()).toBe(true);
    expect(page.project()).toBeUndefined();
    http.expectOne('/api/projects/4').flush({ data: project });
    expect(page.projectForm.value.name).toBe('編輯前');
    page.nameControl.setValue('編輯後');
    page.onSubmit();
    const patch = http.expectOne('/api/projects/4');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toMatchObject({ name: '編輯後', startDate: '2026-01-01' });
    expect(patch.request.body.status).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
    patch.flush({ data: { ...project, name: '編輯後' } });
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(page.project()?.name).toBe('編輯後');
    expect(page.projectForm.dirty).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('案件資料已儲存');
    expect(fixture.nativeElement.querySelector('.project-workflow')).not.toBeNull();
    http.verify();
  });

  it('keeps user input on PATCH failure and maps 422 field errors', async () => {
    const { fixture, page, http } = await setup();
    fixture.detectChanges();
    http.expectOne('/api/projects/4').flush({ data: project });
    await fixture.whenStable();
    page.nameControl.setValue('保留輸入');
    page.onSubmit();
    http.expectOne('/api/projects/4').flush({ error: { code: 'VALIDATION_ERROR', message: '欄位有誤', fieldErrors: {
      name: [{ code: 'INVALID_NAME', message: '名稱不合規' }],
    } } }, { status: 422, statusText: 'Unprocessable Entity' });
    await fixture.whenStable();
    expect(page.projectForm.value.name).toBe('保留輸入');
    expect(page.nameErrorMessage).toBe('名稱不合規');
    expect(page.saving()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('名稱不合規');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    http.verify();
  });

  it('distinguishes GET 404 from network errors', async () => {
    const { fixture, page, http } = await setup();
    fixture.detectChanges();
    http.expectOne('/api/projects/4').flush({}, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('找不到案件');
    expect(page.loading()).toBe(false);
    expect(page.loadError()).toBe('');
    http.verify();
  });

  it('retries a failed GET without showing a false not-found page', async () => {
    const { fixture, page, http } = await setup();
    fixture.detectChanges();
    http.expectOne('/api/projects/4').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(page.loading()).toBe(false);
    expect(page.loadError()).toContain('無法連線');
    expect(fixture.nativeElement.textContent).not.toContain('找不到案件');
    expect(fixture.nativeElement.textContent).toContain('重試');
    page.reloadProject();
    http.expectOne('/api/projects/4').flush({ data: project });
    await fixture.whenStable();
    expect(page.projectForm.value.name).toBe('編輯前');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    http.verify();
  });

  it('does not overwrite unsaved form edits when retrying the same project', async () => {
    const { fixture, page, http } = await setup();
    fixture.detectChanges();
    http.expectOne('/api/projects/4').flush({ data: project });
    await fixture.whenStable();
    page.nameControl.setValue('尚未儲存的名稱');
    page.nameControl.markAsDirty();
    page.reloadProject();
    http.expectOne('/api/projects/4').flush({ data: { ...project, name: '伺服器的新名稱' } });
    await fixture.whenStable();
    expect(page.nameControl.value).toBe('尚未儲存的名稱');
    expect((fixture.nativeElement.querySelector('#project-edit-name') as HTMLInputElement).value).toBe('尚未儲存的名稱');
    http.verify();
  });
});

describe('ProjectEditPage save intents', () => {
  it('PATCHes the latest unblurred name on Enter and stays on Manage', async () => {
    const { fixture, page, http, router } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const name = form.querySelector('#project-edit-name') as HTMLInputElement;
    typeInto(name, 'Enter 更新');
    expect(document.activeElement).toBe(name);
    expect(page.nameControl.touched).toBe(false);
    submitWithEnter(form, name);
    const patch = http.expectOne('/api/projects/4');
    expect(patch.request.body.name).toBe('Enter 更新');
    expect(navigate).not.toHaveBeenCalled();
    patch.flush({ data: { ...project, name: 'Enter 更新' } });
    await fixture.whenStable();
    expect(page.project()?.name).toBe('Enter 更新');
    expect(navigate).not.toHaveBeenCalled();
    http.verify();
  });

  it('uses the latest DOM input when the main save button is clicked', async () => {
    const { fixture, http, router } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    typeInto(form.querySelector('#project-edit-name') as HTMLInputElement, '滑鼠儲存');
    (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    const patch = http.expectOne('/api/projects/4');
    expect(patch.request.body.name).toBe('滑鼠儲存');
    patch.flush({ data: { ...project, name: '滑鼠儲存' } });
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('案件資料已儲存');
    http.verify();
  });

  it('PATCHes the latest unblurred description via the return button, then navigates', async () => {
    const { fixture, http, router } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    typeInto(form.querySelector('#project-edit-description') as HTMLTextAreaElement, '新的描述');
    (form.querySelector('button[type="button"]') as HTMLButtonElement).click();
    const patch = http.expectOne('/api/projects/4');
    expect(patch.request.body.description).toBe('新的描述');
    expect(navigate).not.toHaveBeenCalled();
    patch.flush({ data: { ...project, description: '新的描述' } });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/projects'], { queryParams: {} });
    http.verify();
  });

  it('keeps unblurred input and field errors after a failed return PATCH', async () => {
    const { fixture, http, router } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const name = form.querySelector('#project-edit-name') as HTMLInputElement;
    typeInto(name, '保留輸入');
    (form.querySelector('button[type="button"]') as HTMLButtonElement).click();
    http.expectOne('/api/projects/4').flush({ error: {
      code: 'VALIDATION_ERROR', message: '欄位有誤',
      fieldErrors: { name: [{ code: 'INVALID_NAME', message: '名稱不合規' }] },
    } }, { status: 422, statusText: 'Unprocessable Entity' });
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(name.value).toBe('保留輸入');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(form.querySelector('#project-edit-name-error')?.textContent).toContain('名稱不合規');
    http.verify();
  });

  it.each(['   ', 'x'.repeat(51)])('blocks invalid unblurred names on Enter: %s', async (value) => {
    const { fixture, http } = await renderWorkflow('pending');
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const name = form.querySelector('#project-edit-name') as HTMLInputElement;
    typeInto(name, value);
    submitWithEnter(form, name);
    fixture.detectChanges();
    http.expectNone('/api/projects/4');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(form.querySelector('#project-edit-name-error')?.textContent).toContain(value.length > 50 ? '50' : '請輸入');
    http.verify();
  });

  it('keeps form submission on Manage and uses a separate non-submit return button', async () => {
    const { fixture, page, http, router } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const buttons = Array.from(form.querySelectorAll('button'));
    expect(buttons.find((button) => button.textContent?.trim() === '儲存並返回列表')?.type).toBe('button');
    expect(buttons.find((button) => button.textContent?.trim() === '儲存資料變更')?.type).toBe('submit');

    page.nameControl.setValue('一般儲存');
    page.nameControl.markAsDirty();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const patch = http.expectOne('/api/projects/4');
    expect(patch.request.method).toBe('PATCH');
    patch.flush({ data: { ...project, name: '一般儲存' } });
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(page.project()?.name).toBe('一般儲存');
    expect(page.projectForm.pristine).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('案件資料已儲存');
    http.verify();
  });

  it('navigates only after a successful PATCH when returning with changes', async () => {
    const { fixture, page, http, router, button } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    page.nameControl.setValue('儲存後返回');
    page.nameControl.markAsDirty();
    button('儲存並返回列表')?.click();
    const patch = http.expectOne('/api/projects/4');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body.name).toBe('儲存後返回');
    expect(navigate).not.toHaveBeenCalled();
    patch.flush({ data: { ...project, name: '伺服器回傳名稱' } });
    await fixture.whenStable();
    expect(page.project()?.name).toBe('伺服器回傳名稱');
    expect(page.nameControl.value).toBe('伺服器回傳名稱');
    expect(page.projectForm.pristine).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/projects'], { queryParams: {} });
    http.verify();
  });

  it('does not navigate on PATCH failure and keeps input plus 422 field errors', async () => {
    const { fixture, page, http, router, button } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    page.nameControl.setValue('保留未儲存名稱');
    page.nameControl.markAsDirty();
    button('儲存並返回列表')?.click();
    http.expectOne('/api/projects/4').flush({ error: {
      code: 'VALIDATION_ERROR', message: '欄位有誤',
      fieldErrors: { name: [{ code: 'INVALID_NAME', message: '名稱不合規' }] },
    } }, { status: 422, statusText: 'Unprocessable Entity' });
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(page.nameControl.value).toBe('保留未儲存名稱');
    expect(page.projectForm.dirty).toBe(true);
    expect(page.nameErrorMessage).toBe('名稱不合規');
    expect(page.saving()).toBe(false);
    http.verify();
  });

  it('keeps the unsaved form and stays on Manage after a network PATCH failure', async () => {
    const { fixture, page, http, router } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    page.descriptionControl.setValue('斷線後仍保留');
    page.descriptionControl.markAsDirty();
    page.saveAndReturn();
    http.expectOne('/api/projects/4').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(page.descriptionControl.value).toBe('斷線後仍保留');
    expect(page.projectForm.dirty).toBe(true);
    expect(page.submissionError()).toContain('無法連線');
    http.verify();
  });

  it.each(['stay', 'return'] as const)('uses the same validation for %s', async (intent) => {
    const { page, http, router } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    page.nameControl.setValue('   ');
    page.nameControl.markAsDirty();
    if (intent === 'stay') page.onSubmit();
    else page.saveAndReturn();
    expect(page.submitted).toBe(true);
    expect(page.showNameError).toBe(true);
    expect(page.nameControl.touched).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    http.expectNone('/api/projects/4');
    http.verify();
  });

  it('blocks repeated submits while PATCH is pending', async () => {
    const { fixture, page, http, router, button } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    page.nameControl.setValue('只送一次');
    page.nameControl.markAsDirty();
    button('儲存並返回列表')?.click();
    const patch = http.expectOne('/api/projects/4');
    page.saveAndReturn();
    page.onSubmit();
    await fixture.whenStable();
    expect(button('儲存並返回列表')?.disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('.project-edit-form-card__submit') as HTMLButtonElement).disabled).toBe(true);
    http.expectNone('/api/projects/4');
    patch.flush({ data: { ...project, name: '只送一次' } });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledOnce();
    http.verify();
  });

  it('returns directly without PATCH when the form has no unsaved changes', async () => {
    const { fixture, http, router, button } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    button('儲存並返回列表')?.click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/projects'], { queryParams: {} });
    http.expectNone('/api/projects/4');
    http.verify();
  });

  it('ignores repeated return clicks while navigation is pending', async () => {
    const { fixture, page, http, router } = await renderWorkflow('pending');
    let finishNavigation!: (value: boolean) => void;
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => new Promise<boolean>((resolve) => {
      finishNavigation = resolve;
    }));
    page.saveAndReturn();
    page.saveAndReturn();
    expect(navigate).toHaveBeenCalledOnce();
    expect(page.navigating()).toBe(true);
    http.expectNone('/api/projects/4');
    finishNavigation(true);
    await fixture.whenStable();
    expect(page.navigating()).toBe(false);
    http.verify();
  });
});

describe('ProjectEditPage unsaved navigation', () => {
  it('starts pristine after the initial GET and leaves without a dialog', async () => {
    const { fixture, page, http } = await renderWorkflow('pending');
    const dialog = mockLeaveDialog(fixture);
    expect(page.projectForm.pristine).toBe(true);
    expect(page.canLeave()).toBe(true);
    expect(dialog.open).toBe(false);
    http.verify();
  });

  it('asks on Cancel, keeps input on continue editing, and restores focus', async () => {
    const { fixture, page, http } = await renderWorkflow('pending');
    const dialog = mockLeaveDialog(fixture);
    const name = fixture.nativeElement.querySelector('#project-edit-name') as HTMLInputElement;
    typeInto(name, '未儲存名稱');
    const decision = page.canLeave();
    await fixture.whenStable();
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector('button'));
    (dialog.querySelector('button') as HTMLButtonElement).click();
    expect(await decision).toBe(false);
    await fixture.whenStable();
    expect(dialog.open).toBe(false);
    expect(name.value).toBe('未儲存名稱');
    expect(page.projectForm.dirty).toBe(true);
    expect(document.activeElement).toBe(name);
    http.expectNone('/api/projects/4');
    http.verify();
  });

  it('leaves without PATCH when discarding changes', async () => {
    const { fixture, page, http } = await renderWorkflow('pending');
    const dialog = mockLeaveDialog(fixture);
    typeInto(fixture.nativeElement.querySelector('#project-edit-name') as HTMLInputElement, '不要儲存');
    const decision = page.canLeave();
    await fixture.whenStable();
    (dialog.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(await decision).toBe(true);
    expect(dialog.open).toBe(false);
    http.expectNone('/api/projects/4');
    http.verify();
  });

  it('treats Escape as continue editing', async () => {
    const { fixture, page, http } = await renderWorkflow('pending');
    const dialog = mockLeaveDialog(fixture);
    typeInto(fixture.nativeElement.querySelector('#project-edit-name') as HTMLInputElement, '保留內容');
    const decision = page.canLeave();
    await fixture.whenStable();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(await decision).toBe(false);
    expect(page.nameControl.value).toBe('保留內容');
    http.verify();
  });

  it('blocks leaving while PATCH is pending, then allows leaving after success', async () => {
    const { fixture, page, http } = await renderWorkflow('pending');
    const dialog = mockLeaveDialog(fixture);
    typeInto(fixture.nativeElement.querySelector('#project-edit-name') as HTMLInputElement, '已儲存');
    page.onSubmit();
    const patch = http.expectOne('/api/projects/4');
    expect(page.saving()).toBe(true);
    expect(page.canLeave()).toBe(false);
    expect(dialog.open).toBe(false);
    patch.flush({ data: { ...project, name: '已儲存' } });
    await fixture.whenStable();
    expect(page.projectForm.pristine).toBe(true);
    expect(page.canLeave()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('案件資料已儲存');
    http.verify();
  });

  it('retains dirty input and the leave prompt after PATCH failure', async () => {
    const { fixture, page, http } = await renderWorkflow('pending');
    const dialog = mockLeaveDialog(fixture);
    typeInto(fixture.nativeElement.querySelector('#project-edit-name') as HTMLInputElement, '失敗仍保留');
    page.onSubmit();
    http.expectOne('/api/projects/4').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(page.projectForm.dirty).toBe(true);
    expect(page.nameControl.value).toBe('失敗仍保留');
    const decision = page.canLeave();
    await fixture.whenStable();
    expect(dialog.open).toBe(true);
    (dialog.querySelector('button') as HTMLButtonElement).click();
    expect(await decision).toBe(false);
    http.verify();
  });

  it('prompts on beforeunload only for dirty or in-flight edits', async () => {
    const { fixture, page, http } = await renderWorkflow('pending');
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    typeInto(fixture.nativeElement.querySelector('#project-edit-name') as HTMLInputElement, '未儲存');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    page.onSubmit();
    const pending = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pending);
    expect(pending.defaultPrevented).toBe(true);
    http.expectOne('/api/projects/4').flush({ data: { ...project, name: '未儲存' } });
    await fixture.whenStable();
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
    http.verify();
  });
});

describe('ProjectEditPage progress management', () => {
  it.each([
    ['pending', '待處理', ['開始案件', '取消案件'], ['完成案件', '退回待處理', '重新開啟案件', '恢復案件']],
    ['in_progress', '進行中', ['完成案件', '退回待處理', '取消案件'], ['開始案件', '重新開啟案件', '恢復案件']],
    ['completed', '已完成', ['重新開啟案件'], ['開始案件', '完成案件', '取消案件', '恢復案件']],
    ['cancelled', '已取消', ['恢復案件'], ['開始案件', '完成案件', '取消案件', '重新開啟案件']],
  ] as const)('shows only legal actions for %s', async (status, label, visible, hidden) => {
    const { element, button, badge, http } = await renderWorkflow(status);
    expect(badge()).toBe(label);
    expect(element.querySelector('.project-edit-page__code')?.textContent).toContain(project.projectCode);
    expect(element.textContent?.split(project.projectCode).length - 1).toBe(1);
    expect(element.querySelector('h1')?.textContent).toBe('管理案件');
    expect(element.querySelector('.project-edit-page__back-link')?.getAttribute('href')).toBe('/projects');
    expect(element.querySelector('.project-edit-form-card__title')?.textContent).toContain('案件基本資料');
    for (const action of visible) expect(button(action)).toBeTruthy();
    for (const action of hidden) expect(button(action)).toBeUndefined();
    http.verify();
  });

  it('uses the shared card and button hierarchy for progress and metadata', async () => {
    const { element, button, http } = await renderWorkflow('in_progress');
    expect(element.querySelector('.project-workflow')).not.toBeNull();
    expect(element.querySelector('.project-edit-form-card')).not.toBeNull();
    expect(button('完成案件')?.classList.contains('project-workflow__action--primary')).toBe(true);
    expect(button('退回待處理')?.classList.contains('project-workflow__action--recovery')).toBe(true);
    expect(button('取消案件')?.classList.contains('project-workflow__action--danger')).toBe(true);
    http.verify();
  });

  it('updates the badge, actions, and form from the server response after a transition', async () => {
    const { fixture, page, http, button, badge, element } = await renderWorkflow('pending');
    button('開始案件')?.click();
    const request = http.expectOne('/api/projects/4/transitions');
    expect(request.request.body).toEqual({ toStatus: 'in_progress' });
    await fixture.whenStable();
    expect(button('開始案件')?.disabled).toBe(true);
    button('開始案件')?.click();
    http.expectNone('/api/projects/4/transitions');
    request.flush({ data: { ...project, status: 'in_progress', name: '後端更新名稱' } });
    await fixture.whenStable();
    expect(badge()).toBe('進行中');
    expect(button('完成案件')).toBeTruthy();
    expect(button('退回待處理')).toBeTruthy();
    expect(page.nameControl.value).toBe('後端更新名稱');
    expect(element.querySelector('.project-edit-page__project-reference')?.textContent).toContain('後端更新名稱');
    http.verify();
  });

  it('keeps progress and metadata PATCH as separate requests', async () => {
    const { fixture, page, http, button, router } = await renderWorkflow('in_progress');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    button('完成案件')?.click();
    const transition = http.expectOne('/api/projects/4/transitions');
    expect(transition.request.body).toEqual({ toStatus: 'completed' });
    page.onSubmit();
    http.expectNone('/api/projects/4');
    transition.flush({ data: { ...project, status: 'completed' } });
    await fixture.whenStable();
    expect(button('重新開啟案件')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    page.nameControl.setValue('更新名稱');
    page.onSubmit();
    const patch = http.expectOne('/api/projects/4');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body.status).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
    patch.flush({ data: { ...project, status: 'completed', name: '更新名稱' } });
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(page.project()?.name).toBe('更新名稱');
    expect(button('重新開啟案件')).toBeTruthy();
    http.verify();
  });

  it('can save metadata and then complete the project without leaving Manage', async () => {
    const { fixture, page, http, button, badge, router } = await renderWorkflow('in_progress');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    page.nameControl.setValue('已更新名稱');
    page.nameControl.markAsDirty();
    page.onSubmit();
    http.expectOne('/api/projects/4').flush({ data: { ...project, status: 'in_progress', name: '已更新名稱' } });
    await fixture.whenStable();
    expect(page.projectForm.dirty).toBe(false);
    expect(button('完成案件')).toBeTruthy();
    button('完成案件')?.click();
    const transition = http.expectOne('/api/projects/4/transitions');
    expect(transition.request.body).toEqual({ toStatus: 'completed' });
    transition.flush({ data: { ...project, status: 'completed', name: '已更新名稱' } });
    await fixture.whenStable();
    expect(badge()).toBe('已完成');
    expect(button('完成案件')).toBeUndefined();
    expect(button('重新開啟案件')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    page.reloadProject();
    http.expectOne('/api/projects/4').flush({ data: { ...project, status: 'completed', name: '已更新名稱' } });
    await fixture.whenStable();
    expect(badge()).toBe('已完成');
    http.verify();
  });

  it('moves an in-progress project back to pending without bypassing the transition API', async () => {
    const { fixture, http, button, badge } = await renderWorkflow('in_progress');
    button('退回待處理')?.click();
    const request = http.expectOne('/api/projects/4/transitions');
    expect(request.request.body).toEqual({ toStatus: 'pending' });
    request.flush({ data: { ...project, status: 'pending' } });
    await fixture.whenStable();
    expect(badge()).toBe('待處理');
    expect(button('開始案件')).toBeTruthy();
    http.verify();
  });

  it('blocks a transition while form edits are unsaved and can discard them', async () => {
    const { fixture, page, http, button, element } = await renderWorkflow('pending');
    page.nameControl.setValue('未儲存內容');
    page.nameControl.markAsDirty();
    await fixture.whenStable();
    button('開始案件')?.click();
    await fixture.whenStable();
    http.expectNone('/api/projects/4/transitions');
    expect(element.textContent).toContain('請先儲存或放棄目前修改，再變更案件進度。');
    expect(page.nameControl.value).toBe('未儲存內容');
    button('放棄修改')?.click();
    await fixture.whenStable();
    expect(page.projectForm.dirty).toBe(false);
    expect(page.nameControl.value).toBe('編輯前');
    button('開始案件')?.click();
    http.expectOne('/api/projects/4/transitions').flush({ data: { ...project, status: 'in_progress' } });
    http.verify();
  });

  it('blocks confirmation actions with unsaved edits', async () => {
    const { fixture, page, http, button } = await renderWorkflow('completed');
    page.descriptionControl.setValue('未儲存描述');
    page.descriptionControl.markAsDirty();
    button('重新開啟案件')?.click();
    await fixture.whenStable();
    expect(button('確認重新開啟')).toBeUndefined();
    expect(page.descriptionControl.value).toBe('未儲存描述');
    http.expectNone('/api/projects/4/transitions');
    http.verify();
  });

  it('requires confirmation for cancellation and restores trigger focus on return', async () => {
    const { fixture, http, button, element } = await renderWorkflow('pending');
    button('取消案件')?.click();
    await fixture.whenStable();
    expect(element.querySelector('.project-workflow__confirmation h3')?.textContent).toContain('取消此案件');
    expect(document.activeElement).toBe(button('確認取消'));
    http.expectNone('/api/projects/4/transitions');
    button('返回')?.click();
    await fixture.whenStable();
    expect(button('確認取消')).toBeUndefined();
    expect(document.activeElement).toBe(button('取消案件'));
    button('取消案件')?.click();
    await fixture.whenStable();
    button('確認取消')?.click();
    const request = http.expectOne('/api/projects/4/transitions');
    expect(request.request.body).toEqual({ toStatus: 'cancelled' });
    request.flush({ data: { ...project, status: 'cancelled' } });
    await fixture.whenStable();
    expect(button('恢復案件')).toBeTruthy();
    http.verify();
  });

  it('allows Escape to dismiss confirmation without sending a transition', async () => {
    const { fixture, http, button, element } = await renderWorkflow('cancelled');
    button('恢復案件')?.click();
    await fixture.whenStable();
    button('確認恢復')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(element.querySelector('.project-workflow__confirmation')).toBeNull();
    expect(document.activeElement).toBe(button('恢復案件'));
    http.expectNone('/api/projects/4/transitions');
    http.verify();
  });

  it('does not overwrite a user edit made while a transition is in flight', async () => {
    const { fixture, page, http, button, badge } = await renderWorkflow('pending');
    button('開始案件')?.click();
    const request = http.expectOne('/api/projects/4/transitions');
    page.nameControl.setValue('尚未儲存的名稱');
    page.nameControl.markAsDirty();
    request.flush({ data: { ...project, status: 'in_progress', name: '伺服器名稱' } });
    await fixture.whenStable();
    expect(badge()).toBe('進行中');
    expect(page.nameControl.value).toBe('尚未儲存的名稱');
    expect(page.project()?.name).toBe('伺服器名稱');
    http.verify();
  });

  it.each([
    ['completed', '重新開啟案件', '確認重新開啟', 'in_progress'],
    ['cancelled', '恢復案件', '確認恢復', 'pending'],
  ] as const)('confirms %s recovery before the API call', async (status, trigger, confirm, nextStatus) => {
    const { fixture, http, button, badge } = await renderWorkflow(status);
    button(trigger)?.click();
    await fixture.whenStable();
    http.expectNone('/api/projects/4/transitions');
    button(confirm)?.click();
    const request = http.expectOne('/api/projects/4/transitions');
    expect(request.request.body).toEqual({ toStatus: nextStatus });
    request.flush({ data: { ...project, status: nextStatus } });
    await fixture.whenStable();
    expect(badge()).toBe(nextStatus === 'pending' ? '待處理' : '進行中');
    http.verify();
  });

  it('keeps the old state after a failed transition and reloads after 409', async () => {
    const { fixture, http, button, badge, element } = await renderWorkflow('pending');
    button('開始案件')?.click();
    http.expectOne('/api/projects/4/transitions').flush(
      { error: { code: 'INVALID_TRANSITION', message: '狀態衝突' } },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    expect(badge()).toBe('待處理');
    expect(element.textContent).toContain('案件狀態可能已被其他人變更');
    button('重新取得案件資訊')?.click();
    http.expectOne('/api/projects/4').flush({ data: { ...project, status: 'completed' } });
    await fixture.whenStable();
    expect(badge()).toBe('已完成');
    expect(button('重新開啟案件')).toBeTruthy();
    http.verify();
  });

  it('shows a transition failure without false success or navigation', async () => {
    const { fixture, http, button, badge, router, element } = await renderWorkflow('pending');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    button('開始案件')?.click();
    http.expectOne('/api/projects/4/transitions').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(badge()).toBe('待處理');
    expect(element.textContent).toContain('無法連線');
    expect(navigate).not.toHaveBeenCalled();
    http.verify();
  });
});
