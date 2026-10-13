/**
 * The diff palette must match the Azure DevOps theme, not the operating system: the host can be light while the OS is
 * dark (or the other way round), and `prefers-color-scheme` only knows about the OS. So the mode is derived from the
 * brightness of the page background the host theme actually produced and exposed as `data-sp-theme` on <html>.
 */

/** Relative luminance (0 dark .. 1 light) of a CSS `rgb()/rgba()` string; undefined when it cannot be read or is transparent. */
export function luminanceOf(color: string): number | undefined {
  const m = color.match(/rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,/]+(\d*\.?\d+%?))?\s*\)/i);
  if (!m) return undefined;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!(alpha > 0.5)) return undefined;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = parseFloat(v) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function themeFromBackground(color: string): "dark" | "light" | undefined {
  const l = luminanceOf(color);
  return l === undefined ? undefined : l < 0.4 ? "dark" : "light";
}

/** Keeps `data-sp-theme` in sync with the host theme, including live theme switches. Returns a disposer. */
export function watchTheme(doc: Document = document): () => void {
  const apply = () => {
    const mode = themeFromBackground(getComputedStyle(doc.body).backgroundColor);
    if (mode) doc.documentElement.setAttribute("data-sp-theme", mode);
    else doc.documentElement.removeAttribute("data-sp-theme");
  };
  apply();
  if (typeof MutationObserver === "undefined") return () => undefined;
  // The SDK applies the host theme by changing variables/classes on <html>, which changes the computed background.
  const observer = new MutationObserver(apply);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
  media?.addEventListener?.("change", apply);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.("change", apply);
  };
}
