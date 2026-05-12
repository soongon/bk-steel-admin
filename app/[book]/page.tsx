import { redirect } from "next/navigation";

export default async function BookRoot({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  redirect(`/${book}/dashboard`);
}
