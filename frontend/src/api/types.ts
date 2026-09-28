export type Role = "student" | "academician" | "admin";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  department_id: string | null;
  school_no: string | null;
  university: string | null;
  created_at: string;
  is_founder: boolean;
  is_demo: boolean;
  must_change_password: boolean;
  totp_enabled: boolean;
}

/** Giriş yanıtı: ya oturum (access_token + user) ya da 2FA adımı (mfa_token). */
export interface TokenResponse {
  access_token: string | null;
  token_type: string;
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
  client: "web" | "mobile" | string;
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

export interface ClassOut {
  id: string;
  course_id: string;
  academician_id: string;
  name: string;
  term: string | null;
}

export interface Course {
  id: string;
  department_id: string;
  name: string;
  code: string | null;
}

export interface Department {
  id: string;
  name: string;
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
  created_by: string;
  created_at: string;
  precheck_enabled?: boolean;
  precheck_limit?: number;
  /** Hocanın başlattığı AI sonuçlarını öğrenci görsün mü (hocanın kararı) */
  show_requirement_to_student?: boolean;
  show_clean_code_to_student?: boolean;
  submission_kind?: "code" | "document";
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

/** Öğrencinin teslim öncesi ön kontrol sonucu. */
export interface PrecheckResult {
  id: string;
  created_at: string;
  coverage: number | null;
  met: number;
  partial: number;
  missing: number;
  headline: string;
  items: OverviewItem[];
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

export interface Submission extends SubmissionListItem {
  file_tree_json: FileTreeNode | null;
  student_name?: string | null;
  assignment_title?: string | null;
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
  a: number | null;
  b: number | null;
  text: string;
}

export interface Diff {
  path: string;
  from_version: number | null;
  to_version: number;
  changed: boolean;
  lines: DiffLine[];
}

export interface Comment {
  id: string;
  submission_id: string;
  author_id: string | null;
  author_type: string; // academician | ai
  author_name: string | null;
  file_path: string | null;
  line_number: number | null;
  body: string;
  created_at: string;
}

export interface Score {
  id: string;
  submission_id: string;
  score: number;
  graded_by: string;
  grader_name: string | null;
  graded_at: string;
}

export type AnalysisType =
  | "clean_code"
  | "requirement_check"
  | "plagiarism"
  | "readme_draft";

export interface Analysis {
  id: string;
  analysis_type: AnalysisType;
  scope: string;
  target_submission_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summary_json: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail_json: Record<string, any> | null;
  created_at: string;
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
  icon: string | null;
  earned: boolean;
  value: string | null;
}

export interface MeSummary {
  full_name: string;
  role: Role;
  university: string | null;
  class_label: string | null;
}

export type ReqStatus = "met" | "partial" | "missing";

export interface OverviewItem {
  requirement: string;
  status: ReqStatus;
  evidence: string;
  where: string;
}

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
  items: OverviewItem[];
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

export type CommunityScope = "class" | "department" | "general";

export interface Community {
  id: string;
  name: string;
  scope: CommunityScope;
  scope_ref_id: string | null;
  created_by: string;
  created_at: string;
  post_count?: number | null;
}

export interface CommunityPost {
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

export interface CommunityReply {
  id: string;
  post_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
  edited_at?: string | null;
}

/* --- Pano özetleri (GET /me/teaching-overview, /assignments/{id}/roster,
       /classes/{id}/grades, /me/assignments) --- */
export type CellStatus = "none" | "ungraded" | "new_version" | "graded";

export interface OverviewAssignment {
  id: string;
  title: string;
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
  course_name: string | null;
  student_count: number;
  assignment_count: number;
  assignments: OverviewAssignment[];
}

export interface AttentionRef {
  class_id: string;
  class_name: string;
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
  /** Öğrenciye özel, süresi geçmemiş uzatma */
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
  assignments: { id: string; title: string }[];
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
