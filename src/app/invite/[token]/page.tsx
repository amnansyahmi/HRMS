import { InvitationPage } from "@/components/public-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <InvitationPage token={(await params).token} />;
}
