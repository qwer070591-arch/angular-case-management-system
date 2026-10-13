import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { Project } from '../project';
import { StatusBadgeComponent } from '../shared/status-badge/status-badge';

export interface ProjectDeleteRequest {
  id: number;
  trigger: HTMLButtonElement;
}

@Component({
  imports: [RouterLink, StatusBadgeComponent],
  selector: 'app-project-list',
  styleUrl: './project-list.css',
  templateUrl: './project-list.html',
})
export class ProjectList {
  @Input() projects: Project[] = [];
  @Input() total: number | null = null;
  @Input() hasActiveFilters = false;
  @Input() listQueryParams: Params = {};

  @Output() delete = new EventEmitter<ProjectDeleteRequest>();
  @Output() clearFilters = new EventEmitter<void>();

  requestDelete(id: number, event: MouseEvent): void {
    this.delete.emit({ id, trigger: event.currentTarget as HTMLButtonElement });
  }
}
