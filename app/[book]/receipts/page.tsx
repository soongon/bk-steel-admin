import { type Book } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function ReceiptsPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return (
    <PageStub
      title="영수증·비용"
      description="식대·연료비·임차료·급여 등. 책별 자료 정책 자동 적용"
      book={book as Book}
    />
  );
}
