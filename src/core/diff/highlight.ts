import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash, c, cpp, csharp, css, dockerfile, go, ini, java, javascript, json, kotlin, less, markdown, php, powershell, python, ruby, rust, scss, sql, swift, typescript, xml, yaml
};
for (const [name, def] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, def);

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", css: "css", scss: "scss", less: "less",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", csproj: "xml", vbproj: "xml", fsproj: "xml", props: "xml", targets: "xml", config: "xml", xaml: "xml", resx: "xml", nuspec: "xml", vsixmanifest: "xml", cshtml: "xml", razor: "xml",
  cs: "csharp", java: "java", kt: "kotlin", kts: "kotlin", go: "go", rs: "rust", py: "python", rb: "ruby", php: "php", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  sql: "sql", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", psm1: "powershell", psd1: "powershell",
  yml: "yaml", yaml: "yaml", md: "markdown", markdown: "markdown", ini: "ini", toml: "ini", cfg: "ini", conf: "ini", properties: "ini", editorconfig: "ini"
};

/** highlight.js language for a file path, or undefined when the file type is not known. */
export function languageForPath(path: string): string | undefined {
  const name = path.split("/").pop()!.toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : BY_EXTENSION[name.slice(dot + 1)];
}

/** Very large files are shown unhighlighted: highlighting runs on the page's main thread. */
export const MAX_HIGHLIGHT_CHARS = 400_000;

const TAG = /<span class="([^"]*)">|<\/span>/g;

/** Splits highlighted HTML into one self-contained HTML string per source line (spans that cross a line break are closed and reopened). */
export function splitHighlighted(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  const flush = () => {
    lines.push(current + "</span>".repeat(open.length));
    current = open.map((cls) => `<span class="${cls}">`).join("");
  };
  let last = 0;
  const text = (chunk: string) => {
    const parts = chunk.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) flush();
      current += part;
    });
  };
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    text(html.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      open.push(m[1]);
      current += m[0];
    } else {
      open.pop();
      current += m[0];
    }
  }
  text(html.slice(last));
  lines.push(current + "</span>".repeat(open.length));
  return lines;
}

/**
 * Highlights a whole file and returns the HTML of each line (index = 0-based line), or undefined when the language is
 * unknown, the file is too large, or highlighting fails. Highlighting the whole file, not line by line, keeps multi-line
 * comments and strings correct. The HTML is produced (and escaped) by highlight.js.
 */
export function highlightLines(text: string, language: string | undefined): string[] | undefined {
  if (!language || !text || text.length > MAX_HIGHLIGHT_CHARS) return undefined;
  try {
    const html = hljs.highlight(text.replace(/\r\n?/g, "\n"), { language, ignoreIllegals: true }).value;
    return splitHighlighted(html);
  } catch {
    return undefined;
  }
}
