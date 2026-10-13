import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Project } from '../../project';
import { NewProjectPage } from './new-project';

const saved: Project = {
  id: 12, projectCode: 'PRJ-2026-0012', name: '新案件', description: null,
  status: 'pending', priority: 'medium', startDate: null, dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

async function setup() {
  await TestBed.configureTestingModule({
    imports: [NewProjectPage],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  }).compileComponents();
  const fixture = TestBed.createComponent(NewProjectPage);
  fixture.detectChanges();
  return { fixture, page: fixture.componentInstance, http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) };
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

describe('NewProjectPage API create', () => {
  it('submits the latest unblurred name when Enter is pressed', async () => {
    const { fixture, http, router } = await setup();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const name = form.querySelector('#project-name') as HTMLInputElement;
    typeInto(name, '  即時案件  ');
    expect(document.activeElement).toBe(name);
    expect(fixture.componentInstance.nameControl.touched).toBe(false);
    submitWithEnter(form, name);
    const post = http.expectOne('/api/projects');
    expect(post.request.body.name).toBe('即時案件');
    post.flush({ data: saved }, { status: 201, statusText: 'Created' });
    http.verify();
  });

  it('submits the latest description without requiring a blur', async () => {
    const { fixture, http, router } = await setup();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    typeInto(form.querySelector('#project-name') as HTMLInputElement, '新案件');
    typeInto(form.querySelector('#project-description') as HTMLTextAreaElement, '立即更新的描述');
    expect(fixture.componentInstance.descriptionControl.touched).toBe(false);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const post = http.expectOne('/api/projects');
    expect(post.request.body.description).toBe('立即更新的描述');
    post.flush({ data: saved }, { status: 201, statusText: 'Created' });
    http.verify();
  });

  it('creates normally when the user clicks the submit button after typing', async () => {
    const { fixture, http, router } = await setup();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    typeInto(form.querySelector('#project-name') as HTMLInputElement, '滑鼠建立');
    (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    const post = http.expectOne('/api/projects');
    expect(post.request.body.name).toBe('滑鼠建立');
    post.flush({ data: saved }, { status: 201, statusText: 'Created' });
    http.verify();
  });

  it.each(['   ', 'x'.repeat(51)])('blocks invalid unblurred names on Enter: %s', async (value) => {
    const { fixture, http } = await setup();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const name = form.querySelector('#project-name') as HTMLInputElement;
    typeInto(name, value);
    submitWithEnter(form, name);
    fixture.detectChanges();
    http.expectNone('/api/projects');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(form.querySelector('#project-name-error')?.textContent).toContain(value.length > 50 ? '50' : '請輸入');
    http.verify();
  });

  it('does not show typing errors before blur, then shows the field error', async () => {
    const { fixture, http } = await setup();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const name = form.querySelector('#project-name') as HTMLInputElement;
    typeInto(name, '   ');
    fixture.detectChanges();
    expect(form.querySelector('#project-name-error')).toBeNull();
    expect(name.getAttribute('aria-invalid')).toBe('false');
    name.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(form.querySelector('#project-name-error')?.textContent).toContain('請輸入');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    http.verify();
  });

  it('blocks an overlong description typed immediately before submit', async () => {
    const { fixture, http } = await setup();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    typeInto(form.querySelector('#project-name') as HTMLInputElement, '有效名稱');
    typeInto(form.querySelector('#project-description') as HTMLTextAreaElement, 'x'.repeat(4001));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    http.expectNone('/api/projects');
    expect(form.querySelector('#project-description-error')?.textContent).toContain('4,000');
    http.verify();
  });

  it('blocks invalid form without POST', async () => {
    const { page, http } = await setup();
    page.onSubmit();
    expect(page.showNameError).toBe(true);
    http.expectNone('/api/projects');
    http.verify();
  });

  it('waits for the POST response, blocks duplicate submission, and navigates to returned ID', async () => {
    const { page, http, router } = await setup();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    page.nameControl.setValue(' 新案件 ');
    page.onSubmit();
    page.onSubmit();
    const requests = http.match('/api/projects');
    expect(requests).toHaveLength(1);
    expect(requests[0].request.method).toBe('POST');
    expect(requests[0].request.body).toMatchObject({ name: '新案件', priority: 'medium' });
    expect(requests[0].request.body.status).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
    requests[0].flush({ data: saved }, { status: 201, statusText: 'Created' });
    expect(navigate).toHaveBeenCalledWith(['/projects', 12]);
    http.verify();
  });

  it('maps 422 field errors near input and preserves data on network error', async () => {
    const { page, http } = await setup();
    page.nameControl.setValue('新案件');
    page.onSubmit();
    http.expectOne('/api/projects').flush({ error: { code: 'VALIDATION_ERROR', message: '欄位有誤', fieldErrors: {
      name: [{ code: 'INVALID_NAME', message: '名稱不合規' }],
    } } }, { status: 422, statusText: 'Unprocessable Entity' });
    expect(page.nameErrorMessage).toBe('名稱不合規');
    expect(page.showNameError).toBe(true);
    page.onSubmit();
    http.expectOne('/api/projects').error(new ProgressEvent('error'));
    expect(page.nameControl.value).toBe('新案件');
    expect(page.submissionError).toContain('無法連線');
    expect(page.submitting).toBe(false);
    http.verify();
  });
});
