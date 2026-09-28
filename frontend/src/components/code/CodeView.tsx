import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { languageForPath } from "../../lib/lang";

/** Tek dosya icerigini VS Code Dark+ paletiyle gosterir (spec Bolum 8.3).
 *  onLineClick verilirse satirlar tiklanabilir (satir bazli yorum icin);
 *  commentedLines'daki satirlar vurgulanir. */
export function CodeView({
  path,
  content,
  onLineClick,
  commentedLines,
  activeLine,
}: {
  path: string;
  content: string;
  onLineClick?: (line: number) => void;
  commentedLines?: Set<number>;
  activeLine?: number | null;
}) {
  const annotate = !!onLineClick || (commentedLines && commentedLines.size > 0);

  return (
    <SyntaxHighlighter
      language={languageForPath(path)}
      style={vscDarkPlus}
      showLineNumbers
      wrapLines={annotate}
      lineProps={
        annotate
          ? (lineNumber: number) => {
              const commented = commentedLines?.has(lineNumber);
              const active = activeLine === lineNumber;
              return {
                onClick: onLineClick ? () => onLineClick(lineNumber) : undefined,
                style: {
                  display: "block",
                  cursor: onLineClick ? "pointer" : "default",
                  background: active
                    ? "rgba(59,91,255,0.20)"
                    : commented
                    ? "rgba(216,178,115,0.15)"
                    : undefined,
                  boxShadow: commented ? "inset 3px 0 0 var(--gold)" : undefined,
                },
              };
            }
          : undefined
      }
      customStyle={{
        margin: 0,
        borderRadius: 10,
        fontSize: 13,
        background: "#1e1e1e",
        maxHeight: "70vh",
        overflow: "auto",
      }}
      lineNumberStyle={{ color: "#6a6a6a", minWidth: "2.5em" }}
    >
      {content}
    </SyntaxHighlighter>
  );
}
