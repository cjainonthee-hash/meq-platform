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
