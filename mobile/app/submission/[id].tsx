import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  api,
  ApiError,
  type AnalysisOut,
  type Assignment,
  type Comment,
  type DiffOut,
  type FileContent,
  type FileTreeNode,
  type Score,
  type SubmissionDetail,
  type SubmissionListItem,
} from "../../src/api";
import {
  BackHeader,
  Btn,
  Card,
  Chip,
  form,
  Icon,
  IconButton,
  Loader,
  Muted,
  Screen,
  SectionLabel,
  Segmented,
  Tag,
} from "../../src/ui";
import { useAuth } from "../../src/auth";
import { code, colors, fonts } from "../../src/theme";

type SubTab = "review" | "files" | "ai";
import { CLEAN_WEIGHT, COVERAGE_WEIGHT, gradeHint, PLAGIARISM_WARN } from "../../src/grade";
import { API_BASE_URL } from "../../src/config";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

function fmt(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type FileRow = { path: string; size: number; binary: boolean };

function flattenFiles(node: FileTreeNode | null): FileRow[] {
  const out: FileRow[] = [];
  const walk = (n: FileTreeNode) => {
    if (n.type === "file" && n.path) {
      out.push({ path: n.path, size: n.size_bytes ?? 0, binary: !!n.is_binary });
    }
    if (n.children) Object.values(n.children).forEach(walk);
  };
  if (node) walk(node);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export default function SubmissionScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isStudent = user?.role === "student";
  const isReviewer = user?.role === "academician" || user?.role === "admin";

  const [sub, setSub] = useState<SubmissionDetail | null>(null);
  const [versions, setVersions] = useState<SubmissionListItem[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [score, setScore] = useState<Score | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<SubTab>("review");
  // Hoca: odev ayarina gore ogrencinin gormedigi AI sonuc turleri
  const [hidden, setHidden] = useState<string[] | null>(null);

  const [openFile, setOpenFile] = useState<FileContent | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [diff, setDiff] = useState<DiffOut | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  // Satır bazlı yorum (dosya modalında)
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [lineBody, setLineBody] = useState("");
  const [lineBusy, setLineBusy] = useState(false);

  // Akademisyen inceleme durumu
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState("");
  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreMsg, setScoreMsg] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentMsg, setCommentMsg] = useState<string | null>(null);

  function reloadComments() {
    api<Comment[]>(`/submissions/${id}/comments`).then(setComments).catch(() => {});
  }

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [s, c, sc] = await Promise.all([
          api<SubmissionDetail>(`/submissions/${id}`),
          api<Comment[]>(`/submissions/${id}/comments`),
          api<Score | null>(`/submissions/${id}/score`),
        ]);
        setSub(s);
        setComments(c);
        setScore(sc);
        if (user?.role === "academician" || user?.role === "admin") {
          api<Assignment>(`/assignments/${s.assignment_id}`)
            .then((a) =>
              setHidden([
                "plagiarism",
                ...(a.show_requirement_to_student === false ? ["requirement_check"] : []),
                ...(a.show_clean_code_to_student === false ? ["clean_code"] : []),
              ])
            )
            .catch(() => {});
        }
        // Aynı öğrencinin bu ödevdeki tüm sürümleri (sürüm değiştirici)
        api<SubmissionListItem[]>(
          `/assignments/${s.assignment_id}/submissions?student_id=${s.student_id}`
        )
          .then((v) => setVersions([...v].sort((a, b) => a.version_number - b.version_number)))
          .catch(() => {});
      } catch (e) {
        setErr("Gönderim yüklenemedi.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Analizler: akademisyen tümünü, öğrenci kendi gönderimindekini (intihal
  // hariç, backend filtreler) görebilir.
  useEffect(() => {
    if (!id) return;
    api<AnalysisOut[]>(`/submissions/${id}/analyses`).then(setAnalyses).catch(() => {});
  }, [id]);

  async function runAnalysis(type: string) {
    setReviewErr(null);
    setAnalyzing(type);
    try {
      const rec = await api<AnalysisOut>(`/submissions/${id}/analyze`, {
        method: "POST",
        body: { analysis_type: type },
      });
      setAnalyses((prev) => [rec, ...prev]);
      reloadComments(); // yorum ekleyen analizler için tazele
    } catch (e) {
      setReviewErr(e instanceof ApiError ? e.message : "Analiz başarısız.");
    } finally {
      setAnalyzing(null);
    }
  }

  // ZIP indirme: 5 dk geçerli, yalnızca bu teslime özel imzalı link tarayıcıda açılır.
  const [downloading, setDownloading] = useState(false);
  async function downloadZip() {
    setDownloading(true);
    try {
      const { url } = await api<{ url: string }>(`/submissions/${id}/download-link`, { method: "POST" });
      await Linking.openURL(`${API_BASE_URL}${url}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "İndirme başlatılamadı.");
    } finally {
      setDownloading(false);
    }
  }

  async function addComment() {
    const body = commentBody.trim();
    if (!body || commentSaving) return;
    setCommentMsg(null);
    setCommentSaving(true);
    try {
      await api(`/submissions/${id}/comments`, { method: "POST", body: { body } });
      setCommentBody("");
      setCommentMsg("Yorum eklendi.");
      reloadComments();
    } catch (e) {
      setCommentMsg(e instanceof ApiError ? e.message : "Eklenemedi.");
    } finally {
      setCommentSaving(false);
    }
  }

  async function saveScore() {
    setScoreMsg(null);
    const n = Number(scoreInput.replace(",", "."));
    if (Number.isNaN(n) || n < 0 || n > 100) {
      setScoreMsg("0 ile 100 arası bir değer gir.");
      return;
    }
    setScoreSaving(true);
    try {
      const s = await api<Score>(`/submissions/${id}/score`, {
        method: "POST",
        body: { score: n },
      });
      setScore(s);
      setScoreInput("");
      setScoreMsg("Not kaydedildi.");
    } catch (e) {
      setScoreMsg(e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setScoreSaving(false);
    }
  }

  const files = useMemo(() => flattenFiles(sub?.file_tree_json ?? null), [sub]);
  const hint = useMemo(() => gradeHint(analyses), [analyses]);
  const commentedPaths = useMemo(
    () => new Set(comments.map((c) => c.file_path).filter(Boolean) as string[]),
    [comments]
  );

  const fileLineComments = useMemo(
    () => comments.filter((c) => c.file_path === openFile?.path && c.line_number != null),
    [comments, openFile]
  );
  const commentedLineSet = useMemo(
    () => new Set(fileLineComments.map((c) => c.line_number as number)),
    [fileLineComments]
  );

  async function addLineComment() {
    const body = lineBody.trim();
    if (!body || activeLine == null || !openFile || lineBusy) return;
    setLineBusy(true);
    try {
      await api(`/submissions/${id}/comments`, {
        method: "POST",
        body: { body, file_path: openFile.path, line_number: activeLine },
      });
      setLineBody("");
      reloadComments();
    } catch {
      /* yut */
    } finally {
      setLineBusy(false);
    }
  }

  async function openFileAt(path: string) {
    setFileBusy(true);
    setDiffMode(false);
    setDiff(null);
    setActiveLine(null);
    try {
      const fc = await api<FileContent>(
        `/submissions/${id}/file?path=${encodeURIComponent(path)}`
      );
      setOpenFile(fc);
    } catch {
      setErr("Dosya açılamadı.");
    } finally {
      setFileBusy(false);
    }
  }

  async function toggleDiff() {
    if (diffMode) {
      setDiffMode(false);
      return;
    }
    if (!openFile) return;
    setDiffMode(true);
    if (!diff) {
      setDiffBusy(true);
      try {
        const d = await api<DiffOut>(
          `/submissions/${id}/diff?path=${encodeURIComponent(openFile.path)}`
        );
        setDiff(d);
      } catch {
        /* diff alınamadı; boş kalır */
      } finally {
        setDiffBusy(false);
      }
    }
  }

  const similar = useMemo(() => {
    const pl = analyses.find((a) => a.analysis_type === "plagiarism");
    const top = (pl?.summary_json as { top_similarity?: number } | null)?.top_similarity;
    if (typeof top !== "number" || top < PLAGIARISM_WARN) return null;
    const matches = ((pl?.detail_json as { matches?: { student_name?: string }[] } | null)?.matches) ?? [];
    return { pct: top, name: matches[0]?.student_name ?? null };
  }, [analyses]);

  if (loading) return <Loader />;

  const title = isReviewer && sub?.student_name ? sub.student_name : "Gönderim";

  return (
    <Screen>
      <BackHeader
        title={title}
        subtitle={sub?.assignment_title ?? undefined}
        right={
          <IconButton
            name={downloading ? "loader" : "download"}
            label="Projeyi indir (.zip)"
            onPress={() => !downloading && downloadZip()}
          />
        }
      />

      {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}

      {/* Sürüm seçici */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Muted style={{ fontSize: 12.5, marginRight: 2 }}>Sürüm</Muted>
        {(versions.length ? versions : sub ? [sub] : []).map((v) => {
          const current = v.id === id;
          return (
            <Pressable
              key={v.id}
              disabled={current}
              onPress={() => router.replace({ pathname: "/submission/[id]", params: { id: v.id } })}
              style={{
                minHeight: 32,
                justifyContent: "center",
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: current ? colors.gold : colors.line2,
                backgroundColor: current ? colors.goldBg : "transparent",
              }}
            >
              <Text style={{ color: current ? colors.gold : colors.ink, fontSize: 12.5, fontWeight: "700" }}>
                v{v.version_number}
              </Text>
            </Pressable>
          );
        })}
        {sub && <Muted style={{ fontSize: 12.5, marginLeft: "auto" }}>{fmt(sub.submitted_at)}</Muted>}
      </View>

      {isReviewer && similar && (
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginTop: 14,
            padding: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.danger,
            backgroundColor: colors.dangerBg,
          }}
        >
          <Icon name="alert-triangle" size={18} color={colors.danger} />
          <Text style={{ flex: 1, color: colors.ink, fontSize: 13.5, lineHeight: 19 }}>
            <Text style={{ color: colors.danger, fontWeight: "700" }}>
              {similar.name ? `${similar.name} ile ` : ""}%{similar.pct} benzerlik.
            </Text>{" "}
            Notlamadan önce iki teslimi karşılaştır.
          </Text>
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <Segmented<SubTab>
          value={tab}
          onChange={setTab}
          options={[
            { key: "review", label: isReviewer ? "İnceleme" : "Geri bildirim" },
            { key: "files", label: `Dosyalar ${files.length}` },
            { key: "ai", label: isReviewer ? "AI analizi" : "AI" },
          ]}
        />
      </View>

      {tab === "review" && (
        <>
          {/* Not */}
          <Card>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <Text style={{ color: colors.muted, fontSize: 11.5, fontFamily: fonts.ui, letterSpacing: 1 }}>NOT</Text>
              {score ? (
                <Text style={{ color: colors.ink, fontSize: 28, fontFamily: fonts.display }}>
                  {score.score}
                  <Text style={{ color: colors.muted, fontSize: 14 }}> /100</Text>
                </Text>
              ) : (
                <Muted>Henüz notlanmadı</Muted>
              )}
            </View>
            {score?.grader_name && <Muted style={{ fontSize: 12, marginTop: 2 }}>{score.grader_name}</Muted>}

            {isReviewer && (
              <>
                {hint.suggested != null && (
                  <View style={{ backgroundColor: colors.bg3, borderRadius: 12, padding: 11, marginTop: 12 }}>
                    <Text style={{ color: colors.ink, fontSize: 13, lineHeight: 19 }}>
                      <Text style={{ color: colors.muted }}>AI referansı: </Text>
                      {hint.coverage != null ? `kapsam %${hint.coverage}` : ""}
                      {hint.coverage != null && hint.cleanCode != null ? " · " : ""}
                      {hint.cleanCode != null ? `Clean Code ${hint.cleanCode}/100` : ""}
                      {" → öneri "}
                      <Text style={{ color: colors.gold, fontWeight: "800" }}>{hint.suggested}</Text>
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 3 }}>
                      {hint.coverage != null && hint.cleanCode != null
                        ? `%${Math.round(COVERAGE_WEIGHT * 100)} kapsam + %${Math.round(CLEAN_WEIGHT * 100)} kod kalitesi. `
                        : "Tek analize dayalı. "}
                      Yalnızca referanstır; notu sen belirlersin.
                    </Text>
                    <Pressable onPress={() => setScoreInput(String(hint.suggested))} style={{ marginTop: 8 }} hitSlop={6}>
                      <Text style={{ color: colors.blueSoft, fontSize: 13, fontWeight: "700" }}>Öneriyi kullan →</Text>
                    </Pressable>
                  </View>
                )}
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 12 }}>
                  <TextInput
                    value={scoreInput}
                    onChangeText={setScoreInput}
                    keyboardType="number-pad"
                    placeholder={score ? String(score.score) : "0-100"}
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="Not (0-100)"
                    style={[form.input, { flex: 1 }]}
                  />
                  <Btn title={scoreSaving ? "…" : score ? "Güncelle" : "Kaydet"} variant="gold" onPress={saveScore} disabled={scoreSaving} />
                </View>
                {scoreMsg && (
                  <Text style={{ color: scoreMsg.includes("kaydedildi") ? colors.ok : colors.danger, fontSize: 13, marginTop: 8 }}>
                    {scoreMsg}
                  </Text>
                )}
              </>
            )}
          </Card>

          {isStudent && (
            <View style={{ marginBottom: 14 }}>
              <Btn
                title="AI Mentor'a sor"
                icon="message-circle"
                variant="primary"
                onPress={() => router.push({ pathname: "/mentor/[id]", params: { id } })}
              />
            </View>
          )}

          <SectionLabel style={{ marginTop: 8 }}>{`Yorumlar (${comments.length})`}</SectionLabel>
          {isReviewer && (
            <Card>
              <TextInput
                value={commentBody}
                onChangeText={setCommentBody}
                placeholder="Öğrenciye geri bildirim yaz…"
                placeholderTextColor={colors.faint}
                multiline
                style={[form.input, { minHeight: 70, textAlignVertical: "top" }]}
              />
              <View style={{ marginTop: 10 }}>
                <Btn
                  title={commentSaving ? "Gönderiliyor…" : "Yorumu gönder"}
                  variant="primary"
                  onPress={addComment}
                  disabled={commentSaving || !commentBody.trim()}
                />
              </View>
              {commentMsg && (
                <Text style={{ color: commentMsg.includes("eklendi") ? colors.ok : colors.danger, fontSize: 13, marginTop: 8 }}>
                  {commentMsg}
                </Text>
              )}
            </Card>
          )}
          {comments.length === 0 ? (
            <Card>
              <Muted>Henüz yorum yok.{isStudent ? " Akademisyen incelediğinde burada görünecek." : ""}</Muted>
            </Card>
          ) : (
            comments.map((c) => (
              <Card key={c.id}>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <Chip text={c.author_type === "ai" ? "AI" : c.author_name ?? "Akademisyen"} kind={c.author_type === "ai" ? "blue" : "gold"} />
                  {c.file_path && (
                    <Muted style={{ fontSize: 12, fontFamily: MONO }}>
                      {c.file_path}
                      {c.line_number != null ? `:${c.line_number}` : ""}
                    </Muted>
                  )}
                </View>
                <Text style={{ color: colors.ink, fontSize: 14.5, marginTop: 8, lineHeight: 20 }}>{c.body}</Text>
                <Muted style={{ fontSize: 11, marginTop: 8 }}>{fmt(c.created_at)}</Muted>
              </Card>
            ))
          )}
        </>
      )}

      {tab === "ai" && (
        <>
          {isReviewer && (
            <Card>
              <Muted style={{ fontSize: 13 }}>Analiz yalnızca sen istediğinde çalışır. Bir tür seç:</Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {ANALYSIS_TYPES.map((t) => (
                  <Pressable
                    key={t.key}
                    onPress={() => runAnalysis(t.key)}
                    disabled={analyzing !== null}
                    style={{
                      minHeight: 36,
                      justifyContent: "center",
                      paddingHorizontal: 13,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.line2,
                      opacity: analyzing !== null && analyzing !== t.key ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ color: colors.ink, fontSize: 13, fontFamily: fonts.ui }}>
                      {analyzing === t.key ? "Çalışıyor…" : t.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {reviewErr && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{reviewErr}</Text>}
            </Card>
          )}
          {analyses.length === 0 ? (
            <Card>
              <Muted>
                {isReviewer ? "Henüz analiz yok." : "Akademisyen AI değerlendirmesi ürettiğinde burada görünecek."}
              </Muted>
            </Card>
          ) : (
            groupByType(analyses).map((runs) => (
              <AnalysisGroup
                key={runs[0].id}
                runs={runs}
                studentSees={hidden ? !hidden.includes(runs[0].analysis_type) : undefined}
              />
            ))
          )}
        </>
      )}

      {tab === "files" && (
        <>
          <Card style={{ paddingVertical: 4 }}>
            {files.length === 0 && <Muted style={{ padding: 8 }}>Dosya yok.</Muted>}
            {files.map((f, i) => (
              <Pressable
                key={f.path}
                onPress={() => !f.binary && openFileAt(f.path)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  minHeight: 44,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.line,
                  opacity: f.binary ? 0.5 : 1,
                }}
              >
                <Icon name="file" size={14} color={colors.muted} />
                <Text style={{ color: colors.ink, fontSize: 13.5, fontFamily: MONO, flex: 1 }} numberOfLines={1}>
                  {f.path}
                </Text>
                {commentedPaths.has(f.path) && <Icon name="message-square" size={13} color={colors.gold} />}
                <Text style={{ color: colors.faint, fontSize: 11 }}>{f.binary ? "ikili" : `${f.size} B`}</Text>
              </Pressable>
            ))}
          </Card>
          <Muted style={{ fontSize: 12 }}>
            Bir dosyayı açıp satıra dokunarak o satırdaki yorumları görebilirsin
            {isReviewer ? " ya da yeni yorum ekleyebilirsin." : "."}
          </Muted>
        </>
      )}

      {fileBusy && (
        <View style={{ marginTop: 10 }}>
          <Muted>Dosya açılıyor…</Muted>
        </View>
      )}

      {/* Dosya içeriği modalı */}
      <Modal
        visible={openFile !== null}
        animationType="slide"
        onRequestClose={() => setOpenFile(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: colors.bg }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 14,
              paddingTop: 52,
              borderBottomWidth: 1,
              borderBottomColor: colors.line,
            }}
          >
            <Text style={{ color: colors.ink, fontSize: 13, fontFamily: MONO, flex: 1 }} numberOfLines={1}>
              {openFile?.path}
            </Text>
            {openFile && !openFile.is_binary && openFile.content !== null && (
              <Pressable onPress={toggleDiff} style={{ paddingHorizontal: 6 }}>
                <Text style={{ color: diffMode ? colors.gold : colors.muted, fontSize: 13, fontWeight: "600" }}>
                  Fark
                </Text>
              </Pressable>
            )}
            <Pressable onPress={() => setOpenFile(null)} style={{ paddingHorizontal: 6 }}>
              <Text style={{ color: colors.blueSoft, fontSize: 15 }}>Kapat</Text>
            </Pressable>
          </View>

          {diffMode && (
            <Text style={{ color: colors.faint, fontSize: 11.5, paddingHorizontal: 14, paddingTop: 8 }}>
              {diffBusy
                ? "Fark hesaplanıyor…"
                : diff
                  ? diff.from_version == null
                    ? "İlk sürüm — karşılaştırılacak önceki sürüm yok."
                    : `v${diff.from_version} → v${diff.to_version}${diff.changed ? "" : " · değişiklik yok"}`
                  : "Fark alınamadı."}
            </Text>
          )}

          <ScrollView style={{ flex: 1, backgroundColor: code.bg }} contentContainerStyle={{ padding: 14 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              {diffMode ? (
                <View>
                  {(diff?.lines ?? []).map((ln, i) => (
                    <Text
                      key={i}
                      style={{
                        fontFamily: MONO,
                        fontSize: 12,
                        lineHeight: 18,
                        color:
                          ln.type === "add" ? code.add : ln.type === "del" ? code.del : code.ink,
                        backgroundColor:
                          ln.type === "add"
                            ? "rgba(78,201,176,0.12)"
                            : ln.type === "del"
                              ? "rgba(255,107,107,0.12)"
                              : "transparent",
                      }}
                    >
                      {(ln.type === "add" ? "+ " : ln.type === "del" ? "- " : "  ") + ln.text}
                    </Text>
                  ))}
                </View>
              ) : openFile?.is_binary ? (
                <Text style={{ color: code.ink, fontSize: 12.5, fontFamily: MONO }}>
                  İkili (binary) dosya — önizleme yok.
                </Text>
              ) : openFile?.content === null ? (
                <Text style={{ color: code.ink, fontSize: 12.5, fontFamily: MONO }}>
                  Dosya çok büyük, içerik saklanmadı.
                </Text>
              ) : (
                <View>
                  {(openFile?.content ?? "").split("\n").map((line, i) => {
                    const no = i + 1;
                    const has = commentedLineSet.has(no);
                    const active = activeLine === no;
                    return (
                      <Pressable key={i} onPress={() => setActiveLine(active ? null : no)}>
                        <Text
                          style={{
                            fontFamily: MONO,
                            fontSize: 12.5,
                            lineHeight: 18,
                            color: code.ink,
                            backgroundColor: active
                              ? "rgba(216,178,115,0.22)"
                              : has
                                ? "rgba(216,178,115,0.12)"
                                : "transparent",
                          }}
                        >
                          {String(no).padStart(3, " ")}  {line || " "}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </ScrollView>

          {/* Satır yorum ipucu / thread + composer */}
          {!diffMode && openFile && !openFile.is_binary && openFile.content !== null && activeLine == null && (
            <Text style={{ color: colors.faint, fontSize: 11.5, textAlign: "center", paddingVertical: 6 }}>
              {isReviewer ? "Yorum için bir satıra dokun" : "Yorumlu satır ● işaretlidir — görmek için dokun"}
            </Text>
          )}
          {activeLine != null && (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.line,
                backgroundColor: colors.bg2,
                padding: 12,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: colors.gold, fontSize: 13, fontWeight: "700" }}>Satır {activeLine}</Text>
                <Pressable onPress={() => setActiveLine(null)}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Kapat</Text>
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 120, marginTop: 8 }} keyboardShouldPersistTaps="handled">
                {fileLineComments.filter((c) => c.line_number === activeLine).length === 0 ? (
                  <Muted style={{ fontSize: 13 }}>Bu satırda henüz yorum yok.</Muted>
                ) : (
                  fileLineComments
                    .filter((c) => c.line_number === activeLine)
                    .map((c) => (
                      <View key={c.id} style={{ marginBottom: 8 }}>
                        <Muted style={{ fontSize: 11 }}>
                          {c.author_type === "ai" ? "AI" : c.author_name ?? "Akademisyen"}
                        </Muted>
                        <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 19 }}>{c.body}</Text>
                      </View>
                    ))
                )}
              </ScrollView>
              {isReviewer && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
                  <TextInput
                    value={lineBody}
                    onChangeText={setLineBody}
                    placeholder={`Satır ${activeLine} için yorum…`}
                    placeholderTextColor={colors.faint}
                    multiline
                    style={{
                      flex: 1,
                      maxHeight: 90,
                      color: colors.ink,
                      backgroundColor: colors.bg,
                      borderColor: colors.line2,
                      borderWidth: 1,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      fontSize: 14.5,
                    }}
                  />
                  <Pressable
                    onPress={addLineComment}
                    disabled={lineBusy || !lineBody.trim()}
                    style={{
                      backgroundColor: colors.blue,
                      opacity: lineBusy || !lineBody.trim() ? 0.5 : 1,
                      borderRadius: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>Gönder</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const ANALYSIS_TYPES: { key: string; label: string }[] = [
  { key: "clean_code", label: "Clean Code" },
  { key: "requirement_check", label: "Gereksinim" },
  { key: "plagiarism", label: "İntihal" },
];

function analysisLabel(t: string): string {
  return ANALYSIS_TYPES.find((x) => x.key === t)?.label ?? (t === "readme_draft" ? "README (eski)" : t);
}

/** Analizler en yeni önce gelir; türe göre grupla (grup sırası = en yeni çalıştırma). */
function groupByType(list: AnalysisOut[]): AnalysisOut[][] {
  const groups = new Map<string, AnalysisOut[]>();
  for (const a of list) {
    const g = groups.get(a.analysis_type);
    if (g) g.push(a);
    else groups.set(a.analysis_type, [a]);
  }
  return [...groups.values()];
}

/** Aynı türden birden çok çalıştırma: en yenisi "Güncel", eskiler kapalı bir listede. */
function AnalysisGroup({ runs, studentSees }: { runs: AnalysisOut[]; studentSees?: boolean }) {
  const [showOld, setShowOld] = useState(false);
  const [latest, ...older] = runs;
  return (
    <View>
      <AnalysisResultCard an={latest} studentSees={studentSees} badge={older.length ? "current" : undefined} />
      {older.length > 0 && (
        <View style={{ marginTop: -4, marginBottom: 12 }}>
          <Pressable onPress={() => setShowOld((o) => !o)} hitSlop={8}>
            <Text style={{ color: colors.blueSoft, fontSize: 13 }}>
              {showOld ? "Önceki çalıştırmaları gizle" : `Önceki çalıştırmalar (${older.length})`}
            </Text>
          </Pressable>
          {showOld && (
            <View style={{ marginTop: 8, opacity: 0.8 }}>
              <Muted style={{ fontSize: 12, marginBottom: 8 }}>
                Yapay zeka aynı kodu her çalıştırmada birebir aynı yorumlamayabilir. Özetlerde ve not
                önerisinde güncel sonuç kullanılır.
              </Muted>
              {older.map((a) => (
                <AnalysisResultCard key={a.id} an={a} badge="old" />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** Analiz sonucu kartı: başlık + tür bazlı açılır detay. */
function AnalysisResultCard({
  an,
  studentSees,
  badge,
}: {
  an: AnalysisOut;
  studentSees?: boolean;
  badge?: "current" | "old";
}) {
  const [open, setOpen] = useState(false);
  const s = (an.summary_json ?? {}) as Record<string, unknown>;
  const d = (an.detail_json ?? {}) as Record<string, unknown>;
  const t = an.analysis_type;
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Tag text={analysisLabel(t)} color={colors.blueSoft} />
        {badge === "current" && <Chip text="Güncel" kind="blue" />}
        {badge === "old" && <Chip text="Önceki çalıştırma" kind="muted" />}
        {studentSees !== undefined && (
          <Chip text={studentSees ? "Öğrenci görüyor" : "Öğrenciden gizli"} kind={studentSees ? "ok" : "muted"} />
        )}
        <Muted style={{ fontSize: 11 }}>{fmt(an.created_at)}</Muted>
      </View>
      <Text style={{ color: colors.ink, fontSize: 14.5, marginTop: 8, lineHeight: 20 }}>
        {String(s.headline ?? "Analiz tamamlandı.")}
      </Text>
      <MetricRow type={t} s={s} />

      <Pressable onPress={() => setOpen((o) => !o)} style={{ marginTop: 8 }}>
        <Text style={{ color: colors.blueSoft, fontSize: 13 }}>
          {open ? "Detayları gizle" : "Detayları gör"}
        </Text>
      </Pressable>

      {open && (
        <View style={{ marginTop: 8 }}>
          {t === "clean_code" && (
            <>
              {list(d.strengths).length > 0 && (
                <DetailGroup color={colors.ok} title="Güçlü yönler">
                  {list(d.strengths).map((x, i) => (
                    <Bullet key={i} text={String(x)} />
                  ))}
                </DetailGroup>
              )}
              {list(d.issues).length > 0 && (
                <DetailGroup color={colors.danger} title="Bulgular">
                  {list(d.issues).map((it, i) => (
                    <Bullet
                      key={i}
                      text={`${it.title ?? ""}${it.severity ? ` (${it.severity})` : ""} — ${it.detail ?? ""}`}
                    />
                  ))}
                </DetailGroup>
              )}
            </>
          )}

          {t === "requirement_check" && (
            <>
              {list(d.met).length > 0 && (
                <DetailGroup color={colors.ok} title={`Tam (${list(d.met).length})`}>
                  {list(d.met).map((it, i) => (
                    <ReqItem key={i} it={it} />
                  ))}
                </DetailGroup>
              )}
              {list(d.partial).length > 0 && (
                <DetailGroup color={colors.gold} title={`Kısmen (${list(d.partial).length})`}>
                  {list(d.partial).map((it, i) => (
                    <ReqItem key={i} it={it} />
                  ))}
                </DetailGroup>
              )}
              {list(d.missing).length > 0 && (
                <DetailGroup color={colors.danger} title={`Eksik (${list(d.missing).length})`}>
                  {list(d.missing).map((it, i) => (
                    <ReqItem key={i} it={it} />
                  ))}
                </DetailGroup>
              )}
            </>
          )}

          {t === "plagiarism" &&
            (list(d.matches).length > 0 ? (
              <DetailGroup color={colors.gold} title="Benzer teslimler">
                {list(d.matches).map((m, i) => (
                  <Bullet key={i} text={`${m.student_name ?? "Öğrenci"} — %${m.similarity ?? ""}`} />
                ))}
              </DetailGroup>
            ) : (
              <Muted style={{ fontSize: 13 }}>Kayda değer benzerlik yok.</Muted>
            ))}

          {t === "readme_draft" && (
            <Text
              style={{
                color: code.ink,
                fontSize: 12,
                fontFamily: MONO,
                backgroundColor: code.bg,
                padding: 10,
                borderRadius: 8,
                lineHeight: 17,
              }}
            >
              {String(d.markdown ?? "").slice(0, 1500)}
            </Text>
          )}

          {d.note ? <Muted style={{ fontSize: 11.5, marginTop: 8 }}>{String(d.note)}</Muted> : null}
        </View>
      )}
    </Card>
  );
}

/** Web'deki gibi özet ölçü: Clean Code skoru, gereksinim kapsamı, intihal kararı. */
function MetricRow({ type, s }: { type: string; s: Record<string, unknown> }) {
  const row = (children: React.ReactNode) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
      {children}
    </View>
  );
  if (type === "clean_code")
    return row(
      <>
        <Tag text={`Skor: ${s.score ?? "—"}/100`} color={colors.gold} />
        <Muted style={{ fontSize: 12 }}>{String(s.issues_count ?? 0)} bulgu</Muted>
      </>
    );
  if (type === "requirement_check")
    return row(
      <>
        <Tag text={`Kapsam: %${s.coverage ?? "—"}`} color={colors.gold} />
        <Muted style={{ fontSize: 12 }}>
          {String(s.met_count ?? 0)} tam
          {s.partial_count ? ` · ${s.partial_count} kısmen` : ""} · {String(s.missing_count ?? 0)} eksik
        </Muted>
      </>
    );
  if (type === "plagiarism") {
    // Tek eşik (backend SIMILARITY_WARN ile aynı); eski "şüpheli" kayıtlar da tutarlı görünür
    const high = typeof s.top_similarity === "number" && s.top_similarity >= PLAGIARISM_WARN;
    return row(
      <>
        <Tag
          text={high ? "Yüksek benzerlik" : Number(s.match_count ?? 0) > 0 ? "Eşik altında" : "Temiz"}
          color={high ? colors.danger : colors.ok}
        />
        {Number(s.match_count ?? 0) > 0 && (
          <Muted style={{ fontSize: 12 }}>En yüksek: %{String(s.top_similarity)}</Muted>
        )}
      </>
    );
  }
  return null;
}

function DetailGroup({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color, fontSize: 12.5, fontWeight: "700", marginBottom: 4 }}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 2 }}>• {text}</Text>
  );
}

function ReqItem({ it }: { it: Record<string, unknown> }) {
  const ev = (it.evidence || it.note || "") as string;
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={{ color: colors.ink, fontSize: 13.5, fontWeight: "600" }}>
        {String(it.requirement ?? "")}
      </Text>
      {ev ? <Text style={{ color: colors.muted, fontSize: 12.5, lineHeight: 18 }}>{ev}</Text> : null}
      {it.where ? <Text style={{ color: colors.faint, fontSize: 11 }}>{String(it.where)}</Text> : null}
    </View>
  );
}

function Section({ title }: { title: string }) {
  return (
    <Text
      style={{
        color: colors.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 1,
        textTransform: "uppercase",
        marginTop: 20,
        marginBottom: 10,
      }}
    >
      {title}
    </Text>
  );
}
