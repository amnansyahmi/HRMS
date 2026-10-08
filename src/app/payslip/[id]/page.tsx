import { redirect, notFound } from "next/navigation";
import { getActor, getCompany } from "@/lib/auth";
import { visibleRecords } from "@/lib/hr";
import { PrintButton } from "@/components/print-button";
import { money } from "@/lib/client";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActor().catch(() => null);
  if (!actor) redirect("/");
  const { id } = await params,
    record = (await visibleRecords(actor)).find(
      (r) =>
        r.id === id && r.kind === "payroll" && r.data.status === "Published",
    );
  if (!record) notFound();
  const company = await getCompany(actor),
    data = record.data;
  const earnings = [
      ["Base salary", data.base],
      ["Allowances", data.allowance],
      ["Overtime", data.overtime],
      ["Bonus", data.bonus],
      ["Commission", data.commission],
      ["Reimbursements", data.reimbursements],
    ],
    deductions = [
      ["EPF", data.epfEmployee],
      ["SOCSO", data.socsoEmployee],
      ["EIS", data.eisEmployee],
      ["PCB / income tax", data.pcb],
      ["Other deductions", data.otherDeduction],
      ["Unpaid leave", data.unpaidDeduction],
      ["Zakat", data.zakat],
    ];
  return (
    <div className="payslip-page">
      <style>{`.payslip-page{max-width:820px;margin:40px auto;padding:0 25px;color:#333;font-family:Arial,sans-serif}.print-tools{display:flex;align-items:center;gap:15px;margin:0 0 35px}.print-tools p{font-size:11px;color:#999}.payslip{border:1px solid #ddd;padding:48px}.payslip header{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding-bottom:25px}.payslip h1{font-size:25px;font-weight:600}.payslip h2{font-size:16px;font-weight:500}.payslip p{font-size:11px;color:#888;margin-top:8px}.payslip-details{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:30px 0}.payslip-details strong{display:block;font-size:13px;font-weight:500;margin-top:8px}.payslip-details small{font-size:10px;color:#999}.payslip-columns{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:35px 0}.payslip table{width:100%;font-size:11px}.payslip th{text-align:left;border-bottom:1px solid #ddd;padding-bottom:12px;font-weight:500}.payslip td{padding:11px 0;color:#666}.payslip td:last-child{text-align:right}.payslip-total{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #ddd;padding-top:25px;font-size:14px}.payslip-total strong{font-size:24px;font-weight:600}.employer-costs{margin:28px 0;padding-top:22px;border-top:1px solid #eee}.employer-costs span{font-size:11px;margin-right:15px;color:#888}.payslip footer{margin-top:30px;color:#aaa;font-size:9px}.payslip-note{white-space:pre-wrap;font-size:11px;line-height:1.7;color:#888;margin:22px 0}@media(max-width:640px){.payslip-page{margin:25px auto;padding:0 16px}.payslip{padding:25px 20px}.payslip-columns{grid-template-columns:1fr;gap:23px}.print-tools{align-items:flex-start;flex-direction:column}}@media print{.print-tools{display:none}.payslip-page{max-width:100%;margin:0;padding:0}.payslip{border:0;padding:20px}.payslip-columns{grid-template-columns:1fr 1fr}@page{size:A4;margin:20mm}}`}</style>
      <PrintButton />
      <article className="payslip">
        <header>
          <div>
            <h1>{company.name}</h1>
            <p>
              {company.settings.registrationNo
                ? `Registration: ${company.settings.registrationNo}`
                : ""}
            </p>
          </div>
          <div>
            <h2>Payslip</h2>
            <p>{String(data.period)}</p>
          </div>
        </header>
        <section className="payslip-details">
          <div>
            <small>EMPLOYEE</small>
            <strong>{String(data.employeeName)}</strong>
            <p>{String(data.employeeTitle)}</p>
          </div>
          <div>
            <small>PAY PERIOD</small>
            <strong>{String(data.period)}</strong>
            <p>Currency: MYR</p>
          </div>
        </section>
        <section className="payslip-columns">
          <table>
            <thead>
              <tr>
                <th colSpan={2}>Earnings</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map(([label, value]) => (
                <tr key={String(label)}>
                  <td>{String(label)}</td>
                  <td>{money(value)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Gross pay</strong>
                </td>
                <td>
                  <strong>{money(data.gross)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th colSpan={2}>Employee deductions</th>
              </tr>
            </thead>
            <tbody>
              {deductions.map(([label, value]) => (
                <tr key={String(label)}>
                  <td>{String(label)}</td>
                  <td>{money(value)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total deductions</strong>
                </td>
                <td>
                  <strong>
                    {money(
                      Number(data.gross) +
                        Number(data.reimbursements || 0) -
                        Number(data.net),
                    )}
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <div className="payslip-total">
          <span>Net pay</span>
          <strong>{money(data.net)}</strong>
        </div>
        <section className="employer-costs">
          <p>Employer contributions</p>
          <p>
            <span>EPF {money(data.epfEmployer)}</span>
            <span>SOCSO {money(data.socsoEmployer)}</span>
            <span>EIS {money(data.eisEmployer)}</span>
          </p>
        </section>
        {data.note ? (
          <div className="payslip-note">{String(data.note)}</div>
        ) : null}
        <footer>
          This payslip records the published payroll amounts. Reference:{" "}
          {record.id}
        </footer>
      </article>
    </div>
  );
}
