import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, QueryList, ViewChildren, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, catchError, map, of, switchMap } from 'rxjs';
import { projectRequestError } from '../../api/project-api-error';
import { projectListQueryParams, readProjectListRouteState } from '../../project-list/project-list-query';
import { PROJECT_PRIORITY_LABELS, Project } from '../../project';
import { ProjectApiService } from '../../services/project-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge';

type ProjectDetailTab = 'overview' | 'description';

@Component({
  imports: [DatePipe, RouterLink, StatusBadgeComponent],
  selector: 'app-project-detail-page',
  styleUrl: './project-detail.css',
  templateUrl: './project-detail.html',
})
export class ProjectDetailPage {
  @ViewChildren('detailTabButton') private readonly detailTabButtons!: QueryList<ElementRef<HTMLButtonElement>>;
  private readonly route = inject(ActivatedRoute);
  private readonly projectApi = inject(ProjectApiService);
  private readonly destroyRef = inject(DestroyRef);
  private reloadSubscription?: Subscription;

  readonly priorityLabels = PROJECT_PRIORITY_LABELS;
  readonly activeTab = signal<ProjectDetailTab>('overview');
  readonly project = signal<Project | undefined>(undefined);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly notFound = signal(false);
  readonly listQueryParams = signal(projectListQueryParams(readProjectListRouteState(this.route.snapshot.queryParamMap)));

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.listQueryParams.set(projectListQueryParams(readProjectListRouteState(params)));
    });
    this.route.paramMap.pipe(
      map((params) => this.parseProjectId(params.get('id'))),
      switchMap((id) => {
        this.reloadSubscription?.unsubscribe();
        this.loading.set(id !== null);
        this.notFound.set(id === null);
        this.loadError.set('');
        this.project.set(undefined);
        return id === null ? of(null) : this.projectApi.getProjectById(id).pipe(
          catchError((error: unknown) => {
            this.notFound.set(error instanceof HttpErrorResponse && error.status === 404);
            if (!this.notFound()) this.loadError.set(projectRequestError(error, '無法載入案件資訊。'));
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe((project) => {
      this.project.set(project ?? undefined);
      this.loading.set(false);
    });
  }

  reloadProject(): void {
    const id = this.parseProjectId(this.route.snapshot.paramMap.get('id'));
    if (id === null) return;
    this.loading.set(true);
    this.loadError.set('');
    this.reloadSubscription?.unsubscribe();
    this.reloadSubscription = this.projectApi.getProjectById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (project) => { this.project.set(project); this.loading.set(false); },
      error: (error: unknown) => {
        this.loading.set(false);
        this.notFound.set(error instanceof HttpErrorResponse && error.status === 404);
        if (this.notFound()) this.project.set(undefined);
        else this.loadError.set(projectRequestError(error, '無法載入案件資訊。'));
      },
    });
  }

  selectTab(tab: ProjectDetailTab): void {
    this.activeTab.set(tab);
  }

  onTabKeydown(event: KeyboardEvent, currentTab: ProjectDetailTab): void {
    const tabOrder: ProjectDetailTab[] = ['overview', 'description'];
    const currentIndex = tabOrder.indexOf(currentTab);
    let nextIndex: number | null = null;

    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
        break;
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % tabOrder.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabOrder.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.selectTab(tabOrder[nextIndex]);
    queueMicrotask(() => this.detailTabButtons.get(nextIndex)?.nativeElement.focus());
  }

  private parseProjectId(value: string | null): number | null {
    if (!value || !/^\d+$/.test(value)) {
      return null;
    }

    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
}
