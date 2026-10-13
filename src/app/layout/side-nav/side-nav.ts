import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-side-nav',
  imports: [RouterLink, RouterLinkActive],
  styleUrl: './side-nav.css',
  templateUrl: './side-nav.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavComponent {
  @Output() navigationSelected = new EventEmitter<void>();
  @Output() navigationClosed = new EventEmitter<void>();
}
