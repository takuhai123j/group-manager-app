-- =======================================================
-- MT同時開催 第2段階A: 同時開催の操作用RPCと整合性トリガー（追加のみ）
-- migration name: mt_joint_groups_phase2_rpc
--
-- 方針:
--   ・既存のテーブル・列・関数・トリガーは変更しない（新規オブジェクトの追加のみ）
--   ・RPCは SECURITY INVOKER（anon が直接できる範囲を超えない）。原子性とDB側検証のために使う
--   ・対象MT行は ID 順に FOR UPDATE でロックし、同時操作では後続を待たせたうえで再検証する
--   ・エラーは 'MTJ_<コード>: <日本語メッセージ>' 形式（SQLSTATE P0001）で返し、画面側でコードを判別する
--   ・通知管理列 schedule_notified_at はこのファイルのRPC内でのみ例外的に更新する
--     （結合・解除で通知を再送しないため。通知送信そのものは従来どおり /api/meeting-notify/* が行う）
-- =======================================================

-- -------------------------------------------------------
-- 1) 同時開催グループの整合性（遅延制約トリガー。コミット時に検査）
--    ・グループには施設MTと厨房MTがちょうど1件ずつ（不完全なグループを作らせない）
--    ・グループ内の2件は schedule_id / status / executed_date が一致（開催日・予定・実績を共通化）
--    グループ自体が削除済み（= 解除）の場合は検査しない
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_check_joint_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  gids uuid[];
  gid uuid;
  n_total int; n_types int; n_sched int; n_status int; n_exec int;
BEGIN
  IF TG_TABLE_NAME = 'meeting_joint_groups' THEN
    gids := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    gids := ARRAY[NEW.joint_group_id];
  ELSIF TG_OP = 'DELETE' THEN
    gids := ARRAY[OLD.joint_group_id];
  ELSE
    gids := ARRAY[OLD.joint_group_id, NEW.joint_group_id];
  END IF;

  FOREACH gid IN ARRAY gids LOOP
    CONTINUE WHEN gid IS NULL;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.meeting_joint_groups g WHERE g.id = gid);

    SELECT count(*),
           count(DISTINCT m.meeting_type),
           count(DISTINCT coalesce(m.schedule_id::text, '-')),
           count(DISTINCT m.status),
           count(DISTINCT coalesce(m.executed_date::text, '-'))
      INTO n_total, n_types, n_sched, n_status, n_exec
      FROM public.meetings m
     WHERE m.joint_group_id = gid;

    IF n_total <> 2 OR n_types <> 2 THEN
      RAISE EXCEPTION 'MTJ_INCOMPLETE_GROUP: 同時開催は施設MTと厨房内MTの2件で構成する必要があります'
        USING ERRCODE = 'P0001';
    END IF;
    IF n_sched <> 1 OR n_status <> 1 OR n_exec <> 1 THEN
      RAISE EXCEPTION 'MTJ_GROUP_INCONSISTENT: 同時開催のMTは予定・実施状況・実施日を共通にする必要があります'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_joint_group_check_groups ON public.meeting_joint_groups;
CREATE CONSTRAINT TRIGGER trg_mt_joint_group_check_groups
  AFTER INSERT ON public.meeting_joint_groups
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.mt_check_joint_group();

DROP TRIGGER IF EXISTS trg_mt_joint_group_check_meetings ON public.meetings;
CREATE CONSTRAINT TRIGGER trg_mt_joint_group_check_meetings
  AFTER INSERT OR DELETE OR UPDATE OF joint_group_id, schedule_id, status, executed_date ON public.meetings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.mt_check_joint_group();

-- -------------------------------------------------------
-- 2) 議事録登録時、同時開催の相手MTにも共有リンクを自動作成する
--    （所有者リンクは第1段階の trg_meeting_minutes_owner_link が作成する。こちらは相手側のみ）
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_link_minute_to_joint_partner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.meeting_minute_links (minute_id, meeting_id)
  SELECT NEW.id, partner.id
    FROM public.meetings owner_m
    JOIN public.meetings partner
      ON partner.joint_group_id = owner_m.joint_group_id
     AND partner.id <> owner_m.id
   WHERE owner_m.id = NEW.meeting_id
     AND owner_m.joint_group_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_minutes_joint_partner_link ON public.meeting_minutes;
CREATE TRIGGER trg_meeting_minutes_joint_partner_link
  AFTER INSERT ON public.meeting_minutes
  FOR EACH ROW EXECUTE FUNCTION public.mt_link_minute_to_joint_partner();

-- -------------------------------------------------------
-- 3) RPC: 既存MT同士を同時開催にする
--   p_keep_schedule_id / p_delete_schedule_id:
--     2件とも予定がある場合のみ必須（残す予定と、利用者が削除に同意した予定）。それ以外は NULL
--   p_executed_date:
--     どちらかが実施済みの場合のみ必須。実施済み側の実施日のいずれかと一致すること
--   予定タイトルは自動生成タイトルのままの場合だけ「施設MT・厨房内MT」に変更する（手動編集は維持）
--   通知済み状態は、予定がある場合に2件の最新値へ揃える（再送防止）
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_join_meetings(
  p_meeting_id uuid,
  p_partner_id uuid,
  p_keep_schedule_id uuid DEFAULT NULL,
  p_delete_schedule_id uuid DEFAULT NULL,
  p_executed_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  a public.meetings%ROWTYPE;
  b public.meetings%ROWTYPE;
  v_keep uuid;
  v_status text;
  v_exec date;
  v_notified timestamptz;
  v_fac_name text;
  v_group uuid;
BEGIN
  IF p_meeting_id IS NULL OR p_partner_id IS NULL THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 結合するMTを2件指定してください' USING ERRCODE = 'P0001';
  END IF;
  IF p_meeting_id = p_partner_id THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 同じMT同士は結合できません' USING ERRCODE = 'P0001';
  END IF;

  -- ID順にロック（デッドロック回避）。ロック取得後の最新状態で検証する
  PERFORM 1 FROM public.meetings
   WHERE id IN (p_meeting_id, p_partner_id)
   ORDER BY id
   FOR UPDATE;

  SELECT * INTO a FROM public.meetings WHERE id = p_meeting_id;
  SELECT * INTO b FROM public.meetings WHERE id = p_partner_id;
  IF a.id IS NULL OR b.id IS NULL THEN
    RAISE EXCEPTION 'MTJ_NOT_FOUND: 指定されたMTが見つかりません' USING ERRCODE = 'P0001';
  END IF;
  IF a.facility_id <> b.facility_id THEN
    RAISE EXCEPTION 'MTJ_FACILITY_MISMATCH: 同じ施設のMT同士だけ結合できます' USING ERRCODE = 'P0001';
  END IF;
  IF a.meeting_type = b.meeting_type THEN
    RAISE EXCEPTION 'MTJ_SAME_TYPE: 施設MTと厨房内MTの組み合わせだけ結合できます' USING ERRCODE = 'P0001';
  END IF;
  IF a.joint_group_id IS NOT NULL OR b.joint_group_id IS NOT NULL THEN
    RAISE EXCEPTION 'MTJ_ALREADY_JOINED: どちらかのMTはすでに同時開催に設定されています' USING ERRCODE = 'P0001';
  END IF;
  IF abs(extract(year FROM a.target_month) - extract(year FROM b.target_month)) > 1 THEN
    RAISE EXCEPTION 'MTJ_YEAR_RANGE: 結合できるのは前年・当年・翌年のMTです' USING ERRCODE = 'P0001';
  END IF;

  -- 予定の決定
  IF a.schedule_id IS NOT NULL AND b.schedule_id IS NOT NULL AND a.schedule_id <> b.schedule_id THEN
    IF p_keep_schedule_id IS NULL OR p_delete_schedule_id IS NULL
       OR p_keep_schedule_id NOT IN (a.schedule_id, b.schedule_id)
       OR p_delete_schedule_id NOT IN (a.schedule_id, b.schedule_id)
       OR p_keep_schedule_id = p_delete_schedule_id THEN
      RAISE EXCEPTION 'MTJ_SCHEDULE_CHOICE_REQUIRED: 残す予定と削除する予定を選択してください' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = p_delete_schedule_id AND s.type = 'mt') THEN
      RAISE EXCEPTION 'MTJ_SCHEDULE_DELETE_DENIED: 削除できるのはMTの予定だけです' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.meetings m
                WHERE m.schedule_id = p_delete_schedule_id
                  AND m.id NOT IN (a.id, b.id)) THEN
      RAISE EXCEPTION 'MTJ_SCHEDULE_DELETE_DENIED: 削除する予定がほかのMTでも使われています' USING ERRCODE = 'P0001';
    END IF;
    v_keep := p_keep_schedule_id;
  ELSE
    IF p_delete_schedule_id IS NOT NULL THEN
      RAISE EXCEPTION 'MTJ_INVALID_INPUT: 削除する予定はありません' USING ERRCODE = 'P0001';
    END IF;
    v_keep := coalesce(a.schedule_id, b.schedule_id);
    IF p_keep_schedule_id IS NOT NULL AND p_keep_schedule_id IS DISTINCT FROM v_keep THEN
      RAISE EXCEPTION 'MTJ_INVALID_INPUT: 残す予定の指定が正しくありません' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 実施状況の決定
  IF a.status = 'done' OR b.status = 'done' THEN
    IF p_executed_date IS NULL THEN
      RAISE EXCEPTION 'MTJ_EXECUTED_DATE_REQUIRED: 共通の実施日を選択してください' USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((a.status = 'done' AND a.executed_date = p_executed_date)
         OR (b.status = 'done' AND b.executed_date = p_executed_date)) THEN
      RAISE EXCEPTION 'MTJ_EXECUTED_DATE_INVALID: 実施日は実施済みのMTの日付から選択してください' USING ERRCODE = 'P0001';
    END IF;
    v_status := 'done';
    v_exec := p_executed_date;
  ELSE
    IF p_executed_date IS NOT NULL THEN
      RAISE EXCEPTION 'MTJ_INVALID_INPUT: 未実施のMT同士では実施日を指定できません' USING ERRCODE = 'P0001';
    END IF;
    v_status := 'scheduled';
    v_exec := NULL;
  END IF;

  -- 通知済み状態（予定を共有する場合のみ、2件の最新値へ揃える）
  IF v_keep IS NOT NULL THEN
    v_notified := greatest(a.schedule_notified_at, b.schedule_notified_at);
  END IF;

  INSERT INTO public.meeting_joint_groups (facility_id) VALUES (a.facility_id) RETURNING id INTO v_group;

  UPDATE public.meetings
     SET joint_group_id = v_group,
         schedule_id = v_keep,
         status = v_status,
         executed_date = v_exec,
         schedule_notified_at = CASE WHEN v_keep IS NOT NULL THEN v_notified ELSE schedule_notified_at END
   WHERE id IN (a.id, b.id);

  -- 付け替え後に、同意済みの不要な予定を削除（どのMTからも参照されていない状態で消す）
  IF p_delete_schedule_id IS NOT NULL THEN
    DELETE FROM public.schedules WHERE id = p_delete_schedule_id;
  END IF;

  -- 自動生成タイトルのままなら同時開催用タイトルへ
  IF v_keep IS NOT NULL THEN
    SELECT f.name INTO v_fac_name FROM public.facilities f WHERE f.id = a.facility_id;
    UPDATE public.schedules
       SET title = v_fac_name || '施設MT・厨房内MT'
     WHERE id = v_keep
       AND title IN (v_fac_name || '施設MT', v_fac_name || '厨房内MT');
  END IF;

  -- 既存の議事録を両方のMTから見えるようにする（PDF・meeting_minutes 行は変更しない）
  INSERT INTO public.meeting_minute_links (minute_id, meeting_id)
  SELECT DISTINCT l.minute_id, x.id
    FROM public.meeting_minute_links l
   CROSS JOIN (VALUES (a.id), (b.id)) AS x(id)
   WHERE l.meeting_id IN (a.id, b.id)
  ON CONFLICT DO NOTHING;

  RETURN v_group;
END;
$$;

-- -------------------------------------------------------
-- 4) RPC: 同時開催グループの共通予定を確定する（2件とも予定未定・未実施の場合のみ）
--    担当者が施設の候補者かどうかは、従来どおり画面側（resolveAssignee）で検証してから呼ぶ
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_confirm_joint_schedule(
  p_group_id uuid,
  p_date date,
  p_start_time text DEFAULT '10:00',
  p_end_time text DEFAULT '11:00',
  p_is_all_day boolean DEFAULT false,
  p_group_manager_id uuid DEFAULT NULL,
  p_staff_member_id uuid DEFAULT NULL,
  p_memo text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  n int;
  v_facility uuid;
  v_fac_name text;
  v_start text;
  v_end text;
  v_schedule uuid;
BEGIN
  IF p_group_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 同時開催グループと実施予定日を指定してください' USING ERRCODE = 'P0001';
  END IF;
  IF (p_group_manager_id IS NULL) = (p_staff_member_id IS NULL) THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 担当者を1名指定してください' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(p_is_all_day, false) THEN
    v_start := '00:00'; v_end := '00:00';
  ELSE
    IF p_start_time IS NULL OR p_end_time IS NULL
       OR p_start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR p_end_time   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR p_start_time >= p_end_time THEN
      RAISE EXCEPTION 'MTJ_INVALID_INPUT: 開始・終了時間が正しくありません' USING ERRCODE = 'P0001';
    END IF;
    v_start := p_start_time; v_end := p_end_time;
  END IF;
  IF length(coalesce(p_memo, '')) > 1000 THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: メモが長すぎます' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.meetings WHERE joint_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), min(facility_id::text)::uuid INTO n, v_facility
    FROM public.meetings WHERE joint_group_id = p_group_id;
  IF n <> 2 THEN
    RAISE EXCEPTION 'MTJ_NOT_FOUND: 同時開催グループが見つかりません' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meetings WHERE joint_group_id = p_group_id
              AND (schedule_id IS NOT NULL OR status <> 'scheduled')) THEN
    RAISE EXCEPTION 'MTJ_ALREADY_SCHEDULED: この同時開催はすでに日程確定済みか実施済みです' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.name INTO v_fac_name FROM public.facilities f WHERE f.id = v_facility;

  INSERT INTO public.schedules
    (group_manager_id, staff_member_id, facility_id, title, date, start_time, end_time, type, memo, is_all_day)
  VALUES
    (p_group_manager_id, p_staff_member_id, v_facility, v_fac_name || '施設MT・厨房内MT',
     p_date, v_start, v_end, 'mt', coalesce(p_memo, ''), coalesce(p_is_all_day, false))
  RETURNING id INTO v_schedule;

  UPDATE public.meetings SET schedule_id = v_schedule WHERE joint_group_id = p_group_id;

  RETURN v_schedule;
END;
$$;

-- -------------------------------------------------------
-- 5) RPC: 同時開催グループを実施済みにする（2件を1回のUPDATEで更新）
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_mark_joint_done(
  p_group_id uuid,
  p_executed_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  n int;
BEGIN
  IF p_group_id IS NULL OR p_executed_date IS NULL THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 同時開催グループと実施日を指定してください' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.meetings WHERE joint_group_id = p_group_id ORDER BY id FOR UPDATE;
  SELECT count(*) INTO n FROM public.meetings WHERE joint_group_id = p_group_id;
  IF n <> 2 THEN
    RAISE EXCEPTION 'MTJ_NOT_FOUND: 同時開催グループが見つかりません' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.meetings
     SET status = 'done', executed_date = p_executed_date
   WHERE joint_group_id = p_group_id;
END;
$$;

-- -------------------------------------------------------
-- 6) RPC: 同時開催を解除する
--   ・p_keep_meeting_id 側が元の予定を引き継ぎ、外れる側には予定を複製する（通知済み状態も引き継ぐ）
--   ・議事録リンクは両方に残す（PDF・meeting_minutes 行は変更しない）
--   ・実施状況・実施日・計画月・頻度設定は変更しない
--   ・同時開催用の自動タイトルのままなら、それぞれ単独のタイトルに戻す（手動編集は維持）
--   戻り値: 外れる側に作成した予定ID（予定未定なら NULL）
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_leave_joint(
  p_group_id uuid,
  p_keep_meeting_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  k public.meetings%ROWTYPE;
  o public.meetings%ROWTYPE;
  n int;
  v_fac_name text;
  v_joint_title text;
  v_copy uuid;
BEGIN
  IF p_group_id IS NULL OR p_keep_meeting_id IS NULL THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 同時開催グループと予定を引き継ぐMTを指定してください' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.meetings WHERE joint_group_id = p_group_id ORDER BY id FOR UPDATE;
  SELECT count(*) INTO n FROM public.meetings WHERE joint_group_id = p_group_id;
  IF n <> 2 THEN
    RAISE EXCEPTION 'MTJ_NOT_FOUND: 同時開催グループが見つかりません' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO k FROM public.meetings WHERE id = p_keep_meeting_id AND joint_group_id = p_group_id;
  IF k.id IS NULL THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 予定を引き継ぐMTがこの同時開催に含まれていません' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO o FROM public.meetings WHERE joint_group_id = p_group_id AND id <> k.id;

  SELECT f.name INTO v_fac_name FROM public.facilities f WHERE f.id = k.facility_id;
  v_joint_title := v_fac_name || '施設MT・厨房内MT';

  IF k.schedule_id IS NOT NULL THEN
    INSERT INTO public.schedules
      (group_manager_id, staff_member_id, facility_id, title, date, start_time, end_time, type, memo, is_all_day)
    SELECT s.group_manager_id, s.staff_member_id, s.facility_id,
           CASE WHEN s.title = v_joint_title
                THEN v_fac_name || CASE WHEN o.meeting_type = 'kitchen' THEN '厨房内MT' ELSE '施設MT' END
                ELSE s.title END,
           s.date, s.start_time, s.end_time, s.type, s.memo, s.is_all_day
      FROM public.schedules s
     WHERE s.id = k.schedule_id
    RETURNING id INTO v_copy;

    UPDATE public.schedules
       SET title = v_fac_name || CASE WHEN k.meeting_type = 'kitchen' THEN '厨房内MT' ELSE '施設MT' END
     WHERE id = k.schedule_id
       AND title = v_joint_title;

    UPDATE public.meetings
       SET schedule_id = v_copy,
           schedule_notified_at = coalesce(o.schedule_notified_at, k.schedule_notified_at)
     WHERE id = o.id;
  END IF;

  -- グループ削除で両方の joint_group_id が NULL に戻る（ON DELETE SET NULL (joint_group_id)）
  DELETE FROM public.meeting_joint_groups WHERE id = p_group_id;

  RETURN v_copy;
END;
$$;

-- -------------------------------------------------------
-- 7) RPC: 新規登録と同時に同時開催にする
--   ・p_partner_id 指定時は既存MTを相手にする（相手の予定・実施状況を引き継ぐ）
--   ・未指定時は p_partner_target_month（省略時は同じ月）に相手種別のMTを手動追加する
--   ・p_schedule_date 指定時は共通予定を確定する（相手に予定がある・実施済みの場合は指定不可）
--   戻り値: {"meeting_id", "partner_id", "group_id", "schedule_id", "schedule_created"}
--   schedule_created = true の場合だけ、呼び出し元が予定確定通知を1回送る
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_create_joint_meetings(
  p_facility_id uuid,
  p_meeting_type text,
  p_target_month date,
  p_memo text DEFAULT '',
  p_partner_id uuid DEFAULT NULL,
  p_partner_target_month date DEFAULT NULL,
  p_schedule_date date DEFAULT NULL,
  p_start_time text DEFAULT '10:00',
  p_end_time text DEFAULT '11:00',
  p_is_all_day boolean DEFAULT false,
  p_group_manager_id uuid DEFAULT NULL,
  p_staff_member_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  p public.meetings%ROWTYPE;
  v_partner_type text;
  v_new uuid;
  v_partner uuid;
  v_group uuid;
  v_schedule uuid;
  v_created boolean := false;
BEGIN
  IF p_facility_id IS NULL OR p_meeting_type IS NULL OR p_target_month IS NULL THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 施設・MT種別・計画月を指定してください' USING ERRCODE = 'P0001';
  END IF;
  IF p_meeting_type NOT IN ('facility', 'kitchen') THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: MT種別が正しくありません' USING ERRCODE = 'P0001';
  END IF;
  IF extract(day FROM p_target_month) <> 1
     OR (p_partner_target_month IS NOT NULL AND extract(day FROM p_partner_target_month) <> 1) THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: 計画月は月初の日付で指定してください' USING ERRCODE = 'P0001';
  END IF;
  IF length(coalesce(p_memo, '')) > 1000 THEN
    RAISE EXCEPTION 'MTJ_INVALID_INPUT: メモが長すぎます' USING ERRCODE = 'P0001';
  END IF;
  v_partner_type := CASE WHEN p_meeting_type = 'facility' THEN 'kitchen' ELSE 'facility' END;

  IF EXISTS (SELECT 1 FROM public.meetings
              WHERE facility_id = p_facility_id AND meeting_type = p_meeting_type
                AND target_month = p_target_month) THEN
    RAISE EXCEPTION 'MTJ_MONTH_TAKEN: この月にはすでに同じ種別のMTがあります' USING ERRCODE = 'P0001';
  END IF;

  IF p_partner_id IS NOT NULL THEN
    IF p_partner_target_month IS NOT NULL THEN
      RAISE EXCEPTION 'MTJ_INVALID_INPUT: 既存MTを相手にする場合、相手の計画月は指定できません' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO p FROM public.meetings WHERE id = p_partner_id FOR UPDATE;
    IF p.id IS NULL THEN
      RAISE EXCEPTION 'MTJ_NOT_FOUND: 指定されたMTが見つかりません' USING ERRCODE = 'P0001';
    END IF;
    IF p_schedule_date IS NOT NULL AND (p.schedule_id IS NOT NULL OR p.status = 'done') THEN
      RAISE EXCEPTION 'MTJ_ALREADY_SCHEDULED: 相手のMTに予定または実施記録があるため、日時はそちらに合わせます' USING ERRCODE = 'P0001';
    END IF;
    v_partner := p.id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.meetings
                WHERE facility_id = p_facility_id AND meeting_type = v_partner_type
                  AND target_month = coalesce(p_partner_target_month, p_target_month)) THEN
      RAISE EXCEPTION 'MTJ_MONTH_TAKEN: 相手の月にはすでにMTがあります。既存のMTを相手に選んでください' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.meetings (facility_id, meeting_type, target_month, frequency_id, status, memo)
    VALUES (p_facility_id, v_partner_type, coalesce(p_partner_target_month, p_target_month), NULL, 'scheduled', '')
    RETURNING id INTO v_partner;
  END IF;

  INSERT INTO public.meetings (facility_id, meeting_type, target_month, frequency_id, status, memo)
  VALUES (p_facility_id, p_meeting_type, p_target_month, NULL, 'scheduled', coalesce(p_memo, ''))
  RETURNING id INTO v_new;

  -- 結合（検証は mt_join_meetings に集約。相手が実施済みなら相手の実施日を共通の実施日にする）
  v_group := public.mt_join_meetings(v_new, v_partner, NULL, NULL,
                                     CASE WHEN p.status = 'done' THEN p.executed_date ELSE NULL END);

  IF p_schedule_date IS NOT NULL THEN
    v_schedule := public.mt_confirm_joint_schedule(v_group, p_schedule_date, p_start_time, p_end_time,
                                                   p_is_all_day, p_group_manager_id, p_staff_member_id, '');
    v_created := true;
  ELSE
    SELECT schedule_id INTO v_schedule FROM public.meetings WHERE id = v_new;
  END IF;

  RETURN jsonb_build_object(
    'meeting_id', v_new,
    'partner_id', v_partner,
    'group_id', v_group,
    'schedule_id', v_schedule,
    'schedule_created', v_created
  );
END;
$$;

-- -------------------------------------------------------
-- 8) 実行権限（RPCは anon のみ。内部用トリガー関数は誰にも直接実行させない）
--    Supabase は新規関数に既定で実行権限を付与するため、明示的に取り消してから付与する
-- -------------------------------------------------------
REVOKE ALL ON FUNCTION public.mt_check_joint_group() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mt_link_minute_to_joint_partner() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mt_join_meetings(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mt_confirm_joint_schedule(uuid, date, text, text, boolean, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mt_mark_joint_done(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mt_leave_joint(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mt_create_joint_meetings(uuid, text, date, text, uuid, date, date, text, text, boolean, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mt_join_meetings(uuid, uuid, uuid, uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.mt_confirm_joint_schedule(uuid, date, text, text, boolean, uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.mt_mark_joint_done(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.mt_leave_joint(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mt_create_joint_meetings(uuid, text, date, text, uuid, date, date, text, text, boolean, uuid, uuid) TO anon;
