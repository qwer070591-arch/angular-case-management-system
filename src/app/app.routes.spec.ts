import { routes } from './app.routes';
import { AboutPage } from './pages/about/about';

describe('project route titles', () => {
  it('keeps login outside the guarded App Shell', () => {
    expect(routes.find((route) => route.path === 'login')).toBeTruthy();
    const shell = routes.find((route) => route.path === '');
    expect(shell?.canActivate?.length).toBeGreaterThan(0);
    expect(shell?.canActivateChild?.length).toBeGreaterThan(0);
  });
  it('uses the same page names as the List, Detail, and Manage views', () => {
    const children = routes.find((route) => route.path === '')?.children ?? [];
    const titleFor = (path: string) => children.find((route) => route.path === path)?.data?.['title'];

    expect(titleFor('projects')).toBe('案件管理');
    expect(titleFor('projects/:id')).toBe('案件詳情');
    expect(titleFor('projects/:id/edit')).toBe('管理案件');
    expect(children.find((route) => route.path === 'projects/:id/edit')?.canDeactivate?.length).toBe(1);
  });

  it('keeps /about lazy loaded inside the App Shell with the Chinese Topbar title', async () => {
    const children = routes.find((route) => route.path === '')?.children ?? [];
    const about = children.find((route) => route.path === 'about');

    expect(about?.data?.['title']).toBe('關於系統');
    expect(about?.loadComponent).toBeTruthy();
    expect(await about?.loadComponent?.()).toBe(AboutPage);
    expect(children.find((route) => route.path === 'dashboard')).toBeTruthy();
    expect(children.find((route) => route.path === 'projects')).toBeTruthy();
  });
});
