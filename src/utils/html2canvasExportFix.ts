/** Paint longhands safe to copy when normalized (avoid `background` shorthand). */
const PAINT_PROPS = [
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'fill',
  'stroke',
  'stop-color',
] as const;

const UNSUPPORTED_COLOR_RE = /color-mix|color\(|oklch|oklab|lab\(|lch\(/i;

let normalizeCtx: CanvasRenderingContext2D | null | undefined;

function getNormalizeCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (normalizeCtx !== undefined) return normalizeCtx;
  const canvas = document.createElement('canvas');
  normalizeCtx = canvas.getContext('2d');
  return normalizeCtx;
}

/** Convert any browser-resolved color to rgb()/hex that html2canvas accepts. */
export function normalizeCssColorForHtml2Canvas(value: string): string | null {
  const v = value.trim();
  if (!v || v === 'none') return null;

  if (!UNSUPPORTED_COLOR_RE.test(v)) {
    return v;
  }

  const ctx = getNormalizeCtx();
  if (!ctx) return null;

  try {
    ctx.fillStyle = '#000000';
    ctx.fillStyle = v;
    const normalized = ctx.fillStyle;
    if (!normalized || UNSUPPORTED_COLOR_RE.test(normalized)) return null;
    return normalized;
  } catch {
    return null;
  }
}

function ruleUsesUnsupportedColor(ruleText: string): boolean {
  return UNSUPPORTED_COLOR_RE.test(ruleText);
}

function stripRulesFromGroupingRule(group: CSSGroupingRule): void {
  for (let i = group.cssRules.length - 1; i >= 0; i -= 1) {
    const rule = group.cssRules[i]!;
    if (rule instanceof CSSGroupingRule) {
      stripRulesFromGroupingRule(rule);
      if (rule.cssRules.length === 0) {
        group.deleteRule(i);
      }
    } else if (ruleUsesUnsupportedColor(rule.cssText)) {
      group.deleteRule(i);
    }
  }
}

/** Remove CSS rules that use color-mix()/color() so html2canvas does not throw. */
export function stripUnsupportedColorFunctionsFromDocument(doc: Document): void {
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (let i = sheet.cssRules.length - 1; i >= 0; i -= 1) {
        const rule = sheet.cssRules[i]!;
        if (rule instanceof CSSGroupingRule) {
          stripRulesFromGroupingRule(rule);
          if (rule.cssRules.length === 0) {
            sheet.deleteRule(i);
          }
        } else if (ruleUsesUnsupportedColor(rule.cssText)) {
          sheet.deleteRule(i);
        }
      }
    } catch {
      // External or inaccessible stylesheets — ignore.
    }
  }

  doc.querySelectorAll('[style]').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const raw = node.getAttribute('style');
    if (!raw || !UNSUPPORTED_COLOR_RE.test(raw)) return;
    let next = raw;
    next = next.replace(/color-mix\([^;]*\)/gi, 'transparent');
    next = next.replace(/color\([^;]*\)/gi, 'transparent');
    node.setAttribute('style', next);
  });

  doc.querySelectorAll('[fill], [stroke]').forEach((node) => {
    if (!(node instanceof SVGElement)) return;
    for (const attr of ['fill', 'stroke'] as const) {
      const v = node.getAttribute(attr);
      if (v && UNSUPPORTED_COLOR_RE.test(v)) {
        node.removeAttribute(attr);
      }
    }
  });
}

function inlinePaintStyles(source: Element, clone: Element): void {
  const computed = window.getComputedStyle(source);

  if (clone instanceof HTMLElement) {
    for (const prop of PAINT_PROPS) {
      const raw = computed.getPropertyValue(prop);
      const normalized = normalizeCssColorForHtml2Canvas(raw);
      if (normalized) {
        clone.style.setProperty(prop, normalized);
      }
    }

    const bgImage = computed.getPropertyValue('background-image');
    if (bgImage && bgImage !== 'none' && !UNSUPPORTED_COLOR_RE.test(bgImage)) {
      clone.style.setProperty('background-image', bgImage);
    }
  }

  if (source instanceof SVGElement && clone instanceof SVGElement) {
    const fill = normalizeCssColorForHtml2Canvas(computed.fill);
    const stroke = normalizeCssColorForHtml2Canvas(computed.stroke);
    if (fill) clone.setAttribute('fill', fill);
    if (stroke) clone.setAttribute('stroke', stroke);
  }
}

/** Copy browser-resolved paint from the live capture tree onto the html2canvas clone. */
export function inlineResolvedPaintStyles(sourceRoot: HTMLElement, clonedRoot: HTMLElement): void {
  inlinePaintStyles(sourceRoot, clonedRoot);

  const sourceNodes = sourceRoot.querySelectorAll('*');
  const cloneNodes = clonedRoot.querySelectorAll('*');
  const count = Math.min(sourceNodes.length, cloneNodes.length);

  for (let i = 0; i < count; i += 1) {
    inlinePaintStyles(sourceNodes[i]!, cloneNodes[i]!);
  }
}

export function prepareHtml2CanvasClone(
  clonedDoc: Document,
  sourceRoot: HTMLElement,
  clonedRoot: HTMLElement,
): void {
  stripUnsupportedColorFunctionsFromDocument(clonedDoc);
  inlineResolvedPaintStyles(sourceRoot, clonedRoot);

  clonedDoc.documentElement.style.backgroundColor = '#ffffff';
  if (clonedDoc.body) {
    clonedDoc.body.style.backgroundColor = '#ffffff';
  }
  clonedRoot.style.backgroundColor = '#ffffff';
}
