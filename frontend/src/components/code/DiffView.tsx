import type { Diff } from "../../api/types";

/** Versiyonlar arasi birlesik (unified) diff — GitHub tarzi renkli satirlar. */
export function DiffView({ diff }: { diff: Diff }) {
  return (
    <div
      style={{
        borderRadius: 10,
        overflow: "auto",
        maxHeight: "70vh",
        background: "#1e1e1e",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        border: "1px solid var(--line)",
      }}
    >
      {!diff.changed && (
        <div style={{ padding: "8px 12px", color: "#9c968c" }}>
          Bu dosya v{diff.from_version ?? "?"} → v{diff.to_version} arasında değişmedi.
        </div>
      )}
      {diff.lines.map((ln, i) => {
        const bg =
          ln.type === "add"
            ? "rgba(46,160,67,0.15)"
            : ln.type === "del"
            ? "rgba(248,81,73,0.15)"
            : "transparent";
        const sign = ln.type === "add" ? "+" : ln.type === "del" ? "-" : " ";
        const color =
          ln.type === "add" ? "#7ee787" : ln.type === "del" ? "#ff7b72" : "#d4d4d4";
        return (
          <div key={i} style={{ display: "flex", background: bg, whiteSpace: "pre" }}>
            <span style={num}>{ln.a ?? ""}</span>
            <span style={num}>{ln.b ?? ""}</span>
            <span style={{ width: 16, color, textAlign: "center" }}>{sign}</span>
            <span style={{ color, paddingRight: 12 }}>{ln.text || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

const num: React.CSSProperties = {
  width: "3em",
  minWidth: "3em",
  textAlign: "right",
  paddingRight: 8,
  color: "#6a6a6a",
  userSelect: "none",
};
