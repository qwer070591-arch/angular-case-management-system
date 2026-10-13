# Phase 6A-2A — NestJS Auth 與 Session 契約

本階段的後端安全基礎僅供**本機開發與隔離測試**。Angular 登入 UI 與 Session 串接已在 [Phase 6A-2B](phase-6a-2b-angular-auth.md) 加入；但尚未完成真實帳號瀏覽器驗收，不可部署至公司或公開網路。沒有公開註冊、員工管理、密碼重設、最終 RBAC 或 Audit。

## API

所有路徑以 `/api` 為前綴。成功回應以 `data` 包裝；失敗使用既有 `{ "error": { "code", "message" } }`。不回傳 `passwordHash`、Session 原始 token 或 `tokenHash`。

| Method | Path | 用途 | 成功 | 常見錯誤 |
| --- | --- | --- | --- | --- |
| GET | `/auth/csrf` | 登入前／後取得 XSRF Cookie | 200 `{ "data": { "csrfToken": "…" } }` | 500 設定錯誤 |
| POST | `/auth/login` | Email＋密碼登入並輪替現有 Session | 200 `{ "data": UserPublic }` | 400 `MALFORMED_REQUEST`、401 `INVALID_CREDENTIALS`、403 `CSRF_INVALID`、429 `LOGIN_RATE_LIMITED` |
| GET | `/auth/me` | 取得目前員工 | 200 `{ "data": UserPublic }` | 401 `AUTH_REQUIRED` |
| POST | `/auth/logout` | 撤銷 Session 並清 Cookie | 204 無 body | 403 `CSRF_INVALID` |

`UserPublic` 為 `{ id: number, name: string, email: string, role: "admin" | "manager" | "staff" }`。Login 僅接受 `{ "email": "employee@example.com", "password": "…" }`；Email trim＋lowercase。首位 Admin CLI 目前限用 ASCII Email，以避免 JavaScript 與 PostgreSQL 對非 ASCII 大小寫正規化不一致；未來員工管理需定案同一政策。密碼錯誤、帳號不存在／待啟用／停用／無 hash 均回相同的 `INVALID_CREDENTIALS`。

## Cookie、Session、CSRF

- Session Cookie：開發 `case_session`；production `__Host-case_session`。`HttpOnly`、`SameSite=Lax`、host-only（無 Domain）、`Path=/`；正式環境 `Secure` 且須 HTTPS。Cookie Max-Age 24 小時；不放角色或個資。
- 原始 token 為安全亂數 32 bytes，資料庫只存唯一 SHA-256 `tokenHash`。每次讀取都檢查撤銷、閒置與絕對期限、User active。登入建立新 token 並撤銷舊 Session；登出撤銷當前 Session。`revokeAll(userId)` 預留給未來帳號停用流程。
- 閒置期限 8 小時、絕對期限 24 小時；活動時間及閒置期限最多每 5 分鐘更新一次，絕對期限不延長。尚無排程清理過期資料，但過期 Session 一律拒絕。
- `GET /auth/csrf` 設可讀 `XSRF-TOKEN` Cookie。所有 POST／PUT／PATCH／DELETE 須送 `X-XSRF-TOKEN` header；後端核對 header／Cookie、以 `CSRF_SECRET` 驗證 HMAC，並綁定 Session token（登入前為匿名用途）。登入後輪替 XSRF Cookie。CSRF 與 HttpOnly Session Cookie 分離，並檢查 Origin；不只依賴 SameSite／CORS。
- Angular 使用相對 `/api` 與 `provideHttpClient()` 的預設 XSRF Cookie/Header 行為；登入前取得 `/auth/csrf`，登入後由伺服器輪替 Cookie。實際瀏覽器與本機帳號驗收仍待 Phase 6A-2C。
- `CSRF_SECRET` 至少 32 bytes，須由環境提供；不同實例需共用，不能放入 Git、前端或日誌。正式環境仍需規劃秘密輪替。

## 登入節流與暫行權限

同一 IP＋正規化 Email 於 15 分鐘窗口最多 5 次失敗；每 IP 另有 100 次失敗的寬鬆上限，超限回 429。這是**單一 Node.js process 記憶體**限流，多實例部署前須改共用儲存／閘道層策略並評估共用出口 IP 誤傷。

所有 `/api/projects` 端點（GET 列表／統計／單筆、POST、PATCH、Transition、DELETE）要求有效 Session，且**僅 Admin 可用**。Manager／Staff 回 403、未登入回 401。這不是最終 RBAC，後續 Phase 6B 須重新決定。

## 首位 Admin 與資料庫安全

`npm run build` 後，`npm run admin:bootstrap` 使用互動終端機，不接受命令列密碼、沒有 HTTP Bootstrap Endpoint。CLI 顯示目標 DB 名稱，須輸入相同名稱；密碼無回顯輸入兩次。交易內取 PostgreSQL advisory lock，確認 `users` 為空才建立首位 active Admin，Argon2id 儲存密碼，不建立 Session、不列印密碼或雜湊。

**本階段未執行 CLI，未對 `case_management_dev` 建帳號或套用 Migration。**日後操作前先確認目標、備份及可恢復方式，再審閱並套用現有 `20261012000100_users_sessions` Migration；禁止 `migrate reset`。測試腳本只允許 `case_management_test`。

## 尚待處理

- Angular UI／路由／401／403／XSRF 初始化已加入；仍待具備 migration 與 Admin 的隔離本機環境驗證完整瀏覽器登入流程。
- 正式 HTTPS／反向代理、Cookie／Origin 驗收、CSRF secret 輪替；目前仍只監聽本機。
- 多實例共用限流、過期 Session 清理、員工邀請／停用／密碼重設流程。
- 最終權限矩陣及登入異常監控。現階段不可使用真實公司資料。
