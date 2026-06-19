import { Document, Packer, Paragraph, TextRun } from "docx";
import jsPDF from "jspdf";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportDocx(title: string, content: string) {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 30 })],
          }),
          ...content.split("\n").map((line) => new Paragraph(line)),
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  downloadBlob(blob, `${title}.docx`);
}

export function exportPdf(title: string, content: string) {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.setFont("times", "bold");
  pdf.setFontSize(18);
  pdf.text(title, 40, 50);
  pdf.setFont("times", "normal");
  pdf.setFontSize(11);
  const lines = pdf.splitTextToSize(content, 520);
  pdf.text(lines, 40, 80);
  pdf.save(`${title}.pdf`);
}

export function exportMarkdown(title: string, content: string) {
  const blob = new Blob([`# ${title}\n\n${content}`], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, `${title}.md`);
}
