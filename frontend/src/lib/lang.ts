/** Dosya uzantisindan syntax-highlighter dil adina esleme. */
const MAP: Record<string, string> = {
  py: "python",
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  sql: "sql",
  html: "markup",
  xml: "markup",
  css: "css",
  scss: "scss",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  dockerfile: "docker",
  txt: "text",
};

export function languageForPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  if (base.toLowerCase() === "dockerfile") return "docker";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return MAP[ext] ?? "text";
}
