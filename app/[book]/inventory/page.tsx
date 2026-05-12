import { type BookView } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return (
    <PageStub
      title="재고"
      description="개별법 ledger (purchase_line - allocation). 가닥/lot 단위 추적"
      book={book as BookView}
    />
  );
}
