import { Injectable } from '@angular/core';
import {
  CreateProjectInput,
  Project,
  ProjectMutationResult,
  ProjectPriority,
  ProjectStatus,
  PROJECT_PRIORITIES,
  UpdateProjectInput,
  canTransitionProjectStatus,
} from '../project';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private projects: Project[] = [
    {
      id: 1,
      projectCode: 'PRJ-2026-0001',
      name: '公司官網改版',
      description: '更新公司官方網站的資訊架構、內容與前端體驗。',
      status: 'in_progress',
      priority: 'high',
      startDate: '2026-01-06',
      dueDate: '2026-03-31',
      createdAt: '2026-01-06T09:00:00.000Z',
      updatedAt: '2026-01-15T04:30:00.000Z',
    },
    {
      id: 2,
      projectCode: 'PRJ-2026-0002',
      name: '會員系統開發',
      description: '規劃並實作新版會員註冊、登入與帳戶管理流程。',
      status: 'pending',
      priority: 'urgent',
      startDate: '2026-02-02',
      dueDate: '2026-05-29',
      createdAt: '2026-01-10T09:00:00.000Z',
      updatedAt: '2026-01-10T09:00:00.000Z',
    },
    {
      id: 3,
      projectCode: 'PRJ-2025-0001',
      name: '後台管理系統',
      description: '建立內部案件管理與追蹤作業的後台系統。',
      status: 'completed',
      priority: 'medium',
      startDate: '2025-12-18',
      dueDate: '2026-01-09',
      createdAt: '2025-12-18T09:00:00.000Z',
      updatedAt: '2026-01-03T08:00:00.000Z',
    },
  ];

  private lastTimestamp = '';

  getProjects(): Project[] {
    return this.projects.map((project) => ({ ...project }));
  }

  getProjectById(id: number): Project | undefined {
    const project = this.projects.find((item) => item.id === id);
    return project ? { ...project } : undefined;
  }

  addProject(input: CreateProjectInput): ProjectMutationResult {
    const name = input.name.trim();
    const description = this.normalizeDescription(input.description);
    const startDate = this.normalizeDate(input.startDate, null);
    const dueDate = this.normalizeDate(input.dueDate, null);

    if (name === '') {
      return { success: false, reason: 'invalid-name' };
    }

    if (description !== null && description.length > 4000) {
      return { success: false, reason: 'invalid-description' };
    }

    if (!this.isValidDateRange(startDate, dueDate)) {
      return { success: false, reason: 'invalid-date' };
    }

    const timestamp = this.nextTimestamp();
    const project: Project = {
      id: this.nextProjectId(),
      projectCode: this.generateProjectCode(timestamp),
      name,
      description,
      status: 'pending',
      priority: input.priority ?? 'medium',
      startDate,
      dueDate,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.projects = [...this.projects, project];
    return { success: true, project: { ...project } };
  }

  deleteProject(id: number): void {
    this.projects = this.projects.filter((project) => project.id !== id);
  }

  transitionProjectStatus(id: number, nextStatus: ProjectStatus): ProjectMutationResult {
    const project = this.projects.find((item) => item.id === id);

    if (!project) {
      return { success: false, reason: 'not-found' };
    }

    if (!canTransitionProjectStatus(project.status, nextStatus)) {
      return { success: false, reason: 'invalid-transition' };
    }

    const updatedProject: Project = {
      ...project,
      status: nextStatus,
      updatedAt: this.nextTimestamp(),
    };

    this.projects = this.projects.map((item) => item.id === id ? updatedProject : item);
    return { success: true, project: { ...updatedProject } };
  }

  updateProject(id: number, input: UpdateProjectInput): ProjectMutationResult {
    const project = this.projects.find((item) => item.id === id);

    if (!project) {
      return { success: false, reason: 'not-found' };
    }

    const name = input.name === undefined ? project.name : input.name.trim();
    const description = input.description === undefined
      ? project.description
      : this.normalizeDescription(input.description);
    const priority = input.priority ?? project.priority;
    const startDate = this.normalizeDate(input.startDate, project.startDate);
    const dueDate = this.normalizeDate(input.dueDate, project.dueDate);

    if (name === '') {
      return { success: false, reason: 'invalid-name' };
    }

    if (description !== null && description.length > 4000) {
      return { success: false, reason: 'invalid-description' };
    }

    if (!this.isValidPriority(priority)) {
      return { success: false, reason: 'invalid-priority' };
    }

    if (!this.isValidDateRange(startDate, dueDate)) {
      return { success: false, reason: 'invalid-date' };
    }

    const updatedProject: Project = {
      ...project,
      name,
      description,
      priority,
      startDate,
      dueDate,
      updatedAt: this.nextTimestamp(),
    };

    this.projects = this.projects.map((item) => item.id === id ? updatedProject : item);
    return { success: true, project: { ...updatedProject } };
  }

  private nextProjectId(): number {
    return this.projects.length > 0
      ? Math.max(...this.projects.map((project) => project.id)) + 1
      : 1;
  }

  private generateProjectCode(timestamp: string): string {
    const year = new Date(timestamp).getUTCFullYear();
    const prefix = `PRJ-${year}-`;
    const sequence = this.projects.reduce((highestSequence, project) => {
      if (!project.projectCode.startsWith(prefix)) {
        return highestSequence;
      }

      const currentSequence = Number(project.projectCode.slice(prefix.length));
      return Number.isInteger(currentSequence) ? Math.max(highestSequence, currentSequence) : highestSequence;
    }, 0) + 1;

    // 正式環境須改由 Backend / Database transaction 與 unique constraint 產生並保證唯一性。
    return `${prefix}${String(sequence).padStart(4, '0')}`;
  }

  private normalizeDescription(value: string | null | undefined): string | null {
    const description = value?.trim() ?? '';
    return description === '' ? null : description;
  }

  private normalizeDate(value: string | null | undefined, fallback: string | null): string | null {
    if (value === undefined) {
      return fallback;
    }

    const date = value?.trim() ?? '';
    return date === '' ? null : date;
  }

  private isValidDateRange(startDate: string | null, dueDate: string | null): boolean {
    if (!this.isValidDate(startDate) || !this.isValidDate(dueDate)) {
      return false;
    }

    return startDate === null || dueDate === null || dueDate >= startDate;
  }

  private isValidPriority(value: ProjectPriority): boolean {
    return PROJECT_PRIORITIES.includes(value);
  }

  private isValidDate(value: string | null): boolean {
    if (value === null) {
      return true;
    }

    const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!dateParts) {
      return false;
    }

    const [, year, month, day] = dateParts.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  }

  private nextTimestamp(): string {
    const currentTimestamp = new Date().toISOString();

    if (currentTimestamp > this.lastTimestamp) {
      this.lastTimestamp = currentTimestamp;
      return currentTimestamp;
    }

    this.lastTimestamp = new Date(Date.parse(this.lastTimestamp) + 1).toISOString();
    return this.lastTimestamp;
  }
}
