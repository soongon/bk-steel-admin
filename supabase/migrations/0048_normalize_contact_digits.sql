-- ============================================================
-- 0048_normalize_contact_digits.sql
-- 사업자번호·전화·팩스·휴대폰을 숫자만 저장으로 정규화(표시는 앱에서 포맷).
-- 기존 데이터가 대시 포함/숫자만 혼재 → regexp_replace 로 숫자만, 빈 값은 NULL.
-- ============================================================

UPDATE company_profile SET
  business_no = regexp_replace(business_no, '[^0-9]', '', 'g'),
  phone  = NULLIF(regexp_replace(coalesce(phone, ''),  '[^0-9]', '', 'g'), ''),
  fax    = NULLIF(regexp_replace(coalesce(fax, ''),    '[^0-9]', '', 'g'), ''),
  mobile = NULLIF(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), '');

UPDATE partner SET
  business_no = NULLIF(regexp_replace(coalesce(business_no, ''), '[^0-9]', '', 'g'), ''),
  phone       = NULLIF(regexp_replace(coalesce(phone, ''),       '[^0-9]', '', 'g'), ''),
  fax         = NULLIF(regexp_replace(coalesce(fax, ''),         '[^0-9]', '', 'g'), '');

UPDATE business_card SET
  phone = NULLIF(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '');
