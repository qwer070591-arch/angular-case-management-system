import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, HostListener, Injector, ViewChild, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, catchError, map, of, switchMap } from 'rxjs';
import { projectFieldErrors, projectRequestError } from '../../api/project-api-error';
import { projectListQueryParams, readProjectListRouteState } from '../../project-list/project-list-query';
import {
  PROJECT_PRIORITIES,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  Project,
  ProjectPriority,
  ProjectStatus,
  canTransitionProjectStatus,
} from '../../project';
import { ProjectApiService } from '../../services/project-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge';

type ProjectConfirmation = 'cancel' | 'reopen' | 'restore';
type SaveIntent = 'stay' | 'return';

const CONFIRMATION_CONTENT: Record<ProjectConfirmation, { title: string; confirmLabel: string; nextStatus: ProjectStatus }> = {
  cancel: { title: '確定要取消此案件嗎？', confirmLabel: '確認取消', nextStatus: 'cancelled' },
  reopen: { title: '確定要重新開啟此案件嗎？', confirmLabel: '確認重新開啟', nextStatus: 'in_progress' },
  restore: { title: '確定要恢復此案件嗎？', confirmLabel: '確認恢復', nextStatus: 'pending' },
};

const nonWhitespaceValidator: ValidatorFn = (control): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? control.value.trim() : '';

  return value.length > 0 ? null : { whitespace: true };
};

const priorityValidator: ValidatorFn = (control): ValidationErrors | null => {
  return PROJECT_PRIORITIES.includes(control.value as ProjectPriority) ? null : { priority: true };
};

const dateRangeValidator: ValidatorFn = (control): ValidationErrors | null => {
  const startDate = control.get('startDate')?.value as string | null;
  const dueDate = control.get('dueDate')?.value as string | null;

  return startDate && dueDate && dueDate < startDate ? { dateRange: true } : null;
};

@Component({
  imports: [ReactiveFormsModule, RouterLink, StatusBadgeComponent],
  selector: 'app-project-edit-page',
  styleUrl: './project-edit.css',
  templateUrl: './project-edit.html',
})
export class ProjectEditPage {
  @ViewChild('confirmTransitionButton') private confirmTransitionButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('confirmationTriggerButton') private confirmationTriggerButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('reloadWorkflowButton') private reloadWorkflowButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('projectTitle') private projectTitle?: ElementRef<HTMLHeadingElement>;
  @ViewChild('projectNameInput') projectNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('projectDescriptionInput') projectDescriptionInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('projectPrioritySelect') projectPrioritySelect?: ElementRef<HTMLSelectElement>;
  @ViewChild('projectStartDateInput') projectStartDateInput?: ElementRef<HTMLInputElement>;
  @ViewChild('projectDueDateInput') projectDueDateInput?: ElementRef<HTMLInputElement>;
  @ViewChild('leaveDialog') private leaveDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('stayOnPageButton') private stayOnPageButton?: ElementRef<HTMLButtonElement>;

  readonly priorityOptions = PROJECT_PRIORITIES;
  readonly priorityLabels = PROJECT_PRIORITY_LABELS;
  readonly confirmationContent = CONFIRMATION_CONTENT;
  readonly canTransition = canTransitionProjectStatus;

  readonly projectForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonWhitespaceValidator, Validators.maxLength(50)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(4000)],
    }),
    priority: new FormControl<ProjectPriority>('medium', {
      nonNullable: true,
      validators: [Validators.required, priorityValidator],
    }),
    startDate: new FormControl<string | null>(null),
    dueDate: new FormControl<string | null>(null),
  }, { validators: [dateRangeValidator] });

  readonly project = signal<Project | undefined>(undefined);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly navigating = signal(false);
  readonly transitioning = signal(false);
  readonly pendingConfirmation = signal<ProjectConfirmation | null>(null);
  readonly workflowError = signal('');
  readonly workflowAnnouncement = signal('');
  readonly unsavedWarning = signal('');
  readonly serverErrors = signal(projectFieldErrors(null));
  readonly saveSuccess = signal('');
  readonly leaveConfirmationOpen = signal(false);
  readonly listQueryParams = signal(projectListQueryParams({ q: '', status: 'all', page: 1 }));
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private reloadSubscription?: Subscription;
  private saveSubscription?: Subscription;
  private transitionSubscription?: Subscription;
  private leaveDecision?: (allow: boolean) => void;
  private pendingLeave?: Promise<boolean>;
  private leaveTrigger?: HTMLElement;
  submitted = false;
  readonly submissionError = signal('');

  constructor(
    private readonly route: ActivatedRoute,
    private readonly projectApi: ProjectApiService,
    private readonly router: Router,
  ) {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.listQueryParams.set(projectListQueryParams(readProjectListRouteState(params)));
    });
    this.projectForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.saveSuccess.set(''));
    this.route.paramMap.pipe(
      map((params) => this.parseProjectId(params.get('id'))),
      switchMap((id) => {
        this.reloadSubscription?.unsubscribe();
        this.saveSubscription?.unsubscribe();
        this.transitionSubscription?.unsubscribe();
        this.saving.set(false);
        this.transitioning.set(false);
        this.project.set(undefined);
        this.loading.set(id !== null);
        this.loadError.set('');
        this.submitted = false;
        this.submissionError.set('');
        this.saveSuccess.set('');
        this.pendingConfirmation.set(null);
        this.workflowError.set('');
        this.workflowAnnouncement.set('');
        this.unsavedWarning.set('');
        return id === null ? of(null) : this.projectApi.getProjectById(id).pipe(
          catchError((error: unknown) => {
            if (!(error instanceof HttpErrorResponse) || error.status !== 404) {
              this.loadError.set(projectRequestError(error, '無法載入案件資訊。'));
            }
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe((project) => this.applyProject(project));
  }

  get nameControl() {
    return this.projectForm.controls.name;
  }

  get descriptionControl() {
    return this.projectForm.controls.description;
  }

  get priorityControl() {
    return this.projectForm.controls.priority;
  }

  get startDateControl() {
    return this.projectForm.controls.startDate;
  }

  get dueDateControl() {
    return this.projectForm.controls.dueDate;
  }

  get showNameError(): boolean {
    return (!!this.serverErrors().name || this.nameControl.invalid) && (this.nameControl.touched || this.submitted);
  }

  get showDescriptionError(): boolean {
    return (!!this.serverErrors().description || this.descriptionControl.invalid) && (this.descriptionControl.touched || this.submitted);
  }

  get showPriorityError(): boolean {
    return (!!this.serverErrors().priority || this.priorityControl.invalid) && (this.priorityControl.touched || this.submitted);
  }

  get showDateRangeError(): boolean {
    return (this.projectForm.hasError('dateRange') || !!this.serverErrors().startDate || !!this.serverErrors().dueDate)
      && (this.startDateControl.touched || this.dueDateControl.touched || this.submitted);
  }

  get nameDescribedBy(): string {
    return this.showNameError ? 'project-edit-name-help project-edit-name-error' : 'project-edit-name-help';
  }

  get descriptionDescribedBy(): string {
    return this.showDescriptionError
      ? 'project-edit-description-help project-edit-description-count project-edit-description-error'
      : 'project-edit-description-help project-edit-description-count';
  }

  get priorityDescribedBy(): string {
    return this.showPriorityError ? 'project-edit-priority-help project-edit-priority-error' : 'project-edit-priority-help';
  }

  get startDateDescribedBy(): string {
    return this.showDateRangeError ? 'project-edit-start-date-help project-edit-date-range-error' : 'project-edit-start-date-help';
  }

  get dueDateDescribedBy(): string {
    return this.showDateRangeError ? 'project-edit-due-date-help project-edit-date-range-error' : 'project-edit-due-date-help';
  }

  get nameErrorMessage(): string {
    if (this.serverErrors().name) return this.serverErrors().name!;
    return this.nameControl.hasError('maxlength')
      ? '案件名稱最多 50 個字。'
      : '請輸入案件名稱。';
  }

  onSubmit(): void {
    this.saveProject('stay');
  }

  saveAndReturn(): void {
    this.saveProject('return');
  }

  canLeave(): boolean | Promise<boolean> {
    if (this.saving() || this.transitioning()) return false;
    if (!this.projectForm.dirty) return true;
    if (this.pendingLeave) return this.pendingLeave;

    this.leaveTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.pendingLeave = new Promise<boolean>((resolve) => {
      this.leaveDecision = resolve;
    });
    this.leaveConfirmationOpen.set(true);
    afterNextRender(() => {
      if (!this.leaveDecision) return;
      this.leaveDialog?.nativeElement.showModal();
      this.stayOnPageButton?.nativeElement.focus();
    }, { injector: this.injector });
    return this.pendingLeave;
  }

  stayOnPage(): void {
    this.resolveLeave(false);
  }

  discardAndLeave(): void {
    this.resolveLeave(true);
  }

  onLeaveDialogCancel(event: Event): void {
    event.preventDefault();
    this.stayOnPage();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.projectForm.dirty && !this.saving()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private resolveLeave(allow: boolean): void {
    const resolve = this.leaveDecision;
    if (!resolve) return;
    const focusTarget = this.leaveTrigger;
    this.leaveDialog?.nativeElement.close();
    this.leaveDecision = undefined;
    this.pendingLeave = undefined;
    this.leaveTrigger = undefined;
    this.leaveConfirmationOpen.set(false);
    resolve(allow);
    if (!allow) {
      afterNextRender(() => {
        if (focusTarget?.isConnected) focusTarget.focus();
        else this.projectTitle?.nativeElement.focus();
      }, { injector: this.injector });
    }
  }

  private saveProject(intent: SaveIntent): void {
    const project = this.project();

    if (!project || this.saving() || this.navigating() || this.transitioning() || this.pendingConfirmation()) {
      return;
    }

    if (intent === 'return' && this.projectForm.pristine) {
      void this.returnToList();
      return;
    }

    this.submitted = true;
    this.unsavedWarning.set('');
    this.submissionError.set('');
    this.saveSuccess.set('');
    this.serverErrors.set({});

    if (this.projectForm.invalid) {
      this.projectForm.markAllAsTouched();
      this.focusFirstInvalidField();
      return;
    }

    this.saving.set(true);
    this.saveSubscription = this.projectApi.updateProject(project.id, {
      name: this.nameControl.value.trim(),
      description: this.descriptionControl.value,
      priority: this.priorityControl.value,
      startDate: this.startDateControl.value || null,
      dueDate: this.dueDateControl.value || null,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.project.set(saved);
        this.projectForm.reset(this.formValue(saved));
        this.submitted = false;
        this.saveSuccess.set('案件資料已儲存。');
        if (intent === 'return') void this.returnToList();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.serverErrors.set(projectFieldErrors(error));
        this.submissionError.set(projectRequestError(error, '無法更新案件，請稍後重試。'));
        this.focusServerError();
      },
    });
  }

  private async returnToList(): Promise<void> {
    this.navigating.set(true);
    try {
      const navigated = await this.router.navigate(['/projects'], { queryParams: this.listQueryParams() });
      if (!navigated) this.submissionError.set('無法返回案件列表，請再試一次。');
    } catch {
      this.submissionError.set('無法返回案件列表，請再試一次。');
    } finally {
      this.navigating.set(false);
    }
  }

  reloadProject(): void {
    const id = this.parseProjectId(this.route.snapshot.paramMap.get('id'));
    if (id === null) return;
    this.loading.set(true);
    this.loadError.set('');
    this.saveSuccess.set('');
    this.workflowError.set('');
    this.pendingConfirmation.set(null);
    this.reloadSubscription?.unsubscribe();
    this.reloadSubscription = this.projectApi.getProjectById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (project) => this.applyProject(project),
      error: (error: unknown) => {
        this.loading.set(false);
        if (error instanceof HttpErrorResponse && error.status === 404) this.project.set(undefined);
        else this.loadError.set(projectRequestError(error, '無法載入案件資訊。'));
      },
    });
  }

  transitionStatus(nextStatus: ProjectStatus): void {
    const currentProject = this.project();
    if (!currentProject || this.transitioning() || this.saving() || this.pendingConfirmation()
      || !this.canTransition(currentProject.status, nextStatus)) return;
    if (this.blockForUnsavedChanges()) return;

    this.performTransition(currentProject, nextStatus);
  }

  showConfirmation(action: ProjectConfirmation): void {
    const currentProject = this.project();
    if (!currentProject || this.transitioning() || this.saving() || this.pendingConfirmation()) return;
    if ((action === 'cancel' && !['pending', 'in_progress'].includes(currentProject.status))
      || (action === 'reopen' && currentProject.status !== 'completed')
      || (action === 'restore' && currentProject.status !== 'cancelled')) return;
    if (this.blockForUnsavedChanges()) return;
    this.workflowError.set('');
    this.pendingConfirmation.set(action);
    afterNextRender(() => this.confirmTransitionButton?.nativeElement.focus(), { injector: this.injector });
  }

  confirmTransition(): void {
    const action = this.pendingConfirmation();
    const currentProject = this.project();
    if (!action || !currentProject || this.transitioning() || this.saving()) return;
    if (this.blockForUnsavedChanges()) return;
    const nextStatus = CONFIRMATION_CONTENT[action].nextStatus;
    if (!this.canTransition(currentProject.status, nextStatus)) return;
    this.performTransition(currentProject, nextStatus);
  }

  closeConfirmation(): void {
    if (this.transitioning()) return;
    this.pendingConfirmation.set(null);
    afterNextRender(() => this.confirmationTriggerButton?.nativeElement.focus(), { injector: this.injector });
  }

  discardChanges(): void {
    const currentProject = this.project();
    if (!currentProject || this.saving() || this.transitioning()) return;
    this.projectForm.reset(this.formValue(currentProject));
    this.submitted = false;
    this.serverErrors.set({});
    this.submissionError.set('');
    this.unsavedWarning.set('');
  }

  private blockForUnsavedChanges(): boolean {
    if (!this.projectForm.dirty) return false;
    this.unsavedWarning.set('請先儲存或放棄目前修改，再變更案件進度。');
    return true;
  }

  private performTransition(currentProject: Project, nextStatus: ProjectStatus): void {
    this.workflowError.set('');
    this.saveSuccess.set('');
    this.transitioning.set(true);
    this.transitionSubscription = this.projectApi.transitionProjectStatus(currentProject.id, nextStatus)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (updatedProject) => {
          this.transitioning.set(false);
          this.applyProject(updatedProject);
          this.pendingConfirmation.set(null);
          this.workflowAnnouncement.set(`案件狀態已更新為${PROJECT_STATUS_LABELS[updatedProject.status]}。`);
          afterNextRender(() => this.projectTitle?.nativeElement.focus(), { injector: this.injector });
        },
        error: (error: unknown) => {
          this.transitioning.set(false);
          this.pendingConfirmation.set(null);
          this.workflowError.set(error instanceof HttpErrorResponse && error.status === 409
            ? '案件狀態可能已被其他人變更，請重新取得案件資訊後再操作。'
            : projectRequestError(error, '無法更新案件狀態，請重試。'));
          afterNextRender(() => this.reloadWorkflowButton?.nativeElement.focus(), { injector: this.injector });
        },
      });
  }

  private applyProject(project: Project | null): void {
    const preserveUnsavedInput = !!project && this.project()?.id === project.id && this.projectForm.dirty;
    this.loading.set(false);
    this.project.set(project ?? undefined);
    if (!project) return;
    if (preserveUnsavedInput) return;
    this.projectForm.reset(this.formValue(project));
  }

  private formValue(project: Project) {
    return {
      name: project.name,
      description: project.description ?? '',
      priority: project.priority,
      startDate: project.startDate ?? null,
      dueDate: project.dueDate ?? null,
    };
  }

  private focusServerError(): void {
    if (this.serverErrors().name) this.projectNameInput?.nativeElement.focus();
    else if (this.serverErrors().description) this.projectDescriptionInput?.nativeElement.focus();
    else if (this.serverErrors().priority) this.projectPrioritySelect?.nativeElement.focus();
    else if (this.serverErrors().startDate) this.projectStartDateInput?.nativeElement.focus();
    else if (this.serverErrors().dueDate) this.projectDueDateInput?.nativeElement.focus();
  }

  private focusFirstInvalidField(): void {
    if (this.nameControl.invalid) {
      this.projectNameInput?.nativeElement.focus();
      return;
    }

    if (this.descriptionControl.invalid) {
      this.projectDescriptionInput?.nativeElement.focus();
      return;
    }

    if (this.priorityControl.invalid) {
      this.projectPrioritySelect?.nativeElement.focus();
      return;
    }

    if (this.projectForm.hasError('dateRange') || this.startDateControl.invalid || this.dueDateControl.invalid) {
      this.projectDueDateInput?.nativeElement.focus();
    }
  }

  private parseProjectId(value: string | null): number | null {
    if (!value || !/^\d+$/.test(value)) {
      return null;
    }

    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
}
