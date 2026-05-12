import { PageStub } from "@/components/admin/page-stub";

export default async function PricesPage() {
  return (
    <PageStub
      title="오늘의 시세"
      description="큐레이션 품목군의 일자별 시세 입력 + 매입가 자동 누적 + 시계열 그래프"
      isShared
    />
  );
}
