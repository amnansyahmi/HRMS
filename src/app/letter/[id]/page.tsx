import Link from "next/link";
import { getActor, getCompany } from "@/lib/auth";
import { visibleRecords } from "@/lib/hr";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActor(),
    id = (await params).id,
    letter = (await visibleRecords(actor)).find(
      (r) => r.id === id && r.kind === "letter",
    );
  if (!letter) notFound();
  const company = await getCompany(actor);
  return (
    <div className="print-document">
      <div className="print-toolbar">
        <Link href="/?view=employee-files">Back to letters</Link>
        <PrintButton />
      </div>
      <h1>{company.name}</h1>
      <p>{letter.data.status === "Draft" ? "DRAFT — for HR review" : ""}</p>
      <h2>{String(letter.data.title)}</h2>
      <p>{String(letter.data.effectiveDate)}</p>
      <p className="letter-text">{String(letter.data.body)}</p>
    </div>
  );
}
