-- =======================================================
-- 【本部管理者用】勤務・休日振替の通知「要確認」の片付け（Supabase Dashboard > SQL Editor で実行）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv)
--
-- 「要確認」は、送信結果が分からないまま重複防止の有効期間（約24時間）を過ぎた通知です。アプリは自動では送り直しません。
-- この操作は本部で実際の受信を確認したうえで行う管理操作のため、アプリの画面・API からは実行できません
-- （Dashboard にログインできる管理者だけが、関数の所有者として実行できます）。
--
-- 手順
--   1) 下の「① 一覧」だけを実行し、要確認の通知（対象者・日付・操作の種類・最初の送信日時・エラー）を確認する
--   2) 本部の受信メール（件名「【振替出勤・振替休日】登録／変更／取消 …」）に、その通知が届いているかを確認する
--      Resend の管理画面（Emails）でも、送信の有無を確認できる
--   3) 届いていた → 「② 完了にする」、届いていなかった → 「③ 送り直せる状態に戻す」を、操作IDを入れて1件ずつ実行する
--      ③ のあとは、アプリのシフト変更記録の「本部への通知」に「通知を送る」が出るので、そこから送る（新しい重複防止キーで1通送られる）
--   ※ ② ③ は1回に1件だけ。操作IDを貼り間違えないこと（要確認でない通知は変更されず、エラーになる）
-- =======================================================

-- ① 一覧（読み取りのみ）
SELECT id AS operation_id, action, person_name, work_date, off_date, created_at,
       notify_first_attempt_at, notify_attempts, notify_last_error
  FROM public.shift_change_swap_operations
 WHERE notify_status = 'needs_check'
 ORDER BY created_at;

-- ② 届いていた → 完了にする（'<操作ID>' を①の operation_id に置き換えて、この1行だけを選んで実行）
-- SELECT public.shift_change_swap_notify_resolve('<操作ID>'::uuid, 'confirmed_sent');

-- ③ 届いていなかった → 送り直せる状態に戻す（'<操作ID>' を置き換えて、この1行だけを選んで実行）
-- SELECT public.shift_change_swap_notify_resolve('<操作ID>'::uuid, 'resend');
