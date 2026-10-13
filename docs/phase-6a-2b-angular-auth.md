# Phase 6A-2B — Angular 員工登入與 Session 串接

本階段僅修改 Angular 與文件。**未**對 `case_management_dev` 套用 User／Session migration、未執行 Admin bootstrap，也未以真實帳號完成瀏覽器登入驗收。部署至公司或公開網路前仍須完成 Phase 6A-2C 及後續授權／部署安全驗證。

## 前端資料與路由

- `AuthApiService` 使用相對 `/api/auth`：`GET /csrf`、`POST /login`、`GET /me`、`POST /logout`；成功的 `data` envelope 解出 `UserPublic`。不讀取或儲存 Session Cookie／原始 token／passwordHash。
- `AuthStateService` 是唯一身份狀態來源：`checking`、`authenticated`、`unauthenticated`、`unavailable`，另有目前員工及錯誤 Signal。App 啟動呼叫 `/me`；並行檢查共用同一 HTTP request。401 判定為未登入；網路／伺服器問題保持獨立的「無法確認」狀態，可重試。
- `/login` 位於 App Shell 外。正式頁面的父路由和子路由均使用 `authGuard`，Guard 等 `/me` 結果才允許建立 Shell。原網址僅接受 `/dashboard`、`/projects...`、`/about` 等站內路徑作為 `returnUrl`；未登入轉 `/login`。
- 對非 Auth API 的 401，Interceptor 清除前端身份並引導登入；Auth API 的登入 401 留在登入頁顯示通用錯誤。403 不清除 Session，案件頁使用後端錯誤訊息顯示無權限。前端 Guard／按鈕不是權限安全邊界；後端仍只允許 Admin 呼叫案件 API。

## Cookie、CSRF 與登出

- Angular `provideHttpClient()` 預設讀取同源 `XSRF-TOKEN` Cookie，對 `/api` 的非 GET／HEAD 請求送 `X-XSRF-TOKEN` Header。Cookie 使用後端 `Path=/`，開發代理將 `/api` 導到本機 NestJS。不要改成絕對跨來源 URL 或關閉後端 CSRF。
- 每次登入先 `GET /api/auth/csrf`，再 POST。後端登入成功會輪替 Session Cookie 與 XSRF Cookie；後續請求使用瀏覽器當前 Cookie。登出前重新取得 session-bound XSRF Cookie，204 確認後才清除身份並轉 `/login`。CSRF／網路失敗不假裝登出成功。
- Session Cookie 為 HttpOnly，不保存在 localStorage／sessionStorage。原有 `sessionStorage` 僅保存 Entrance 是否在本分頁顯示過，與登入憑證無關。

## UI 與限制

登入頁使用 Reactive Form、可見 Label、autocomplete、顯示／隱藏密碼、欄位錯誤、提交中防重複及 401／429／網路錯誤回饋；沒有公開註冊或假的密碼重設。Topbar 顯示 `/me` 或 Login 回傳的真實姓名與角色，並有等待後端確認的登出按鈕。Landscape Entrance 只對已驗證身份且不在登入路由的使用者顯示；其動畫不變。

本階段的 HttpClient Mock 測試只確認前端請求與狀態，不證明瀏覽器 Cookie、代理、NestJS、PostgreSQL 的完整整合。Phase 6A-2C 前須安全審閱並套用開發資料庫 Migration、備份／還原驗證、手動建立首位 Admin、確認 `APP_ORIGIN`／代理／HTTPS Cookie 設定，然後在真實瀏覽器驗證登入、重新整理、CSRF 輪替、401／403、登出與 Session 失效。
