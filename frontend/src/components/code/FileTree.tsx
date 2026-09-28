import { useState } from "react";
import type { FileTreeNode } from "../../api/types";
import { IconFile } from "../icons";

/** GitHub-tarzi dosya agaci. Dosyaya tiklaninca onSelect(path) cagrilir. */
export function FileTree({
  node,
  selected,
  onSelect,
}: {
  node: FileTreeNode;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const children = node.children ? Object.values(node.children) : [];
  // dizinler once, sonra dosyalar; alfabetik
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return (
    <div>
      {children.map((c) =>
        c.type === "dir" ? (
          <TreeDir key={c.name} node={c} selected={selected} onSelect={onSelect} />
        ) : (
          <TreeFile key={c.name} node={c} selected={selected} onSelect={onSelect} />
        )
      )}
    </div>
  );
}

function TreeDir({
  node,
  selected,
  onSelect,
}: {
  node: FileTreeNode;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button className="tree-row" onClick={() => setOpen((o) => !o)}>
        <span style={{ width: 14, display: "inline-block" }}>{open ? "▾" : "▸"}</span>
        <span>📁 {node.name}</span>
      </button>
      {open && (
        <div style={{ paddingLeft: 14 }}>
          <FileTree node={node} selected={selected} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

function TreeFile({
  node,
  selected,
  onSelect,
}: {
  node: FileTreeNode;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const active = selected === node.path;
  return (
    <button
      className="tree-row"
      onClick={() => node.path && onSelect(node.path)}
      style={{
        color: active ? "var(--gold)" : "var(--ink)",
        background: active ? "var(--bg-3)" : "transparent",
      }}
    >
      <span style={{ width: 14, display: "inline-block" }} />
      <IconFile size={13} />
      <span style={{ marginLeft: 3 }}>{node.name}</span>
    </button>
  );
}
