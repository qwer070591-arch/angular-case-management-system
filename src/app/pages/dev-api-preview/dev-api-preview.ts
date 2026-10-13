import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { Project } from '../../project';
import { ProjectApiService, ProjectListResponse } from '../../services/project-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge';

type RequestState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; data: T }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-dev-api-preview-page',
  imports: [StatusBadgeComponent],
  templateUrl: './dev-api-preview.html',
  styleUrl: './dev-api-preview.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevApiPreviewPage implements OnInit {
  private readonly api = inject(ProjectApiService);
  private readonly destroyRef = inject(DestroyRef);
  private listSubscription?: Subscription;
  private detailSubscription?: Subscription;
  readonly lastRequestedId = signal<number | null>(null);

  readonly listState = signal<RequestState<ProjectListResponse>>({ kind: 'idle' });
  readonly detailState = signal<RequestState<Project>>({ kind: 'idle' });
  readonly requestedId = signal('');

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.listSubscription?.unsubscribe();
    this.listState.set({ kind: 'loading' });
    this.listSubscription = this.api.getProjects()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.listState.set({ kind: 'success', data: response }),
        error: (error: unknown) => this.listState.set({ kind: 'error', message: this.errorMessage(error) }),
      });
  }

  loadProject(rawId: string): void {
    this.requestedId.set(rawId);
    const id = Number(rawId.trim());
    if (!Number.isSafeInteger(id) || id <= 0) {
      this.detailSubscription?.unsubscribe();
      this.lastRequestedId.set(null);
      this.detailState.set({ kind: 'error', message: '請輸入有效的正整數案件 ID。' });
      return;
    }

    this.lastRequestedId.set(id);
    this.fetchProject(id);
  }

  retryProject(): void {
    const id = this.lastRequestedId();
    if (id !== null) {
      this.fetchProject(id);
    }
  }

  private fetchProject(id: number): void {
    this.detailSubscription?.unsubscribe();
    this.detailState.set({ kind: 'loading' });
    this.detailSubscription = this.api.getProjectById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (project) => this.detailState.set({ kind: 'success', data: project }),
        error: (error: unknown) => this.detailState.set({ kind: 'error', message: this.errorMessage(error) }),
      });
  }

  private errorMessage(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'API 回應格式不正確，請稍後重試。';
    }

    if (error.status === 0) {
      return '無法連線至 Backend。請確認伺服器已啟動後重試。';
    }
    if (error.status === 400) {
      return '請求參數不正確（HTTP 400）。';
    }
    if (error.status === 404) {
      return '找不到指定案件（HTTP 404）。';
    }
    if (error.status >= 500) {
      return `Backend 暫時無法處理請求（HTTP ${error.status}）。`;
    }
    return `API 請求失敗（HTTP ${error.status}）。`;
  }
}
