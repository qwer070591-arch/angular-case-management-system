import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { PROJECT_STATUS_LABELS, Project } from '../../project';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  templateUrl: './status-badge.html',
  styleUrl: './status-badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadgeComponent {
  @Input({ required: true }) status!: Project['status'];

  get statusClass(): string {
    return `status-badge--${this.status.replace('_', '-')}`;
  }

  get statusLabel(): string {
    return PROJECT_STATUS_LABELS[this.status];
  }
}
