# Case Management Backend

本目錄是**獨立**的 NestJS 11 + Prisma 7 + PostgreSQL 後端。Angular 正式頁面已透過 `ProjectApiService` 使用本 API；舊記憶體 `ProjectService` 仍留供舊測試使用。案件 API 已要求有效 Admin Session；Angular 登入 UI 已加入，但真實帳號驗收、最終 RBAC 與部署安全驗收尚未完成，**僅供本機開發，不可部署至公司或公開網路**。啟動時只綁定 `127.0.0.1`。案件資料契約見 [Phase 5A](../docs/phase-5a-api-contract.md)，登入契約見 [Phase 6A-2A](../docs/phase-6a-2a-auth-contract.md) 與 [Phase 6A-2B](../docs/phase-6a-2b-angular-auth.md)。

## 環境需求與設定

- Node.js >=22.18.0、npm；已在 Node 24.20.0 / npm 11.19.0 編譯。
- PostgreSQL。可使用已安裝的 PostgreSQL，或可選的 `compose.yaml`（PostgreSQL **17.11-bookworm**，僅綁本機 5432，持久化 volume）。Docker 不會由本專案自動安裝。
- 3000 與 5432 未被占用。本機 Angular 預設 4200；`APP_ORIGIN` 控制允許的 Origin，開發預設 `http://localhost:4200`。

在 `backend/` 目錄執行：

```powershell
Copy-Item .env.example .env
npm ci
```

編輯**未追蹤**的 `.env`，將 `POSTGRES_PASSWORD` 和兩個連線 URL 改成一致的本機專用密碼，並為 `CSRF_SECRET` 產生至少 32 bytes 的唯一隨機值。密碼若含 `@`、`:`、`/` 等字元，URL 內須先 percent-encode。`.env` 被 `backend/.gitignore` 排除，請勿提交正式憑證。正式環境必須以部署環境變數提供秘密，且 `APP_ORIGIN` 必須是單一 HTTPS Origin。

若有 Docker Compose，可在 `backend/` 執行：

```powershell
docker compose up -d db
docker compose ps
```

沒有 Docker 時，請自行建立 PostgreSQL `case_management_dev` 資料庫與有權建立 schema/table 的本機使用者，並設定 `.env` 的 `DATABASE_URL`。不需要修改 Angular 設定。

## Migration、seed 與啟動

目前 **不要直接對 `case_management_dev` 執行 `db:migrate` 或 `admin:bootstrap`**。先確認備份、目標資料庫及可恢復方式；完成審閱後才依序執行 `npm run db:migrate`、`npm run build`、`npm run admin:bootstrap`（互動式）、`npm run start`。`db:seed` 是另外選擇的開發資料操作，不屬於登入啟用的必要步驟。

`db:migrate` 使用**版本化** Prisma Migrate `deploy`，不是 `db push`。初始 migration 含 PostgreSQL CHECK 約束；`20261010000100_project_code_counters` 只新增年度計數表；`20261010000200_project_soft_delete` 僅增加 nullable 的 `deleted_at TIMESTAMPTZ(3)`，既有列保持 `NULL`、不重建資料表；`20261012000100_users_sessions` 只新增員工／Session 表、枚舉與 Email 正規化 trigger，不修改案件或年度計數資料。**本次 migration 只在 `case_management_test` 套用；尚未對 `case_management_dev` 執行。**`db:seed` 必須**手動**執行，不會在 production 自動執行；腳本只允許資料庫名稱以 `_dev` 或 `_test` 結尾，且拒絕 `NODE_ENV=production`。Seed 以不可變的 `projectCode` 直接查詢資料庫、並以 `skipDuplicates` 建立缺少的三筆開發案件；已軟刪除但仍保有 code 的列不會被重建或復活。建立案件時採 **UTC 年份**、至少四位序號（超過 9999 自動擴位）；交易內原子分配，23 位數已滿回 409。

本階段 id 使用 PostgreSQL `INTEGER` / Prisma `Int`，與 Angular `number` 完全相容；這比 Phase 5A 建議的 64-bit logical ID 範圍小，未來若要跨越 32-bit 上限，必須另做 ID 遷移與 JSON 安全範圍決策。

## 員工與 Session（Phase 6A-1／2A）

`users` 儲存姓名、正規化 Email、可空的 `password_hash`、`admin/manager/staff` 角色、`pending_activation/active/disabled` 狀態及時間欄位。PostgreSQL 在 Email 寫入前執行 `lower(btrim(email))`，再以 UNIQUE index 防重。登入與首位 Admin Bootstrap 已採 Argon2id；待啟用／停用帳號不能登入。沒有預設 Admin 或公開註冊。

`sessions` 以外鍵連結 User，只存高熵 token 的 SHA-256 `token_hash`，不存 Cookie 原始 token。伺服器驗證撤銷與到期，登入輪替 Session，登出撤銷，停用 User 立即使其 Session 不可用。預設閒置 8 小時、絕對 24 小時。`GET /api/auth/csrf`、`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout` 已提供；CSRF 使用獨立可讀 XSRF Cookie、header 與伺服器 HMAC 驗證。詳見 [Auth 契約](../docs/phase-6a-2a-auth-contract.md)。

## 案件 API

以下案件 API 均要求有效 Admin Session；未登入通常回 401，Manager／Staff 暫回 403。若寫入請求連 CSRF Token 都缺少，會先回 403 `CSRF_INVALID`。不能直接匿名以 `Invoke-RestMethod` 試用。

列表支援 `q`（**只搜尋案件名稱**，不搜尋編號或描述；部分匹配、英文不分大小寫）、`status`（`pending/in_progress/completed/cancelled`）、`limit`（1–100，預設 20）、`offset`（預設 0）、`sort=updatedAt:desc`。例如 `GET /api/projects?q=官網&status=in_progress&limit=5&offset=0`。`q` 先 trim；省略、空字串或只有空白視為未搜尋；trim 後最多 100 個 Unicode code points，超過或重複／非單一字串回 400 `INVALID_QUERY`。不合法 status 也回 400 `INVALID_QUERY`。在 PostgreSQL 先套用未刪除 **AND** q **AND** status，再依 `updatedAt DESC, id DESC` 排序並分頁；`meta.total` 是相同條件下的未分頁總筆數。單筆成功回 `{ "data": Project }`；無效 id 回 400 `INVALID_ID`；合法但不存在的 id 回 404 `PROJECT_NOT_FOUND`。`DATE` 欄位回 `YYYY-MM-DD`，timestamp 回 UTC ISO 8601。

`GET /api/projects/stats` 不接受列表分頁，直接從全部未刪除案件取得四種狀態計數，`cancelled` 仍納入。回應格式為 `{ "data": { "total": 0, "pending": 0, "inProgress": 0, "completed": 0, "cancelled": 0 } }`（數字由資料庫決定；空集合才全為 0）；`total` 等於四項加總。Dashboard 的完成率仍由前端按 `completed / (total - cancelled)` 計算，分母為 0 時是 0%。

`POST /api/projects` 接受 `name`、`description`、`priority`、`startDate`、`dueDate`；成功為 201，回完整 `{ "data": Project }` 與 `Location`，初始狀態一律 `pending`、優先級預設 `medium`。`PATCH /api/projects/:id` 對這五欄做部分更新，成功為 200；`description/startDate/dueDate` 可用 `null` 清除。兩者都拒絕未知與唯讀欄位，欄位錯誤回 422 `fieldErrors`。PATCH 日期區間會與資料庫中未修改的日期一起驗證。所有寫入還要求 CSRF Token；**目前系統尚不可正式部署**。

`POST /api/projects/:id/transitions` 只接受 `{ "toStatus": ProjectStatus }`，由後端驗證既有七條合法狀態轉換；非法或同狀態回 409。`DELETE /api/projects/:id` 將 `deleted_at` 與 `updated_at` 設為伺服器時間，成功回 **204、無 body**。重複刪除、找不到或已刪除案件回 404 `PROJECT_NOT_FOUND`；無效 ID 回 400 `INVALID_ID`。一般 GET 列表、總數、分頁與單筆均只看 `deleted_at IS NULL` 的案件；PATCH／Transition 的實際寫入條件也要求未刪除。`cancelled` 仍是可見的業務狀態，不等於刪除。`deletedAt` 不屬於一般 Project 回應，也不能由 Client 傳入。本階段沒有 Restore／Hard Delete API 或回收站。

## 測試分層

```powershell
npm test
npm run build
```

`npm test` 執行不需資料庫的 Service 單元與 Mock Prisma 的 HTTP 測試；**不能**證明 PostgreSQL、migration 或 seed 成功。

真實 DB 測試必須使用獨立的 `case_management_test` 資料庫。以 Compose 預設使用者為例，先建立測試 DB（已有時不要重建）：

```powershell
docker compose exec db createdb -U case_dev case_management_test
npm run test:db
```

`test:db` 只接受 `TEST_DATABASE_URL`，且會檢查它不同於 `DATABASE_URL`、資料庫名**恰為** `case_management_test`；接著以測試 URL 執行 migration，再跑**真實 PostgreSQL** HTTP／seed／併發整合測試。測試建立的 `[5C2A]`／`[5C2B]`／`[5C3B0]`／`[5C3B1]` 案件與 `@phase6a-model.test`／`@phase6a-auth.test` 員工／Session 會清理，已用過的案件編號不重用；固定 seed 列若被測試暫時軟刪除會還原。絕不可指向正式或開發 DB。

## 未實作與下一階段前提

- Angular 登入 UI 已加入，但尚未以真實帳號／瀏覽器驗收；暫行權限僅 Admin 可使用案件 API。勿開放網路或使用真實公司資料。`npm run admin:bootstrap` 僅在備份、確認目標 DB 且已套用 Migration 後手動執行；尚未對開發 DB 執行。
- 已有 Dashboard 全域計數 API，但尚無 Restore 或 Hard Delete API。PATCH 尚未加入多人編輯的 ETag／版本衝突控制；目前同一案件的 PATCH 會鎖列，驗證日期一致性，但一般欄位仍是最後寫入者覆蓋。Soft Delete 的保留期限、復原權限及容量管理仍待正式上線前決策。
- 上線前需完成 Angular 登入整合、最終 RBAC、共用登入節流、HTTPS／Cookie／CSRF 驗收，並決策 Soft Delete 保存／復原政策、完整併發控制及案件編號年份時區。

## Prisma 傳遞依賴安全紀錄（Phase 5B.2）

Prisma 7.10.0 是檢查時最新的穩定 7.x；`@prisma/config@7.10.0` 仍精確依賴有遞迴物件耗盡堆疊問題的 `deepmerge-ts@7.1.5`，Prisma CLI 亦依賴有安全公告的 `mysql2@3.15.3`。為避免安裝 Prisma 8 RC 或降回 Prisma 6，`package.json` 暫以**精確** overrides 固定 `deepmerge-ts@8.0.2`、`mysql2@3.24.5`。

2026-10-09 本機驗證：`npm audit --omit=dev` 由 4 high 降至 0；`prisma validate`、`prisma generate`、backend build、單元／Mock HTTP 測試 17/17，以及獨立 `case_management_test` PostgreSQL 測試 3/3 均通過。測試資料庫 migration 顯示無待套用項目；這不代表 Prisma 上游已正式承諾跨 major override 相容。

完整的 `npm audit`（包含 devDependencies）仍回報 29 high、5 moderate 的套件節點警告，主要落在現有 Jest 29 測試工具鏈；這些不是本次 Prisma override 的修補範圍，也不能把 production audit 為零解讀為整個開發供應鏈無風險。日後升級測試工具須另行評估相容性與測試結果。

`deepmerge-ts` 8 是跨 major 變更：Map 值合併、`deepmergeInto` 修改來源的行為及部分型別名稱改變。Prisma config 已知只將一般 `deepmerge` 傳給 `c12` 作為設定合併器，沒有使用上述改名型別或 `deepmergeInto`；但這不是 Prisma 官方相容保證。每次 Prisma 7 更新後應先檢查其相依版本與設定載入行為，若上游已修補，**移除 overrides** 並重新執行 audit、Prisma CLI、build、HTTP 與獨立測試 DB 整合測試。不可只憑 audit 為零便推定跨 major 相容。

本專案使用 PostgreSQL，不使用 MySQL 連線；`mysql2` 位於 Prisma CLI 相依路徑，但仍須修補供應鏈警告。驗證紀錄以實際命令結果為準；測試 DB 腳本只接受獨立的 `*_test` URL，不會對 `case_management_dev` 執行 migration 或 seed。

追蹤來源：[deepmerge-ts 安全公告](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)、[Prisma 上游議題與使用點分析](https://github.com/prisma/orm/issues/30052)、[deepmerge-ts v8 變更](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)、[MySQL2 安全公告](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)。
