-- =======================================================
-- MT同時開催 第1段階: DB基盤（追加のみ。既存行の値は変更しない）
-- migration name: mt_joint_groups_phase1
-- =======================================================

-- -------------------------------------------------------
-- 1) meeting_joint_groups（同時開催グループ。1グループ = 同一施設の施設MT＋厨房MT）
--    (id, facility_id) の UNIQUE は meetings からの複合FK（同一施設の保証）用
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_joint_groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID        NOT NULL REFERENCES public.facilities(id),
  memo        TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meeting_joint_groups_id_facility_unique UNIQUE (id, facility_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_joint_groups_facility_id
  ON public.meeting_joint_groups(facility_id);

-- -------------------------------------------------------
-- 2) meetings.joint_group_id（NULL = 単独開催。既存行はすべて NULL のまま）
--    NULL許容・DEFAULTなしの列追加はテーブル書き換えなし／UPDATEトリガーも発火しない
-- -------------------------------------------------------
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS joint_group_id UUID NULL;

-- -------------------------------------------------------
-- 5) 制約
--   ・同一施設: (joint_group_id, facility_id) → meeting_joint_groups(id, facility_id) の複合FK
--     joint_group_id が NULL の行は検査対象外（MATCH SIMPLE）
--     グループ削除時は joint_group_id だけを NULL に戻す（= 解除。facility_id は残す）
--   ・異なるMT種別: (joint_group_id, meeting_type) UNIQUE
--     種別は facility/kitchen の2種のみのため、1グループ最大2件・同種別の重複不可が保証される
-- -------------------------------------------------------
ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_joint_group_facility_fkey;
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_joint_group_facility_fkey
  FOREIGN KEY (joint_group_id, facility_id)
  REFERENCES public.meeting_joint_groups(id, facility_id)
  ON DELETE SET NULL (joint_group_id);

ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_joint_group_type_unique;
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_joint_group_type_unique
  UNIQUE (joint_group_id, meeting_type);

-- -------------------------------------------------------
-- 3) meeting_minute_links（議事録PDF ⇔ MT の紐付け。1PDFを複数MTで共有する）
--    meeting_minutes.meeting_id は「アップロード元MT（所有者）」として従来どおり残す
--    MT削除・議事録削除時はリンクだけが消える（Storage実ファイルには一切触れない）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_minute_links (
  minute_id   UUID        NOT NULL REFERENCES public.meeting_minutes(id) ON DELETE CASCADE,
  meeting_id  UUID        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (minute_id, meeting_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_minute_links_meeting_id
  ON public.meeting_minute_links(meeting_id);

-- リンク先MTは議事録の所有者MTと同一施設に限る
CREATE OR REPLACE FUNCTION public.check_meeting_minute_link_facility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.meeting_minutes mm
    JOIN public.meetings owner_m  ON owner_m.id  = mm.meeting_id
    JOIN public.meetings target_m ON target_m.id = NEW.meeting_id
    WHERE mm.id = NEW.minute_id
      AND owner_m.facility_id = target_m.facility_id
  ) THEN
    RAISE EXCEPTION '議事録と異なる施設のMTには紐付けできません';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_minute_links_facility ON public.meeting_minute_links;
CREATE TRIGGER trg_meeting_minute_links_facility
  BEFORE INSERT OR UPDATE ON public.meeting_minute_links
  FOR EACH ROW EXECUTE FUNCTION public.check_meeting_minute_link_facility();

-- 第2段階リリースまでの間も、現行アプリが登録した議事録に所有者リンクが自動で付くようにする
CREATE OR REPLACE FUNCTION public.add_owner_meeting_minute_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.meeting_minute_links (minute_id, meeting_id)
  VALUES (NEW.id, NEW.meeting_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_minutes_owner_link ON public.meeting_minutes;
CREATE TRIGGER trg_meeting_minutes_owner_link
  AFTER INSERT ON public.meeting_minutes
  FOR EACH ROW EXECUTE FUNCTION public.add_owner_meeting_minute_link();

-- -------------------------------------------------------
-- 4) 既存議事録の所有者リンク登録（INSERTのみ。meeting_minutes 自体は更新しない）
-- -------------------------------------------------------
INSERT INTO public.meeting_minute_links (minute_id, meeting_id, created_at)
SELECT id, meeting_id, uploaded_at
FROM public.meeting_minutes
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------
-- RLS（最小権限: 両テーブルとも UPDATE / TRUNCATE は付与しない）
--   ・グループの facility_id、リンクの組み合わせは「作り直し」で変更する前提
--   ・authenticated は本アプリ未使用のため権限を付与しない
-- -------------------------------------------------------
ALTER TABLE public.meeting_joint_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_minute_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.meeting_joint_groups FROM anon, authenticated;
REVOKE ALL ON public.meeting_minute_links FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.meeting_joint_groups TO anon;
GRANT SELECT, INSERT, DELETE ON public.meeting_minute_links TO anon;

DROP POLICY IF EXISTS "anon_select_meeting_joint_groups" ON public.meeting_joint_groups;
DROP POLICY IF EXISTS "anon_insert_meeting_joint_groups" ON public.meeting_joint_groups;
DROP POLICY IF EXISTS "anon_delete_meeting_joint_groups" ON public.meeting_joint_groups;
CREATE POLICY "anon_select_meeting_joint_groups" ON public.meeting_joint_groups
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "anon_insert_meeting_joint_groups" ON public.meeting_joint_groups
  FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "anon_delete_meeting_joint_groups" ON public.meeting_joint_groups
  FOR DELETE TO anon USING (TRUE);

DROP POLICY IF EXISTS "anon_select_meeting_minute_links" ON public.meeting_minute_links;
DROP POLICY IF EXISTS "anon_insert_meeting_minute_links" ON public.meeting_minute_links;
DROP POLICY IF EXISTS "anon_delete_meeting_minute_links" ON public.meeting_minute_links;
CREATE POLICY "anon_select_meeting_minute_links" ON public.meeting_minute_links
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "anon_insert_meeting_minute_links" ON public.meeting_minute_links
  FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "anon_delete_meeting_minute_links" ON public.meeting_minute_links
  FOR DELETE TO anon USING (TRUE);
