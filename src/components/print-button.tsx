"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
export function PrintButton() {
  return (
    <div className="print-tools">
      <Button onClick={() => window.print()}>
        <Printer size={15} />
        Print / save as PDF
      </Button>
      <p>Choose “Save as PDF” in your browser’s print dialog to download.</p>
    </div>
  );
}
