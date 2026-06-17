import { createClient } from "@/lib/supabase/server";
import { fetchAllCompanyProfiles } from "@/lib/company-profile";
import { CompanyCards } from "./company-cards";

export default async function CompanySettingsPage() {
  const supabase = await createClient();
  const profiles = await fetchAllCompanyProfiles(supabase);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">회사 정보</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          거래명세표·세금계산서·견적서의 <strong>공급자</strong> 정보로 사용됩니다. 책별로 별도 관리
          (B계좌는 통상 SL과 동일한 정보 사용).
        </p>
      </header>

      <CompanyCards profiles={profiles} />

      <div className="rounded-md border-dashed border-2 border-zinc-300 p-3 text-xs text-muted-foreground dark:border-zinc-700">
        💡 각 책 카드의 <strong>편집</strong>에서 인감(직인) 이미지(1MB 이하 PNG/JPG/WebP, 배경 투명 PNG 권장)를
        업로드하면 거래명세표·견적서·납품확인서의 공급자 직인에 자동 적용됩니다. 법인·사업자는 각각 별도 등록.
      </div>
    </div>
  );
}
