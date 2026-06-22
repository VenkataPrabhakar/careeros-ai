export type WorkspaceCategory =
  | "RESUME"
  | "JOB_DESCRIPTION"
  | "APPLICATION"
  | "STAR_STORY"
  | "INTERVIEW_NOTE"
  | "CERTIFICATION"
  | "STUDY_PLAN"
  | "COMPANY_RESEARCH";

export type WorkspaceItem = {
  id: number;
  category: WorkspaceCategory;
  title: string;
  organization?: string | null;
  status?: string | null;
  tags: string[];
  content: Record<string, unknown>;
  notes?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  priority?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type GeneratedDocument = {
  id: number;
  kind: string;
  provider: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ResumeStyleOption =
  | "ORIGINAL_UPLOADED_FORMAT"
  | "CLASSIC_PROFESSIONAL"
  | "MODERN_MINIMAL"
  | "EXECUTIVE_BRIEF"
  | "ATS_COMPACT"
  | "HARVARD_TRADITIONAL"
  | "JAKE_CLEAN"
  | "FAANG_TECHNICAL"
  | "CONSULTING_POLISHED"
  | "SENIOR_ENGINEERING";

export type WorkspaceSnapshot = {
  dashboard: {
    resumeCount: number;
    jobDescriptionCount: number;
    applicationCount: number;
    upcomingInterviews: number;
    certificationCount: number;
    studyProgress: number;
  };
  items: Record<WorkspaceCategory, WorkspaceItem[]>;
  generatedDocuments: GeneratedDocument[];
};

export type JobDescriptionAnalysis = {
  rawText: string;
  jobTitle: string;
  company: string;
  skills: string[];
  responsibilities: string[];
  technologies: string[];
  domain: string;
  matchScore: number;
  missingKeywords: string[];
  suggestions: string[];
};

export type SearchResult = {
  id: number;
  category: string;
  title: string;
  score: number;
  excerpt: string;
};

export type ResumeAnalysis = {
  title: string;
  rawText: string;
  candidateName: string;
  email: string;
  phone: string;
  summary: string;
  estimatedExperienceYears: number;
  techStack: string[];
  skills: string[];
  experienceHighlights: string[];
  companies: string[];
  education: string[];
  certifications: string[];
};

export type OutputFormat = "DOCX" | "PDF" | "BOTH";
