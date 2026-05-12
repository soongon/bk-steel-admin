import { type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  const view = book as BookView;
  return (
    <PageStub
      title="대시보드"
      description={`${BOOK_VIEW_LABEL[view]} 보기의 핵심 지표 (시세·미수·재고 시가·B계좌 흐름 등)`}
      book={view}
    />
  );
}
