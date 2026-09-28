import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { API_BASE_URL } from "./config";

const TOKEN_KEY = "kernel_token";

// "Beni hatırla" işaretsizken token yalnızca bellekte tutulur (uygulama
// kapanınca gider); işaretliyken SecureStore'a yazılır (kalıcı).
let memToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null, remember = true): Promise<void> {
  memToken = token;
  try {
    if (token && remember) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// Oturum sunucuda iptal edilince (şifre değişti, tüm cihazlardan çıkıldı, hesap
// kapatıldı) AuthProvider'a haber ver: kullanıcı giriş ekranına döner.
let sessionExpiredHandler: (() => void) | null = null;
export function onSessionExpired(fn: (() => void) | null): void {
  sessionExpiredHandler = fn;
}

const FIELD_LABEL: Record<string, string> = {
  email: "e-posta",
  password: "şifre",
  new_password: "yeni şifre",
  full_name: "ad soyad",
  school_no: "numara",
  code: "kod",
};

/* Kalıcı cihaz kimliği: "yeni cihazdan giriş" bildirimi ve Aktif oturumlar listesi için.
   Güvenlik sırrı değildir; yalnızca bu kurulumu diğer cihazlardan ayırır. */
const DEVICE_KEY = "kernel_device_id";
let deviceId: string | null = null;

async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  try {
    const stored =
      Platform.OS === "web" ? globalThis.localStorage?.getItem(DEVICE_KEY) : await SecureStore.getItemAsync(DEVICE_KEY);
    if (stored) return (deviceId = stored);
  } catch {
    /* yut */
  }
  const id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  deviceId = id;
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(DEVICE_KEY, id);
    else await SecureStore.setItemAsync(DEVICE_KEY, id);
  } catch {
    /* yut */
  }
  return id;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Device-Id": await getDeviceId() };
  if (auth) {
    const t = await getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `Hata (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail && typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data?.detail) && data.detail.length) {
        const loc = data.detail[0]?.loc ?? [];
        const field = String(loc[loc.length - 1] ?? "");
        detail = `Geçersiz bilgi: ${FIELD_LABEL[field] ?? field}. Lütfen kontrol et.`;
      }
    } catch {
      /* no body */
    }
    if (res.status === 401 && auth && path !== "/auth/me" && (await getToken())) {
      await setToken(null);
      sessionExpiredHandler?.();
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type PickedFile = { uri: string; name: string; mimeType?: string | null; size?: number | null };

/** Teslim (multipart): tek .zip ya da bir/birden fazla normal dosya (sunucu ZIP'e paketler). */
export function uploadSubmission(assignmentId: string, files: PickedFile[]): Promise<SubmissionDetail> {
  return uploadFiles<SubmissionDetail>(`/assignments/${assignmentId}/submissions`, files);
}

/** Teslim öncesi ön kontrol (teslim oluşturmaz). */
export function runPrecheck(
  assignmentId: string,
  files: PickedFile[]
): Promise<{ result: PrecheckResult; status: PrecheckStatus }> {
  return uploadFiles(`/assignments/${assignmentId}/precheck`, files);
}

/** Rapor/belge ödevinde seçicide gösterilen türler (sunucu da ayrıca denetler). */
export const DOCUMENT_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/*",
  "text/plain",
  "text/markdown",
];

async function uploadFiles<T>(path: string, files: PickedFile[]): Promise<T> {
  const t = await getToken();
  const total = files.reduce((s, f) => s + (f.size ?? 0), 0);
  if (total > 20 * 1024 * 1024) throw new ApiError(400, "Dosyalar toplamda en fazla 20 MB olabilir.");
  const form = new FormData();
  const singleZip = files.length === 1 && files[0].name.toLowerCase().endsWith(".zip");
  for (const f of files) {
    form.append(singleZip ? "file" : "files", {
      uri: f.uri,
      name: f.name,
      type: f.mimeType || "application/octet-stream",
    } as unknown as Blob);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    body: form,
  });
  if (!res.ok) {
    let detail = `Hata (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail && typeof data.detail === "string") detail = data.detail;
    } catch {
      /* gövde yok */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

// --- Tipler ---
export type Role = "student" | "academician" | "admin";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  school_no: string | null;
  university: string | null;
  is_founder: boolean;
  is_demo: boolean;
  must_change_password: boolean;
  totp_enabled: boolean;
}

/** Giriş yanıtı: ya oturum (access_token + user) ya da 2FA adımı (mfa_token). */
export interface TokenResponse {
  access_token: string | null;
  user: User | null;
  mfa_required: boolean;
  mfa_token: string | null;
}

export interface SecurityEvent {
  id: string;
  event: string;
  ip: string | null;
  user_agent: string | null;
  detail: string | null;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  actor_name: string | null;
}

export interface SecurityInfo {
  totp_enabled: boolean;
  backup_codes_left: number;
  is_demo: boolean;
  events: SecurityEvent[];
}

export interface SessionInfo {
  id: string;
  client: string;
  device: string;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export interface TwoFactorSetup {
  secret: string;
  otpauth_uri: string;
  qr: string;
}

export interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  school_no: string | null;
  university: string | null;
  is_founder: boolean;
  is_demo: boolean;
  is_active: boolean;
  totp_enabled: boolean;
  must_change_password: boolean;
  locked: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface AdminStats {
  users: Record<string, number>;
  demo_users: number;
  inactive_users: number;
  locked_users: number;
  classes: number;
  assignments: number;
  submissions: number;
  analyses_7d: number;
  communities: number;
  failed_logins_24h: number;
}

export interface AdminSettings {
  demo_login: boolean;
  jwt_secret_from_env: boolean;
  founder_setup_open: boolean;
}

/** Sınıf = bölüm grubu; dersler sınıfa eklenir, ödev bir derse ait (web ile aynı). */
export interface ClassOut {
  id: string;
  department_id: string | null;
  department_name: string | null;
  course_id: string | null;
  name: string;
  term: string | null;
  courses: Course[];
}

export interface Department {
  id: string;
  name: string;
}

export interface Course {
  id: string;
  department_id: string;
  name: string;
  code: string | null;
}

export interface Assignment {
  id: string;
  class_id: string;
  title: string;
  description: string | null;
  requirements_json: string[] | null;
  deadline_at: string;
  /** Uzatmalar dahil geçerli son tarih — "açık mı?" kararı buna göre verilir. */
  effective_deadline_at?: string | null;
  precheck_enabled?: boolean;
  precheck_limit?: number;
  show_requirement_to_student?: boolean;
  show_clean_code_to_student?: boolean;
  submission_kind?: "code" | "document";
  course_id?: string | null;
  course_name?: string | null;
}

/** Verilmiş süre uzatması (student_id null = tüm sınıf). */
export interface Reopen {
  id: string;
  assignment_id: string;
  student_id: string | null;
  student_name: string | null;
  reopened_until: string;
  active: boolean;
}

export type ReqItem = { requirement: string; status: ReqStatus; evidence: string; where: string };

/** Öğrencinin teslim öncesi ön kontrol sonucu. */
export interface PrecheckResult {
  id: string;
  created_at: string;
  coverage: number | null;
  met: number;
  partial: number;
  missing: number;
  headline: string;
  items: ReqItem[];
}

export interface PrecheckStatus {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  limit: number;
  used: number;
  remaining: number;
  resets_at: string | null;
  history: PrecheckResult[];
}

export interface SubmissionListItem {
  id: string;
  assignment_id: string;
  student_id: string;
  version_number: number;
  submitted_at: string;
}

export interface FileTreeNode {
  name: string;
  type: "dir" | "file";
  path?: string;
  size_bytes?: number;
  is_binary?: boolean;
  children?: Record<string, FileTreeNode>;
}

export interface SubmissionDetail extends SubmissionListItem {
  file_tree_json: FileTreeNode | null;
  student_name?: string | null;
  assignment_title?: string | null;
}

export interface Comment {
  id: string;
  author_type: string; // academician | ai
  author_name: string | null;
  file_path: string | null;
  line_number: number | null;
  body: string;
  created_at: string;
}

export interface Score {
  id: string;
  score: number;
  grader_name: string | null;
  graded_at: string;
}

export interface FileContent {
  path: string;
  content: string | null;
  is_binary: boolean;
  size_bytes: number;
  preview?: "image" | "pdf" | "docx" | "none";
  has_text?: boolean;
}

export type DocRun = { s: string; b: boolean; i: boolean };
export type DocBlock =
  | { t: "h"; level: number; runs: DocRun[] }
  | { t: "p"; runs: DocRun[] }
  | { t: "li"; ordered: boolean; depth: number; runs: DocRun[] }
  | { t: "img"; src: string }
  | { t: "table"; rows: string[][] };

/** Görsel / PDF / DOCX önizlemesi (web ile aynı uç: /submissions/{id}/preview). */
export interface FilePreview {
  kind: "image" | "pdf" | "docx" | "none";
  url?: string | null;
  width?: number | null;
  height?: number | null;
  pages: { url: string; width: number; height: number }[];
  page_count: number;
  truncated: boolean;
  blocks: DocBlock[];
  reason?: string | null;
}

export interface DiffLine {
  type: "ctx" | "add" | "del";
  a?: number | null;
  b?: number | null;
  text: string;
}

export interface DiffOut {
  path: string;
  from_version: number | null;
  to_version: number;
  changed: boolean;
  lines: DiffLine[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  kind: string; // graded | comment | submission
  message: string;
  submission_id: string | null;
  assignment_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface AnalysisOut {
  id: string;
  analysis_type: string;
  scope: string;
  target_submission_id: string | null;
  summary_json: Record<string, unknown> | null;
  detail_json: Record<string, unknown> | null;
  created_at: string;
}

export type ReqStatus = "met" | "partial" | "missing";
export type OverviewStudentStatus = "at_risk" | "late" | "pending" | "no_submission" | "ok";

export interface OverviewStudent {
  student_id: string;
  full_name: string;
  school_no: string | null;
  submission_id: string | null;
  version: number | null;
  submitted_at: string | null;
  score: number | null;
  analyzed: boolean;
  coverage: number | null;
  met: number;
  partial: number;
  missing: number;
  items: { requirement: string; status: ReqStatus; evidence: string; where: string }[];
  status: OverviewStudentStatus;
  stale: boolean; // analizden sonra kurallar değişti
  analyzed_at: string | null;
  feedback_sent_at: string | null;
  precheck_count: number;
  /** Sınıfın tüm ödevlerinde kapsam (teslim tarihine göre sıralı) */
  history: { assignment_id: string; title: string; submitted: boolean; coverage: number | null }[];
  trend: "up" | "down" | "flat" | null;
  /** Birden fazla ödevde eksik/kısmen kalan konular */
  recurring: { topic: string; count: number; of: number; assignments: string[] }[];
}

/** GET /classes/{id}/ai-overview — sınıf AI özeti (pop-it). */
export interface ClassOverview {
  class_id: string;
  class_name: string;
  assignments: { id: string; title: string; deadline_at: string; requirement_count: number }[];
  enrolled_count: number;
  assignment: {
    id: string;
    title: string;
    deadline_at: string;
    deadline_passed: boolean;
    requirements: string[];
  } | null;
  submitted_count: number;
  analyzed_count: number;
  pending_count: number;
  stale_count: number;
  feedback_pending_count: number;
  average_coverage: number | null;
  at_risk_count: number;
  headline: string;
  insights: string[];
  requirements: { requirement: string; met: number; partial: number; missing: number }[];
  students: OverviewStudent[];
  recurring_topics: { topic: string; students: string[] }[];
  newly_analyzed?: number;
  failed?: number; // AI yanıt veremedi (kaydedilmedi, tekrar denenebilir)
  feedback_sent?: number;
}

export interface CommunityOut {
  id: string;
  name: string;
  scope: string; // class | department | general
  scope_ref_id: string | null;
  created_by: string;
  created_at: string;
  post_count?: number | null;
}

export interface PostOut {
  id: string;
  community_id: string;
  author_id: string;
  author_name: string | null;
  title: string;
  body: string | null;
  created_at: string;
  edited_at?: string | null;
  reply_count?: number | null;
  vote_count?: number | null;
  i_voted?: boolean | null;
}

export interface ReplyOut {
  id: string;
  post_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
  edited_at?: string | null;
}

export interface MeSummary {
  full_name: string;
  role: Role;
  university: string | null;
  class_label: string | null;
}

export interface ProgressPoint {
  label: string;
  score: number;
}
export interface Progress {
  average: number | null;
  current: number | null;
  points: ProgressPoint[];
}

export interface Badge {
  code: string;
  name: string;
  description: string;
  earned: boolean;
  value: string | null;
}

/* --- Pano özetleri (web'deki api/types.ts ile aynı) --- */
export type CellStatus = "none" | "ungraded" | "new_version" | "graded";

export interface OverviewAssignment {
  id: string;
  title: string;
  course_id: string | null;
  course_name: string | null;
  submission_kind?: "code" | "document";
  deadline_at: string;
  effective_deadline_at: string;
  open: boolean;
  enrolled: number;
  submitted: number;
  graded: number;
  needs_review: number;
}

export interface OverviewClass {
  id: string;
  name: string;
  term: string | null;
  department_name: string | null;
  courses: { id: string; name: string; code: string | null }[];
  course_name: string | null;
  student_count: number;
  assignment_count: number;
  assignments: OverviewAssignment[];
}

export interface AttentionRef {
  class_id: string;
  class_name: string;
  course_name?: string | null;
  assignment_id: string;
  title: string;
}

export interface TeachingOverview {
  classes: OverviewClass[];
  attention: {
    needs_review: { count: number; items: (AttentionRef & { count: number })[] };
    due_soon: { count: number; items: (AttentionRef & { due: string })[] };
    similarity: {
      count: number;
      items: (AttentionRef & { student_name: string; other_name: string | null; similarity: number; submission_id: string })[];
    };
    missing: { count: number; items: (AttentionRef & { count: number })[] };
  };
  upcoming: (AttentionRef & { due: string; submitted: number; enrolled: number })[];
}

export interface RosterRow {
  student: { id: string; full_name: string; school_no: string | null };
  latest: { id: string; version_number: number; submitted_at: string } | null;
  versions: number;
  score: number | null;
  graded_version: number | null;
  status: CellStatus;
  similarity: number | null;
  similar_to: string | null;
  extended_until?: string | null;
}

export interface Roster {
  enrolled: number;
  submitted: number;
  graded: number;
  needs_review: number;
  similarity_warn: number;
  rows: RosterRow[];
}

export interface ClassGrades {
  assignments: { id: string; title: string; course_id: string | null; course_name: string | null }[];
  rows: {
    student: { id: string; full_name: string; school_no: string | null };
    scores: (number | null)[];
    statuses: CellStatus[];
    average: number | null;
  }[];
}

export interface MyAssignment {
  id: string;
  class_id: string;
  class_name: string;
  course_name?: string | null;
  title: string;
  deadline_at: string;
  effective_deadline_at: string;
  open: boolean;
  latest: { id: string; version_number: number; submitted_at: string } | null;
  versions: number;
  score: number | null;
  status: CellStatus;
  precheck: { limit: number; remaining: number } | null;
}