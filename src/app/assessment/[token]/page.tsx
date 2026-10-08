import { AssessmentPage } from "@/components/public-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <AssessmentPage token={(await params).token} />;
}
