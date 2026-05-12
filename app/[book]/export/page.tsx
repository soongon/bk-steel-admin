import { type Book } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function ExportPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return (
    <PageStub
      title="결산·신고 Export"
      description="vw_book_monthly_pnl_filing / vw_vat_eligible_* — 세무사용 CSV·XLSX"
      book={book as Book}
    />
  );
}
