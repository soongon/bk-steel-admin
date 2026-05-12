import { type Book } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function PurchasesPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return <PageStub title="매입" description="발주 → 입고 → 결제 상태머신" book={book as Book} />;
}
