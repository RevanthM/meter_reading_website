import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { ReportSummaryRow } from './pipelineAnalyticsStory';
import { prepareHtml2CanvasClone } from './html2canvasExportFix';

export type DashboardReportPdfOptions = {
  title: string;
  subtitle?: string;
  captureRoot: HTMLElement;
  filename?: string;
  summaryRows?: ReportSummaryRow[];
};

/** Wait for React paint + Recharts layout after enabling export panels. */
export async function waitForReportDomReady(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 450);
  });
}

function fmtCell(v: number | null | undefined, pct = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return pct ? `${v.toFixed(1)}%` : String(v);
}

/** Avoid capturing nested [data-report-capture] blocks twice (parent + child). */
export function getOutermostReportCaptureSections(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll('[data-report-capture]')) as HTMLElement[];
  return all.filter((el) => {
    let parent = el.parentElement;
    while (parent && parent !== root) {
      if (parent.hasAttribute('data-report-capture')) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

function isCanvasMostlyBlank(canvas: HTMLCanvasElement): boolean {
  if (canvas.width < 2 || canvas.height < 2) return true;
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;

  const sampleAt = (x: number, y: number): boolean => {
    const px = Math.min(canvas.width - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(canvas.height - 1, Math.max(0, Math.floor(y)));
    const { data } = ctx.getImageData(px, py, 1, 1);
    const r = data[0]!;
    const g = data[1]!;
    const b = data[2]!;
    const a = data[3]!;
    return a > 8 && (r < 250 || g < 250 || b < 250);
  };

  const w = canvas.width;
  const h = canvas.height;
  const points: [number, number][] = [
    [w * 0.5, h * 0.25],
    [w * 0.5, h * 0.5],
    [w * 0.5, h * 0.75],
    [w * 0.2, h * 0.5],
    [w * 0.8, h * 0.5],
  ];

  return !points.some(([x, y]) => sampleAt(x, y));
}

function drawNativeSummaryTable(
  pdf: jsPDF,
  rows: ReportSummaryRow[],
  startY: number,
  margin: number,
  contentW: number,
): number {
  if (!rows.length) return startY;

  const pageH = pdf.internal.pageSize.getHeight();
  let y = startY;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('Executive summary', margin, y);
  y += 7;

  const cols = [
    { label: 'Pipeline', w: 0.22 },
    { label: 'Iter', w: 0.07 },
    { label: 'Acc', w: 0.1 },
    { label: 'Conf', w: 0.1 },
    { label: 'Exact', w: 0.1 },
    { label: 'Train', w: 0.1 },
    { label: 'UT', w: 0.08 },
  ];

  const colWidths = cols.map((c) => c.w * contentW);
  const rowH = 6;

  const drawHeader = () => {
    pdf.setFillColor(241, 245, 249);
    pdf.rect(margin, y - 4, contentW, rowH, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    let x = margin + 2;
    for (let i = 0; i < cols.length; i += 1) {
      pdf.text(cols[i]!.label, x, y);
      x += colWidths[i]!;
    }
    y += rowH;
  };

  drawHeader();

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);

  for (let ri = 0; ri < rows.length; ri += 1) {
    if (y > pageH - margin - 10) {
      pdf.addPage();
      y = margin + 6;
      drawHeader();
    }

    const r = rows[ri]!;
    const pipelineShort =
      r.pipeline.length > 28 ? `${r.pipeline.slice(0, 26)}…` : r.pipeline;
    const cells = [
      pipelineShort,
      `#${r.iterationNumber}`,
      fmtCell(r.readAccuracyPct, true),
      fmtCell(r.readConfidencePct, true),
      fmtCell(r.exactReadingPct, true),
      fmtCell(r.trainingImages),
      fmtCell(r.unitTestImages),
    ];

    if (ri % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y - 4, contentW, rowH, 'F');
    }

    let x = margin + 2;
    for (let i = 0; i < cells.length; i += 1) {
      pdf.text(String(cells[i]), x, y);
      x += colWidths[i]!;
    }
    y += rowH;
  }

  return y + 8;
}

/** Add a tall canvas across multiple PDF pages without blank overflow pages. */
function addCanvasSlicesToPdf(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  margin: number,
  contentW: number,
  startY: number,
): number {
  const pageH = pdf.internal.pageSize.getHeight();
  let y = startY;
  const fullImgH = (canvas.height * contentW) / canvas.width;
  const maxSliceMm = pageH - margin * 2;

  if (fullImgH <= maxSliceMm && y + fullImgH <= pageH - margin) {
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, y, contentW, fullImgH);
    return y + fullImgH + 6;
  }

  const sliceHeightPx = Math.max(1, Math.floor((maxSliceMm / fullImgH) * canvas.height));
  let srcY = 0;

  while (srcY < canvas.height) {
    const hPx = Math.min(sliceHeightPx, canvas.height - srcY);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = hPx;
    const ctx = sliceCanvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(canvas, 0, srcY, canvas.width, hPx, 0, 0, canvas.width, hPx);

    const sliceMm = (hPx * contentW) / canvas.width;
    if (y + sliceMm > pageH - margin) {
      pdf.addPage();
      y = margin;
    }
    pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, y, contentW, sliceMm);
    y += sliceMm + 4;
    srcY += hPx;
  }

  return y + 2;
}

export async function generateDashboardReportPdf(options: DashboardReportPdfOptions): Promise<void> {
  const sections = getOutermostReportCaptureSections(options.captureRoot);
  if (!sections.length && !options.summaryRows?.length) {
    throw new Error('No report sections found. Select iterations with metrics first.');
  }

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(options.title, margin, margin + 5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.text('AMR Model Training · Unit-test eval metrics', margin, margin + 12);
  pdf.setTextColor(0, 0, 0);

  let headerY = margin + 18;
  if (options.subtitle) {
    pdf.setFontSize(9);
    const lines = pdf.splitTextToSize(options.subtitle, contentW);
    pdf.text(lines, margin, headerY);
    headerY += lines.length * 4.5 + 3;
  }
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text(`Generated ${new Date().toLocaleString()}`, margin, headerY);
  pdf.setTextColor(0, 0, 0);

  let y = drawNativeSummaryTable(pdf, options.summaryRows ?? [], headerY + 8, margin, contentW);

  if (y > pageH - margin - 30) {
    pdf.addPage();
    y = margin;
  }

  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, y, margin + contentW, y);
  y += 8;

  let captured = 0;

  for (let i = 0; i < sections.length; i += 1) {
    const el = sections[i]!;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: Math.max(el.scrollWidth, Math.ceil(rect.width)),
      windowHeight: Math.max(el.scrollHeight, Math.ceil(rect.height)),
      onclone: (clonedDoc, clonedEl) => {
        prepareHtml2CanvasClone(clonedDoc, el, clonedEl);
      },
    });

    if (isCanvasMostlyBlank(canvas)) continue;

    y = addCanvasSlicesToPdf(pdf, canvas, margin, contentW, y);
    captured += 1;

    if (i < sections.length - 1 && y > pageH - margin - 40) {
      pdf.addPage();
      y = margin;
    }
  }

  if (captured === 0 && sections.length > 0) {
    throw new Error(
      'Report visuals could not be captured. Try again after charts finish loading, or refresh the page.',
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (options.filename ?? options.title).replace(/[^\w.-]+/g, '-').replace(/-+/g, '-');
  pdf.save(`${safeName}-${stamp}.pdf`);
}
