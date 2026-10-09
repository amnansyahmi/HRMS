import { notFound } from "next/navigation";
import { AccountPage } from "@/components/security-page";
export default async function Page({
  params,
}: {
  params: Promise<{ purpose: string; token: string }>;
}) {
  const { purpose, token } = await params;
  if (purpose !== "reset" && purpose !== "verify") notFound();
  return <AccountPage purpose={purpose} token={token} />;
}
