import { type BookView } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function PayablesPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return (
    <PageStub
      title="외상매입금"
      description="vw_payable — 만기 임박 매입 결제 알림"
      book={book as BookView}
    />
  );
}
