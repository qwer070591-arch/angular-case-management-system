import { ChangeDetectionStrategy, Component } from '@angular/core';

const FEATURES = [
  {
    title: '數據儀表板',
    description: '查看案件數量、狀態分布與完成率。',
    iconPath: 'M4 19.5h16M6.5 16v-5m5.5 5V5m5.5 11V9',
  },
  {
    title: '案件管理',
    description: '支援新增、查看、編輯及軟刪除案件。',
    iconPath: 'M8 4.5h8M8 19.5h8M5 8.5h14M5 15.5h14',
  },
  {
    title: '進度追蹤',
    description: '透過案件狀態掌握工作進度。',
    iconPath: 'M4.5 12h4l2.5 3 3.5-6 2.5 3h2.5M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z',
  },
  {
    title: '搜尋與篩選',
    description: '依案件名稱、狀態查找資料，支援分頁。',
    iconPath: 'M10.75 17.5a6.75 6.75 0 1 0 0-13.5 6.75 6.75 0 0 0 0 13.5Zm5-1.75L20 20M6.5 10.75H15',
  },
  {
    title: '員工登入',
    description: '透過 Session 管理登入狀態，保護案件資料。',
    iconPath: 'M12 3 5.5 6v5.5c0 4.1 2.5 7.1 6.5 9 4-1.9 6.5-4.9 6.5-9V6L12 3Zm-2.5 9 1.7 1.7 3.3-3.5',
  },
  {
    title: '響應式設計',
    description: '支援桌機、平板及手機操作。',
    iconPath: 'M3.5 5.5h17v11h-17v-11ZM8 20h8M12 16.5V20M15.5 9h2v4h-2V9Z',
  },
] as const;

const FRONTEND_TECHNOLOGIES = [
  'Angular 22', 'TypeScript', 'HTML5', 'CSS3', 'Angular Signals', 'Reactive Forms',
] as const;

const BACKEND_TECHNOLOGIES = ['NestJS 11', 'Prisma 7', 'PostgreSQL 17'] as const;

const PROJECT_HIGHLIGHTS = [
  'Standalone Components', 'Lazy Loading', 'API Integration',
  'Form Validation', 'Responsive Layout', 'Accessibility',
] as const;

@Component({
  selector: 'app-about-page',
  styleUrl: './about.css',
  templateUrl: './about.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutPage {
  readonly features = FEATURES;
  readonly frontendTechnologies = FRONTEND_TECHNOLOGIES;
  readonly backendTechnologies = BACKEND_TECHNOLOGIES;
  readonly highlights = PROJECT_HIGHLIGHTS;
}
