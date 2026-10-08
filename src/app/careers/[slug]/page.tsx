import { CareersPage } from "@/components/public-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <CareersPage slug={(await params).slug} />;
}
