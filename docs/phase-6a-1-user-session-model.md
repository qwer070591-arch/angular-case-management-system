# Phase 6A-1 — 員工與 Session 資料模型

本階段只有 Prisma Schema、加法式 PostgreSQL migration 與真實測試資料庫驗證。**沒有登入、登出、Cookie、Session middleware、Auth Guard、員工管理 API 或預設 Admin。**目前 Project API 仍未受身份驗證保護，不能公開部署。

## 資料表與約束

| `users` | 用途 |
| --- | --- |
| `id` | 自動產生的 `INTEGER` 主鍵；不與現有案件建立關聯。 |
| `name` | `VARCHAR(120)`，trim 後不可空白。 |
| `email` | `VARCHAR(254)`、唯一；資料庫寫入前以 `lower(btrim(email))` 正規化，拒絕空值與含空白值。 |
| `password_hash` | 可空 `TEXT`。待啟用帳號可為 null；`active` 帳號必須非 null。這個約束**不能**證明內容真的是密碼雜湊；Argon2id 產生、驗證與密碼政策留待 Auth 階段。 |
| `role` | PostgreSQL `user_role`：`admin`、`manager`、`staff`；建立時必須明確指定。 |
| `status` | PostgreSQL `user_status`：`pending_activation`、`active`、`disabled`，預設待啟用。 |
| `created_at` / `updated_at` | `TIMESTAMPTZ(3)`，預設伺服器當下時間；後續修改 User 時須由 Service 更新 `updated_at`。 |
| `disabled_at` | 可空 `TIMESTAMPTZ(3)`；狀態為 disabled 時必填，其他狀態必須為 null。停用不刪除員工身份。 |

Email 的 **儲存契約**由 PostgreSQL `users_normalize_email` trigger 執行：半形前後空白 trim、轉小寫，再由 `users_email_key` UNIQUE index 保證唯一。CHECK 約束作為最後防線；因此直接透過 Prisma 寫入 `  Alice@Example.Test  ` 也儲存為 `alice@example.test`，後續大小寫／前後空白變體會被拒絕。未來登入查詢必須採同一正規化規則，不能用前端自行猜測；完整國際化 Email 與 Unicode 空白政策尚未決定。不要僅依賴前端驗證。

| `sessions` | 用途 |
| --- | --- |
| `id` | 自動產生的內部 `INTEGER` 主鍵，**不是** Cookie 識別值。 |
| `user_id` | 指向 `users.id`；User 不可在仍有 Session 時被實體刪除。 |
| `token_hash` | 唯一的 64 位小寫十六進位值；只預留高熵 Session token 的雜湊，不儲存原始 token。 |
| `created_at` / `last_seen_at` | 建立與最後活動時間，`TIMESTAMPTZ(3)`。 |
| `idle_expires_at` / `absolute_expires_at` | 伺服器端閒置／絕對期限；兩者都須晚於建立時間，閒置期限不可晚於絕對期限。 |
| `revoked_at` | 可空；個別撤銷或停用員工時批次撤銷的紀錄時間。 |

`sessions_user_revoked_idx` 支援按員工找出／撤銷未撤銷 Session；兩個期限索引為清理過期資料預留；`sessions_token_hash_key` 防止相同雜湊重複。未來的有效性判斷須同時檢查 `revoked_at IS NULL`、兩個期限均未過、User 狀態為 `active`。資料表不會自動使 Session 失效，也不會在停用時自動撤銷；這些是後續 Auth Service 的責任。

登入階段才決定及實作原始 token 的安全產生、雜湊／比較、Session 輪替、Cookie 屬性、CSRF、期限長度與過期清理。密碼雜湊與 Session token 雜湊屬於不同用途；不能用快速雜湊儲存員工密碼。

## Migration 與既有案件

新 migration：`20261012000100_users_sessions`。它只新增兩個 enum、`users`、`sessions`、Email 正規化 trigger、索引與約束；不修改先前已套用的三份 migration，不碰 `projects`、`project_code_counters`、案件 ID／編號或 seed。本階段沒有 Project→User 外鍵，也不替既有案件虛構建立者或負責人。

先以 `case_management_test` 執行 `npm run test:db`，其腳本會檢查資料庫名稱及與開發 URL 不同，再套用 migration 和真實 PostgreSQL 測試。**尚未對 `case_management_dev` 套用本 migration。**之後如要在開發／正式環境部署，先備份並驗證還原，再審閱 migration 並執行版本化 `prisma migrate deploy`；不得使用 `migrate reset`。

## Phase 6A-2 前需確定

- 原始 Session token 的長度、雜湊形式與輪替策略；Cookie 的網域、SameSite 與 HTTPS 部署方式。
- 閒置／絕對 Session 有效期、清理頻率，以及停用時對已送出但尚未完成請求的處理界線。
- 員工 Email 是否限定 ASCII 公司信箱；登入查詢須與資料庫 `lower(btrim())` 完全一致。
- 首位 Admin 的非公開、安全 bootstrap 流程；員工邀請與密碼重設如何送達及驗證。
- Argon2id 參數、登入節流、CSRF 與權限矩陣。這些都**未**由本資料模型實作。
