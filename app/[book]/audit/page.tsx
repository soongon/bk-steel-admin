import { type BookView } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return (
    <PageStub
      title="감사 로그"
      description="audit_log 조회. B계좌 row는 sensitive=TRUE로 자동 마킹"
      book={book as BookView}
    />
  );
}
