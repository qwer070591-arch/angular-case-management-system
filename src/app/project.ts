export type ProjectStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  pending: '待處理',
  in_progress: '進行中',
  completed: '已完成',
  cancelled: '已取消',
};

export const PROJECT_STATUS_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['pending', 'completed', 'cancelled'],
  completed: ['in_progress'],
  cancelled: ['pending'],
};

export function canTransitionProjectStatus(current: ProjectStatus, next: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[current].includes(next);
}

export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';

export const PROJECT_PRIORITIES: readonly ProjectPriority[] = [
  'low',
  'medium',
  'high',
  'urgent',
];

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '緊急',
};

export interface Project {
  id: number;
  projectCode: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  priority?: ProjectPriority;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  priority?: ProjectPriority;
  startDate?: string | null;
  dueDate?: string | null;
}

export type ProjectMutationResult =
  | { success: true; project: Project }
  | {
      success: false;
      reason: 'invalid-name' | 'invalid-description' | 'invalid-priority' | 'invalid-date' | 'not-found' | 'invalid-transition';
    };
