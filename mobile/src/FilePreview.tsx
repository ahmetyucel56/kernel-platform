import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { api, ApiError, type DocBlock, type DocRun, type FilePreview as Preview } from "./api";
import { API_BASE_URL } from "./config";
import { colors } from "./theme";

/** Görsel / PDF / DOCX'i indirmeden gösterir (web'deki FilePreview ile aynı uç).
 *  DOCX sunucunun güvenli bloklarından çizilir; görsel ve PDF sayfaları kısa ömürlü imzalı adreslerden gelir. */
export function FilePreview({ submissionId, path, hasText }: { submissionId: string; path: string; hasText?: boolean }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const inner = width - 28;

  useEffect(() => {
    setP(null);
    setErr(null);
    api<Preview>(`/submissions/${submissionId}/preview?path=${encodeURIComponent(path)}`)
      .then(setP)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Önizleme yüklenemedi."));
  }, [submissionId, path]);

  const fit = (w?: number | null, h?: number | null) => {
    const ww = Math.min(inner, w || inner);
    return { width: ww, height: w && h ? (ww * h) / w : ww };
  };

  let body: React.ReactNode;
  if (err) body = <Text style={{ color: colors.danger, fontSize: 13 }}>{err}</Text>;
  else if (!p) body = <ActivityIndicator color={colors.gold} style={{ marginTop: 30 }} />;
  else if (p.kind === "none") body = <Text style={{ color: colors.muted, fontSize: 13 }}>{p.reason ?? "Önizleme yok."}</Text>;
  else if (p.kind === "image" && p.url)
    body = (
      <Image
        source={{ uri: API_BASE_URL + p.url }}
        style={{ ...fit(p.width, p.height), alignSelf: "center", borderRadius: 8, backgroundColor: "#fff" }}
        resizeMode="contain"
        accessibilityLabel={path}
      />
    );
  else if (p.kind === "pdf")
    body = (
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.faint, fontSize: 12 }}>
          {p.page_count} sayfa{p.truncated ? ` · ilk ${p.pages.length} sayfa gösteriliyor` : ""}
        </Text>
        {p.pages.map((pg, i) => (
          <Image
            key={i}
            source={{ uri: API_BASE_URL + pg.url }}
            style={{ ...fit(pg.width, pg.height), borderRadius: 6, backgroundColor: "#fff" }}
            resizeMode="contain"
            accessibilityLabel={`${path} sayfa ${i + 1}`}
          />
        ))}
      </View>
    );
  else body = <DocxView blocks={p.blocks} width={inner} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
      {hasText && (
        <Text style={{ color: colors.faint, fontSize: 12, marginBottom: 10 }}>Yapay zekâ bu belgenin metnini okuyabiliyor.</Text>
      )}
      {body}
    </ScrollView>
  );
}

function Runs({ runs, size }: { runs: DocRun[]; size: number }) {
  return (
    <Text style={{ color: "#1b1913", fontSize: size, lineHeight: size * 1.5 }}>
      {runs.map((r, i) => (
        <Text key={i} style={{ fontWeight: r.b ? "700" : undefined, fontStyle: r.i ? "italic" : undefined }}>
          {r.s}
        </Text>
      ))}
    </Text>
  );
}

/** DOCX blokları: kâğıt görünümlü sayfa. Gömülü görseller data URI (sunucu yalnızca raster türlere izin verir). */
function DocxView({ blocks, width }: { blocks: DocBlock[]; width: number }) {
  if (!blocks.length) return <Text style={{ color: colors.muted }}>Belge boş görünüyor.</Text>;
  const pageInner = width - 36;
  return (
    <View style={{ backgroundColor: "#fbfaf7", borderRadius: 10, padding: 18 }}>
      {blocks.map((b, i) => {
        if (b.t === "h") {
          const size = b.level === 1 ? 20 : b.level === 2 ? 17.5 : 16;
          return (
            <View key={i} style={{ marginTop: 12, marginBottom: 4 }}>
              <Text style={{ fontWeight: "700" }}>
                <Runs runs={b.runs} size={size} />
              </Text>
            </View>
          );
        }
        if (b.t === "li") {
          return (
            <View key={i} style={{ flexDirection: "row", gap: 6, marginLeft: 10 + b.depth * 14, marginBottom: 2 }}>
              <Text style={{ color: "#1b1913", fontSize: 14.5 }}>{b.ordered ? "–" : "•"}</Text>
              <View style={{ flex: 1 }}>
                <Runs runs={b.runs} size={14.5} />
              </View>
            </View>
          );
        }
        if (b.t === "img") {
          return <DocImage key={i} src={b.src} max={pageInner} />;
        }
        if (b.t === "table") {
          return (
            <ScrollView key={i} horizontal style={{ marginVertical: 8 }}>
              <View style={{ borderWidth: 1, borderColor: "#d8d2c4" }}>
                {b.rows.map((row, r) => (
                  <View key={r} style={{ flexDirection: "row" }}>
                    {row.map((cell, c) => (
                      <Text
                        key={c}
                        style={{ width: 140, padding: 6, fontSize: 13, color: "#1b1913", borderWidth: 0.5,
                                 borderColor: "#d8d2c4", fontWeight: r === 0 ? "600" : undefined }}
                      >
                        {cell}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }
        return (
          <View key={i} style={{ marginBottom: 8 }}>
            <Runs runs={b.runs} size={14.5} />
          </View>
        );
      })}
    </View>
  );
}

function DocImage({ src, max }: { src: string; max: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    Image.getSize(src, (w, h) => setSize({ w, h }), () => setSize(null));
  }, [src]);
  const w = Math.min(max, size?.w ?? max);
  const h = size ? (w * size.h) / size.w : w * 0.6;
  return <Image source={{ uri: src }} style={{ width: w, height: h, marginVertical: 8 }} resizeMode="contain" />;
}
