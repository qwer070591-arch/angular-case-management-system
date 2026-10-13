import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardPage } from './dashboard';

describe('DashboardPage API metrics', () => {
  it('uses global stats rather than the first list page and keeps section errors independent', async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/projects/stats').flush({ data: { total: 30, pending: 5, inProgress: 10, completed: 12, cancelled: 3 } });
    http.expectOne((request) => request.url === '/api/projects' && request.params.get('status') === 'pending')
      .flush({ data: [], meta: { total: 5, limit: 5, offset: 0 } });
    http.expectOne((request) => request.url === '/api/projects' && !request.params.has('status'))
      .flush({ error: { code: 'SERVER_ERROR', message: '失敗' } }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(fixture.componentInstance.metrics?.completionRate).toBe(44);
    expect(fixture.componentInstance.metrics?.total).toBe(30);
    expect(fixture.nativeElement.textContent).toContain('案件服務暫時無法處理請求');
    http.verify();
  });
});
