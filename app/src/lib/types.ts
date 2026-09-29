export interface Course {
  code: string;
  title: string;
  grade: string;
  attempts?: number;
}

export interface StudentProfile {
  student_id: string;
  name: string;
  programme: string;
  credits_completed: number;
  cgpa: number;
  status: 'good_standing' | 'academic_probation' | 'pending_fees' | string;
  fee_cleared: boolean;
  completed_courses: Course[];
  failed_courses: Course[];
  current_registered_credits: number;
  notes?: string;
}

export interface KnowledgeChunk {
  chunk_id: string;
  source_file: string;
  document_title: string;
  section: string;
  course_codes: string[];
  keywords: string[];
  text: string;
  char_count: number;
  estimated_tokens: number;
}

export interface RetrievedChunk {
  chunk_id: string;
  source: string;
  document_title: string;
  section: string;
  course_codes: string[];
  text: string;
  score: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  is_out_of_domain: boolean;
  confidence: number;
  matched_policies: string[];
  detected_courses: string[];
  message?: string;
}
