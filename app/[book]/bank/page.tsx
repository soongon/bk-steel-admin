import { type Book } from "@/lib/book";
import { PageStub } from "@/components/admin/page-stub";

export default async function BankPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  return <PageStub title="통장 입출금" description="책 종속 통장의 일자별 흐름" book={book as Book} />;
}
