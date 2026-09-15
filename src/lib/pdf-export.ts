// PDF-export: ritar sättningsmotorns sidor (lib/book-layout.ts) till en
// tryckfärdig PDF i bokformat 16×21 cm med inbäddade typsnitt.
import type { jsPDF } from 'jspdf';
import { BookProject } from './types';
import {
  buildBookLayout, collectImageSources, loadImageSizes, bookFontFamilies, BookLayout, PageEl,
} from './book-layout';
import { createBookPdf, createMeasurer } from './book-fonts';

export async function layoutBook(book: BookProject): Promise<BookLayout> {
  const [measurer, sizes] = await Promise.all([
    createMeasurer(bookFontFamilies(book)),
    loadImageSizes(collectImageSources(book)),
  ]);
  return buildBookLayout(book, measurer, sizes);
}

export async function exportBookToPDF(book: BookProject, layout?: BookLayout): Promise<void> {
  const doc = await renderBookPdf(book, layout);
  const safeName = book.title
    .replace(/[^a-zA-ZåäöÅÄÖ0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 50) || 'bok';
  doc.save(`${safeName}.pdf`);
}

export async function renderBookPdf(book: BookProject, layout?: BookLayout): Promise<jsPDF> {
  const finalLayout = layout ?? await layoutBook(book);
  const families = Array.from(new Set(
    finalLayout.pages.flatMap(p => p.els.flatMap(el => (el.kind === 'text' ? [el.font.family] : [])))
  ));
  const doc = await createBookPdf(families);
  const images = new ImageCache();

  for (let i = 0; i < finalLayout.pages.length; i++) {
    const page = finalLayout.pages[i];
    if (i > 0) doc.addPage([160, 210], 'portrait');

    if (page.background) {
      doc.setFillColor(page.background);
      doc.rect(0, 0, 160, 210, 'F');
    }
    for (const el of page.els) {
      await drawElement(doc, el, images);
    }
  }
  return doc;
}

async function drawElement(doc: jsPDF, el: PageEl, images: ImageCache) {
  switch (el.kind) {
    case 'image': {
      const img = await images.get(el.src);
      if (!img) return;
      // Beskär till bildrutan (uppslagsbilder ritas bredare än sidan)
      doc.saveGraphicsState();
      if (el.clip === 'circle') {
        doc.circle(el.box.x + el.box.w / 2, el.box.y + el.box.h / 2, Math.min(el.box.w, el.box.h) / 2, null);
      } else {
        doc.rect(el.box.x, el.box.y, el.box.w, el.box.h, null);
      }
      doc.clip();
      doc.discardPath();
      doc.addImage(img.data, 'JPEG', el.draw.x, el.draw.y, el.draw.w, el.draw.h, img.alias, 'NONE');
      doc.restoreGraphicsState();
      return;
    }
    case 'rect': {
      doc.saveGraphicsState();
      if (el.opacity < 1) doc.setGState(doc.GState({ opacity: el.opacity }));
      doc.setFillColor(el.color);
      if (el.radius > 0) {
        doc.roundedRect(el.box.x, el.box.y, el.box.w, el.box.h, el.radius, el.radius, 'F');
      } else {
        doc.rect(el.box.x, el.box.y, el.box.w, el.box.h, 'F');
      }
      doc.restoreGraphicsState();
      return;
    }
    case 'text': {
      doc.setFont(el.font.family, el.font.style);
      doc.setFontSize(el.size);
      doc.setTextColor(el.color);
      const charSpace = el.tracking ? el.tracking : 0;

      if (el.align === 'center') {
        doc.text(el.text, el.x + el.width / 2, el.y, { align: 'center', charSpace });
      } else if (el.align === 'justify' && el.wordSpacing) {
        // Utjämnad rad: placera ord för ord med jämnt fördelat mellanrum
        const space = doc.getTextWidth(' ') + el.wordSpacing;
        let x = el.x;
        for (const word of el.text.split(' ')) {
          doc.text(word, x, el.y);
          x += doc.getTextWidth(word) + space;
        }
      } else {
        doc.text(el.text, el.x, el.y, { charSpace });
      }
      return;
    }
  }
}

// Bilder komprimeras till JPEG en gång och återanvänds (uppslag delas på två sidor)
class ImageCache {
  private cache = new Map<string, Promise<{ data: string; alias: string } | null>>();
  private counter = 0;

  get(src: string) {
    let entry = this.cache.get(src);
    if (!entry) {
      const alias = `img${this.counter++}`;
      entry = toJpeg(src).then(data => (data ? { data, alias } : null));
      this.cache.set(src, entry);
    }
    return entry;
  }
}

function toJpeg(src: string, maxSide = 2600): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
