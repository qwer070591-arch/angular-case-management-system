import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DevApiPreviewPage } from './dev-api-preview';

const apiUrl = '/api/projects';

describe('DevApiPreviewPage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DevApiPreviewPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('distinguishes loading from an empty API list', async () => {
    const fixture = TestBed.createComponent(DevApiPreviewPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在讀取案件列表');

    http.expectOne(apiUrl).flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('API 回傳空列表');
  });

  it('shows a network error and retries the list', async () => {
    const fixture = TestBed.createComponent(DevApiPreviewPage);
    fixture.detectChanges();
    http.expectOne(apiUrl).error(new ProgressEvent('error'));
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('無法連線至 Backend');
    const retry = Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.trim() === '重試列表');
    retry?.click();
    http.expectOne(apiUrl).flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    await fixture.whenStable();
    expect(element.textContent).toContain('API 回傳空列表');
  });

  it('shows HTTP 404 for an unknown ID and can retry the same detail request', async () => {
    const fixture = TestBed.createComponent(DevApiPreviewPage);
    fixture.detectChanges();
    http.expectOne(apiUrl).flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    fixture.componentInstance.loadProject('999999');
    http.expectOne(`${apiUrl}/999999`).flush(null, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('HTTP 404');
    const retry = Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.trim() === '重試單筆');
    retry?.click();
    http.expectOne(`${apiUrl}/999999`).flush(null, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('HTTP 404');
  });

  it.each([400, 500])('shows an HTTP %i error without crashing', async (status) => {
    const fixture = TestBed.createComponent(DevApiPreviewPage);
    fixture.detectChanges();
    http.expectOne(apiUrl).flush(null, { status, statusText: 'Test error' });
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain(`HTTP ${status}`);
  });
});
