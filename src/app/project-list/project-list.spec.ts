import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProjectService } from '../services/project.service';
import { ProjectDeleteRequest, ProjectList } from './project-list';

describe('ProjectList', () => {
  let component: ProjectList;
  let fixture: ComponentFixture<ProjectList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectList],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps Detail and Delete while both table and card link directly to Manage', async () => {
    fixture.componentRef.setInput('projects', TestBed.inject(ProjectService).getProjects());
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.project-table-container a[href="/projects/1"]')).toBeTruthy();
    expect(element.querySelector('.project-card a[href="/projects/1"]')).toBeTruthy();
    const tableManage = element.querySelector<HTMLAnchorElement>('.project-table-container a[href="/projects/1/edit"]');
    const cardManage = element.querySelector<HTMLAnchorElement>('.project-card__actions a[href="/projects/1/edit"]');
    expect(tableManage?.textContent?.trim()).toBe('管理');
    expect(cardManage?.textContent?.trim()).toBe('管理');
    expect(element.textContent).not.toContain('完成案件');
    expect(element.textContent).toContain('刪除');
  });

  it('uses the same filtered list context in desktop table and mobile card links', async () => {
    fixture.componentRef.setInput('projects', TestBed.inject(ProjectService).getProjects());
    fixture.componentRef.setInput('listQueryParams', { q: '官網', status: 'pending', page: 2 });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const links = [
      '.project-table-container .project-name__link',
      '.project-table-container .project-action--edit',
      '.project-card__name-link',
      '.project-card__actions .project-action--edit',
    ].map((selector) => element.querySelector<HTMLAnchorElement>(selector));
    expect(links).toHaveLength(4);
    expect(links.map((link) => link?.getAttribute('href'))).toEqual([
      '/projects/1?q=%E5%AE%98%E7%B6%B2&status=pending&page=2',
      '/projects/1/edit?q=%E5%AE%98%E7%B6%B2&status=pending&page=2',
      '/projects/1?q=%E5%AE%98%E7%B6%B2&status=pending&page=2',
      '/projects/1/edit?q=%E5%AE%98%E7%B6%B2&status=pending&page=2',
    ]);
  });

  it('emits the project ID and originating button from both table and card delete actions', async () => {
    fixture.componentRef.setInput('projects', TestBed.inject(ProjectService).getProjects());
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const tableButton = element.querySelector<HTMLButtonElement>('.project-table-container .project-action--delete');
    const cardButton = element.querySelector<HTMLButtonElement>('.project-card__actions .project-action--delete');
    if (!tableButton || !cardButton) throw new Error('Expected table and card delete buttons');

    const requests: ProjectDeleteRequest[] = [];
    component.delete.subscribe((request) => requests.push(request));
    tableButton.click();
    cardButton.click();

    expect(requests).toEqual([
      { id: 1, trigger: tableButton },
      { id: 1, trigger: cardButton },
    ]);
  });
});
