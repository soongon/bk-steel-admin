import { type BookView } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function SalesPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return <PageStub title="매출" description="외부 매출 + 책 내 매출 라인" book={book as BookView} />;
}
