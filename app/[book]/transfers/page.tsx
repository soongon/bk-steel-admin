import { type Book } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function TransfersPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return (
    <PageStub
      title="책 간 이관"
      description="BK↔SL 정상거래 (시가 근거 필수) / SL↔B 비공식 재분류 (BK↔B 자동 차단)"
      book={book as Book}
    />
  );
}
