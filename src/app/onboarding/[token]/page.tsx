import { OnboardingPage } from "@/components/onboarding-page";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <OnboardingPage token={(await params).token} />;
}
