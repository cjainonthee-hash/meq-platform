export type UserRole = "student" | "lecturer" | "guest" | "admin";
export type ExamStatus = "draft" | "scheduled" | "live" | "closed" | "released";
export type GradeStatus = "pending" | "ai_graded" | "confirmed";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  student_code: string | null;
  role: UserRole;
}

/** CMU account types returned in `itaccounttype_id`. This is the only reliable
 *  way to tell a student from staff: CMU student emails are name-based, so the
 *  email address cannot be used to infer the role. */
export type CmuAccountType = "StdAcc" | "MISEmpAcc";

/** The raw "Basic Info" payload CMU SSO returns on sign-in, verbatim.
 *  Field names are CMU's, including the mixed casing (`prename_TH`).
 *  Beware: CMU sends EMPTY STRINGS for missing values, never null. A staff
 *  member's `student_id` is `""` and a student's `prename_TH` is `""`. */
export interface CmuBasicInfo {
  cmuitaccount_name: string;
  cmuitaccount: string;
  student_id: string;
  prename_id: string;
  prename_TH: string;
  prename_EN: string;
  firstname_TH: string;
  firstname_EN: string;
  lastname_TH: string;
  lastname_EN: string;
  organization_code: string;
  organization_name_TH: string;
  organization_name_EN: string;
  itaccounttype_id: CmuAccountType | string;
  itaccounttype_TH: string;
  itaccounttype_EN: string;
}

/** A row of `public.cmu_accounts` (migration 0018). Empty strings from CMU have
 *  already been normalised to null by `sync_cmu_account()`. */
export interface CmuAccount {
  user_id: string;
  cmuitaccount_name: string;
  cmuitaccount: string;
  student_id: string | null;
  prename_id: string | null;
  prename_th: string | null;
  prename_en: string | null;
  firstname_th: string | null;
  firstname_en: string | null;
  lastname_th: string | null;
  lastname_en: string | null;
  organization_code: string | null;
  organization_name_th: string | null;
  organization_name_en: string | null;
  itaccounttype_id: string | null;
  itaccounttype_th: string | null;
  itaccounttype_en: string | null;
  raw: CmuBasicInfo;
  first_seen_at: string;
  last_login_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  description: string | null;
}

export interface RubricCriterion {
  criterion: string;
  points: number;
  notes?: string;
}

export interface Question {
  id: string;
  exam_id: string;
  order_index: number;
  stem: string;
  image_url: string | null;
  image_urls: string[];
  video_urls: string[];
  answer_key: string;
  rubric: RubricCriterion[];
  max_score: number;
  time_limit_seconds: number;
}

export interface Exam {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  status: ExamStatus;
  scheduled_start: string | null;
  buffer_seconds: number;
  current_question_index: number;
  current_started_at: string | null;
  created_by: string | null;
  graders_restricted: boolean;
}

export interface AiBreakdownItem {
  criterion: string;
  points_awarded: number;
  points_possible: number;
  justification: string;
}

export interface AiGradeResult {
  total_score: number;
  confidence: "high" | "medium" | "low";
  breakdown: AiBreakdownItem[];
  rationale: string;
}
