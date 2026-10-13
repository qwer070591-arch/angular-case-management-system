import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterLink, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { Project } from '../../project';
import { ProjectEditPage } from './project-edit';
import { projectEditCanDeactivate } from './project-edit.guard';

@Component({
  imports: [RouterLink, RouterOutlet],
  template: '<a id="sidebar-link" routerLink="/dashboard">Dashboard</a><router-outlet />',
})
class TestShell {}

@Component({ template: '<p>Destination</p>' })
class DestinationPage {}

const project: Project = {
  id: 4, projectCode: 'PRJ-2026-0004', name: '原名稱', description: null,
  status: 'pending', priority: 'medium', startDate: null, dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

async function setup(start = '/projects', editUrl = '/projects/4/edit') {
  await TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
      provideRouter([{ path: '', component: TestShell, children: [
        { path: 'projects/:id/edit', component: ProjectEditPage, canDeactivate: [projectEditCanDeactivate] },
        { path: 'projects', component: DestinationPage },
        { path: 'dashboard', component: DestinationPage },
      ] }]),
    ],
  }).compileComponents();
  TestBed.inject(Router).setUpLocationChangeListener();
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(start);
  await harness.navigateByUrl(editUrl);
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/projects/4').flush({ data: project });
  harness.detectChanges();
  const page = harness.routeDebugElement?.query(By.directive(ProjectEditPage))?.componentInstance as ProjectEditPage;
  const dialog = harness.routeNativeElement?.querySelector('.project-edit-leave-dialog') as HTMLDialogElement;
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  return { harness, page, dialog, http, router: TestBed.inject(Router) };
}

function editName(harness: RouterTestingHarness): void {
  const input = harness.routeNativeElement?.querySelector('#project-edit-name') as HTMLInputElement;
  input.value = '未儲存名稱';
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Project Edit CanDeactivate routing', () => {
  it('allows a pristine form to leave by Sidebar without confirmation', async () => {
    const { harness, page, dialog, http, router } = await setup();
    expect(page.projectForm.pristine).toBe(true);
    (harness.routeNativeElement?.querySelector('#sidebar-link') as HTMLAnchorElement).click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/dashboard');
    expect(dialog.open).toBe(false);
    http.verify();
  });

  it('guards Sidebar navigation and preserves input when continuing editing', async () => {
    const { harness, page, dialog, http, router } = await setup();
    editName(harness);
    (harness.routeNativeElement?.querySelector('#sidebar-link') as HTMLAnchorElement).click();
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.open).toBe(true);
    (dialog.querySelector('button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects/4/edit');
    expect(page.nameControl.value).toBe('未儲存名稱');
    http.expectNone('/api/projects/4');
    http.verify();
  });

  it('guards Cancel and leaves only after discarding changes', async () => {
    const { harness, dialog, http, router } = await setup();
    editName(harness);
    (harness.routeNativeElement?.querySelector('.project-edit-form-card__actions a') as HTMLAnchorElement).click();
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(router.url).toBe('/projects/4/edit');
    expect(dialog.open).toBe(true);
    (dialog.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects');
    http.expectNone('/api/projects/4');
    http.verify();
  });

  it('guards browser Back through Router popstate navigation', async () => {
    const { harness, page, dialog, http, router } = await setup('/dashboard');
    editName(harness);
    const guardCall = vi.spyOn(page, 'canLeave');
    const location = TestBed.inject(Location);
    expect(location.path()).toBe('/projects/4/edit');
    location.back();
    expect(location.path()).toBe('/dashboard');
    await vi.waitFor(() => expect(guardCall).toHaveBeenCalled());
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(router.url).toBe('/projects/4/edit');
    (dialog.querySelector('button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects/4/edit');
    http.verify();
  });

  it('guards browser Forward through Router popstate navigation', async () => {
    const { harness, http, router } = await setup();
    await harness.navigateByUrl('/dashboard');
    const location = TestBed.inject(Location);
    location.back();
    const get = await vi.waitFor(() => http.expectOne('/api/projects/4'));
    get.flush({ data: project });
    await harness.fixture.whenStable();
    const dialog = harness.routeNativeElement?.querySelector('.project-edit-leave-dialog') as HTMLDialogElement;
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = () => dialog.removeAttribute('open');
    editName(harness);
    location.forward();
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(router.url).toBe('/projects/4/edit');
    (dialog.querySelector('button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects/4/edit');
    http.verify();
  });

  it('blocks Sidebar navigation while a PATCH is in flight', async () => {
    const { harness, page, dialog, http, router } = await setup();
    editName(harness);
    page.onSubmit();
    const patch = http.expectOne('/api/projects/4');
    (harness.routeNativeElement?.querySelector('#sidebar-link') as HTMLAnchorElement).click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects/4/edit');
    expect(dialog.open).toBe(false);
    patch.flush({ data: { ...project, name: '未儲存名稱' } });
    await harness.fixture.whenStable();
    expect(page.projectForm.pristine).toBe(true);
    http.verify();
  });

  it('guards navigation to another project ID on the same edit route', async () => {
    const { harness, page, dialog, http, router } = await setup();
    editName(harness);
    const navigation = router.navigateByUrl('/projects/5/edit');
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    (dialog.querySelector('button') as HTMLButtonElement).click();
    expect(await navigation).toBe(false);
    expect(router.url).toBe('/projects/4/edit');
    expect(page.nameControl.value).toBe('未儲存名稱');
    http.expectNone('/api/projects/5');
    http.verify();
  });

  it('returns after save-and-return PATCH without a second leave prompt', async () => {
    const { harness, page, dialog, http, router } = await setup();
    editName(harness);
    const returnButton = Array.from(harness.routeNativeElement?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === '儲存並返回列表') as HTMLButtonElement;
    returnButton.click();
    const patch = http.expectOne('/api/projects/4');
    expect(router.url).toBe('/projects/4/edit');
    patch.flush({ data: { ...project, name: '未儲存名稱' } });
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects');
    expect(page.projectForm.pristine).toBe(true);
    expect(dialog.open).toBe(false);
    http.verify();
  });

  it('preserves list query params on Cancel without bypassing unsaved-change confirmation', async () => {
    const editUrl = '/projects/4/edit?q=official&status=pending&page=2';
    const { harness, page, dialog, http, router } = await setup('/projects', editUrl);
    editName(harness);
    (harness.routeNativeElement?.querySelector('.project-edit-form-card__actions a') as HTMLAnchorElement).click();
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(router.url).toBe(editUrl);
    (dialog.querySelector('button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(page.nameControl.value).toBe('未儲存名稱');
    expect(router.url).toBe(editUrl);
    (harness.routeNativeElement?.querySelector('.project-edit-form-card__actions a') as HTMLAnchorElement).click();
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    (dialog.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/projects?q=official&status=pending&page=2');
    http.expectNone('/api/projects/4');
    http.verify();
  });
});
