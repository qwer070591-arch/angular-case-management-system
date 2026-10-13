import { Routes } from '@angular/router';
import { devPreviewRoutes } from './dev-preview.routes';
import { authGuard } from './auth/auth-routing';
import { projectEditCanDeactivate } from './pages/project-edit/project-edit.guard';

export const routes: Routes = [
  {
    path: 'login',
    data: { title: '員工登入' },
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    loadComponent: () => import('./layout/app-shell/app-shell').then((m) => m.AppShellComponent),
    children: [
      {
        path: 'dashboard',
        data: { title: 'Dashboard' },
        loadComponent: () =>
          import('./pages/dashboard/dashboard').then((m) => m.DashboardPage),
      },
      {
        path: 'projects/new',
        data: { title: '新增案件' },
        loadComponent: () =>
          import('./pages/new-project/new-project').then((m) => m.NewProjectPage),
      },
      {
        path: 'projects/:id/edit',
        data: { title: '管理案件' },
        canDeactivate: [projectEditCanDeactivate],
        loadComponent: () =>
          import('./pages/project-edit/project-edit').then((m) => m.ProjectEditPage),
      },
      {
        path: 'projects/:id',
        data: { title: '案件詳情' },
        loadComponent: () =>
          import('./pages/project-detail/project-detail').then((m) => m.ProjectDetailPage),
      },
      {
        path: 'projects',
        data: { title: '案件管理' },
        loadComponent: () => import('./pages/projects/projects').then((m) => m.ProjectsPage),
      },
      {
        path: 'about',
        data: { title: '關於系統' },
        loadComponent: () => import('./pages/about/about').then((m) => m.AboutPage),
      },
      ...devPreviewRoutes,
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard',
      },
      {
        path: '**',
        redirectTo: 'dashboard',
      },
    ],
  },
];
