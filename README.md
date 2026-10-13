# 案件管理系統（Case Management System）

使用 **Angular 22 + NestJS + PostgreSQL** 開發的響應式案件管理系統，提供案件追蹤、狀態管理、資料查詢及員工登入功能。本專案以**前端開發、UI/UX 與 API 整合實作**為重點。

## 主要功能

- **儀表板**：案件總數、狀態統計、完成率與近期案件。
- **案件管理**：新增、檢視、編輯、軟刪除與自動產生案件編號。
- **進度追蹤**：依後端規則切換案件狀態。
- **搜尋與篩選**：依案件名稱、狀態查詢及分頁；條件同步至 URL，返回列表或重新整理後可保留。
- **表單體驗**：欄位驗證、錯誤提示、儲存狀態與未儲存離頁確認。
- **登入驗證**：員工登入／登出、伺服器端 Session、受保護路由與 CSRF 驗證。
- **響應式介面**：桌機表格、手機卡片，以及支援鍵盤操作的側邊選單。

## 技術架構

| 類別     | 技術                                                             |
| -------- | ---------------------------------------------------------------- |
| 前端     | Angular 22、TypeScript、Signals、Reactive Forms、RxJS、HTML、CSS |
| 後端     | NestJS 11、Node.js                                               |
| 資料庫   | PostgreSQL 17、Prisma 7                                          |
| 開發環境 | Docker Compose、npm                                              |

## 專案結構

```text
angular-project/
├── src/app/              # Angular 頁面、元件、路由與服務
├── backend/
│   ├── src/              # NestJS API、驗證與案件模組
│   ├── prisma/           # Schema 與 Migration
│   └── compose.yaml      # PostgreSQL Docker 設定
├── docs/                 # 開發與功能設計文件
└── proxy.conf.json       # Angular 開發環境 API Proxy
```

## 本機啟動

**需求：** Node.js 24、npm、Docker Desktop。以下以 Windows CMD 為例。

### 1. 安裝依賴

在專案根目錄執行：

```cmd
npm install
cd backend
npm install
```

### 2. 啟動資料庫及設定環境變數

在 `backend` 目錄執行：

```cmd
docker compose up -d db
```

設定 `backend/.env`，確認 `DATABASE_URL` 與 `CSRF_SECRET` 符合現有後端設定。`CSRF_SECRET` 必須是至少 32 bytes 的安全隨機密鑰。

其他環境設定請參考 `backend/README.md`。不要將 `.env` 或任何密碼提交到 GitHub。

### 3. 初始化資料庫與管理員

僅限首次建立的新開發資料庫。已有資料時，先備份並確認 Migration 狀態。

在 `backend` 目錄執行：

```cmd
npm run db:migrate
npm run build
npm run admin:bootstrap
```

管理員帳號透過互動式 CLI 建立，不使用預設密碼。

### 4. 啟動系統

終端機 A（backend）：

```cmd
npm run start:dev
```

終端機 B（專案根目錄）：

```cmd
npm run start
```

開啟 http://localhost:4200/login。

前端透過相對路徑 `/api` 與開發環境 Proxy 串接 NestJS（預設 `127.0.0.1:3000`）。

注意：目前後端 `start:dev` 並非自動監聽模式，修改後端程式後需要重新啟動。

## 測試與建置

前端專案根目錄：

```cmd
npx ng test --watch=false
npm run build
```

Backend 目錄：

```cmd
npm run test:unit
npm run test:db
npm run build
```

`test:db` 使用獨立的 `case_management_test` 資料庫，執行前應確認設定，避免指向開發資料庫。

## 權限與目前狀態

- 案件 API 目前採 **Admin-only** 暫行政策，Manager／Staff 的正式權限尚未開放。
- 已完成本機登入、Session、CSRF 與案件管理主要流程驗證。
- 目前屬於**本機開發與作品展示專案**，尚未完成正式部署所需的安全及維運規劃，不應直接用於公司正式生產環境。
