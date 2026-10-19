-- ============================================================
-- 0083_quote_site_link.sql
-- 견적서 현장 연결 백필 — 견적서 저장이 site_id 를 채우지 않던 문제(2026-10-19 코드 수정: createQuote·updateQuote 가
-- resolveSiteId 로 같은 이름의 현장을 찾고 없으면 만든다)의 기존 데이터를 같은 규칙으로 맞춘다(0031 매출 백필과 같은 방식).
--   · 현장명만 있고 현장이 연결되지 않은 견적서 → 그 이름(앞뒤 공백 제거)의 현장이 없으면 현장 마스터에 만든다.
--   · 견적서 site_id = 같은 이름의 현장.
--   · 견적서에서 전환된 매출 — convert_quote_to_sale 이 견적서의 빈 site_id 를 그대로 복사했다 — 도 같은 현장으로.
-- 이미 연결된 행은 건드리지 않으므로 다시 실행해도 안전하다.
-- ============================================================

INSERT INTO site (name)
SELECT DISTINCT btrim(q.site_name)
FROM quote q
WHERE q.site_id IS NULL
  AND q.deleted_at IS NULL
  AND btrim(COALESCE(q.site_name, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM site s WHERE s.name = btrim(q.site_name) AND s.deleted_at IS NULL
  )
ON CONFLICT DO NOTHING;

UPDATE quote q SET site_id = s.id
FROM site s
WHERE q.site_id IS NULL
  AND q.deleted_at IS NULL
  AND s.deleted_at IS NULL
  AND btrim(COALESCE(q.site_name, '')) = s.name;

UPDATE sale x SET site_id = q.site_id
FROM quote q
WHERE x.source_quote_id = q.id
  AND x.site_id IS NULL
  AND x.deleted_at IS NULL
  AND q.site_id IS NOT NULL
  AND btrim(COALESCE(x.site_name, '')) = btrim(COALESCE(q.site_name, ''));
