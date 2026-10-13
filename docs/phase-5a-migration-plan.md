# Phase 5A — 從 Memory Service 到 REST API 的遷移計畫

狀態：**Phase 5A 的歷史遷移計畫**。後端目前已完成案件 CRUD、Transition 與 Soft Delete；Angular 正式頁面也已切換至 `ProjectApiService`／PostgreSQL API。舊記憶體 Service 保留供舊測試使用。以下「目前」及階段表屬原規劃時點的歷史描述；Phase 6A-1 僅新增 User／Session 模型，Auth 尚未實作。契約見 [phase-5a-api-contract.md](./phase-5a-api-contract.md)。

## 1. 依賴盤點與遷移落點

**Phase 5A 當時**只有 [ProjectService](../src/app/services/project.service.ts) 持有案件陣列；`providedIn: 'root'` 讓同一個 Angular 執行期間的頁面共享資料，但重整即回到 3 筆開發 seed。當時沒有 `provideHttpClient()`、Backend、DB、案件 localStorage。App Intro 的 sessionStorage 標記不屬於案件資料。

| 消費者 | 現在如何取得／修改 | 改 API 時的具體變化 |
| --- | --- | --- |
| [Projects Page](../src/app/pages/projects/projects.ts) / [ProjectList](../src/app/project-list/project-list.ts) | 同步 `getProjects()` 全量 → 本地**案件名稱**/狀態篩選；不搜尋案件編號或描述；直接 `deleteProject(id): void`；List 只呈現輸入資料。 | 搜尋、篩選、分頁變成 server `q/status/limit/offset` query；`q` 與現有 UI 一樣只比對名稱，空白視為未搜尋，後端 trim 後上限 100 個 Unicode code points。狀態分開管理 `loading/data/total/error`，搜尋需 debounce、取消過時請求；刪除待 204 回應後刷新目前列表及 total，失敗時保留項目。Backend 已定 Soft Delete，前端確認與 404 處理仍須在切換階段設計。List 可繼續是純呈現元件。 |
| [New Project](../src/app/pages/new-project/new-project.ts) | Reactive Form → 同步 `addProject()` → 立即導航。 | POST pending 時禁止重複提交、顯示儲存中；成功用 server 回傳 Project 導航；422 `fieldErrors` 貼回欄位並聚焦；網路失敗保留表單和重試。新建永遠 pending，無初始 status 控制項。 |
| [Project Detail](../src/app/pages/project-detail/project-detail.ts) | route param → 同步 `getProjectById()` → signal；轉換成功以 `ProjectMutationResult.project` 即時設 signal。 | 參數變更時取消舊 GET、分開 loading/404/network error；轉換 pending 時鎖定重複操作，成功只以 server Project 更新 signal；409 重新抓目前案件並重算按鈕，確認 UI 不可送出兩次。StatusBadge 和 Actions 仍用同一 signal。 |
| [Project Edit](../src/app/pages/project-edit/project-edit.ts) | route param 同步載入；提交同步 `updateProject()`，成功導回 Detail。 | 非同步載入與 Not Found/error；PATCH pending 時停用儲存、保留修改內容；422 對應欄位；404/409 分別顯示不存在／資料衝突。不得把 status 放入一般 PATCH。 |
| [Dashboard](../src/app/pages/dashboard/dashboard.ts) | 對全量 `getProjects()` 計算 KPI、完成率、待處理 5 筆、最近更新 5 筆。 | KPI 由**全域** `GET /api/projects/stats` 取得；待處理 `GET ?status=pending&limit=5`；最近更新 `GET ?sort=updatedAt:desc&limit=5`。不可只用分頁第一頁推算全域數量；保留 `completed/(total-cancelled)` 計算定義及 0 分母規則。 |
| [Router](../src/app/app.routes.ts) | `/dashboard`、`/projects`、`/projects/new`、`/projects/:id`、`/projects/:id/edit`、`/about` 共用 App Shell。 | 路由可維持；無須為 API 增設前端路由。應為每個讀取頁面處理 loading/404/network error，不把 API 404 導回 Dashboard。 |

### 同步 → 非同步 API 表面

草案沿用現有 `ProjectService` 作為單一 facade，未必需要新狀態管理套件。到前端切換階段，可用 Angular HttpClient 的 `Observable` 表示一次 HTTP 請求：

| 現有同步方法 | 預計非同步語意 |
| --- | --- |
| `getProjects(): Project[]` | `listProjects(query): Observable<ProjectListResponse>`，含 filtered `total`；不在 template getter 發 HTTP。 |
| `getProjectById(id): Project \| undefined` | `getProjectById(id): Observable<Project>`；404 與傳輸失敗區分。 |
| `addProject(input): ProjectMutationResult` | `addProject(input): Observable<Project>`；成功以 server response 為準，錯誤統一映射。 |
| `updateProject(id,input): ProjectMutationResult` | `updateProject(id,input): Observable<Project>`。 |
| `transitionProjectStatus(id,next): ProjectMutationResult` | `transitionProjectStatus(id,next): Observable<Project>`；不做前端直接狀態賦值。 |
| `deleteProject(id): void` | `deleteProject(id): Observable<void>`；204 後再更新列表，404/失敗可見。 |

若要保持「結果物件」而非 Observable error channel，也可在 facade 內映射為 typed result；**同一 app 必須選定一種一致錯誤處理**。不要把 `boolean` 當一般業務錯誤，也不要只用 `console`。HTTP status/code/fieldErrors 要保留供頁面判斷。

## 2. 資料唯一來源與狀態設計

1. **在正式切換前**：現有 memory Service 是唯一案件來源；backend 開發可獨立完成，但 Angular 不同時從 memory 與 API 合併案件。
2. **準備前端非同步化時**：可先讓同一 Service facade 回傳 Observable 包裝的 memory 資料（僅測試／過渡），讓所有頁面在每個小步仍可 build/test。此時資料來源仍只有 memory。
3. **切換點**：六個寫讀 endpoint、Dashboard stats/query 及必要 error contract 可用後，將 facade 的實作一次切向 HttpClient；正式環境不再以開發 seed 當 fallback。測試可注入假 API，但不是執行時的第二份資料。
4. **頁面狀態**：各頁可用現有 Angular signal 持有該次 request 的 `idle/loading/success/error` 與 server 回傳資料；這是 view state，不是獨立的案件資料庫。route/search 改變用取消舊請求的方式避免較慢回應覆蓋新頁。
5. **mutation 後**：Detail/Edit/New 使用 response 的 Project 作立即回饋；重返 List/Dashboard 時重新讀取或使其 read cache 失效。若未建立共享 cache，單純重抓比同時手動同步多份陣列更安全。

現有 `ProjectService` 的 id/code/timestamp 在前端產生只是開發期行為；改接 API 後要**刪除正式路徑中的前端生成邏輯**。不可先樂觀產生假 code，再用 API 覆蓋而造成跳動或碰撞。

## 3. UX 與失敗路徑（遷移時才實作）

| 場景 | 預期行為 |
| --- | --- |
| 首次載入 | 顯示真正 loading 狀態；收到 200 + 空陣列才顯示 Empty State，不能把尚未載入當「沒有案件」。 |
| 列表搜尋／篩選 | debounce 並取消前一次請求；保留條件與最後可用結果直到新結果到達；對 400 query 錯誤顯示可修正訊息。 |
| 讀取 404 | Detail/Edit 保留正式 Not Found State；不要導回 Dashboard。 |
| 網路／5xx | 區分於 Empty 和 404，顯示可重試操作；不清掉尚未儲存的表單。 |
| Save pending | 禁止雙擊造成重複 POST/PATCH/transition；維持可辨識的進行中狀態；成功後再導頁或更新 Detail signal。 |
| 422 server validation | 依 `fieldErrors` 對應 name/description/priority/dates，保留可見 label、`aria-invalid`/`aria-describedby`、聚焦第一個錯誤欄位；前端驗證只是即時協助。 |
| 409 transition conflict | 保留可讀 inline error，重新 GET Project，再依最新狀態顯示合法操作；不讓 Badge 與 Action 依不同 snapshot。 |
| Delete failure | 當前 List 不應先永久移除案件；收到 204 後再刷新。重複刪除 404、網路失敗或 5xx 應可辨識；Restore／undo 尚未實作，不顯示假的復原入口。 |

## 4. 分階段遷移與驗收門檻

| 階段 | 最小工作 | 每階段可驗收條件 |
| --- | --- | --- |
| **5A（本階段）** | 現況盤點、API/DB/錯誤契約與決策清單；只新增 docs。 | 契約對照現有程式，不聲稱已有 backend；`git diff --check`。 |
| **建議 5B：本機唯讀縱切** | 先決定 Backend 框架與 DBMS；建立本機開發用 `projects` DB migration，以明確標示的 dev seed 提供 `GET /api/projects`、`GET /api/projects/:id`；加 API 契約／整合測試。不接 Angular、不公開部署、無未授權正式資料。 | DB migration 可重跑；讀取 envelope、日期與 400/404 可測；現有 Angular build/測試仍通過。Auth 未定前**僅限本機**。 |
| **後續寫入切片（至 5C.2B-2 已完成）** | 已實作 POST/PATCH/transitions/Soft DELETE、欄位白名單、DB 原子條件更新、code counter 與 error mapping；Auth 與完整多人編輯併發政策仍待決策。 | 當時後端測試覆蓋 4×4 status matrix、非法不更新、併發 code 唯一、Soft Delete 可見性與競爭；當時前端仍維持記憶體流程。 |
| **前端非同步化** | 依第 1 節逐頁改 Observable + signal view state；可先由 memory facade 回傳 Observable；Dashboard stats 必須在切換前可用（目前後端已提供）。 | 每一小步 build、相關 component/service tests 通過；Loading/Empty/Error 不混淆；沒有雙資料來源。 |
| **全站切換 API** | 在單一明確切換點注入 HttpClient 實作，移除正式路徑的 memory seed/id/code/timestamp；更新 HTTP mock/整合測試。 | 重整後案件保留；List/New/Detail/Edit/Dashboard/transition/delete 的成功與失敗流程端到端可驗證。 |
| **正式上線準備（非 5B）** | Auth/Roles、資料存取範圍、稽核與監控、備份/還原、部署與機密管理、並發策略。 | 未經授權不可讀/寫；恢復演練與操作監控就緒，再考慮公司正式使用。 |

### 測試遷移

- 目前 Service 測試保護同步 memory 規則：16 種狀態組合、not-found、pending 建立、重複名稱；Detail 測試保護 Badge/Actions/確認與 route id 更新；Dashboard/List 各有少量測試。這些不能證明 HTTP/DB、跨請求併發或資料持久性。
- 後端需另有 domain/unit + DB integration/contract tests，尤其 code 同時建立、status row lock/transaction、DB constraint、PATCH 欄位白名單與 400/404/409/422。
- 前端切換時用 Angular 既有 HTTP 測試能力模擬成功、延遲、404/409/422/5xx；補 New/Edit 表單、Delete 失敗、Dashboard 分頁與 stats 不一致情況。不要用假 `Project[]` 掩蓋 API 契約錯誤。
- 現有 `app.spec.ts` 仍檢查舊的 `Hello, angular-project` 標題，是既存測試落差；在相關測試整修階段處理，不在文件 Phase 改測試。

## 5. 待決策與取捨

| 議題 | 實用選項與取捨 | 本文件建議（非定案） |
| --- | --- | --- |
| Backend 框架 | 選公司已能維運的語言/框架，少一套新技術成本；新框架可能有較佳開發體驗但增加部署/招聘負擔。 | 先詢問公司現有技術與部署環境，勿僅因 Angular 同為 TypeScript 就預設 Node。 |
| DBMS | PostgreSQL、SQL Server 等皆可支援交易/constraint；授權、維運、備份與既有環境不同。 | 優先既有可靠 DBMS；若無既有偏好，可評估 PostgreSQL，但不是已選定。 |
| Auth/Roles | 公司 SSO/OIDC 可減少獨立帳密管理，整合成本取決於現有 IdP；自建帳密控制多、長期安全負擔也高。 | 正式上線前與 IT 確認 SSO/IdP、角色與資料可見範圍。 |
| Delete | **已確定 Soft Delete**：資料列與 projectCode 保留，GET／PATCH／Transition 一般路徑不顯示或修改已刪除案件；Restore 尚未實作。 | 前端切換時以 204 為刪除成功、404 為不存在或已刪除，不要假定 204 等於不可恢復；保存期限、復原權限與容量管理待決。 |
| ID | number 保持目前前端相容；UUID 較適合跨系統合併但變更 URL/型別/DB。 | 5B 可暫用 number；跨系統需求確認前不要擅自改型別。 |
| 併發 | 僅 DB 交易可保證 transition 的合法性；PATCH 仍可能最後寫入覆蓋前人。ETag/版本欄位增加前後端工作但能避免 lost update。 | transition 起步必須交易化；PATCH 樂觀併發是否在首版加入要於多人編輯需求下決策。 |
| 年度 code | UTC 年份可與現有 Service 一致；公司時區更符合員工直覺，跨年邊界需共同定義。 | 上線前固定一種時區與擴位規則，交易內原子分配，DB UNIQUE 保底。 |
| Dashboard 聚合 | 取完整列表最省 endpoint 但無法隨分頁擴張；`GET /api/projects/stats` 增加一個查詢契約，換來正確全域 KPI。 | 後端已提供 stats，Angular 正式 Dashboard 已使用它，不用第一頁推算總數。 |

## 6. Phase 5B 最小可執行範圍

**以下是 Phase 5A 當時的 5B 建議，已完成，不是下一步待辦：**確認 Backend/DBMS 與 migration 工具 → 建立 `projects` schema／明確的 dev seed → `GET /api/projects`、`GET /api/projects/:id`、統一錯誤 envelope → DB/HTTP 整合測試。其後的 POST、PATCH、Transition、Soft Delete、列表篩選與 stats 也已由後續階段實作；Angular 正式頁面亦已切換 API。Auth 與 Restore 仍未完成。
