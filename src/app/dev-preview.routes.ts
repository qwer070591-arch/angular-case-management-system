import { Routes } from '@angular/router';

export const devPreviewRoutes: Routes = [
  {
    path: 'dev/api-preview',
    data: { title: 'API 測試畫面' },
    loadComponent: () =>
      import('./pages/dev-api-preview/dev-api-preview').then((m) => m.DevApiPreviewPage),
  },
];
