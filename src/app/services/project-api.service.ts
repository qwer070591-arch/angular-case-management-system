import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_BASE_URL } from '../api/api-config';
import { CreateProjectInput, Project, ProjectStatus, UpdateProjectInput } from '../project';

export interface ProjectListResponse {
  data: Project[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface ProjectListQuery {
  q?: string;
  status?: ProjectStatus;
  limit?: number;
  offset?: number;
}

export interface ProjectStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

export interface ProjectResponse {
  data: Project;
}

function projectFromResponse(response: ProjectResponse): Project {
  if (!response?.data || typeof response.data.id !== 'number') {
    throw new Error('Invalid project detail response');
  }
  return response.data;
}

@Injectable({ providedIn: 'root' })
export class ProjectApiService {
  private readonly http = inject(HttpClient);
  private readonly projectsUrl = `${inject(API_BASE_URL)}/projects`;

  getProjects(query?: ProjectListQuery): Observable<ProjectListResponse> {
    let params = new HttpParams();
    if (query?.q !== undefined) params = params.set('q', query.q);
    if (query?.status !== undefined) params = params.set('status', query.status);
    if (query?.limit !== undefined) params = params.set('limit', query.limit);
    if (query?.offset !== undefined) params = params.set('offset', query.offset);

    return this.http.get<ProjectListResponse>(this.projectsUrl, { params }).pipe(
      map((response) => {
        if (!response || !Array.isArray(response.data) || !response.meta) {
          throw new Error('Invalid project list response');
        }
        return response;
      }),
    );
  }

  getProjectStats(): Observable<ProjectStats> {
    return this.http.get<{ data: ProjectStats }>(`${this.projectsUrl}/stats`).pipe(
      map((response) => {
        const stats = response?.data;
        if (!stats || !(['total', 'pending', 'inProgress', 'completed', 'cancelled'] as const)
          .every((field) => Number.isSafeInteger(stats[field]) && stats[field] >= 0)) {
          throw new Error('Invalid project stats response');
        }
        return stats;
      }),
    );
  }

  getProjectById(id: number): Observable<Project> {
    return this.http.get<ProjectResponse>(`${this.projectsUrl}/${id}`).pipe(map(projectFromResponse));
  }

  createProject(input: CreateProjectInput): Observable<Project> {
    const body: CreateProjectInput = {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    };
    return this.http.post<ProjectResponse>(this.projectsUrl, body).pipe(map(projectFromResponse));
  }

  updateProject(id: number, input: UpdateProjectInput): Observable<Project> {
    const body: UpdateProjectInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    };
    return this.http.patch<ProjectResponse>(`${this.projectsUrl}/${id}`, body).pipe(map(projectFromResponse));
  }

  transitionProjectStatus(id: number, toStatus: ProjectStatus): Observable<Project> {
    return this.http.post<ProjectResponse>(`${this.projectsUrl}/${id}/transitions`, { toStatus }).pipe(map(projectFromResponse));
  }

  deleteProject(id: number): Observable<void> {
    return this.http.delete<void>(`${this.projectsUrl}/${id}`).pipe(map(() => undefined));
  }
}
