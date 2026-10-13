import { Component, DestroyRef, ElementRef, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  PROJECT_PRIORITIES,
  PROJECT_PRIORITY_LABELS,
  ProjectPriority,
} from '../../project';
import { projectFieldErrors, projectRequestError } from '../../api/project-api-error';
import { ProjectApiService } from '../../services/project-api.service';

const nonWhitespaceValidator: ValidatorFn = (control): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? control.value.trim() : '';

  return value.length > 0 ? null : { whitespace: true };
};

const dateRangeValidator: ValidatorFn = (control): ValidationErrors | null => {
  const startDate = control.get('startDate')?.value as string | null;
  const dueDate = control.get('dueDate')?.value as string | null;

  return startDate && dueDate && dueDate < startDate ? { dateRange: true } : null;
};

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  selector: 'app-new-project-page',
  styleUrl: './new-project.css',
  templateUrl: './new-project.html',
})
export class NewProjectPage {
  @ViewChild('projectNameInput') projectNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('projectDescriptionInput') projectDescriptionInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('projectPrioritySelect') projectPrioritySelect?: ElementRef<HTMLSelectElement>;
  @ViewChild('projectStartDateInput') projectStartDateInput?: ElementRef<HTMLInputElement>;
  @ViewChild('projectDueDateInput') projectDueDateInput?: ElementRef<HTMLInputElement>;

  readonly priorityOptions = PROJECT_PRIORITIES;
  readonly priorityLabels = PROJECT_PRIORITY_LABELS;

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
      validators: [Validators.required],
    }),
    startDate: new FormControl<string | null>(null),
    dueDate: new FormControl<string | null>(null),
  }, { validators: [dateRangeValidator] });

  submitted = false;
  submitting = false;
  submissionError = '';
  serverErrors = projectFieldErrors(null);
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly projectApi: ProjectApiService,
    private readonly router: Router,
  ) {}

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
    return (!!this.serverErrors.name || this.nameControl.invalid) && (this.nameControl.touched || this.submitted);
  }

  get showDescriptionError(): boolean {
    return (!!this.serverErrors.description || this.descriptionControl.invalid) && (this.descriptionControl.touched || this.submitted);
  }

  get showPriorityError(): boolean {
    return (!!this.serverErrors.priority || this.priorityControl.invalid) && (this.priorityControl.touched || this.submitted);
  }

  get showDateRangeError(): boolean {
    return (this.projectForm.hasError('dateRange') || !!this.serverErrors.startDate || !!this.serverErrors.dueDate)
      && (this.startDateControl.touched || this.dueDateControl.touched || this.submitted);
  }

  get nameDescribedBy(): string {
    return this.showNameError ? 'project-name-help project-name-error' : 'project-name-help';
  }

  get descriptionDescribedBy(): string {
    return this.showDescriptionError ? 'project-description-help project-description-error' : 'project-description-help';
  }

  get priorityDescribedBy(): string {
    return this.showPriorityError ? 'project-priority-help project-priority-error' : 'project-priority-help';
  }

  get dueDateDescribedBy(): string {
    return this.showDateRangeError ? 'project-due-date-help project-date-range-error' : 'project-due-date-help';
  }

  get startDateDescribedBy(): string {
    return this.showDateRangeError ? 'project-start-date-help project-date-range-error' : 'project-start-date-help';
  }

  get nameErrorMessage(): string {
    if (this.serverErrors.name) return this.serverErrors.name;
    if (this.nameControl.hasError('maxlength')) {
      return '案件名稱不可超過 50 個字元';
    }

    return '請輸入案件名稱';
  }

  onSubmit(): void {
    if (this.submitting) return;
    this.submitted = true;
    this.submissionError = '';
    this.serverErrors = {};

    if (this.projectForm.invalid) {
      this.projectForm.markAllAsTouched();
      this.focusFirstInvalidField();
      return;
    }

    this.submitting = true;
    this.projectApi.createProject({
      name: this.nameControl.value.trim(),
      description: this.descriptionControl.value,
      priority: this.priorityControl.value,
      startDate: this.startDateControl.value || null,
      dueDate: this.dueDateControl.value || null,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (project) => {
        this.submitting = false;
        void this.router.navigate(['/projects', project.id]);
      },
      error: (error: unknown) => {
        this.submitting = false;
        this.serverErrors = projectFieldErrors(error);
        this.submissionError = projectRequestError(error, '無法建立案件，請稍後重試。');
        if (Object.keys(this.serverErrors).length) this.focusServerError();
      },
    });
  }

  private focusServerError(): void {
    if (this.serverErrors.name) this.projectNameInput?.nativeElement.focus();
    else if (this.serverErrors.description) this.projectDescriptionInput?.nativeElement.focus();
    else if (this.serverErrors.priority) this.projectPrioritySelect?.nativeElement.focus();
    else if (this.serverErrors.startDate) this.projectStartDateInput?.nativeElement.focus();
    else if (this.serverErrors.dueDate) this.projectDueDateInput?.nativeElement.focus();
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

    if (this.startDateControl.invalid) {
      this.projectStartDateInput?.nativeElement.focus();
      return;
    }

    this.projectDueDateInput?.nativeElement.focus();
  }
}
