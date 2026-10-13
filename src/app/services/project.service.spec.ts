import { CreateProjectInput, PROJECT_STATUSES, Project, ProjectStatus } from '../project';
import { ProjectService } from './project.service';

const legalTransitions = new Set([
  'pending:in_progress',
  'pending:cancelled',
  'in_progress:pending',
  'in_progress:completed',
  'in_progress:cancelled',
  'completed:in_progress',
  'cancelled:pending',
]);

function createProjectAtStatus(service: ProjectService, status: ProjectStatus): Project {
  const created = service.addProject({ name: 'Workflow test project' });
  if (!created.success) {
    throw new Error('Test setup could not create a project');
  }

  if (status === 'pending') {
    return created.project;
  }

  const started = service.transitionProjectStatus(created.project.id, 'in_progress');
  if (!started.success) {
    throw new Error('Test setup could not start the project');
  }

  if (status === 'in_progress') {
    return started.project;
  }

  const finished = service.transitionProjectStatus(started.project.id, status);
  if (!finished.success) {
    throw new Error('Test setup could not reach the terminal status');
  }

  return finished.project;
}

describe('ProjectService status workflow', () => {
  for (const current of PROJECT_STATUSES) {
    for (const next of PROJECT_STATUSES) {
      it(`${current} → ${next}`, () => {
        const service = new ProjectService();
        const before = createProjectAtStatus(service, current);
        const result = service.transitionProjectStatus(before.id, next);
        const isLegal = legalTransitions.has(`${current}:${next}`);

        expect(result.success).toBe(isLegal);

        if (result.success) {
          const { status: previousStatus, updatedAt: previousUpdatedAt, ...unchangedBefore } = before;
          const { status, updatedAt, ...unchangedAfter } = result.project;
          expect(previousStatus).toBe(current);
          expect(status).toBe(next);
          expect(Date.parse(updatedAt)).toBeGreaterThan(Date.parse(previousUpdatedAt));
          expect(unchangedAfter).toEqual(unchangedBefore);
          expect(service.getProjectById(before.id)).toEqual(result.project);
        } else {
          expect(result.reason).toBe('invalid-transition');
          expect(service.getProjectById(before.id)).toEqual(before);
        }
      });
    }
  }

  it('returns not-found without changing any project', () => {
    const service = new ProjectService();
    const before = service.getProjects();

    expect(service.transitionProjectStatus(999999, 'in_progress')).toEqual({
      success: false,
      reason: 'not-found',
    });
    expect(service.getProjects()).toEqual(before);
  });

  it('always creates a pending project, even if a runtime caller supplies status', () => {
    const service = new ProjectService();
    const input = { name: 'New project', status: 'completed' } as unknown as CreateProjectInput;
    const result = service.addProject(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.status).toBe('pending');
    }
  });

  it('continues to allow duplicate names while project codes remain unique', () => {
    const service = new ProjectService();
    const first = service.addProject({ name: 'Same name' });
    const second = service.addProject({ name: 'Same name' });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.project.name).toBe(second.project.name);
      expect(first.project.projectCode).not.toBe(second.project.projectCode);
    }
  });
});
