# Phase 5A — Project REST API 與資料契約草案

狀態：**Phase 5A 原始契約草案；以下「前端現況」維持 2026-10-09 的歷史快照**。目前後端已實作案件 CRUD、Transition、Soft Delete、列表查詢與全域統計；Angular 正式頁面已改用 `ProjectApiService` 與 PostgreSQL API，舊記憶體 `ProjectService` 仍供舊測試使用。Phase 6A-1 僅增加 User／Session 資料模型，**Auth 尚未實作**。歷史遷移順序見 [phase-5a-migration-plan.md](./phase-5a-migration-plan.md)。

## 1. 已確認的前端現況

來源：[Project domain](../src/app/project.ts)、[ProjectService](../src/app/services/project.service.ts)、[routes](../src/app/app.routes.ts)。

| 項目 | 現況 |
| --- | --- |
| `Project` | `id: number`、`projectCode: string`、`name: string`、`description: string \| null`、`status: ProjectStatus`、`priority: ProjectPriority`、`startDate/dueDate: string \| null`、`createdAt/updatedAt: string`。 |
| `ProjectStatus` | `pending`、`in_progress`、`completed`、`cancelled`；中文標籤由前端 `PROJECT_STATUS_LABELS` 映射。 |
| `ProjectPriority` | `low`、`medium`、`high`、`urgent`；中文標籤由前端 `PROJECT_PRIORITY_LABELS` 映射。 |
| `CreateProjectInput` | 必填 `name`；選填 `description`、`priority`、`startDate`、`dueDate`。無 `status/id/projectCode/timestamps`。 |
| `UpdateProjectInput` | 以上五個欄位皆選填；沒有 `status`。 |
| Service API | 同步的 `getProjects(): Project[]`、`getProjectById(id): Project \| undefined`、`addProject(input)`、`updateProject(id,input)`、`transitionProjectStatus(id,nextStatus)`、`deleteProject(id): void`。讀取回傳淺拷貝。 |
| `ProjectMutationResult` | 成功 `{success:true,project}`；失敗 `{success:false,reason}`，reason 為 `invalid-name`、`invalid-description`、`invalid-priority`、`invalid-date`、`not-found`、`invalid-transition`。`deleteProject` 例外地沒有結果。 |
| 儲存與重整 | `providedIn:'root'` Service 中的 3 筆開發 seed + 記憶體陣列；沒有 HttpClient、backend、database 或案件 localStorage。重新載入頁面會重新建立 Service，案件異動消失。`sessionStorage` 只用於 App Intro，與案件無關。 |

目前 [Projects Page](../src/app/pages/projects/projects.ts) 每次從 `getProjects()` 取全量資料，在瀏覽器依名稱與狀態篩選，刪除直接呼叫 `deleteProject()`；[ProjectList](../src/app/project-list/project-list.ts) 只接收資料、輸出刪除事件並提供 Detail/Edit 連結。[New Project](../src/app/pages/new-project/new-project.ts) 表單驗證後同步呼叫 `addProject()`，成功即導回列表。[Detail](../src/app/pages/project-detail/project-detail.ts) 隨 route param 以 `getProjectById()` 載入 signal；轉換成功以 Service 回傳的 Project 更新 signal，取消／重新開啟／恢復有頁內確認。[Edit](../src/app/pages/project-edit/project-edit.ts) 隨 route param 同步載入、送出 `updateProject()` 後導回 Detail。[Dashboard](../src/app/pages/dashboard/dashboard.ts) 多次讀取完整陣列：計數、待處理前 5 筆、依 `updatedAt` 排序的最近 5 筆；完成率為 `completed / (total - cancelled)`，分母為 0 時為 0%。

現有測試：[Service workflow](../src/app/services/project.service.spec.ts) 覆蓋 4×4 transition matrix、非法轉換不變更資料、timestamp/metadata、找不到案件、建立為 pending、重複名稱可用；[Detail](../src/app/pages/project-detail/project-detail.spec.ts) 覆蓋操作、確認、Badge/Actions 同步及 route id 切換；[Dashboard](../src/app/pages/dashboard/dashboard.spec.ts) 覆蓋狀態統計更新；[List](../src/app/project-list/project-list.spec.ts) 覆蓋 Detail/Edit 入口與無直接完成操作。**尚無** HTTP、資料庫、跨 session 持久化、New/Edit API 失敗或 Delete 錯誤的測試；現有 `app.spec.ts` 仍有舊的預設標題斷言，不能視為完整回歸保護。

### 現況與目標契約的差異（不在 5A 修改程式）

- 表單有 `name` 最長 50 的驗證，但 Service 的 create/update 僅驗證 trim 後非空；create 也未檢查 priority 是否為列舉。後端必須完整驗證，不能照搬 Service 的缺口。
- Service 對執行期額外傳入的 create `status` 是**忽略並建立 pending**；下述 HTTP 草案選擇**明確拒絕唯讀欄位**。兩者都不允許藉此建立 completed/cancelled，但錯誤行為不同。
- `deleteProject()` 對不存在 ID 靜默完成；HTTP 草案改為 404。列表目前無分頁、刪除確認或 HTTP 失敗狀態。
- `nextProjectId()` 與年度 code 都依目前仍存在的記憶體資料取最大值再加一；刪除最大值後可能重用，亦不能處理多人併發。正式 code/ID 必須由後端與資料庫保證。
- `updateProject()` 對有效輸入即更新 `updatedAt`，即使值相同；草案維持此簡單語意，真正的併發控制另列待決策。

## 2. 共通契約

- 基礎路徑 `/api/projects`；JSON 欄位使用 camelCase、枚舉值使用上述穩定英文值。API **不傳中文 UI label**。
- 暫定 `id` 為正整數 JSON number（須落在 JavaScript safe integer 範圍）；是否改 UUID 為上線前決策，**本階段不更改前端型別**。URL `:id` 非合法正整數回 400，不存在回 404。
- `projectCode` 是不可修改的業務識別碼；可沿用 `PRJ-YYYY-NNNN`（序號至少 4 位，超過 9999 時擴位而非重置）。`name` 允許重複，不能作為唯一鍵。
- `startDate` / `dueDate` 是日曆日期 `YYYY-MM-DD` 或 `null`；`createdAt` / `updatedAt` 是帶時區的 ISO 8601 timestamp，建議 API 統一回 UTC `Z`。不要把 date-only 當成午夜 timestamp，也不要將格式化中文日期存入資料模型。
- 成功單筆：`{"data": Project}`；列表：`{"data": Project[], "meta": {"total": number, "limit": number, "offset": number}}`。`DELETE 204` 依 HTTP 語意**沒有 body**，是唯一例外。錯誤統一為第 5 節格式。
- API 拒絕未知或唯讀欄位；POST/PATCH 的 `status` 不可改變初始或現有狀態。只有 `/transitions` 可改狀態。伺服器要重新驗證每一筆請求，不能信任 Angular form。

完整 `Project` response 範例（以下單筆 endpoint 都使用此形狀）：

```json
{
  "data": {
    "id": 3,
    "projectCode": "PRJ-2025-0001",
    "name": "後台管理系統",
    "description": "建立內部案件管理與追蹤作業的後台系統。",
    "status": "completed",
    "priority": "medium",
    "startDate": "2025-12-18",
    "dueDate": "2026-01-09",
    "createdAt": "2025-12-18T09:00:00.000Z",
    "updatedAt": "2026-01-03T08:00:00.000Z"
  }
}
```

## 3. Endpoint 一覽

| Endpoint | 用途與 request | 成功 response | 主要錯誤 |
| --- | --- | --- | --- |
| `GET /api/projects` | 列表；選填 `q`、`status`、`limit`、`offset`、`sort` query | 200 `ProjectListResponse` | 400 無效 query；未來 401/403 |
| `GET /api/projects/stats` | 全部未刪除案件的四種狀態計數；無 query | 200 `{data: ProjectStats}` | 未來 401/403 |
| `GET /api/projects/:id` | 依 numeric id 讀取 | 200 `ProjectResponse` | 400 無效 id、404 不存在 |
| `POST /api/projects` | 建立；body = `CreateProjectInput`，不接受 status | 201 `ProjectResponse`，`Location: /api/projects/{id}` | 400 格式錯誤、422 欄位錯誤 |
| `PATCH /api/projects/:id` | 局部修改 metadata；body = 非空 `UpdateProjectInput` | 200 `ProjectResponse` | 400 無效請求、404、422；併發衝突策略待決 |
| `POST /api/projects/:id/transitions` | body `{"toStatus": ProjectStatus}`；以 DB 當下狀態判斷 | 200 `ProjectResponse` | 400 格式錯誤、404、409 非法／競爭轉換、422 無效枚舉 |
| `DELETE /api/projects/:id` | Soft Delete；保留資料列與 projectCode，一般 GET 不再取得 | 204、無 body | 400 無效 id、404 不存在／已刪除；未來 403 |

`/stats` 已在 `/:id` 前註冊，避免將 `stats` 當成 numeric id。Dashboard 現在依**全量陣列**計算，而分頁列表只含一頁；改接 API 時不可用當頁 `data.length` 推算全域 KPI。

### `GET /api/projects`

`q` **只搜尋案件名稱 `name`**，不搜尋 `projectCode` 或 `description`，與目前正式 Projects 頁一致。後端先 trim；未提供、空字串或僅空白均不套用搜尋。trim 後最多 100 個 Unicode code points，超過或非單一字串回 400 `INVALID_QUERY`。PostgreSQL 經 Prisma `contains` 做部分匹配，英文不分大小寫；繁體中文可做部分匹配，CJK/重音字元的完整 collation 規則仍依 DB 實測。`status` 只接受 `pending/in_progress/completed/cancelled`，省略代表全部；不合法值回 400 `INVALID_QUERY`。`limit` 預設 20、範圍 1–100；`offset` 預設 0；`sort` 只接受 `updatedAt:desc`，同時間以 `id:desc` 穩定排序。Prisma 在資料庫先套用 `deletedAt IS NULL` **AND** q **AND** status 條件，再分頁；`meta.total` 是**相同條件下、尚未分頁**的總數。空結果是 200 + `data: []`，不是 404。分頁期間有併發修改時可能出現跨頁位移；cursor pagination 留待需要時評估。

例如 `GET /api/projects?q=官網&status=in_progress&limit=20&offset=0`；符合條件的未刪除案件才進入排序及分頁。Angular 正式 Projects 頁現已透過 `ProjectApiService.getProjects({q, status, limit, offset})` 查詢 API。

範例 `GET /api/projects?status=pending&limit=5&offset=0&sort=updatedAt:desc` → 200：

```json
{
  "data": [{
    "id": 2,
    "projectCode": "PRJ-2026-0002",
    "name": "會員系統開發",
    "description": "規劃並實作新版會員註冊、登入與帳戶管理流程。",
    "status": "pending",
    "priority": "urgent",
    "startDate": "2026-02-02",
    "dueDate": "2026-05-29",
    "createdAt": "2026-01-10T09:00:00.000Z",
    "updatedAt": "2026-01-10T09:00:00.000Z"
  }],
  "meta": { "total": 1, "limit": 5, "offset": 0 }
}
```

### `GET /api/projects/:id`

範例 `GET /api/projects/3` → 200：使用第 2 節完整 `{"data": Project}` JSON。`GET /api/projects/999999` → 404：

```json
{ "error": { "code": "PROJECT_NOT_FOUND", "message": "找不到案件。" } }
```

### `POST /api/projects`

`name` 必填；其餘選填，預設 `description/startDate/dueDate = null`、`priority = medium`。伺服器產生 `id/projectCode/status=pending/createdAt/updatedAt`，且建立時兩個 timestamp 相同。即使請求帶 `status: "completed"` 也**不能建立 completed**；草案回 422 `READ_ONLY_FIELD`。範例 request：

```json
{
  "name": "客服流程改善",
  "description": "整理客服回覆與升級流程。",
  "priority": "high",
  "startDate": "2026-10-12",
  "dueDate": "2026-12-31"
}
```

範例 201 response（`Location: /api/projects/42`）：

```json
{
  "data": {
    "id": 42,
    "projectCode": "PRJ-2026-0004",
    "name": "客服流程改善",
    "description": "整理客服回覆與升級流程。",
    "status": "pending",
    "priority": "high",
    "startDate": "2026-10-12",
    "dueDate": "2026-12-31",
    "createdAt": "2026-10-09T12:00:00.000Z",
    "updatedAt": "2026-10-09T12:00:00.000Z"
  }
}
```

上述 id/code/time **僅為契約範例，不是實際新增案件**。

### `PATCH /api/projects/:id`

只接受 `name/description/priority/startDate/dueDate`；至少提供一個欄位。省略表示不變，`description/startDate/dueDate: null` 表示清除，不能用 `null` 清除 name/priority。範例 `PATCH /api/projects/42` request：

```json
{ "name": "客服流程優化", "dueDate": "2027-01-15" }
```

範例 200 response：

```json
{
  "data": {
    "id": 42,
    "projectCode": "PRJ-2026-0004",
    "name": "客服流程優化",
    "description": "整理客服回覆與升級流程。",
    "status": "pending",
    "priority": "high",
    "startDate": "2026-10-12",
    "dueDate": "2027-01-15",
    "createdAt": "2026-10-09T12:00:00.000Z",
    "updatedAt": "2026-10-09T12:10:00.000Z"
  }
}
```

驗證須看合併後的日期區間；有效 PATCH 更新 `updatedAt`，`createdAt` 不變。傳入 `status/id/projectCode/createdAt/updatedAt` 應回 422 `READ_ONLY_FIELD`，不能靜默忽略。

### `POST /api/projects/:id/transitions`

範例 `POST /api/projects/42/transitions` request：

```json
{ "toStatus": "in_progress" }
```

範例 200 response：

```json
{
  "data": {
    "id": 42,
    "projectCode": "PRJ-2026-0004",
    "name": "客服流程優化",
    "description": "整理客服回覆與升級流程。",
    "status": "in_progress",
    "priority": "high",
    "startDate": "2026-10-12",
    "dueDate": "2027-01-15",
    "createdAt": "2026-10-09T12:00:00.000Z",
    "updatedAt": "2026-10-09T12:15:00.000Z"
  }
}
```

Service 讀取未刪除案件的狀態並檢查 matrix，再以 `id + status + updatedAt + deletedAt IS NULL` 原子條件更新；非法、same-state 或競爭後失敗回 409，已刪除回 404，且不更動資料。合法轉換完整清單：

| From | To |
| --- | --- |
| `pending` | `in_progress`、`cancelled` |
| `in_progress` | `pending`、`completed`、`cancelled` |
| `completed` | `in_progress` |
| `cancelled` | `pending` |

### `DELETE /api/projects/:id`

範例 `DELETE /api/projects/42` → **204 No Content，沒有 request/response JSON body**。Phase 5C.2B-2 已定案為 Soft Delete：單一 PostgreSQL 條件更新只接受 `id` 存在且 `deleted_at IS NULL` 的資料列，將 `deleted_at` 與 `updated_at` 設為伺服器時間；原 `status`、`createdAt`、`projectCode` 與其他 metadata 不變。無效 ID 回 400 `INVALID_ID`，不存在或重複刪除回 404 `PROJECT_NOT_FOUND`，不重複修改。已刪除案件不列入一般 GET 的資料、總數或分頁；單筆 GET、PATCH 與 Transition 視為 404。`deletedAt` 是內部欄位，不加入一般 Project DTO，不得由 POST/PATCH/Transition 客戶端寫入。`cancelled` 是獨立的業務狀態，仍可見。Restore／Hard Delete／回收站**尚未實作**；若未來需要，應另訂權限與 API 契約。

### `GET /api/projects/stats`

範例 200：

```json
{
  "data": {
    "total": 42,
    "pending": 8,
    "inProgress": 21,
    "completed": 10,
    "cancelled": 3
  }
}
```

以上數字僅示範格式。後端以 PostgreSQL 的全部未刪除案件分組計算，包含 `cancelled`；`total` 是四種狀態數量加總，空集合各欄均為 0。前端依現有規則計算完成率 `completed / (total - cancelled)`；`total - cancelled = 0` 時顯示 0%。這是**全域**聚合，不受列表 q/status/分頁影響；權限範圍未來需與 Auth 定義一致。

## 4. 驗證與時間／識別碼規則

| 規則 | 後端責任；DB 防線見第 6 節 |
| --- | --- |
| 名稱 | trim 後非空、最多 50 字元；允許重複。字元計數建議明訂為 Unicode code points；現有 Angular `maxLength` 使用 JavaScript 長度，遇到 emoji 可能不一致，前端遷移時須對齊。 |
| 描述 | trim 後空字串存 `null`，非空最多 4000 字元；長文字以 `TEXT` 類型儲存。 |
| Priority | 只能是 `low/medium/high/urgent`，create 省略則 `medium`。 |
| 日期 | 僅接受真實存在的 `YYYY-MM-DD`；兩日期都存在時 `dueDate >= startDate`。不接受無時區的 timestamp 代替 date-only。 |
| Status | create 只能由後端設 `pending`；PATCH 不可改；transition 只允許上表，same-state 拒絕。 |
| Timestamp | `createdAt/updatedAt` 由後端產生；合法 mutation 的後者應嚴格晚於原值，不修改前者。DB/API 保留時區資訊；跨節點時間單調性及精度須由選定 DB/交易實作保證。 |
| Code | 同一建立交易內按年度安全分配，不從前端或 `MAX(projectCode)+1` 計算；有唯一索引作最後防線。目前正式後端採 UTC 年份；日後若改公司時區須另行決策與遷移。 |

## 5. Error Contract

共通格式；`details` 僅放安全、可供客戶端處理的上下文，不放 SQL、stack trace 或內部路徑。`fieldErrors` 的 key 對應 request 欄位，值為可機讀 code + 可顯示 message 的陣列。所有錯誤可附 `requestId` 供查詢日誌，但不把內部日誌傳給前端。

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "請修正案件資料。",
    "fieldErrors": {
      "name": [{ "code": "TOO_LONG", "message": "案件名稱不可超過 50 個字元。" }],
      "dueDate": [{ "code": "BEFORE_START_DATE", "message": "預計完成日期不可早於開始日期。" }]
    },
    "requestId": "req-example-123"
  }
}
```

| HTTP | `error.code` 範例 | 使用時機 |
| --- | --- | --- |
| 400 | `MALFORMED_REQUEST`、`INVALID_ID`、`INVALID_QUERY` | JSON 解析失敗、頂層結構/型別錯誤、無效 path/query 或空 PATCH。 |
| 404 | `PROJECT_NOT_FOUND` | 合法 ID 但案件不存在或依刪除策略不可見。 |
| 409 | `INVALID_TRANSITION`、`CONFLICT` | 非法／same-state 轉換、交易競爭；不可用模糊 boolean。 |
| 422 | `VALIDATION_ERROR`、`READ_ONLY_FIELD` | 已可解析的欄位值不合法、超長、日期區間、未知 priority/status 或企圖寫入唯讀欄位。 |
| 401/403（Phase 5A 歷史草案） | `UNAUTHENTICATED`、`FORBIDDEN` | 此列為當時規劃；目前 Phase 6A-2A 的實際 Auth／CSRF 錯誤碼見 [Auth 契約](phase-6a-2a-auth-contract.md)。 |
| 500 | `INTERNAL_ERROR` | 不暴露內部細節；以 requestId 在伺服器查因。 |

非法轉換範例（例如 `pending → completed`）：

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "目前案件狀態不允許此操作。",
    "details": { "currentStatus": "pending", "requestedStatus": "completed" }
  }
}
```

客戶端收到 409 應重新讀取案件，再顯示最新可用操作；422 對應表單欄位；網路/500 顯示可重試狀態。若未來採 ETag/`If-Match`，版本不符可改用 412，需在版本化契約中定案。

## 6. Database 草案（邏輯 schema，尚未選 DBMS）

| `projects` 欄位 | 建議邏輯型別 | Nullable / 約束 |
| --- | --- | --- |
| `id` | 產生式 64-bit integer PK | NOT NULL、PK；API 暫保證 JSON safe integer。UUID 是待決策替代方案。 |
| `project_code` | VARCHAR(32) | NOT NULL、UNIQUE、建立後不可改；格式檢查視 DBMS 能力。 |
| `name` | VARCHAR(50) | NOT NULL；trim 後非空、長度 <=50；**不設 UNIQUE**。 |
| `description` | TEXT | NULL；非空最多 4000 字元。 |
| `status` | VARCHAR(16) | NOT NULL、CHECK 四個穩定值、預設 `pending`。 |
| `priority` | VARCHAR(16) | NOT NULL、CHECK 四個穩定值、預設 `medium`。 |
| `start_date` / `due_date` | DATE | NULL；兩者皆有值時 CHECK `due_date >= start_date`。 |
| `created_at` / `updated_at` | timezone-aware timestamp | NOT NULL；由伺服器/DB 在寫入時產生，`updated_at >= created_at`。具體型別依 DBMS。 |
| `deleted_at` | PostgreSQL `TIMESTAMPTZ(3)` | NULL 代表有效案件；非 NULL 代表軟刪除，不屬於 `ProjectStatus`。2026-10-10 已由版本化 migration 增加。 |

索引起點：PK(id)、UNIQUE(project_code)、`(status, updated_at DESC, id DESC)` 支援狀態列表、`(updated_at DESC, id DESC)` 支援最近更新。名稱包含搜尋不保證一般 B-tree 有效；全文/特定索引需依 DBMS、資料量與實際查詢計畫再決定，不提前建一堆索引。

**DB/交易必保證**：id 與 projectCode 唯一、code 不因刪除重用、status/priority 值範圍、日期區間、交易內原子狀態轉換、必要欄位非空；後端負責欄位白名單、trim/長度/真實日期、錯誤映射、權限（未來）及交易流程。DB constraint 是最後防線，不取代友善的 422 欄位錯誤。

年度 code 可用持久化的年度計數器（例如 `project_code_counters(year, next_sequence)`）在同一 DB transaction 中鎖定／原子遞增，並以 `projects.project_code UNIQUE` 防碰撞；不可用查詢目前最大 code 再加一。年份採用的時區、跨年瞬間及序號超過四位的表示需先定案。開發 seed 與正式序號應分離；目前 3 筆只是開發資料，不應冒充正式歷史案件。

Schema/migration 建議順序：選定 DBMS 與 migration 工具 → 建立 `projects`、唯一鍵、CHECK 與必要索引 → 匯入明確標示為 dev 的冪等 seed 並驗證 code/日期 → 在啟用寫入前建立年度計數器並以每年既有最大 code + 1 初始化 → API 整合測試 → 再評估正式資料搬遷。這個初始化只用於一次性 migration；日常建立案件仍須交易內原子取號，不能每次 `MAX()+1`。現有 memory 狀態在重整後即消失，沒有可直接自動遷移的正式資料庫來源。

Delete **已定案為 Soft Delete**：`deleted_at` 透過 `20261010000200_project_soft_delete` 增量加入；一般查詢在資料庫篩選 `NULL`，PATCH／Transition 的實際寫入條件也檢查 `NULL`，projectCode 永不重用。現有排序索引仍可用；目前不新增部分索引，待資料量與刪除比例升高時以查詢計畫評估。Restore、保存期限、權限與未來關聯資料的語意仍待決策；Auth、User/Task、Activity log、樂觀併發版本欄位尚未在此階段建表。

## 7. 必須決策、不得視為已確認

1. Backend 框架／部署方式與 DBMS（例如 PostgreSQL、SQL Server；依公司既有維運能力選擇）。
2. Auth/Roles 與 API 資料可見範圍；沒有它們的 API 不可作為公司正式對外服務。
3. Soft Delete 已確定；是否允許復原、保存期限、復原權限與未來關聯資料的刪除語意仍待決策。
4. numeric ID 延續或 UUID；若延續 64-bit ID，JSON safe integer 的長期界線。
5. 併發控制：至少交易內驗證轉換；PATCH 是否需 ETag/版本欄位，避免多人覆寫。
6. Project code 年份採 UTC 或公司時區、序號擴位規則、dev seed 與正式序號隔離。
7. 搜尋 collation/排序、分頁上限與 Dashboard 使用 stats endpoint 的前端切換時機。
8. 名稱／描述的 Unicode「字元」計數規則，確保 Angular、Backend、DB 一致。

以上選項須在對應 implementation phase 開始前確認；Phase 5A 不新增 HttpClient、Backend、Database 或任何執行碼。
