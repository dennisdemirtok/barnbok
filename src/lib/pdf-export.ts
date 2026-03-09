import { BookProject, Spread } from './types';
import { pickLunaLayout, LunaLayout } from './luna-layouts';

export async function exportBookToPDF(book: BookProject): Promise<void> {
  const { jsPDF } = await import('jspdf');

  const isSeparateTextFormat = book.bookFormat === 'bildbok-separat-text';

  // Book format: 16x21cm per page -> spread = 32x21cm (landscape)
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [320, 210],
  });

  const W = pdf.internal.pageSize.getWidth();   // 320mm
  const H = pdf.internal.pageSize.getHeight();  // 210mm
  const M = 3;   // margin
  const HW = W / 2; // 160mm = one page width

  let lastChapter = '';

  for (let i = 0; i < book.spreads.length; i++) {
    const spread = book.spreads[i];
    if (i > 0) pdf.addPage();

    const isSpecial = spread.pages === 'omslag' || spread.pages === 'slutsida';

    if (isSeparateTextFormat && !isSpecial) {
      const layout = pickLunaLayout(i);
      renderLunaSpread(pdf, spread, layout, W, H, M, HW, lastChapter);
    } else {
      renderStandardSpread(pdf, spread, W, H, M, HW, lastChapter);
    }

    if (spread.chapter && spread.chapter !== lastChapter) {
      lastChapter = spread.chapter;
    }
  }

  const safeName = book.title
    .replace(/[^a-zA-ZåäöÅÄÖ0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  pdf.save(`${safeName}.pdf`);
}

// ════════════════════════════════════════════════════════
//  Standard full-spread rendering (image covers entire spread)
// ════════════════════════════════════════════════════════
function renderStandardSpread(
  pdf: any, spread: Spread,
  W: number, H: number, M: number, HW: number,
  lastChapter: string
) {
  if (spread.generatedImage) {
    try {
      pdf.addImage(
        `data:image/png;base64,${spread.generatedImage}`, 'PNG',
        M, M, W - M * 2, H - M * 2
      );
    } catch (err) {
      console.error(`Bild for sida ${spread.pages}:`, err);
    }
  } else {
    pdf.setFontSize(14);
    pdf.setTextColor(150, 150, 150);
    const label = spread.pages === 'omslag' ? 'Omslag' :
                  spread.pages === 'slutsida' ? 'Slutsida' :
                  `Sida ${spread.pages}`;
    pdf.text(`[${label} - ingen bild]`, HW, H / 2, { align: 'center' });
  }

  const isSpecial = spread.pages === 'omslag' || spread.pages === 'slutsida';
  if (isSpecial) return;

  addPageNumbers(pdf, spread, W, H, M);
  addChapterHeading(pdf, spread, HW, lastChapter);
}

// ════════════════════════════════════════════════════════
//  Luna-style varied layouts
// ════════════════════════════════════════════════════════
function renderLunaSpread(
  pdf: any, spread: Spread, layout: LunaLayout,
  W: number, H: number, M: number, HW: number,
  lastChapter: string
) {
  // Page divider
  pdf.setDrawColor(220, 220, 220);
  pdf.setLineWidth(0.3);
  pdf.line(HW, M, HW, H - M);

  switch (layout) {
    case 'text-left-img-right':
      renderTextLeftImgRight(pdf, spread, W, H, M, HW, lastChapter);
      break;
    case 'img-left-text-right':
      renderImgLeftTextRight(pdf, spread, W, H, M, HW, lastChapter);
      break;
    case 'text-left-img-right-3q':
      renderTextLeftImgRight3Q(pdf, spread, W, H, M, HW, lastChapter);
      break;
    case 'img-left-3q-text-right':
      renderImgLeft3QTextRight(pdf, spread, W, H, M, HW, lastChapter);
      break;
    case 'text-around-img-center':
      renderTextAroundImgCenter(pdf, spread, W, H, M, HW, lastChapter);
      break;
  }

  addPageNumbers(pdf, spread, W, H, M);
}

// ── Layout 1: Text left, full image right ──
function renderTextLeftImgRight(
  pdf: any, spread: Spread,
  W: number, H: number, M: number, HW: number,
  lastChapter: string
) {
  const TM = 15; // text margin

  // White background for text page
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, HW, H, 'F');

  // Text content (no chapter headings for Luna-style books)
  const startY = TM + 10;
  renderTextContent(pdf, spread.textBlocks, TM, startY, HW - TM * 2, H - TM - 10);

  // Image on right half
  addImageToArea(pdf, spread, HW + M, M, HW - M * 2, H - M * 2);
}

// ── Layout 2: Full image left, text right ──
function renderImgLeftTextRight(
  pdf: any, spread: Spread,
  W: number, H: number, M: number, HW: number,
  lastChapter: string
) {
  const TM = 15;

  // Image on left half
  addImageToArea(pdf, spread, M, M, HW - M * 2, H - M * 2);

  // White background for text page (right)
  pdf.setFillColor(255, 255, 255);
  pdf.rect(HW, 0, HW, H, 'F');

  // Text content on right page (no chapter headings for Luna-style books)
  const startY = TM + 10;
  renderTextContent(pdf, spread.textBlocks, HW + TM, startY, HW - TM * 2, H - TM - 10);
}

// ── Layout 3: Text left, image 3/4 right + text below image ──
function renderTextLeftImgRight3Q(
  pdf: any, spread: Spread,
  W: number, H: number, M: number, HW: number,
  lastChapter: string
) {
  const TM = 15;
  const imgHeight = (H - M * 2) * 0.72; // 72% of page for image
  const textBelowY = M + imgHeight + 3;
  const textBelowH = H - textBelowY - 12;

  // White background for text page (left)
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, HW, H, 'F');

  // Text content (no chapter headings for Luna-style books)
  const startY = TM + 10;

  // Split text: main on left, last block below image (if multiple blocks)
  const mainBlocks = spread.textBlocks.length > 1
    ? spread.textBlocks.slice(0, -1)
    : spread.textBlocks;
  const bottomBlock = spread.textBlocks.length > 1
    ? spread.textBlocks[spread.textBlocks.length - 1]
    : null;

  renderTextContent(pdf, mainBlocks, TM, startY, HW - TM * 2, H - TM - 10);

  // Image on right (top 72%)
  addImageToArea(pdf, spread, HW + M, M, HW - M * 2, imgHeight);

  // Subtle divider below image
  pdf.setDrawColor(230, 230, 230);
  pdf.setLineWidth(0.2);
  pdf.line(HW + TM, textBelowY - 2, W - TM, textBelowY - 2);

  // Text below image
  if (bottomBlock) {
    renderTextContent(pdf, [bottomBlock], HW + TM, textBelowY, HW - TM * 2, textBelowH, 9);
  }
}

// ── Layout 4: Image 3/4 left + text below, text right ──
function renderImgLeft3QTextRight(
  pdf: any, spread: Spread,
  W: number, H: number, M: number, HW: number,
  lastChapter: string
) {
  const TM = 15;
  const imgHeight = (H - M * 2) * 0.72;
  const textBelowY = M + imgHeight + 3;
  const textBelowH = H - textBelowY - 12;

  // Image on left (top 72%)
  addImageToArea(pdf, spread, M, M, HW - M * 2, imgHeight);

  // Subtle divider below image on left
  pdf.setDrawColor(230, 230, 230);
  pdf.setLineWidth(0.2);
  pdf.line(TM, textBelowY - 2, HW - TM, textBelowY - 2);

  // Text snippet below image on left page
  if (spread.textBlocks.length > 0) {
    const snippet = [spread.textBlocks[0]];
    renderTextContent(pdf, snippet, TM, textBelowY, HW - TM * 2, textBelowH, 9);
  }

  // White background for text page (right)
  pdf.setFillColor(255, 255, 255);
  pdf.rect(HW, 0, HW, H, 'F');

  // Re-draw divider line between pages (was covered by white rect)
  pdf.setDrawColor(220, 220, 220);
  pdf.setLineWidth(0.3);
  pdf.line(HW, M, HW, H - M);

  // Text on right page (no chapter headings for Luna-style books)
  const startY = TM + 10;

  // Main text on right (skip first block if it was used as snippet)
  const rightBlocks = spread.textBlocks.length > 1
    ? spread.textBlocks.slice(1)
    : spread.textBlocks;
  renderTextContent(pdf, rightBlocks, HW + TM, startY, HW - TM * 2, H - TM - 10);
}

// ── Layout 5: Portrait image centered, text columns on both sides ──
function renderTextAroundImgCenter(
  pdf: any, spread: Spread,
  W: number, H: number, M: number, HW: number,
  lastChapter: string
) {
  const TM = 10;

  // Three-column layout: text (28%) | image (44%) | text (28%)
  const leftColW = W * 0.28;   // ~90mm
  const imgAreaW = W * 0.44;   // ~140mm
  const rightColX = leftColW + imgAreaW;
  const rightColW = W - rightColX;

  // White backgrounds for text columns
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, leftColW, H, 'F');
  pdf.rect(rightColX, 0, rightColW, H, 'F');

  // Light background for image area
  pdf.setFillColor(248, 248, 248);
  pdf.rect(leftColW, 0, imgAreaW, H, 'F');

  // Portrait image centered in middle column
  const imgPadding = 6;
  const imgX = leftColW + imgPadding;
  const imgW = imgAreaW - imgPadding * 2;
  const imgH = H - M * 2;
  addImageToArea(pdf, spread, imgX, M, imgW, imgH);

  // Subtle vertical dividers
  pdf.setDrawColor(230, 230, 230);
  pdf.setLineWidth(0.2);
  pdf.line(leftColW, M, leftColW, H - M);
  pdf.line(rightColX, M, rightColX, H - M);

  // Split text blocks between left and right columns
  const allBlocks = spread.textBlocks;
  if (allBlocks.length === 0) return;

  const midIdx = Math.ceil(allBlocks.length / 2);
  const leftBlocks = allBlocks.length > 1 ? allBlocks.slice(0, midIdx) : allBlocks;
  const rightBlocks = allBlocks.length > 1 ? allBlocks.slice(midIdx) : [];

  const textTopY = TM + 15;
  const textColWidth = leftColW - TM * 2;
  const textMaxH = H - textTopY - 10;

  // Left column text
  renderTextContent(pdf, leftBlocks, TM, textTopY, textColWidth, textMaxH, 9.5);

  // Right column text
  if (rightBlocks.length > 0) {
    const rightTextX = rightColX + TM;
    const rightTextW = rightColW - TM * 2;
    renderTextContent(pdf, rightBlocks, rightTextX, textTopY, rightTextW, textMaxH, 9.5);
  }
}

// ════════════════════════════════════════════════════════
//  Shared helpers
// ════════════════════════════════════════════════════════

/** Add an image to a specific area, or show placeholder */
function addImageToArea(
  pdf: any, spread: Spread,
  x: number, y: number, w: number, h: number
) {
  if (spread.generatedImage) {
    try {
      pdf.addImage(
        `data:image/png;base64,${spread.generatedImage}`, 'PNG',
        x, y, w, h
      );
    } catch (err) {
      console.error(`Bild for sida ${spread.pages}:`, err);
    }
  } else {
    pdf.setFontSize(11);
    pdf.setTextColor(180, 180, 180);
    pdf.text('[Ingen bild]', x + w / 2, y + h / 2, { align: 'center' });
  }
}

/** Render text blocks in a given area with word wrapping */
function renderTextContent(
  pdf: any,
  blocks: { text: string }[],
  x: number, startY: number,
  width: number, maxHeight: number,
  baseFontSize: number = 10
) {
  if (blocks.length === 0) return;

  pdf.setFontSize(baseFontSize);
  pdf.setTextColor(30, 30, 30);
  const lineH = baseFontSize * 0.5;

  let y = startY;
  const bottomLimit = startY + maxHeight;

  for (const block of blocks) {
    const lines = pdf.splitTextToSize(block.text, width);
    const totalH = lines.length * lineH;

    // Auto-shrink if text overflows
    if (y + totalH > bottomLimit && lines.length > 8) {
      const smaller = baseFontSize * 0.85;
      pdf.setFontSize(smaller);
      const smallLines = pdf.splitTextToSize(block.text, width);
      const smallH = smaller * 0.5;
      for (let j = 0; j < smallLines.length; j++) {
        if (y > bottomLimit) break;
        pdf.text(smallLines[j], x, y);
        y += smallH;
      }
      pdf.setFontSize(baseFontSize);
    } else {
      for (let j = 0; j < lines.length; j++) {
        if (y > bottomLimit) break;
        pdf.text(lines[j], x, y);
        y += lineH;
      }
    }

    y += 3; // spacing between blocks
  }
}

/** Render chapter heading on a specific page, returns updated startY */
function renderChapterOnPage(
  pdf: any, spread: Spread,
  centerX: number, startY: number,
  lineStart: number, lineEnd: number,
  lastChapter: string
): number {
  if (!spread.chapter || spread.chapter === lastChapter) return startY;

  pdf.setFontSize(11);
  pdf.setTextColor(60, 60, 60);
  pdf.text(spread.chapter, centerX, startY, { align: 'center' });

  // Decorative lines
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.2);
  const tw = pdf.getTextWidth(spread.chapter);
  const lineY = startY - 1.5;
  pdf.line(lineStart + 5, lineY, centerX - tw / 2 - 4, lineY);
  pdf.line(centerX + tw / 2 + 4, lineY, lineEnd - 5, lineY);

  return startY + 10;
}

/** Add page numbers at bottom corners */
function addPageNumbers(
  pdf: any, spread: Spread,
  W: number, H: number, M: number
) {
  const m = spread.pages.match(/(\d+)(?:-(\d+))?/);
  if (!m) return;

  const left = m[1];
  const right = m[2] || '';

  pdf.setFontSize(9);
  pdf.setTextColor(100, 100, 100);
  pdf.text(left, M + 8, H - 5, { align: 'center' });
  if (right) {
    pdf.text(right, W - M - 8, H - 5, { align: 'center' });
  }

  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.3);
  pdf.line(M + 3, H - 3.5, M + 13, H - 3.5);
  if (right) {
    pdf.line(W - M - 13, H - 3.5, W - M - 3, H - 3.5);
  }
}

/** Add chapter heading at top center of spread */
function addChapterHeading(
  pdf: any, spread: Spread,
  HW: number, lastChapter: string
) {
  if (!spread.chapter || spread.chapter === lastChapter) return;

  pdf.setFillColor(255, 255, 255);
  pdf.rect(HW - 55, 1.5, 110, 9, 'F');
  pdf.setDrawColor(160, 160, 160);
  pdf.setLineWidth(0.2);
  pdf.line(HW - 45, 4, HW - 5, 4);
  pdf.line(HW + 5, 4, HW + 45, 4);
  pdf.setFontSize(7);
  pdf.setTextColor(80, 80, 80);
  pdf.text(spread.chapter, HW, 8, { align: 'center' });
}
