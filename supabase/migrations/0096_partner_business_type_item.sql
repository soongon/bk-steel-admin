-- ============================================================
-- 0096_partner_business_type_item.sql
-- 거래처 업태·종목 분리 — 전자세금계산서 공급받는자 업태(invoiceeBizType)·종목(invoiceeBizClass)
--
-- 지금까지 거래처는 '업종'(industry) 한 칸이었다. 계산서 발행은 그 값을 업태로 보내고 종목은 비워 보냈고,
-- 사업자 이미지 자동 등록(0088)은 서류의 업태·종목을 '업태 / 종목'으로 합쳐 그 칸에 넣었다.
--  · business_type(업태)·business_item(종목) 두 칸을 만든다(company_profile 과 같은 이름).
--  · 백필: '업태 / 종목'으로 합쳐진 값(이미지 등록분)은 나누고, 쉼표 목록에서 겹친 항목(사업자등록증은 종목마다 업태를
--    되풀이한다)은 처음 것만 남긴다. 그 밖의 업종 값은 지금 계산서에 업태로 나가던 그대로 업태 칸으로 옮긴다.
--  · industry 는 지우지 않는다 — 이 마이그레이션 적용과 새 화면 배포 사이에 옛 화면이 읽는다. 앱은 더 쓰지 않으며
--    다음 정리 때 지운다.
-- 길이 상한(팝빌 업태·종목 최대 100자)은 앱(거래처 폼·계산서 발행)이 막는다.
-- ============================================================

ALTER TABLE partner ADD COLUMN IF NOT EXISTS business_type TEXT;  -- 업태
ALTER TABLE partner ADD COLUMN IF NOT EXISTS business_item TEXT;  -- 종목

COMMENT ON COLUMN partner.business_type IS '업태 — 세금계산서 공급받는자 업태(팝빌 최대 100자)';
COMMENT ON COLUMN partner.business_item IS '종목 — 세금계산서 공급받는자 종목(팝빌 최대 100자)';
COMMENT ON COLUMN partner.industry IS '(0096 부터 안 씀) 옛 업종 한 칸 — business_type·business_item 으로 옮김, 다음 정리 때 삭제';

-- 쉼표 목록 정리: 앞뒤 공백·빈 항목을 버리고 같은 항목은 처음 것만(순서 유지). 두 칸이 모두 빈 거래처만.
-- 새 화면 배포 뒤에는 다시 돌리지 않는다 — 업태·종목을 일부러 비운 거래처에 옛 업종이 되살아난다. 적용과 배포 사이에
-- 옛 화면이 업종만 쓴 거래처는 audit_log(table_name 'partner', changed_columns 에 industry)로 찾아 따로 옮긴다.
WITH src AS (
  SELECT id,
         CASE WHEN industry LIKE '% / %' THEN split_part(industry, ' / ', 1) ELSE industry END AS t,
         CASE WHEN industry LIKE '% / %' THEN substr(industry, strpos(industry, ' / ') + 3) END AS i
  FROM partner
  WHERE industry IS NOT NULL AND btrim(industry) <> ''
    AND business_type IS NULL AND business_item IS NULL
), norm AS (
  SELECT s.id,
         (SELECT string_agg(x, ', ' ORDER BY o)
            FROM (SELECT btrim(e) AS x, min(n) AS o
                    FROM unnest(string_to_array(s.t, ',')) WITH ORDINALITY AS u(e, n)
                   WHERE btrim(e) <> '' GROUP BY btrim(e)) a) AS bt,
         (SELECT string_agg(x, ', ' ORDER BY o)
            FROM (SELECT btrim(e) AS x, min(n) AS o
                    FROM unnest(string_to_array(s.i, ',')) WITH ORDINALITY AS u(e, n)
                   WHERE btrim(e) <> '' GROUP BY btrim(e)) a) AS bi
  FROM src s
)
UPDATE partner p
   SET business_type = n.bt,
       business_item = n.bi
  FROM norm n
 WHERE p.id = n.id;
