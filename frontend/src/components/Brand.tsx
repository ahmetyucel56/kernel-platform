import { BRAND_NAME } from "../config";

/** Marka logosu/wordmark. Isim tek yerden (config) gelir. */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        letterSpacing: "-0.03em",
        fontSize: size,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        aria-hidden
        style={{
          width: size * 0.62,
          height: size * 0.62,
          borderRadius: 6,
          background: "linear-gradient(145deg, var(--gold), var(--blue))",
          display: "inline-block",
        }}
      />
      {BRAND_NAME}
    </span>
  );
}
