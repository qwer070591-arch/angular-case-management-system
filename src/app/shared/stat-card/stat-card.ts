import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type StatCardAccent = 'neutral' | 'primary' | 'warning' | 'success';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  templateUrl: './stat-card.html',
  styleUrl: './stat-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatCardComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) value!: number;
  @Input() detail = '';
  @Input() accent: StatCardAccent = 'neutral';

  get cardClass(): string {
    return `stat-card--${this.accent}`;
  }

  get accessibleValue(): string {
    return this.detail ? `${this.label}：${this.value}，${this.detail}` : `${this.label}：${this.value}`;
  }
}
