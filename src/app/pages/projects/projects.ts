import { Component, DestroyRef, ElementRef, Injector, ViewChild, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, Subject, switchMap, timer } from 'rxjs';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, Project, ProjectStatus } from '../../project';
import { projectRequestError } from '../../api/project-api-error';
import { ProjectDeleteRequest, ProjectList } from '../../project-list/project-list';
import { PROJECTS_PAGE_SIZE, hasInvalidProjectListParams, projectListQueryParams, readProjectListRouteState } from '../../project-list/project-list-query';
import { ProjectApiService, ProjectListQuery } from '../../services/project-api.service';

@Component({
  imports: [ProjectList, RouterLink],
  selector: 'app-projects-page',
  styleUrl: './projects.css',
  templateUrl: './projects.html',
})
export class ProjectsPage {
  @ViewChild('deleteDialog') private deleteDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('cancelDeleteButton') private cancelDeleteButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;
  private deleteTrigger: HTMLButtonElement | null = null;
  private readonly api = inject(ProjectApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly requests = new Subject<{ query: ProjectListQuery; debounce: number }>();
  private hasRequested = false;

  readonly statusOptions = PROJECT_STATUSES;
  readonly statusLabels = PROJECT_STATUS_LABELS;
  readonly projects = signal<Project[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly hasLoaded = signal(false);
  readonly loadError = signal('');
  readonly pendingDelete = signal<Project | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal('');
  readonly pageSize = PROJECTS_PAGE_SIZE;

  searchKeyword = '';
  selectedStatus: ProjectStatus | 'all' = 'all';
  offset = 0;

  constructor() {
    this.requests.pipe(
      switchMap(({ query, debounce }) => (debounce ? timer(debounce) : of(0)).pipe(
        switchMap(() => this.api.getProjects(query)),
        map((response) => ({ response, error: '' })),
        catchError((error: unknown) => of({ response: null, error: projectRequestError(error, '無法載入案件列表。') })),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ response, error }) => {
      if (response && this.offset > 0 && this.offset >= response.meta.total) {
        this.offset = Math.max(0, Math.ceil(response.meta.total / PROJECTS_PAGE_SIZE) - 1) * PROJECTS_PAGE_SIZE;
        this.writeListUrl(true);
        this.loadProjects();
        return;
      }
      this.loading.set(false);
      this.refreshing.set(false);
      this.loadError.set(error);
      if (response) {
        this.hasLoaded.set(true);
        this.projects.set(response.data);
        this.total.set(response.meta.total);
      }
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const state = readProjectListRouteState(params);
      const changed = this.searchKeyword !== state.q || this.selectedStatus !== state.status || this.currentPage !== state.page;
      this.searchKeyword = state.q;
      this.selectedStatus = state.status;
      this.offset = (state.page - 1) * PROJECTS_PAGE_SIZE;
      if (hasInvalidProjectListParams(params, state)) this.writeListUrl(true);
      if (changed || !this.hasRequested) this.loadProjects();
    });
  }

  updateSearchKeyword(event: Event): void {
    this.searchKeyword = (event.target as HTMLInputElement).value;
    this.offset = 0;
    this.loadProjects(250);
    this.writeListUrl(true);
  }

  updateSelectedStatus(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedStatus = value === 'all' ? 'all' : value as ProjectStatus;
    this.offset = 0;
    this.loadProjects();
    this.writeListUrl();
  }

  clearSearch(): void {
    this.searchKeyword = '';
    this.offset = 0;
    this.loadProjects();
    this.writeListUrl();
  }

  clearFilters(): void {
    this.searchKeyword = '';
    this.selectedStatus = 'all';
    this.offset = 0;
    this.loadProjects();
    this.writeListUrl();
  }

  get hasActiveFilters(): boolean {
    return this.searchKeyword.trim().length > 0 || this.selectedStatus !== 'all';
  }

  get currentPage(): number {
    return Math.floor(this.offset / PROJECTS_PAGE_SIZE) + 1;
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total() / PROJECTS_PAGE_SIZE));
  }

  changePage(direction: -1 | 1): void {
    const next = this.offset + direction * PROJECTS_PAGE_SIZE;
    if (next < 0 || next >= this.total()) return;
    this.offset = next;
    this.loadProjects();
    this.writeListUrl();
  }

  loadProjects(debounce = 0): void {
    this.hasRequested = true;
    this.loading.set(!this.hasLoaded());
    this.refreshing.set(this.hasLoaded());
    this.loadError.set('');
    this.requests.next({
      query: {
        q: this.searchKeyword.trim() || undefined,
        status: this.selectedStatus === 'all' ? undefined : this.selectedStatus,
        limit: PROJECTS_PAGE_SIZE,
        offset: this.offset,
      },
      debounce,
    });
  }

  get listQueryParams() {
    return projectListQueryParams({ q: this.searchKeyword, status: this.selectedStatus, page: this.currentPage });
  }

  private writeListUrl(replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: null, status: null, page: null, ...this.listQueryParams },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  requestDelete({ id, trigger }: ProjectDeleteRequest): void {
    if (this.pendingDelete()) return;
    const project = this.projects().find((item) => item.id === id);
    if (!project) return;
    this.deleteTrigger = trigger;
    this.deleteError.set('');
    this.pendingDelete.set(project);
    afterNextRender(() => {
      this.deleteDialog?.nativeElement.showModal();
      this.cancelDeleteButton?.nativeElement.focus();
    }, { injector: this.injector });
  }

  cancelDelete(): void {
    if (this.deleting()) return;
    this.closeDeleteDialog();
  }

  onDeleteDialogCancel(event: Event): void {
    event.preventDefault();
    this.cancelDelete();
  }

  confirmDelete(): void {
    const project = this.pendingDelete();
    if (!project || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set('');
    this.api.deleteProject(project.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleting.set(false);
        this.closeDeleteDialog(true);
        this.loadProjects();
      },
      error: (error: unknown) => {
        this.deleting.set(false);
        this.deleteError.set(projectRequestError(error, '無法刪除案件，請重試。'));
      },
    });
  }

  private closeDeleteDialog(deleted = false): void {
    const dialog = this.deleteDialog?.nativeElement;
    if (dialog?.open) dialog.close();
    this.pendingDelete.set(null);
    this.deleteError.set('');
    const focusTarget = deleted || !this.deleteTrigger?.isConnected
      ? this.searchInput?.nativeElement
      : this.deleteTrigger;
    this.deleteTrigger = null;
    focusTarget?.focus();
  }
}
