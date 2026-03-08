import { BookProject } from './types';

export async function exportBookToPDF(book: BookProject): Promise<void> {
  // Dynamic import for client-side only
  const { jsPDF } = await import('jspdf');

  // Book format: 16x21cm per page -> spread = 32x21cm (landscape)
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [320, 210], // 32cm x 21cm spread
  });

  const pageWidth = pdf.internal.pageSize.getWidth(); // 320mm
  const pageHeight = pdf.internal.pageSize.getHeight(); // 210mm
  const margin = 3;
  const halfWidth = pageWidth / 2; // 160mm = one page width

  let lastChapter = '';

  for (let i = 0; i < book.spreads.length; i++) {
    const spread = book.spreads[i];

    if (i > 0) {
      pdf.addPage();
    }

    // Draw the illustration - full spread
    if (spread.generatedImage) {
      try {
        const imgData = `data:image/png;base64,${spread.generatedImage}`;
        const imgWidth = pageWidth - margin * 2;
        const imgHeight = pageHeight - margin * 2;
        pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      } catch (err) {
        console.error(`Kunde inte lagga till bild for sida ${spread.pages}:`, err);
      }
    } else {
      // No image - show placeholder
      pdf.setFontSize(14);
      pdf.setTextColor(150, 150, 150);
      const label = spread.pages === 'omslag' ? 'Omslag' :
                    spread.pages === 'slutsida' ? 'Slutsida' :
                    `Sida ${spread.pages}`;
      pdf.text(`[${label} - ingen bild]`, halfWidth, pageHeight / 2, { align: 'center' });
    }

    // Skip page numbers and chapter for cover/end pages
    const isSpecialPage = spread.pages === 'omslag' || spread.pages === 'slutsida';
    if (isSpecialPage) continue;

    // Parse page numbers from "70-71" format
    const pageMatch = spread.pages.match(/(\d+)(?:-(\d+))?/);
    if (!pageMatch) continue;

    const leftPageNum = pageMatch[1];
    const rightPageNum = pageMatch[2] || '';

    // ---- Consistent page number design ----
    // Left page number - bottom left corner
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text(leftPageNum, margin + 8, pageHeight - 5, { align: 'center' });

    // Right page number - bottom right corner
    if (rightPageNum) {
      pdf.text(rightPageNum, pageWidth - margin - 8, pageHeight - 5, { align: 'center' });
    }

    // Small decorative line under each page number for consistent look
    pdf.setDrawColor(180, 180, 180);
    pdf.setLineWidth(0.3);
    // Left side line
    pdf.line(margin + 3, pageHeight - 3.5, margin + 13, pageHeight - 3.5);
    // Right side line
    if (rightPageNum) {
      pdf.line(pageWidth - margin - 13, pageHeight - 3.5, pageWidth - margin - 3, pageHeight - 3.5);
    }

    // ---- Chapter heading (top center, only on first spread of chapter) ----
    if (spread.chapter && spread.chapter !== lastChapter) {
      lastChapter = spread.chapter;
      // White background strip for chapter heading
      pdf.setFillColor(255, 255, 255);
      pdf.rect(halfWidth - 55, 1.5, 110, 9, 'F');

      // Thin decorative lines around chapter text
      pdf.setDrawColor(160, 160, 160);
      pdf.setLineWidth(0.2);
      pdf.line(halfWidth - 45, 4, halfWidth - 5, 4); // left line
      pdf.line(halfWidth + 5, 4, halfWidth + 45, 4); // right line

      // Chapter text
      pdf.setFontSize(7);
      pdf.setTextColor(80, 80, 80);
      pdf.text(spread.chapter, halfWidth, 8, { align: 'center' });
    }
  }

  // Download
  const safeName = book.title
    .replace(/[^a-zA-ZåäöÅÄÖ0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  pdf.save(`${safeName}.pdf`);
}
