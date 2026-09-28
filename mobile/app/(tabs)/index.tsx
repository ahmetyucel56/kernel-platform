import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  api,
  type Badge,
  type MeSummary,
  type MyAssignment,
  type OverviewClass,
  type Progress,
  type TeachingOverview,
} from "../../src/api";
import { useAuth } from "../../src/auth";
import {
  Accent,
  AiChip,
  Btn,
  Card,
  Chip,
  Icon,
  IconButton,
  Loader,
  Muted,
  ProgressBar,
  Screen,
  SectionLabel,
  StatTile,
} from "../../src/ui";
import { ClassAiSheet } from "../../src/ClassAiSheet";
import { colors, fonts, radius } from "../../src/theme";
import { firstName as firstNameOf, fmtDateTime, timeLeft } from "../../src/format";

function todayLabel() {
  return new Date()
    .toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })
    .toLocaleUpperCase("tr");
}

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const isAcademician = user?.role === "academician" || user?.role === "admin";

  const [unread, setUnread] = useState(0);
  const [summary, setSummary] = useState<MeSummary | null>(null);
  const [overview, setOverview] = useState<TeachingOverview | null>(null);
  const [mine, setMine] = useState<MyAssignment[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  // Ekrana her dönüşte tazele (not verip geri gelince sayılar güncel olsun)
  useFocusEffect(
    useCallback(() => {
      api<{ count: number }>("/me/notifications/unread-count")
        .then((r) => setUnread(r.count))
        .catch(() => {});
      (async () => {
        try {
          const sum = await api<MeSummary>("/me/summary");
          setSummary(sum);
          if (isAcademician) {
            setOverview(await api<TeachingOverview>("/me/teaching-overview"));
          } else {
            const [m, prog, bdg] = await Promise.all([
              api<MyAssignment[]>("/me/assignments"),
              api<Progress>("/me/progress"),
              api<Badge[]>("/me/badges"),
            ]);
            setMine(m);
            setProgress(prog);
            setBadges(bdg);
          }
        } catch {
          /* sessiz */
        } finally {
          setLoading(false);
        }
      })();
    }, [isAcademician])
  );

  if (loading) return <Loader />;

  const name = firstNameOf(summary?.full_name ?? user?.full_name);

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <Text style={{ color: colors.ink, fontSize: 23, fontFamily: fonts.display, letterSpacing: -0.5 }}>
          Kernel<Text style={{ color: colors.gold }}>.</Text>
        </Text>
        <IconButton
          name="bell"
          label={unread ? `Bildirimler (${unread} yeni)` : "Bildirimler"}
          badge={unread}
          onPress={() => router.push("/notifications")}
        />
      </View>

      {isAcademician && (
        <Text style={{ color: colors.muted, fontSize: 11.5, fontFamily: fonts.ui, letterSpacing: 1 }}>{todayLabel()}</Text>
      )}
      <Text style={{ color: colors.ink, fontSize: 29, fontFamily: fonts.display, lineHeight: 34, marginTop: 2 }}>
        Hoş geldin,{" "}
        <Accent>{name ? (user?.role === "academician" ? `${name} Hocam.` : `${name}.`) : "Hocam."}</Accent>
      </Text>
      {!isAcademician && (
        <Muted style={{ fontSize: 13, marginTop: 2 }}>
          {[summary?.class_label, summary?.university].filter(Boolean).join(" · ") || "—"}
        </Muted>
      )}

      {isAcademician ? (
        <AcademicianBody ov={overview} />
      ) : (
        <StudentBody items={mine} progress={progress} badges={badges} />
      )}
    </Screen>
  );
}

/* ---------------- Akademisyen ---------------- */
function AcademicianBody({ ov }: { ov: TeachingOverview | null }) {
  const router = useRouter();
  const [aiClass, setAiClass] = useState<OverviewClass | null>(null);
  if (!ov) return <Muted style={{ marginTop: 20 }}>Özet yüklenemedi.</Muted>;
  const att = ov.attention;
  const openAssignment = (id: string) => router.push({ pathname: "/assignment/[id]", params: { id } });
  // "Ödev ver": sınıf seçimi ödev formunda (tek sınıf varsa o seçili gelir)
  const giveAssignment = (classId?: string) =>
    ov.classes.length === 0
      ? router.push("/class/new")
      : router.push({ pathname: "/assignment/new", params: classId ? { classId } : {} });
  const first = <T,>(items: T[]) => (items.length ? items[0] : null);

  const nr = first(att.needs_review.items);
  const ds = first(att.due_soon.items);
  const sim = first(att.similarity.items);
  const ms = first(att.missing.items);

  return (
    <>
      <GettingStarted ov={ov} />
      <View style={{ gap: 10, marginTop: 18 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <StatTile
            label="Notlanmayı bekleyen"
            value={att.needs_review.count}
            sub={nr ? nr.title : "Hepsi notlandı"}
            onPress={nr ? () => openAssignment(nr.assignment_id) : undefined}
          />
          <StatTile
            label="Bu hafta bitiyor"
            value={att.due_soon.count}
            sub={ds ? fmtDateTime(ds.due) : "Yakın teslim yok"}
            onPress={ds ? () => openAssignment(ds.assignment_id) : undefined}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <StatTile
            warn={att.similarity.count > 0}
            label="Benzerlik uyarısı"
            value={att.similarity.count}
            sub={sim ? `${sim.student_name.split(" ")[0]} ↔ ${(sim.other_name ?? "?").split(" ")[0]} %${sim.similarity}` : "Yüksek benzerlik yok"}
            onPress={sim ? () => router.push({ pathname: "/submission/[id]", params: { id: sim.submission_id } }) : undefined}
          />
          <StatTile
            label="Eksik teslim"
            value={att.missing.count}
            sub={ms ? ms.title : "Açık ödevlerde eksik yok"}
            onPress={ms ? () => openAssignment(ms.assignment_id) : undefined}
          />
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
        <View style={{ flex: 1 }}>
          <Btn title="Ödev ver" icon="plus" variant="primary" onPress={() => giveAssignment()} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn title="Yeni sınıf" icon="plus" variant="ghost" onPress={() => router.push("/class/new")} />
        </View>
      </View>

      <SectionLabel>Sınıflarım</SectionLabel>
      {ov.classes.length === 0 ? (
        <Card>
          <Muted>
            Henüz sınıfın yok. Bölümün için bir kez sınıf oluştur (ör. Bilgisayar Programcılığı); sonra derslerini
            ekleyip ödevleri o sınıfa verirsin.
          </Muted>
        </Card>
      ) : (
        ov.classes.map((c) => {
          const shownA = [...c.assignments]
            .sort((a, b) =>
              a.open !== b.open ? (a.open ? -1 : 1) : a.open ? a.effective_deadline_at.localeCompare(b.effective_deadline_at) : 0
            )
            .slice(0, 3);
          return (
            <Pressable key={c.id} onPress={() => router.push({ pathname: "/class/[id]", params: { id: c.id } })}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontSize: 17.5, fontFamily: fonts.displayBold }}>{c.name}</Text>
                    <Muted style={{ fontSize: 12.5, marginTop: 2 }}>
                      {[
                        c.department_name && c.department_name !== c.name ? c.department_name : null,
                        c.term,
                        `${c.student_count} öğrenci`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Muted>
                  </View>
                  <AiChip onPress={() => setAiClass(c)} />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {c.courses.length === 0 ? (
                    <Muted style={{ fontSize: 12.5 }}>Henüz ders eklenmedi</Muted>
                  ) : (
                    c.courses.map((co) => <Chip key={co.id} text={co.name} />)
                  )}
                </View>
                {shownA.length > 0 ? (
                  <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
                    {shownA.map((a) => (
                      <Pressable
                        key={a.id}
                        onPress={() => openAssignment(a.id)}
                        style={{ flexDirection: "row", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.ink, fontSize: 13.5, fontWeight: "600" }} numberOfLines={1}>
                            {a.title}
                          </Text>
                          {a.course_name ? <Muted style={{ fontSize: 11.5 }}>{a.course_name}</Muted> : null}
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: a.open ? colors.gold : colors.muted, fontSize: 12, fontWeight: "700" }}>
                            {a.open ? `${timeLeft(a.effective_deadline_at)} kaldı` : "Süre doldu"}
                          </Text>
                          <Muted style={{ fontSize: 11.5 }}>
                            {a.submitted}/{a.enrolled} teslim
                          </Muted>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Muted style={{ fontSize: 12.5, marginTop: 10 }}>Bu sınıfa henüz ödev vermedin.</Muted>
                )}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Btn small title="Bu sınıfa ödev ver" icon="plus" variant="primary" onPress={() => giveAssignment(c.id)} />
                  </View>
                  <Btn small title="Sınıfa gir" variant="ghost" onPress={() => router.push({ pathname: "/class/[id]", params: { id: c.id } })} />
                </View>
              </Card>
            </Pressable>
          );
        })
      )}
      <ClassAiSheet
        visible={!!aiClass}
        classId={aiClass?.id ?? ""}
        className={aiClass?.name ?? ""}
        onClose={() => setAiClass(null)}
      />

      <SectionLabel>Yaklaşan teslimler</SectionLabel>
      {ov.upcoming.length === 0 ? (
        <Card>
          <Muted>Açık ödev yok.</Muted>
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {ov.upcoming.map((u, i) => {
            const d = new Date(u.due);
            return (
              <Pressable
                key={u.assignment_id}
                onPress={() => openAssignment(u.assignment_id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 11,
                  borderTopWidth: i ? 1 : 0,
                  borderTopColor: colors.line,
                }}
              >
                <View style={{ width: 40, alignItems: "center" }}>
                  <Text style={{ color: colors.ink, fontSize: 19, fontFamily: fonts.display }}>{d.getDate()}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                    {d.toLocaleDateString("tr-TR", { month: "short" }).toLocaleUpperCase("tr")}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                    {u.title}
                  </Text>
                  <Muted style={{ fontSize: 12 }}>
                    {[u.class_name, u.course_name].filter(Boolean).join(" · ")} · {u.submitted}/{u.enrolled} teslim
                  </Muted>
                </View>
                <Icon name="chevron-right" size={16} color={colors.muted} />
              </Pressable>
            );
          })}
        </Card>
      )}
    </>
  );
}

/** Yeni hoca için "Başlarken" (web'dekiyle aynı): sınıf → öğrenci → ödev. Bitince kaybolur. */
function GettingStarted({ ov }: { ov: TeachingOverview }) {
  const router = useRouter();
  const hasClass = ov.classes.length > 0;
  const hasStudents = ov.classes.some((c) => c.student_count > 0);
  const hasAssignment = ov.classes.some((c) => c.assignment_count > 0);
  if (hasClass && hasStudents && hasAssignment) return null;
  const target = ov.classes.find((c) => c.student_count === 0) ?? ov.classes[0];

  const steps = [
    { done: hasClass, title: "Sınıf oluştur", go: () => router.push("/class/new") },
    {
      done: hasStudents,
      title: "Öğrencileri ekle (Öğrenciler bölümü)",
      go: target ? () => router.push({ pathname: "/class/[id]", params: { id: target.id } }) : undefined,
    },
    {
      done: hasAssignment,
      title: "İlk ödevi ver",
      go: target ? () => router.push({ pathname: "/assignment/new", params: { classId: target.id } }) : undefined,
    },
  ];
  const next = steps.findIndex((s) => !s.done);

  return (
    <Card style={{ marginTop: 18, borderColor: colors.goldDim }}>
      <Text style={{ color: colors.gold, fontFamily: fonts.uiBold, fontSize: 11.5, letterSpacing: 1 }}>BAŞLARKEN</Text>
      <Text style={{ color: colors.ink, fontFamily: fonts.displayBold, fontSize: 18, marginTop: 2 }}>
        Üç adımda ilk ödevine hazırsın
      </Text>
      <View style={{ gap: 8, marginTop: 12 }}>
        {steps.map((s, i) => (
          <Pressable
            key={s.title}
            disabled={s.done || i !== next || !s.go}
            onPress={s.go}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: colors.bg3,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: s.done ? colors.ok : colors.line2,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {s.done ? <Icon name="check" size={13} color={colors.ok} /> : <Text style={{ color: colors.muted, fontSize: 12 }}>{i + 1}</Text>}
            </View>
            <Text
              style={{
                flex: 1,
                color: s.done ? colors.muted : colors.ink,
                textDecorationLine: s.done ? "line-through" : "none",
                fontSize: 14,
              }}
            >
              {s.title}
            </Text>
            {i === next && <Icon name="chevron-right" size={16} color={colors.gold} />}
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

/* ---------------- Öğrenci ---------------- */
function statusChip(a: MyAssignment) {
  if (a.status === "graded" && a.score != null) return <Chip text={String(a.score)} kind="ok" />;
  if (a.status === "new_version") return <Chip text="Yeni sürüm inceleniyor" kind="blue" />;
  if (a.status === "ungraded") return <Chip text="İnceleniyor" kind="blue" />;
  return a.open ? <Chip text="Teslim bekleniyor" kind="gold" /> : <Chip text="Teslim yok" />;
}

function StudentBody({
  items,
  progress,
  badges,
}: {
  items: MyAssignment[];
  progress: Progress | null;
  badges: Badge[];
}) {
  const router = useRouter();
  // Sıradaki: önce hiç teslim edilmemiş açık ödev, sonra notlanmamış, sonra en yakın açık ödev
  const open = items.filter((a) => a.open);
  const next =
    open.find((a) => a.status === "none") ?? open.find((a) => a.status !== "graded") ?? open[0] ?? null;
  const others = items.filter((a) => a !== next);
  const scores = items.map((a) => a.score).filter((s): s is number => s != null);
  const avg = scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10) / 10 : null;
  const openSub = (a: MyAssignment) =>
    a.latest
      ? router.push({ pathname: "/submission/[id]", params: { id: a.latest.id } })
      : router.push("/(tabs)/assignments");

  return (
    <>
      {next ? (
        <View
          style={{
            marginTop: 18,
            borderWidth: 1,
            borderColor: colors.goldDim,
            borderRadius: radius.lg,
            backgroundColor: colors.bg2,
            padding: 18,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: colors.gold, fontSize: 11.5, fontFamily: fonts.uiBold, letterSpacing: 1 }}>SIRADAKİ TESLİM</Text>
            {statusChip(next)}
          </View>
          <Text style={{ color: colors.ink, fontSize: 21, fontFamily: fonts.displayBold, marginTop: 10 }}>{next.title}</Text>
          <Muted style={{ fontSize: 12.5 }}>{[next.course_name, next.class_name].filter(Boolean).join(" · ")}</Muted>
          <View style={{ flexDirection: "row", gap: 22, marginVertical: 14 }}>
            <View>
              <Text style={{ color: colors.ink, fontSize: 24, fontFamily: fonts.display }}>{timeLeft(next.effective_deadline_at)}</Text>
              <Muted style={{ fontSize: 11.5 }}>
                kaldı · {fmtDateTime(next.effective_deadline_at)}
                {next.effective_deadline_at !== next.deadline_at ? " (uzatıldı)" : ""}
              </Muted>
            </View>
            {next.precheck && (
              <View>
                <Text style={{ color: colors.ink, fontSize: 24, fontFamily: fonts.display }}>
                  {next.precheck.remaining}
                  <Text style={{ color: colors.muted, fontSize: 13 }}>/{next.precheck.limit}</Text>
                </Text>
                <Muted style={{ fontSize: 11.5 }}>ön kontrol hakkı</Muted>
              </View>
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Btn
                title={next.latest ? "Yeni sürüm" : "Ödevi yükle"}
                icon="upload"
                variant="gold"
                onPress={() => router.push("/(tabs)/assignments")}
              />
            </View>
            {next.latest ? (
              <View style={{ flex: 1 }}>
                <Btn title="Geri bildirim" variant="ghost" onPress={() => openSub(next)} />
              </View>
            ) : next.precheck ? (
              <View style={{ flex: 1 }}>
                <Btn title="Ön kontrol" icon="sparkle" variant="ghost" onPress={() => router.push("/(tabs)/assignments")} />
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <Card style={{ marginTop: 18 }}>
          <Muted>Şu an açık ödevin yok.</Muted>
        </Card>
      )}

      <SectionLabel>Diğer ödevler</SectionLabel>
      {others.length === 0 ? (
        <Muted style={{ fontSize: 13 }}>Başka ödev yok.</Muted>
      ) : (
        <Card style={{ paddingVertical: 2 }}>
          {others.map((a, i) => (
            <Pressable
              key={a.id}
              onPress={() => openSub(a)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                paddingVertical: 12,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: colors.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: "600" }} numberOfLines={1}>
                  {a.title}
                </Text>
                <Muted style={{ fontSize: 12 }}>
                  {a.course_name ? `${a.course_name} · ` : ""}
                  {a.latest ? `v${a.latest.version_number}` : "Teslim yok"} ·{" "}
                  {a.open ? `${timeLeft(a.effective_deadline_at)} kaldı` : "süre doldu"}
                </Muted>
              </View>
              {statusChip(a)}
            </Pressable>
          ))}
        </Card>
      )}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        <Card style={{ flex: 1 }}>
          <Muted style={{ fontSize: 12 }}>Not ortalaması</Muted>
          <Text style={{ color: colors.ink, fontSize: 28, fontFamily: fonts.display }}>{avg ?? "—"}</Text>
          <Muted style={{ fontSize: 11.5 }}>{scores.length ? `${scores.length} notlanmış ödev` : "Henüz not yok"}</Muted>
        </Card>
        <Card style={{ flex: 1 }}>
          <Muted style={{ fontSize: 12 }}>Clean Code ort.</Muted>
          <Text style={{ color: colors.ink, fontSize: 28, fontFamily: fonts.display }}>{progress?.average ?? "—"}</Text>
          <Sparkline points={progress?.points ?? []} />
        </Card>
      </View>

      <SectionLabel style={{ marginTop: 8 }}>Rozetler</SectionLabel>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          {badges.length === 0 && <Muted>—</Muted>}
          {badges.map((b) => (
            <View key={b.code} style={{ alignItems: "center", width: 72 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  borderWidth: 2,
                  borderColor: b.earned ? colors.gold : colors.line2,
                  backgroundColor: b.earned ? colors.goldBg : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 6,
                }}
              >
                {b.earned && b.value == null ? (
                  <Icon name="check" size={18} color={colors.gold} />
                ) : (
                  <Text style={{ color: b.earned ? colors.gold : colors.faint, fontWeight: "800" }}>
                    {b.earned ? b.value : "?"}
                  </Text>
                )}
              </View>
              <Text style={{ color: b.earned ? colors.ink : colors.faint, fontSize: 11, textAlign: "center" }}>
                {b.earned ? b.name : "Kilitli"}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </>
  );
}

function Sparkline({ points }: { points: { label: string; score: number }[] }) {
  if (points.length < 2) return <Muted style={{ fontSize: 11.5 }}>Henüz yeterli veri yok</Muted>;
  const scores = points.map((p) => p.score);
  const lo = Math.min(...scores) - 2;
  const hi = Math.max(...scores) + 2;
  const span = hi - lo || 1;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 28, gap: 3, marginTop: 4 }}>
      {points.map((p, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 6 + ((p.score - lo) / span) * 22,
            backgroundColor: colors.blue,
            borderRadius: 2,
            opacity: 0.55 + (i / points.length) * 0.45,
          }}
        />
      ))}
    </View>
  );
}
