import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { projectRequestError } from '../../api/project-api-error';
import { PROJECT_STATUS_LABELS, Project, ProjectStatus } from '../../project';
import { ProjectApiService, ProjectStats } from '../../services/project-api.service';
import { StatCardComponent } from '../../shared/stat-card/stat-card';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge';

@Component({
  imports: [DatePipe, RouterLink, StatCardComponent, StatusBadgeComponent],
  selector: 'app-dashboard-page',
  styleUrl: './dashboard.css',
  templateUrl: './dashboard.html',
})
export class DashboardPage {
  private readonly api = inject(ProjectApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly statusLabels = PROJECT_STATUS_LABELS;
  readonly stats = signal<ProjectStats | null>(null);
  readonly statsLoading = signal(true);
  readonly statsError = signal('');
  readonly pendingProjects = signal<Project[]>([]);
  readonly pendingLoading = signal(true);
  readonly pendingError = signal('');
  readonly recentlyUpdatedProjects = signal<Project[]>([]);
  readonly recentLoading = signal(true);
  readonly recentError = signal('');

  constructor() {
    this.loadStats();
    this.loadPending();
    this.loadRecent();
  }

  get metrics() {
    const stats = this.stats();
    if (!stats) return null;
    const denominator = stats.total - stats.cancelled;
    return { ...stats, completionRate: denominator <= 0 ? 0 : Math.round(stats.completed / denominator * 100) };
  }

  get statusOverview() {
    const metrics = this.metrics;
    if (!metrics) return [];
    return (['pending', 'in_progress', 'completed', 'cancelled'] as ProjectStatus[]).map((status) => {
      const count = status === 'in_progress' ? metrics.inProgress : metrics[status];
      return { status, count, percentage: metrics.total === 0 ? 0 : Math.round(count / metrics.total * 100) };
    });
  }

  loadStats(): void {
    this.statsLoading.set(true);
    this.statsError.set('');
    this.api.getProjectStats().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (stats) => { this.stats.set(stats); this.statsLoading.set(false); },
      error: (error: unknown) => { this.stats.set(null); this.statsLoading.set(false); this.statsError.set(projectRequestError(error, '無法載入案件統計。')); },
    });
  }

  loadPending(): void {
    this.pendingLoading.set(true);
    this.pendingError.set('');
    this.api.getProjects({ status: 'pending', limit: 5, offset: 0 }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => { this.pendingProjects.set(response.data); this.pendingLoading.set(false); },
      error: (error: unknown) => { this.pendingLoading.set(false); this.pendingError.set(projectRequestError(error, '無法載入待處理案件。')); },
    });
  }

  loadRecent(): void {
    this.recentLoading.set(true);
    this.recentError.set('');
    this.api.getProjects({ limit: 5, offset: 0 }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => { this.recentlyUpdatedProjects.set(response.data); this.recentLoading.set(false); },
      error: (error: unknown) => { this.recentLoading.set(false); this.recentError.set(projectRequestError(error, '無法載入最近更新案件。')); },
    });
  }
}
