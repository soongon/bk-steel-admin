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
        💡 인감 이미지 업로드 기능은 v1.1에서 추가 예정. 현재는 텍스트 정보만 관리.
      </div>
    </div>
  );
}
