-- =======================================================
-- 勤務・休日振替（振替出勤・振替休日）を「2日分の記録の組」で持つ（追加のみ＋記録の施設を振替だけ省略可にする）
-- migration name: shift_change_swap
-- 前提: 20261018120000_shift_change_support_chain が適用済み
--
-- 例: 対象者Aが公休日の 11/24（火）に急きょ業務（例: 既に予定されているMTへの出席・本部業務・研修）で出勤し（振替出勤）、
--     別のフリー勤務日の 11/27（金）を休日にする（振替休日）。2日分を1件の振替として登録する。MT の予定・管理とは連動しない
--
-- 方針:
--   ・既存の列・データは変更しない（記録に列3つ、制約・索引・トリガーを追加。記録の facility_id は NOT NULL を外し、
--     代わりに「振替の記録以外は施設必須」の CHECK を付ける＝通常のシフト変更は従来どおり施設必須）
--   ・振替1件＝ shift_change_swaps 1行 ＋ shift_change_records 2行（swap_role: work=振替出勤日 / off=振替休日）＋ 明細各1行
--     明細の種別は '振替出勤' / '振替休日'（既存の「休日出勤」「振休」とは別。通常のシフト変更では使えない）
--   ・関連グループID（related_change_group_id＝代替出勤者の振休用）は使わない（振替の記録では NULL に固定）
--   ・対象者はマスタの固有ID（G長・主任 または スタッフ）で持つ。カレンダーに表示するか（show_on_calendar）は別に持つ
--     同じ人・同じ日付の振替は1件だけ（除外制約。日付の入れ替えができるよう、判定はトランザクションの最後）
--   ・カレンダー: 表示する場合だけ、本人の終日予定を作る（schedules.type = 'furikae_work' / 'furikae_off'。自動登録専用）
--     手動の予定は変更・削除しない。振替出勤日の本人の手動の公休（kyukyu）は、選んだものだけ「非表示の紐付け」を持つ
--     （shift_change_swap_hidden_schedules。予定を消すと紐付けも消え、振替を消すと紐付けも消えて予定が再表示される）
--   ・MT（meetings）・MTの予定とは紐付けず、一切触れない（勤務内容は自由入力。MT出席は理由の一例）
--   ・保存・削除は専用の関数（SECURITY DEFINER）だけが行う。新しいテーブルは anon に SELECT だけを許可する
--     既存テーブル（記録・明細・予定）は anon に書き込み権限があるため、振替に関わる行の書き込みはトリガーで止める
--     （関数の所有者＝テーブル所有者として実行されている場合だけ通す。anon / authenticated / service_role は通さない）
--   ・2日分がそろっていること（出勤日1件・休日1件、明細各1件、種別が役割どおり）はトランザクションの最後に検査する
--   ・同時編集: 振替の行をロックし、画面が読み込んだときの updated_at と一致しなければ SCC_CONFLICT で止める
--   ・操作ID: 登録・変更・取消の1回ごとに画面が発行する。同じ操作IDの再送（応答が失われた場合）は最初の操作の結果を返す。
--     別の操作IDなら、内容が偶然同じでも以前の操作の成功とはみなさない（古い更新日時・既にある振替IDは SCC_CONFLICT、
--     既に取り消された振替の取消は SCC_NOT_FOUND、変更なしの編集は SCC_NO_CHANGE）
--   ・本部への通知: 操作ごとに shift_change_swap_operations へ内容と送信状態を同じトランザクションで記録する。
--     通知 API は操作IDだけを受け取り、記録の内容からサーバー側で文面を作る。送信状態は関数（確保・結果の記録）だけが変え、
--     その関数はサーバー専用キー（service_role）だけが実行できる（anon は状態の列を読むだけ）。Resend の Idempotency-Key（操作ID＋版）で二重送信を防ぎ、結果不明のまま
--     キーの保持期間（24時間）に近づいたら要確認（needs_check）にして自動では送り直さない
--   ・エラーは既存と同じ 'SCC_<コード>: <日本語メッセージ>' 形式（SQLSTATE P0001）
--   ・shift_change_save_batch（既存の保存関数）は置き換えない
-- =======================================================

-- -------------------------------------------------------
-- 1) 振替（利用者から見た1件の申請）
-- -------------------------------------------------------
CREATE TABLE public.shift_change_swaps (
  id uuid PRIMARY KEY,
  -- 対象者（マスタの固有ID。どちらか一方だけ）。person_key は比較・一意判定用（2つのIDのうち入っている方）
  person_group_manager_id uuid NULL REFERENCES public.group_managers(id),
  person_staff_member_id  uuid NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
  person_key uuid NOT NULL,
  -- 本人のカレンダーに表示するか（対象者の識別とは別）
  show_on_calendar boolean NOT NULL DEFAULT false,
  -- 振替出勤日の勤務内容（例: MT出席・本部業務・研修）。予定のタイトル「振替出勤（MT出席）」に使う
  work_content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_change_swaps_person_exactly_one
    CHECK (num_nonnulls(person_group_manager_id, person_staff_member_id) = 1),
  CONSTRAINT shift_change_swaps_person_key_matches
    CHECK (person_key = coalesce(person_group_manager_id, person_staff_member_id)),
  CONSTRAINT shift_change_swaps_work_content_length
    CHECK (char_length(work_content) <= 100),
  CONSTRAINT shift_change_swaps_id_person_key_unique UNIQUE (id, person_key)
);

-- -------------------------------------------------------
-- 2) 記録: 振替の組・役割・対象者（3つそろって入るか、すべて NULL）
-- -------------------------------------------------------
ALTER TABLE public.shift_change_records
  ADD COLUMN swap_id uuid NULL,
  ADD COLUMN swap_role text NULL,
  ADD COLUMN swap_person_key uuid NULL;

ALTER TABLE public.shift_change_records
  ALTER COLUMN facility_id DROP NOT NULL;

ALTER TABLE public.shift_change_records
  ADD CONSTRAINT shift_change_records_swap_fields_together
    CHECK (num_nonnulls(swap_id, swap_role, swap_person_key) IN (0, 3)),
  ADD CONSTRAINT shift_change_records_swap_role_values
    CHECK (swap_role IS NULL OR swap_role IN ('work', 'off')),
  -- 通常のシフト変更は従来どおり施設必須。施設なしを許すのは振替の記録だけ
  ADD CONSTRAINT shift_change_records_facility_required
    CHECK (facility_id IS NOT NULL OR swap_id IS NOT NULL),
  -- 振替の記録は振休グループ（代替出勤者の振休）に入れない
  ADD CONSTRAINT shift_change_records_swap_not_in_group
    CHECK (swap_id IS NULL OR related_change_group_id IS NULL),
  -- 振替を消すと2件とも消える。対象者を変えると2件の対象者も揃って変わる
  ADD CONSTRAINT shift_change_records_swap_fkey
    FOREIGN KEY (swap_id, swap_person_key) REFERENCES public.shift_change_swaps (id, person_key)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- 同じ人・同じ日付の振替は1件だけ（出勤日・休日の入れ替えができるよう、判定はトランザクションの最後）
  ADD CONSTRAINT shift_change_records_swap_person_date_excl
    EXCLUDE USING btree (swap_person_key WITH =, target_date WITH =) WHERE (swap_id IS NOT NULL)
    DEFERRABLE INITIALLY DEFERRED;

-- 1件の振替に出勤日・休日を1つずつ
CREATE UNIQUE INDEX shift_change_records_swap_role_unique
  ON public.shift_change_records (swap_id, swap_role) WHERE swap_id IS NOT NULL;

-- -------------------------------------------------------
-- 3) 予定: 振替出勤・振替休日の種類は自動登録専用
-- -------------------------------------------------------
ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_furikae_auto_only
    CHECK (type NOT IN ('furikae_work', 'furikae_off') OR shift_change_record_id IS NOT NULL);

-- -------------------------------------------------------
-- 4) 非表示の紐付け（振替出勤日の本人の手動の公休を、予定は消さずにカレンダーで隠す）
-- -------------------------------------------------------
CREATE TABLE public.shift_change_swap_hidden_schedules (
  schedule_id uuid PRIMARY KEY REFERENCES public.schedules(id) ON DELETE CASCADE,
  swap_id uuid NOT NULL REFERENCES public.shift_change_swaps(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shift_change_swap_hidden_schedules_swap_id_idx
  ON public.shift_change_swap_hidden_schedules (swap_id);

-- -------------------------------------------------------
-- 4b) 操作の記録と本部への通知の状態（登録・変更・取消の1回ごとに1行。保存・取消の関数が同じトランザクションで作る）
--     before_content: 変更前（変更）・取消前（取消）の内容 / after_content: 登録・変更後の内容（どちらも通知文面の元）
--     result: 同じ操作IDで再送されたときに返す、最初の操作の結果
--     振替を取り消しても記録は残す（取消の通知を送るため）。swap_id に外部キーは付けない
-- -------------------------------------------------------
CREATE TABLE public.shift_change_swap_operations (
  id uuid PRIMARY KEY,
  swap_id uuid NOT NULL,
  action text NOT NULL,
  request jsonb NOT NULL,
  before_content jsonb NULL,
  after_content jsonb NULL,
  result jsonb NOT NULL,
  person_name text NOT NULL,
  work_date date NOT NULL,
  off_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  notify_status text NOT NULL DEFAULT 'pending',
  notify_attempts integer NOT NULL DEFAULT 0,
  notify_key_version integer NOT NULL DEFAULT 1,
  notify_claim_token uuid NULL,
  notify_claimed_at timestamptz NULL,
  notify_first_attempt_at timestamptz NULL,
  notify_sent_at timestamptz NULL,
  notify_message_id text NULL,
  notify_last_error text NULL,
  notify_manually_confirmed boolean NOT NULL DEFAULT false,
  CONSTRAINT shift_change_swap_operations_action_values
    CHECK (action IN ('create', 'update', 'cancel')),
  CONSTRAINT shift_change_swap_operations_content_by_action
    CHECK ((action = 'create' AND after_content IS NOT NULL)
        OR (action = 'update' AND before_content IS NOT NULL AND after_content IS NOT NULL)
        OR (action = 'cancel' AND before_content IS NOT NULL)),
  CONSTRAINT shift_change_swap_operations_status_values
    CHECK (notify_status IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'needs_check')),
  CONSTRAINT shift_change_swap_operations_claim_while_sending
    CHECK ((notify_status = 'sending') = (notify_claim_token IS NOT NULL))
);

CREATE INDEX shift_change_swap_operations_swap_id_idx
  ON public.shift_change_swap_operations (swap_id, created_at DESC);
CREATE INDEX shift_change_swap_operations_unsent_idx
  ON public.shift_change_swap_operations (created_at) WHERE notify_status <> 'sent';

-- 通知文面の元になる、振替の今の内容（保存・取消の関数の中だけで使う。直接の実行は許さない）
CREATE FUNCTION public.shift_change_swap_mail_content(p_swap_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'personName', dw.employee_name,
    'workContent', s.work_content,
    'reason', w.reason,
    'handledBy', w.handled_by,
    'memo', coalesce(w.memo, ''),
    'work', jsonb_build_object('date', w.target_date, 'facilityName', coalesce(fw.name, ''),
                               'originalShift', coalesce(dw.original_shift, ''), 'changeDetail', dw.change_detail),
    'off', jsonb_build_object('date', o.target_date, 'facilityName', coalesce(fo.name, ''),
                              'originalShift', coalesce(d_o.original_shift, ''), 'changeDetail', d_o.change_detail)
  )
  FROM public.shift_change_swaps s
  JOIN public.shift_change_records w ON w.swap_id = s.id AND w.swap_role = 'work'
  JOIN public.shift_change_records o ON o.swap_id = s.id AND o.swap_role = 'off'
  JOIN public.shift_change_details dw ON dw.record_id = w.id
  JOIN public.shift_change_details d_o ON d_o.record_id = o.id
  LEFT JOIN public.facilities fw ON fw.id = w.facility_id
  LEFT JOIN public.facilities fo ON fo.id = o.facility_id
  WHERE s.id = p_swap_id
$$;

-- -------------------------------------------------------
-- 5) 新しいテーブルの権限・RLS（anon は読むだけ。書き込みは保存・削除の関数からだけ）
--    Supabase の既定権限で付く anon / authenticated / service_role の権限（TRUNCATE を含む）を外してから付け直す
-- -------------------------------------------------------
REVOKE ALL ON TABLE public.shift_change_swaps FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.shift_change_swap_hidden_schedules FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.shift_change_swap_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shift_change_swaps TO anon, service_role;
GRANT SELECT ON TABLE public.shift_change_swap_hidden_schedules TO anon, service_role;
-- 操作の記録は、通知の状態の確認に使う列だけを読める（通知の内容・確保の印・重複防止キーは読めない。書き込みは関数からだけ）
GRANT SELECT (id, swap_id, action, person_name, work_date, off_date, created_at, notify_status, notify_attempts,
              notify_claimed_at, notify_sent_at, notify_last_error, notify_manually_confirmed)
  ON TABLE public.shift_change_swap_operations TO anon, service_role;

ALTER TABLE public.shift_change_swaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_change_swap_hidden_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_change_swap_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_select ON public.shift_change_swaps FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.shift_change_swap_hidden_schedules FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.shift_change_swap_operations FOR SELECT TO anon USING (true);

-- -------------------------------------------------------
-- 6) 書き込みの見張り（トリガー）
--    「振替に関わる行」を書き換えられるのは、振替テーブルの所有者として実行中のとき
--    （＝保存・削除の関数 SECURITY DEFINER の中、外部キーの連鎖、管理者）だけ。
--    anon / authenticated / service_role から直接・既存の保存関数経由で書き換えると SCC_SWAP_LOCKED で止める
-- -------------------------------------------------------

-- 記録（振替の記録だけを対象にする。通常の記録ではトリガー自体が動かない）
CREATE FUNCTION public.shift_change_swap_guard_records()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c
                                     WHERE c.oid = 'public.shift_change_swaps'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'SCC_SWAP_LOCKED: 振替出勤・振替休日の記録は、勤務・休日振替の画面から編集・削除してください（ページを再読み込みしてください）' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shift_change_records_swap_guard_ins
  BEFORE INSERT ON public.shift_change_records
  FOR EACH ROW WHEN (NEW.swap_id IS NOT NULL)
  EXECUTE FUNCTION public.shift_change_swap_guard_records();
CREATE TRIGGER shift_change_records_swap_guard_upd
  BEFORE UPDATE ON public.shift_change_records
  FOR EACH ROW WHEN (OLD.swap_id IS NOT NULL OR NEW.swap_id IS NOT NULL)
  EXECUTE FUNCTION public.shift_change_swap_guard_records();
CREATE TRIGGER shift_change_records_swap_guard_del
  BEFORE DELETE ON public.shift_change_records
  FOR EACH ROW WHEN (OLD.swap_id IS NOT NULL)
  EXECUTE FUNCTION public.shift_change_swap_guard_records();

-- 明細（親の記録が振替か調べる。振替の種別を通常の記録に入れることも止める）
CREATE FUNCTION public.shift_change_swap_guard_details()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_old_swap uuid;
  v_new_swap uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT r.swap_id INTO v_old_swap FROM public.shift_change_records r WHERE r.id = OLD.record_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT r.swap_id INTO v_new_swap FROM public.shift_change_records r WHERE r.id = NEW.record_id;
    IF NEW.change_type IN ('振替出勤', '振替休日') AND v_new_swap IS NULL THEN
      RAISE EXCEPTION 'SCC_INVALID_INPUT: 振替出勤・振替休日は、勤務・休日振替の画面からだけ登録できます' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF (v_old_swap IS NOT NULL OR v_new_swap IS NOT NULL)
     AND current_user IS DISTINCT FROM (SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c
                                         WHERE c.oid = 'public.shift_change_swaps'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'SCC_SWAP_LOCKED: 振替出勤・振替休日の記録は、勤務・休日振替の画面から編集・削除してください（ページを再読み込みしてください）' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shift_change_details_swap_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.shift_change_details
  FOR EACH ROW EXECUTE FUNCTION public.shift_change_swap_guard_details();

-- 予定（自動登録の予定だけを対象にする。手動の予定ではトリガー自体が動かない）
CREATE FUNCTION public.shift_change_swap_guard_schedules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_old_swap boolean := false;
  v_new_swap boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.shift_change_record_id IS NOT NULL THEN
    v_old_swap := EXISTS (SELECT 1 FROM public.shift_change_records r
                           WHERE r.id = OLD.shift_change_record_id AND r.swap_id IS NOT NULL);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.shift_change_record_id IS NOT NULL THEN
      v_new_swap := EXISTS (SELECT 1 FROM public.shift_change_records r
                             WHERE r.id = NEW.shift_change_record_id AND r.swap_id IS NOT NULL);
    END IF;
    IF NEW.type IN ('furikae_work', 'furikae_off') AND NOT v_new_swap THEN
      RAISE EXCEPTION 'SCC_INVALID_INPUT: 振替出勤・振替休日の予定は、勤務・休日振替から自動で登録されます' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF (v_old_swap OR v_new_swap)
     AND current_user IS DISTINCT FROM (SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c
                                         WHERE c.oid = 'public.shift_change_swaps'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'SCC_SWAP_LOCKED: 振替出勤・振替休日の予定は、勤務・休日振替の画面から編集・削除してください（ページを再読み込みしてください）' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER schedules_swap_guard_ins
  BEFORE INSERT ON public.schedules
  FOR EACH ROW WHEN (NEW.shift_change_record_id IS NOT NULL OR NEW.type IN ('furikae_work', 'furikae_off'))
  EXECUTE FUNCTION public.shift_change_swap_guard_schedules();
CREATE TRIGGER schedules_swap_guard_upd
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW WHEN (OLD.shift_change_record_id IS NOT NULL OR NEW.shift_change_record_id IS NOT NULL
                     OR NEW.type IN ('furikae_work', 'furikae_off'))
  EXECUTE FUNCTION public.shift_change_swap_guard_schedules();
CREATE TRIGGER schedules_swap_guard_del
  BEFORE DELETE ON public.schedules
  FOR EACH ROW WHEN (OLD.shift_change_record_id IS NOT NULL)
  EXECUTE FUNCTION public.shift_change_swap_guard_schedules();

-- -------------------------------------------------------
-- 7) 2日分がそろっていることの検査（トランザクションの最後）
--    振替が残っている場合: 出勤日1件・休日1件、各記録の明細はちょうど1件、種別は役割どおり
--    振替ごと消えた場合: 何もしない（記録は外部キーで一緒に消えている）
-- -------------------------------------------------------
CREATE FUNCTION public.shift_change_swap_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[] := '{}';
  v_id uuid;
  v_work int;
  v_off int;
  v_total int;
  v_bad int;
BEGIN
  IF TG_TABLE_NAME = 'shift_change_swaps' THEN
    v_ids := ARRAY[NEW.id];
  ELSIF TG_TABLE_NAME = 'shift_change_records' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_ids := v_ids || OLD.swap_id; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_ids := v_ids || NEW.swap_id; END IF;
  ELSE
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || (SELECT r.swap_id FROM public.shift_change_records r WHERE r.id = OLD.record_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || (SELECT r.swap_id FROM public.shift_change_records r WHERE r.id = NEW.record_id);
    END IF;
  END IF;

  FOR v_id IN SELECT DISTINCT x FROM unnest(v_ids) x WHERE x IS NOT NULL LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.shift_change_swaps s WHERE s.id = v_id);
    SELECT count(*) FILTER (WHERE r.swap_role = 'work'), count(*) FILTER (WHERE r.swap_role = 'off'), count(*)
      INTO v_work, v_off, v_total
      FROM public.shift_change_records r WHERE r.swap_id = v_id;
    SELECT count(*) INTO v_bad
      FROM public.shift_change_records r
     WHERE r.swap_id = v_id
       AND ((SELECT count(*) FROM public.shift_change_details d WHERE d.record_id = r.id) <> 1
            OR NOT EXISTS (SELECT 1 FROM public.shift_change_details d
                            WHERE d.record_id = r.id
                              AND d.change_type = CASE r.swap_role WHEN 'work' THEN '振替出勤' ELSE '振替休日' END));
    IF v_work <> 1 OR v_off <> 1 OR v_total <> 2 OR v_bad > 0 THEN
      RAISE EXCEPTION 'SCC_SWAP_BROKEN: 勤務・休日振替は、振替出勤日と振替休日の2日分をそろえて保存・削除してください' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER shift_change_swaps_check
  AFTER INSERT OR UPDATE ON public.shift_change_swaps
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.shift_change_swap_check();
CREATE CONSTRAINT TRIGGER shift_change_records_swap_check_ins
  AFTER INSERT ON public.shift_change_records
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.swap_id IS NOT NULL)
  EXECUTE FUNCTION public.shift_change_swap_check();
CREATE CONSTRAINT TRIGGER shift_change_records_swap_check_upd
  AFTER UPDATE ON public.shift_change_records
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.swap_id IS NOT NULL OR NEW.swap_id IS NOT NULL)
  EXECUTE FUNCTION public.shift_change_swap_check();
CREATE CONSTRAINT TRIGGER shift_change_records_swap_check_del
  AFTER DELETE ON public.shift_change_records
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.swap_id IS NOT NULL)
  EXECUTE FUNCTION public.shift_change_swap_check();
CREATE CONSTRAINT TRIGGER shift_change_details_swap_check
  AFTER INSERT OR UPDATE OR DELETE ON public.shift_change_details
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.shift_change_swap_check();

-- -------------------------------------------------------
-- 8) 保存（新規・編集）
--    p_swap: {
--      id, mode: 'create'|'update', operation_id, expected_updated_at（編集時は必須。読み込んだときの updated_at）,
--      person: { type: 'group_manager'|'staff_member', id },
--      show_on_calendar: boolean, work_content: text,
--      reason, handled_by, memo,
--      work: { date, facility_id|null, original_shift, change_detail },   -- 振替出勤日
--      off:  { date, facility_id|null, original_shift, change_detail },   -- 振替休日
--      hidden_schedule_ids: [uuid]   -- 振替出勤日に非表示にする本人の手動の公休（kyukyu のみ・10件まで）
--    }
--    operation_id: 操作ID（必須。画面が発行）。同じ操作IDの再送は、最初の操作の結果をそのまま返す（何も書かない）。
--    新規は画面が発行した振替IDで保存する（既にある振替IDへの新規は、別の操作なら SCC_CONFLICT）。
--    編集は expected_updated_at が一致したときだけ保存する（一致しなければ、内容が同じでも SCC_CONFLICT）。
--    変更なしの編集は SCC_NO_CHANGE（保存も通知の記録もしない）
--    戻り値: { id, updated_at, operation_id }
-- -------------------------------------------------------
CREATE FUNCTION public.shift_change_swap_save(p_swap jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_date constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_now timestamptz := now();
  v_id uuid;
  v_mode text;
  v_expected timestamptz;
  v_ptype text;
  v_pid uuid;
  v_pgm uuid;
  v_psm uuid;
  v_pname text;
  v_pactive boolean;
  v_show boolean;
  v_content text;
  v_reason text;
  v_handled text;
  v_memo text;
  v_work jsonb;
  v_off jsonb;
  v_hidden jsonb;
  v_work_date date;
  v_off_date date;
  v_exists boolean;
  v_old_person uuid;
  v_old_updated timestamptz;
  v_role text;
  v_day jsonb;
  v_date date;
  v_fac uuid;
  v_rec uuid;
  v_type text;
  v_title text;
  v_pair_text text;
  v_hid jsonb;
  v_stored jsonb;
  v_incoming jsonb;
  v_op uuid;
  v_request jsonb;
  v_op_swap uuid;
  v_op_action text;
  v_op_request jsonb;
  v_op_result jsonb;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
BEGIN
  -- ── 入力の検証（書き込み前にすべて確認する） ──
  IF p_swap IS NULL OR jsonb_typeof(p_swap) <> 'object' THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 保存する振替がありません' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(p_swap->>'id', '') !~ c_uuid OR coalesce(p_swap->>'mode', '') NOT IN ('create', 'update') THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 振替のIDと保存方法を指定してください' USING ERRCODE = 'P0001';
  END IF;
  v_id := (p_swap->>'id')::uuid;
  v_mode := p_swap->>'mode';

  -- 操作ID（登録・変更の1回ごとに画面が発行する）。同じ操作IDの再送は、最初の操作の結果をそのまま返す
  -- （応答が失われた場合の再送。内容が偶然同じでも、別の操作IDなら以前の操作の成功とはみなさない）
  IF coalesce(p_swap->>'operation_id', '') !~ c_uuid THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 操作IDを指定してください（ページを再読み込みしてください）' USING ERRCODE = 'P0001';
  END IF;
  v_op := (p_swap->>'operation_id')::uuid;
  v_request := p_swap - 'operation_id';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shift_change_swap_op:' || v_op::text, 0));
  SELECT o.swap_id, o.action, o.request, o.result INTO v_op_swap, v_op_action, v_op_request, v_op_result
    FROM public.shift_change_swap_operations o WHERE o.id = v_op;
  IF FOUND THEN
    IF v_op_swap = v_id AND v_op_action = v_mode AND v_op_request = v_request THEN
      RETURN v_op_result;
    END IF;
    RAISE EXCEPTION 'SCC_CONFLICT: この操作IDは別の内容の操作で使われています（画面を開き直してください）' USING ERRCODE = 'P0001';
  END IF;

  v_ptype := p_swap #>> '{person,type}';
  IF v_ptype NOT IN ('group_manager', 'staff_member') OR v_ptype IS NULL
     OR coalesce(p_swap #>> '{person,id}', '') !~ c_uuid THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 対象者をG長・主任またはスタッフの一覧から選んでください' USING ERRCODE = 'P0001';
  END IF;
  v_pid := (p_swap #>> '{person,id}')::uuid;
  IF v_ptype = 'group_manager' THEN
    v_pgm := v_pid;
    SELECT g.name, g.active INTO v_pname, v_pactive FROM public.group_managers g WHERE g.id = v_pid;
  ELSE
    v_psm := v_pid;
    SELECT s.name, s.active INTO v_pname, v_pactive FROM public.staff_members s WHERE s.id = v_pid;
  END IF;
  IF v_pname IS NULL THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 対象者が見つかりません（一覧を再読み込みしてください）' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(coalesce(p_swap->'show_on_calendar', 'false'::jsonb)) <> 'boolean' THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: カレンダーに表示するかを指定してください' USING ERRCODE = 'P0001';
  END IF;
  v_show := coalesce((p_swap->>'show_on_calendar')::boolean, false);
  v_content := btrim(coalesce(p_swap->>'work_content', ''));
  IF char_length(v_content) > 100 THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 振替出勤日の勤務内容は100文字以内にしてください' USING ERRCODE = 'P0001';
  END IF;
  v_reason := btrim(coalesce(p_swap->>'reason', ''));
  v_handled := btrim(coalesce(p_swap->>'handled_by', ''));
  v_memo := coalesce(p_swap->>'memo', '');
  IF v_reason = '' OR v_handled = '' THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 理由と入力者を入力してください' USING ERRCODE = 'P0001';
  END IF;

  v_work := p_swap->'work';
  v_off := p_swap->'off';
  IF jsonb_typeof(v_work) IS DISTINCT FROM 'object' OR jsonb_typeof(v_off) IS DISTINCT FROM 'object'
     OR coalesce(v_work->>'date', '') !~ c_date OR coalesce(v_off->>'date', '') !~ c_date THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 振替出勤日と振替休日を入力してください' USING ERRCODE = 'P0001';
  END IF;
  v_work_date := (v_work->>'date')::date;
  v_off_date := (v_off->>'date')::date;
  IF v_work_date = v_off_date THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 振替出勤日と振替休日は別の日にしてください' USING ERRCODE = 'P0001';
  END IF;
  FOREACH v_day IN ARRAY ARRAY[v_work, v_off] LOOP
    IF btrim(coalesce(v_day->>'change_detail', '')) = '' THEN
      RAISE EXCEPTION 'SCC_INVALID_INPUT: 変更内容を入力してください' USING ERRCODE = 'P0001';
    END IF;
    IF NULLIF(v_day->>'facility_id', '') IS NOT NULL THEN
      IF (v_day->>'facility_id') !~ c_uuid
         OR NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = (v_day->>'facility_id')::uuid) THEN
        RAISE EXCEPTION 'SCC_INVALID_INPUT: 施設が見つかりません（一覧を再読み込みしてください）' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  v_hidden := coalesce(p_swap->'hidden_schedule_ids', '[]'::jsonb);
  IF jsonb_typeof(v_hidden) <> 'array' THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 非表示にする予定の指定が正しくありません' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_hidden) > 10 THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 非表示にできる公休は10件までです' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_hidden) > 0 AND NOT v_show THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 予定を非表示にするには、振替をカレンダーに表示してください' USING ERRCODE = 'P0001';
  END IF;

  -- ── 既存の振替（編集・再試行）をロックして確認する ──
  SELECT s.person_key, s.updated_at INTO v_old_person, v_old_updated
    FROM public.shift_change_swaps s WHERE s.id = v_id FOR UPDATE;
  v_exists := FOUND;
  IF v_mode = 'update' THEN
    IF NOT v_exists THEN
      RAISE EXCEPTION 'SCC_NOT_FOUND: 編集中の振替が見つかりません（他の端末で取り消された可能性があります）' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(p_swap->>'expected_updated_at', '') = '' THEN
      RAISE EXCEPTION 'SCC_INVALID_INPUT: 編集前の更新日時がありません（ページを再読み込みしてください）' USING ERRCODE = 'P0001';
    END IF;
    v_expected := (p_swap->>'expected_updated_at')::timestamptz;
    -- 他の端末で変更されていたら、内容が同じでも保存しない（以前の操作の成功とはみなさない）
    IF v_expected IS DISTINCT FROM v_old_updated THEN
      RAISE EXCEPTION 'SCC_CONFLICT: この振替は他の端末で変更されています。画面を開き直して、最新の内容から編集してください' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_exists THEN
    -- 新規なのに同じ振替IDが既にある（同じ操作の再送は上で返しているので、ここは別の操作）
    RAISE EXCEPTION 'SCC_CONFLICT: 同じIDの振替が既に登録されています。画面を開き直して、登録済みの内容を確認してください' USING ERRCODE = 'P0001';
  END IF;
  IF v_mode = 'update' THEN
    -- 保存済みの内容と、今回の入力を保存したときの内容を同じ形にそろえて比べる（変更なしなら保存も通知もしない）
    SELECT jsonb_build_object(
        'person', s.person_key, 'show', s.show_on_calendar, 'content', s.work_content,
        'days', (SELECT jsonb_object_agg(r.swap_role, jsonb_build_object(
                   'date', r.target_date, 'facility', r.facility_id, 'reason', r.reason, 'handled', r.handled_by,
                   'memo', coalesce(r.memo, ''), 'orig', d.original_shift, 'detail', d.change_detail))
                   FROM public.shift_change_records r JOIN public.shift_change_details d ON d.record_id = r.id
                  WHERE r.swap_id = s.id),
        'hidden', (SELECT coalesce(jsonb_agg(h.schedule_id ORDER BY h.schedule_id), '[]'::jsonb)
                     FROM public.shift_change_swap_hidden_schedules h WHERE h.swap_id = s.id))
      INTO v_stored
      FROM public.shift_change_swaps s WHERE s.id = v_id;
    v_incoming := jsonb_build_object(
      'person', v_pid, 'show', v_show, 'content', v_content,
      'days', jsonb_build_object(
        'work', jsonb_build_object('date', v_work_date, 'facility', NULLIF(v_work->>'facility_id', '')::uuid,
          'reason', v_reason, 'handled', v_handled, 'memo', v_memo,
          'orig', NULLIF(btrim(coalesce(v_work->>'original_shift', '')), ''), 'detail', btrim(v_work->>'change_detail')),
        'off', jsonb_build_object('date', v_off_date, 'facility', NULLIF(v_off->>'facility_id', '')::uuid,
          'reason', v_reason, 'handled', v_handled, 'memo', v_memo,
          'orig', NULLIF(btrim(coalesce(v_off->>'original_shift', '')), ''), 'detail', btrim(v_off->>'change_detail'))),
      'hidden', (SELECT coalesce(jsonb_agg(DISTINCT (x.value #>> '{}')::uuid ORDER BY (x.value #>> '{}')::uuid), '[]'::jsonb)
                   FROM jsonb_array_elements(v_hidden) x));
    IF v_stored = v_incoming THEN
      RAISE EXCEPTION 'SCC_NO_CHANGE: 変更点がありません（保存・通知は不要です）' USING ERRCODE = 'P0001';
    END IF;
    v_before := public.shift_change_swap_mail_content(v_id);
  END IF;

  -- 無効化された人は新しく対象者にできない（既に対象者になっている振替の編集はできる）
  IF NOT v_pactive AND NOT (v_exists AND v_old_person = v_pid) THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 無効化されている人は対象者にできません' USING ERRCODE = 'P0001';
  END IF;

  -- 同じ人・同じ日付の別の振替（最終的には除外制約でも防ぐ。ここでは分かりやすいメッセージを出す）
  IF EXISTS (SELECT 1 FROM public.shift_change_records r
              WHERE r.swap_person_key = v_pid AND r.swap_id IS NOT NULL AND r.swap_id <> v_id
                AND r.target_date IN (v_work_date, v_off_date)) THEN
    RAISE EXCEPTION 'SCC_DUPLICATE_SWAP: 同じ人の同じ日付に、別の勤務・休日振替が登録されています' USING ERRCODE = 'P0001';
  END IF;

  -- 非表示にする予定: 本人・振替出勤日・手動の公休で、他の振替に使われていないもの
  FOR v_hid IN SELECT value FROM jsonb_array_elements(v_hidden) LOOP
    IF jsonb_typeof(v_hid) <> 'string' OR (v_hid #>> '{}') !~ c_uuid
       OR NOT EXISTS (
         SELECT 1 FROM public.schedules s
          WHERE s.id = (v_hid #>> '{}')::uuid
            AND s.shift_change_record_id IS NULL
            AND coalesce(s.group_manager_id, s.staff_member_id) = v_pid
            AND s.date = v_work_date
            AND s.type = 'kyukyu') THEN
      RAISE EXCEPTION 'SCC_INVALID_HIDDEN: 非表示にできるのは、振替出勤日の本人の公休だけです（一覧を再読み込みしてください）' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.shift_change_swap_hidden_schedules h
                WHERE h.schedule_id = (v_hid #>> '{}')::uuid AND h.swap_id <> v_id) THEN
      RAISE EXCEPTION 'SCC_INVALID_HIDDEN: この予定は別の振替で非表示にしています' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ── 書き込み ──
  INSERT INTO public.shift_change_swaps AS s
    (id, person_group_manager_id, person_staff_member_id, person_key, show_on_calendar, work_content, created_at, updated_at)
  VALUES (v_id, v_pgm, v_psm, v_pid, v_show, v_content, v_now, v_now)
  ON CONFLICT (id) DO UPDATE SET
    person_group_manager_id = EXCLUDED.person_group_manager_id,
    person_staff_member_id = EXCLUDED.person_staff_member_id,
    person_key = EXCLUDED.person_key,
    show_on_calendar = EXCLUDED.show_on_calendar,
    work_content = EXCLUDED.work_content,
    updated_at = EXCLUDED.updated_at;

  FOREACH v_role IN ARRAY ARRAY['work', 'off'] LOOP
    v_day := CASE v_role WHEN 'work' THEN v_work ELSE v_off END;
    v_date := (v_day->>'date')::date;
    v_fac := NULLIF(v_day->>'facility_id', '')::uuid;
    v_type := CASE v_role WHEN 'work' THEN '振替出勤' ELSE '振替休日' END;
    v_pair_text := CASE v_role
      WHEN 'work' THEN '振替休日：' || to_char(v_off_date, 'FMMM/FMDD')
      ELSE '振替出勤日：' || to_char(v_work_date, 'FMMM/FMDD') END;

    v_rec := NULL;
    SELECT r.id INTO v_rec FROM public.shift_change_records r WHERE r.swap_id = v_id AND r.swap_role = v_role;
    IF v_rec IS NULL THEN
      v_rec := gen_random_uuid();
      INSERT INTO public.shift_change_records
        (id, facility_id, target_date, reason, handled_by, memo, related_change_group_id, swap_id, swap_role, swap_person_key)
      VALUES (v_rec, v_fac, v_date, v_reason, v_handled, NULLIF(v_memo, ''), NULL, v_id, v_role, v_pid);
    ELSE
      UPDATE public.shift_change_records SET
        facility_id = v_fac,
        target_date = v_date,
        reason = v_reason,
        handled_by = v_handled,
        memo = NULLIF(v_memo, ''),
        related_change_group_id = NULL
      WHERE id = v_rec;
    END IF;

    DELETE FROM public.shift_change_details WHERE record_id = v_rec;
    INSERT INTO public.shift_change_details
      (record_id, employee_name, change_type, change_detail, is_external_support, sort_order, original_shift)
    VALUES (v_rec, v_pname, v_type, btrim(v_day->>'change_detail'), false, 0, NULLIF(btrim(coalesce(v_day->>'original_shift', '')), ''));

    -- このシフト変更の自動予定だけを作り直す（手動の予定・MTの予定には触れない）
    DELETE FROM public.schedules WHERE shift_change_record_id = v_rec;
    IF v_show THEN
      v_title := CASE v_role
        WHEN 'work' THEN '振替出勤' || CASE WHEN v_content <> '' THEN '（' || v_content || '）' ELSE '' END
        ELSE '振替休日' END;
      INSERT INTO public.schedules (
        group_manager_id, staff_member_id, facility_id, title, date, start_time, end_time,
        type, memo, is_all_day, shift_change_record_id
      ) VALUES (
        v_pgm, v_psm, v_fac, v_title, v_date, '00:00', '00:00',
        CASE v_role WHEN 'work' THEN 'furikae_work' ELSE 'furikae_off' END,
        '【勤務・休日振替から自動登録】' || v_type || '：' || btrim(v_day->>'change_detail')
          || E'\n' || v_pair_text || E'\n理由：' || v_reason,
        true, v_rec
      );
    END IF;
  END LOOP;

  DELETE FROM public.shift_change_swap_hidden_schedules WHERE swap_id = v_id;
  INSERT INTO public.shift_change_swap_hidden_schedules (schedule_id, swap_id)
  SELECT DISTINCT (x.value #>> '{}')::uuid, v_id FROM jsonb_array_elements(v_hidden) x;

  -- 操作の記録（通知の内容と送信状態）を同じトランザクションで作る。通知はこの記録の内容からサーバー側で作る
  v_after := public.shift_change_swap_mail_content(v_id);
  v_result := jsonb_build_object('id', v_id, 'updated_at', v_now, 'operation_id', v_op);
  INSERT INTO public.shift_change_swap_operations
    (id, swap_id, action, request, before_content, after_content, result, person_name, work_date, off_date)
  VALUES (v_op, v_id, v_mode, v_request, v_before, v_after, v_result, v_pname, v_work_date, v_off_date);
  RETURN v_result;
END;
$$;

-- -------------------------------------------------------
-- 9) 取消（2日分・自動予定・非表示の紐付けをまとめて削除。手動の予定・MTには触れない）
--    p_operation_id: 取消の操作ID（画面が発行）。同じ操作IDの再送は、最初の取消の結果をそのまま返す。
--    別の操作IDで、既に取り消されている振替を取り消そうとした場合は SCC_NOT_FOUND（自分の取消が成功したとはみなさない。
--    取消の通知は、実際に取り消した操作の記録で管理される）
--    戻り値: { id, operation_id, content（取消前の内容） }
-- -------------------------------------------------------
CREATE FUNCTION public.shift_change_swap_delete(p_swap_id uuid, p_expected_updated_at timestamptz, p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated timestamptz;
  v_before jsonb;
  v_result jsonb;
  v_op_swap uuid;
  v_op_action text;
  v_op_result jsonb;
BEGIN
  IF p_swap_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 振替のIDと操作IDを指定してください' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shift_change_swap_op:' || p_operation_id::text, 0));
  SELECT o.swap_id, o.action, o.result INTO v_op_swap, v_op_action, v_op_result
    FROM public.shift_change_swap_operations o WHERE o.id = p_operation_id;
  IF FOUND THEN
    IF v_op_swap = p_swap_id AND v_op_action = 'cancel' THEN
      RETURN v_op_result;
    END IF;
    RAISE EXCEPTION 'SCC_CONFLICT: この操作IDは別の内容の操作で使われています（画面を開き直してください）' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.updated_at INTO v_updated FROM public.shift_change_swaps s WHERE s.id = p_swap_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCC_NOT_FOUND: この振替は既に取り消されています（他の端末などで取り消した場合、その操作の通知は一覧の通知状態で確認できます）' USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_updated THEN
    RAISE EXCEPTION 'SCC_CONFLICT: この振替は他の端末で変更されています。画面を開き直して、最新の内容を確認してから取り消してください' USING ERRCODE = 'P0001';
  END IF;

  v_before := public.shift_change_swap_mail_content(p_swap_id);
  v_result := jsonb_build_object('id', p_swap_id, 'operation_id', p_operation_id, 'content', v_before);
  DELETE FROM public.shift_change_swaps WHERE id = p_swap_id;

  INSERT INTO public.shift_change_swap_operations
    (id, swap_id, action, request, before_content, after_content, result, person_name, work_date, off_date)
  VALUES (
    p_operation_id, p_swap_id, 'cancel',
    jsonb_build_object('swap_id', p_swap_id, 'expected_updated_at', p_expected_updated_at),
    v_before, NULL, v_result,
    v_before->>'personName', (v_before #>> '{work,date}')::date, (v_before #>> '{off,date}')::date
  );
  RETURN v_result;
END;
$$;

-- -------------------------------------------------------
-- 10) 本部への通知（操作ごとに1通）。通知 API（サーバー）からサーバー専用キーで呼ぶ。
--     文面は操作の記録（DB）の内容からサーバー側で作る。画面から文面は受け取らない。
--     状態: pending（未送信）→ sending（送信中。確保の印 notify_claim_token）→ sent / failed / unknown
--       failed : メールサービスが明確に受け付けなかった（送られていない）→ 次は新しい重複防止キーで送り直せる
--       unknown: 送れたか分からない（通信切れ・サーバーエラー・送信中のまま期限切れ）
--                → 最初の送信から 23 時間以内なら、同じ重複防止キー（Resend の Idempotency-Key。保持 24 時間）で送り直す
--                  （先に届いていれば Resend が送らない）。23 時間を過ぎたら needs_check（要確認）にして自動では送らない
--       needs_check: 本部に届いているかを人が確認し、「届いていた（完了）」か「届いていない（新しいキーで再送）」を選ぶ
--     重複防止キー: 'shift-swap-op/<操作ID>/<キーの版>'。版は failed からの送り直しと、要確認からの再送のときだけ上がる
-- -------------------------------------------------------
CREATE FUNCTION public.shift_change_swap_notify_claim(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_lease constant interval := interval '5 minutes';
  c_window constant interval := interval '23 hours';
  o public.shift_change_swap_operations%ROWTYPE;
  v_token uuid;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 操作IDを指定してください' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO o FROM public.shift_change_swap_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCC_NOT_FOUND: 通知する操作が見つかりません' USING ERRCODE = 'P0001';
  END IF;

  IF o.notify_status IN ('sent', 'needs_check') THEN
    RETURN jsonb_build_object('status', o.notify_status);
  END IF;
  IF o.notify_status = 'sending' AND o.notify_claimed_at > now() - c_lease THEN
    RETURN jsonb_build_object('status', 'sending');
  END IF;
  -- 送れたか分からない（unknown、または送信中のまま期限切れ）: 重複防止キーの有効期間を過ぎていたら要確認にする
  IF o.notify_status IN ('unknown', 'sending')
     AND o.notify_first_attempt_at IS NOT NULL AND o.notify_first_attempt_at < now() - c_window THEN
    UPDATE public.shift_change_swap_operations
       SET notify_status = 'needs_check', notify_claim_token = NULL,
           notify_last_error = coalesce(notify_last_error, '送信結果が分からないまま、重複防止の有効期間を過ぎました')
     WHERE id = p_operation_id;
    RETURN jsonb_build_object('status', 'needs_check');
  END IF;
  -- 明確に失敗していた（送られていない）: 新しいキーで送り直す
  IF o.notify_status = 'failed' THEN
    o.notify_key_version := o.notify_key_version + 1;
    o.notify_first_attempt_at := NULL;
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.shift_change_swap_operations
     SET notify_status = 'sending', notify_claim_token = v_token, notify_claimed_at = now(),
         notify_attempts = notify_attempts + 1,
         notify_key_version = o.notify_key_version,
         notify_first_attempt_at = coalesce(o.notify_first_attempt_at, now())
   WHERE id = p_operation_id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'claim_token', v_token,
    'idempotency_key', 'shift-swap-op/' || o.id::text || '/' || o.notify_key_version::text,
    'action', o.action,
    'content', CASE o.action WHEN 'cancel' THEN o.before_content ELSE o.after_content END,
    'before', CASE o.action WHEN 'update' THEN o.before_content ELSE NULL END
  );
END;
$$;

-- 送信の結果を記録する（確保した送信だけ。確保の印が一致しなければ記録しない）
CREATE FUNCTION public.shift_change_swap_notify_finish(
  p_operation_id uuid, p_claim_token uuid, p_outcome text, p_message_id text, p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_token uuid;
BEGIN
  IF p_operation_id IS NULL OR p_claim_token IS NULL OR coalesce(p_outcome, '') NOT IN ('sent', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 送信結果の指定が正しくありません' USING ERRCODE = 'P0001';
  END IF;
  SELECT notify_status, notify_claim_token INTO v_status, v_token
    FROM public.shift_change_swap_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCC_NOT_FOUND: 通知する操作が見つかりません' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'sending' OR v_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'SCC_CONFLICT: この送信は確保されていません（期限切れ、または別の送信が処理しています）' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.shift_change_swap_operations
     SET notify_status = p_outcome, notify_claim_token = NULL,
         notify_sent_at = CASE WHEN p_outcome = 'sent' THEN now() ELSE notify_sent_at END,
         notify_message_id = CASE WHEN p_outcome = 'sent' THEN left(p_message_id, 200) ELSE notify_message_id END,
         notify_last_error = CASE WHEN p_outcome = 'sent' THEN NULL ELSE left(coalesce(p_error, ''), 500) END
   WHERE id = p_operation_id;
  RETURN jsonb_build_object('status', p_outcome);
END;
$$;

-- 要確認（needs_check）の通知を、人の確認の結果で片付ける
--   confirmed_sent: 本部に届いていたので完了にする / resend: 届いていなかったので新しいキーで送り直せる状態に戻す
--   本部での受信の確認が必要な管理操作のため、API（anon・service_role）には実行を許さない（Dashboard の管理者だけ）
CREATE FUNCTION public.shift_change_swap_notify_resolve(p_operation_id uuid, p_resolution text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_operation_id IS NULL OR coalesce(p_resolution, '') NOT IN ('confirmed_sent', 'resend') THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 確認結果の指定が正しくありません' USING ERRCODE = 'P0001';
  END IF;
  SELECT notify_status INTO v_status FROM public.shift_change_swap_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCC_NOT_FOUND: 通知する操作が見つかりません' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'needs_check' THEN
    RAISE EXCEPTION 'SCC_CONFLICT: この通知は確認待ちではありません（画面を開き直してください）' USING ERRCODE = 'P0001';
  END IF;
  IF p_resolution = 'confirmed_sent' THEN
    UPDATE public.shift_change_swap_operations
       SET notify_status = 'sent', notify_sent_at = now(), notify_manually_confirmed = true
     WHERE id = p_operation_id;
    RETURN jsonb_build_object('status', 'sent');
  END IF;
  UPDATE public.shift_change_swap_operations
     SET notify_status = 'pending', notify_key_version = notify_key_version + 1, notify_first_attempt_at = NULL
   WHERE id = p_operation_id;
  RETURN jsonb_build_object('status', 'pending');
END;
$$;

-- -------------------------------------------------------
-- 11) 関数の実行権限
--     保存・取消: anon だけ（既存の shift_change_save_batch と同じ）。
--     通知の確保・結果の記録: service_role だけ（通知 API がサーバー専用キー（Secret key・旧 service_role キー）で呼ぶ。画面・anon からは呼べない）。
--     要確認の片付け: API からは誰も呼べない（本部管理者が Supabase Dashboard の SQL Editor で、受信を確認したうえで実行する。
--       supabase/admin/shift_swap_notify_resolve.sql の手順。Dashboard は関数の所有者として実行する）
--     トリガー用・通知内容の組み立て用: 誰にも直接の実行を許さない（既存の mt_check_joint_group と同じ）
-- -------------------------------------------------------
REVOKE ALL ON FUNCTION public.shift_change_swap_save(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_change_swap_delete(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_change_swap_notify_claim(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_change_swap_notify_finish(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_change_swap_notify_resolve(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shift_change_swap_save(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.shift_change_swap_delete(uuid, timestamptz, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.shift_change_swap_notify_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.shift_change_swap_notify_finish(uuid, uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.shift_change_swap_mail_content(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_change_swap_guard_records() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_change_swap_guard_details() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_change_swap_guard_schedules() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_change_swap_check() FROM PUBLIC, anon, authenticated, service_role;
