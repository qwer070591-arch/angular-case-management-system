import { CanDeactivateFn } from '@angular/router';
import type { ProjectEditPage } from './project-edit';

export const projectEditCanDeactivate: CanDeactivateFn<ProjectEditPage> = (page) => page.canLeave();
