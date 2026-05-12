import { type Book } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function ReceivablesPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return (
    <PageStub
      title="미수금"
      description="vw_receivable — 등급별(정상/단기/중기/장기) 노출 + 거래처별 신용한도 비교"
      book={book as Book}
    />
  );
}
