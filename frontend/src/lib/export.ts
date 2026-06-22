import { Document, Packer, Paragraph, TextRun } from "docx";
import jsPDF from "jspdf";

function parseStructuredContent(content: string) {
  const lines = content.split("\n").map((line) => line.trimEnd());
  return lines.filter((line) => line.trim().length > 0);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportDocx(title: string, content: string) {
  const lines = parseStructuredContent(content);
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 30 })],
          }),
          ...lines.map((line) =>
            new Paragraph({
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text: line.replace(/^[-*]\s*/, ""),
                  bold: /^[A-Z][A-Z\s&/()-]{2,}:?$/.test(line),
                }),
              ],
              bullet: /^[-*]\s+/.test(line) ? { level: 0 } : undefined,
            }),
          ),
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  downloadBlob(blob, `${title}.docx`);
}

export function exportPdf(title: string, content: string) {
  const lines = parseStructuredContent(content);
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.setFont("times", "bold");
  pdf.setFontSize(18);
  pdf.text(title, 40, 50);
  let y = 82;
  for (const line of lines) {
    const isHeading = /^[A-Z][A-Z\s&/()-]{2,}:?$/.test(line);
    const printable = line.replace(/^[-*]\s*/, "");
    pdf.setFont("times", isHeading ? "bold" : "normal");
    pdf.setFontSize(isHeading ? 13 : 11);
    const wrapped = pdf.splitTextToSize(`${/^[-*]\s+/.test(line) ? "• " : ""}${printable}`, 520);
    pdf.text(wrapped, 40, y);
    y += wrapped.length * (isHeading ? 16 : 14) + 4;
    if (y > 740) {
      pdf.addPage();
      y = 50;
    }
  }
  pdf.save(`${title}.pdf`);
}

export function exportMarkdown(title: string, content: string) {
  const blob = new Blob([`# ${title}\n\n${content}`], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, `${title}.md`);
}
