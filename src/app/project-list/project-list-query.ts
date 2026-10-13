import { ParamMap, Params } from '@angular/router';
import { PROJECT_STATUSES, ProjectStatus } from '../project';

export interface ProjectListRouteState {
  q: string;
  status: ProjectStatus | 'all';
  page: number;
}

export const PROJECTS_PAGE_SIZE = 20;
const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / PROJECTS_PAGE_SIZE);

export function readProjectListRouteState(params: ParamMap): ProjectListRouteState {
  const status = params.get('status');
  const rawPage = params.get('page');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;

  return {
    q: params.get('q') ?? '',
    status: status && PROJECT_STATUSES.includes(status as ProjectStatus) ? status as ProjectStatus : 'all',
    page: Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

export function projectListQueryParams(state: ProjectListRouteState): Params {
  return {
    ...(state.q ? { q: state.q } : {}),
    ...(state.status !== 'all' ? { status: state.status } : {}),
    ...(state.page > 1 ? { page: state.page } : {}),
  };
}

export function hasInvalidProjectListParams(params: ParamMap, state: ProjectListRouteState): boolean {
  const normalized = projectListQueryParams(state);
  return (['q', 'status', 'page'] as const).some((key) => {
    const expected = normalized[key];
    return params.get(key) !== (expected === undefined ? null : String(expected));
  });
}
