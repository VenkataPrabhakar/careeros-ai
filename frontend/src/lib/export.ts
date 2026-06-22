import { Document, Packer, Paragraph, TextRun } from "docx";
import jsPDF from "jspdf";
import { ResumeStyleOption } from "@/lib/types";

function parseStructuredContent(content: string) {
  const lines = content.split("\n").map((line) => line.trimEnd());
  return lines.filter((line) => line.trim().length > 0);
}

function isHeadingLine(line: string) {
  const trimmed = line.trim().replace(/:$/, "");
  return (
    /^[A-Z][A-Z\s&/()-]{2,}$/.test(trimmed) ||
    /^(Professional Summary|Technical Skills|Education|Professional Experience|Experience|Projects|Certifications|Awards|Summary)$/i.test(trimmed)
  );
}

function isBulletLine(line: string) {
  return /^[-*•]\s+/.test(line.trim());
}

function isNameLine(line: string, index: number) {
  const trimmed = line.trim();
  return (
    index === 0 &&
    trimmed.length > 4 &&
    trimmed.length < 60 &&
    !isHeadingLine(trimmed) &&
    !isBulletLine(trimmed) &&
    trimmed.split(/\s+/).length <= 6
  );
}

function isSubheadLine(line: string, index: number) {
  if (index === 0) {
    return false;
  }
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.length < 90 && !isHeadingLine(trimmed) && !isBulletLine(trimmed);
}

function getStyleTokens(style: ResumeStyleOption) {
  switch (style) {
    case "MODERN_MINIMAL":
      return { titleFont: "helvetica", bodyFont: "helvetica", accent: [18, 98, 240] as const };
    case "EXECUTIVE_BRIEF":
      return { titleFont: "times", bodyFont: "times", accent: [32, 55, 91] as const };
    case "ATS_COMPACT":
      return { titleFont: "helvetica", bodyFont: "times", accent: [0, 0, 0] as const };
    case "HARVARD_TRADITIONAL":
      return { titleFont: "times", bodyFont: "times", accent: [66, 45, 20] as const };
    case "JAKE_CLEAN":
      return { titleFont: "helvetica", bodyFont: "helvetica", accent: [62, 78, 94] as const };
    case "FAANG_TECHNICAL":
      return { titleFont: "helvetica", bodyFont: "helvetica", accent: [11, 110, 79] as const };
    case "CONSULTING_POLISHED":
      return { titleFont: "times", bodyFont: "helvetica", accent: [96, 48, 122] as const };
    case "SENIOR_ENGINEERING":
      return { titleFont: "times", bodyFont: "times", accent: [13, 71, 161] as const };
    case "CLASSIC_PROFESSIONAL":
      return { titleFont: "times", bodyFont: "times", accent: [44, 62, 80] as const };
    case "ORIGINAL_UPLOADED_FORMAT":
    default:
      return { titleFont: "times", bodyFont: "times", accent: [0, 0, 0] as const };
  }
}

function rgbToHex(rgb: readonly [number, number, number]) {
  return rgb.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportDocx(title: string, content: string, style: ResumeStyleOption) {
  const lines = parseStructuredContent(content);
  const tokens = getStyleTokens(style);
  const document = new Document({
    sections: [
      {
        children: lines.map((line, index) => {
          const isHeading = isHeadingLine(line);
          const bullet = isBulletLine(line);
          const isName = isNameLine(line, index);
          const isSubhead = isSubheadLine(line, index) && index < 3;

          return new Paragraph({
            spacing: {
              after: isHeading ? 110 : isName ? 90 : 75,
              before: isHeading ? 150 : 0,
            },
            alignment: isName || isSubhead ? "center" : "left",
            children: [
              new TextRun({
                text: line.replace(/^[-*•]\s*/, ""),
                bold: isHeading || isName,
                size: isName ? 28 : isHeading ? 22 : isSubhead ? 20 : 21,
                font: (isName || isHeading ? tokens.titleFont : tokens.bodyFont) === "helvetica" ? "Arial" : "Times New Roman",
                color: isHeading ? rgbToHex(tokens.accent) : "000000",
              }),
            ],
            bullet: bullet ? { level: 0 } : undefined,
          });
        }),
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  downloadBlob(blob, `${title}.docx`);
}

export function exportPdf(title: string, content: string, style: ResumeStyleOption) {
  const lines = parseStructuredContent(content);
  const tokens = getStyleTokens(style);
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  let y = 50;
  for (const [index, line] of lines.entries()) {
    const isHeading = isHeadingLine(line);
    const bullet = isBulletLine(line);
    const isName = isNameLine(line, index);
    const isSubhead = isSubheadLine(line, index) && index < 3;
    const printable = line.replace(/^[-*•]\s*/, "");
    const color: readonly [number, number, number] = isHeading ? tokens.accent : [0, 0, 0];

    pdf.setFont(isHeading || isName ? tokens.titleFont : tokens.bodyFont, isHeading || isName ? "bold" : "normal");
    pdf.setTextColor(...color);
    pdf.setFontSize(isName ? 18 : isHeading ? 12 : isSubhead ? 11 : 10.5);
    const wrapped = pdf.splitTextToSize(`${bullet ? "• " : ""}${printable}`, 520);
    if (isName || isSubhead) {
      pdf.text(wrapped, 306, y, { align: "center" });
    } else {
      pdf.text(wrapped, 40, y);
    }
    y += wrapped.length * (isHeading ? 15 : isName ? 17 : 13) + (isHeading ? 6 : 3);
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
