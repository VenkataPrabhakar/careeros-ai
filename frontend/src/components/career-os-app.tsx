"use client";

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { exportDocx, exportPdf } from "@/lib/export";
import { formatDate, titleCase } from "@/lib/utils";
import {
  GeneratedDocument,
  JobDescriptionAnalysis,
  ResumeAnalysis,
  ResumeStyleOption,
  SearchResult,
  SectionEditResponse,
  WorkspaceCategory,
  WorkspaceSnapshot,
} from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import {
  BriefcaseBusiness,
  Check,
  Eye,
  FilePenLine,
  FileSearch,
  FileText,
  MessageSquareText,
  MoonStar,
  Search,
  Sparkles,
  SunMedium,
  Target,
  Trophy,
  Upload,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";
const IS_GITHUB_PAGES = typeof window !== "undefined" && window.location.hostname.includes("github.io");

const resumeStyles: Array<{
  value: ResumeStyleOption;
  label: string;
  description: string;
}> = [
  {
    value: "ORIGINAL_UPLOADED_FORMAT",
    label: "Original Uploaded Format",
    description: "Preserve the uploaded resume's section order and detailed skills structure as closely as possible.",
  },
  {
    value: "CLASSIC_PROFESSIONAL",
    label: "Classic Professional",
    description: "Traditional corporate resume with balanced headings and clean experience bullets.",
  },
  {
    value: "MODERN_MINIMAL",
    label: "Modern Minimal",
    description: "Light, clean, and reduced visual noise with simple hierarchy.",
  },
  {
    value: "EXECUTIVE_BRIEF",
    label: "Executive Brief",
    description: "Leadership-oriented format with stronger summary framing and compact depth.",
  },
  {
    value: "ATS_COMPACT",
    label: "ATS Compact",
    description: "Dense but readable structure optimized for applicant tracking systems.",
  },
  {
    value: "HARVARD_TRADITIONAL",
    label: "Harvard Traditional",
    description: "Academic-style resume with restrained typography and formal spacing.",
  },
  {
    value: "JAKE_CLEAN",
    label: "Jake Clean",
    description: "Simple modern structure inspired by clean one-column technical resumes.",
  },
  {
    value: "FAANG_TECHNICAL",
    label: "FAANG Technical",
    description: "Sharp engineering-focused format that emphasizes technical depth and scale.",
  },
  {
    value: "CONSULTING_POLISHED",
    label: "Consulting Polished",
    description: "Structured, polished resume with clear leadership and impact framing.",
  },
  {
    value: "SENIOR_ENGINEERING",
    label: "Senior Engineering",
    description: "Emphasizes architecture, platform ownership, migration work, and production depth.",
  },
];

const generatorSchema = z.object({
  kind: z.enum(["RESUME", "COVER_LETTER", "LINKEDIN", "RECRUITER_EMAIL"]),
  title: z.string().min(2, "Title is required"),
  tone: z.string().min(2, "Tone is required"),
  jobDescriptionText: z.string().optional(),
  additionalContext: z.string().optional(),
  outputFormat: z.enum(["DOCX", "PDF", "BOTH"]),
  resumeStyle: z.enum([
    "ORIGINAL_UPLOADED_FORMAT",
    "CLASSIC_PROFESSIONAL",
    "MODERN_MINIMAL",
    "EXECUTIVE_BRIEF",
    "ATS_COMPACT",
    "HARVARD_TRADITIONAL",
    "JAKE_CLEAN",
    "FAANG_TECHNICAL",
    "CONSULTING_POLISHED",
    "SENIOR_ENGINEERING",
  ]),
});

type GeneratorForm = z.infer<typeof generatorSchema>;

const categories: WorkspaceCategory[] = [
  "RESUME",
  "JOB_DESCRIPTION",
  "APPLICATION",
  "STAR_STORY",
  "INTERVIEW_NOTE",
  "CERTIFICATION",
  "STUDY_PLAN",
  "COMPANY_RESEARCH",
];

const statCards = [
  { key: "resumeCount", label: "Resumes", icon: FileText },
  { key: "jobDescriptionCount", label: "Job Descriptions", icon: Target },
  { key: "applicationCount", label: "Applications", icon: BriefcaseBusiness },
  { key: "upcomingInterviews", label: "Upcoming Interviews", icon: MessageSquareText },
  { key: "certificationCount", label: "Certifications", icon: Trophy },
];

export function CareerOsApp() {
  const { provider, setProvider, theme, setTheme, searchQuery, setSearchQuery } = useAppStore();
  const deferredQuery = useDeferredValue(searchQuery);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [resumeAnalysis, setResumeAnalysis] = useState<ResumeAnalysis | null>(null);
  const [jdAnalysis, setJdAnalysis] = useState<JobDescriptionAnalysis | null>(null);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [editingDocs, setEditingDocs] = useState<Record<number, boolean>>({});
  const [selectedSections, setSelectedSections] = useState<Record<number, string>>({});
  const [sectionInstructions, setSectionInstructions] = useState<Record<number, string>>({});
  const [sectionBusy, setSectionBusy] = useState<Record<number, boolean>>({});
  const [resumeFileName, setResumeFileName] = useState("");
  const [jdFileName, setJdFileName] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [jdBusy, setJdBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [apiError, setApiError] = useState("");
  const [isPending, startTransition] = useTransition();

  const generatorForm = useForm<GeneratorForm>({
    resolver: zodResolver(generatorSchema),
    defaultValues: {
      kind: "RESUME",
      title: "",
      tone: "Professional, ATS-friendly, and human",
      jobDescriptionText: "",
      additionalContext: "",
      outputFormat: "BOTH",
      resumeStyle: "ORIGINAL_UPLOADED_FORMAT",
    },
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void Promise.all([
      fetch(`${API_BASE}/workspace`).then((response) => response.json()),
      fetch(`${API_BASE}/providers`).then((response) => response.json()),
    ])
      .then(([workspaceData, providersData]) => {
        setWorkspace(workspaceData);
        setGeneratedDocuments(workspaceData.generatedDocuments);
        setProviders(providersData);
        setResumeAnalysis((current) => current ?? getLatestResumeAnalysis(workspaceData));
        setJdAnalysis((current) => current ?? getLatestJobDescriptionAnalysis(workspaceData));
        setApiError("");
      })
      .catch(() => {
        setApiError(
          `CareerOS AI frontend is loaded, but the backend API is unreachable at ${API_BASE}. Upload, parsing, and AI generation need the Spring Boot backend running.`,
        );
      });
  }, []);

  useEffect(() => {
    if (!deferredQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      fetch(`${API_BASE}/search?q=${encodeURIComponent(deferredQuery)}`)
        .then((response) => response.json())
        .then(setSearchResults);
    }, 300);
    return () => clearTimeout(timeout);
  }, [deferredQuery]);

  async function refreshWorkspace() {
    const data = await fetch(`${API_BASE}/workspace`).then((response) => response.json());
    setWorkspace(data);
    setGeneratedDocuments(data.generatedDocuments);
    setResumeAnalysis((current) => current ?? getLatestResumeAnalysis(data));
    setJdAnalysis((current) => current ?? getLatestJobDescriptionAnalysis(data));
  }

  async function onResumeUpload(file: File) {
    setResumeBusy(true);
    setFormError("");
    setResumeFileName(file.name);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch(`${API_BASE}/analyze/resume`, { method: "POST", body: formData });
      if (!response.ok) {
        throw new Error("Unable to analyze resume.");
      }
      const data = (await response.json()) as ResumeAnalysis;
      setResumeAnalysis(data);
      if (!generatorForm.getValues("title")) {
        generatorForm.setValue("title", `${data.candidateName || "Candidate"} ${titleCase(generatorForm.getValues("kind"))}`);
      }
      await refreshWorkspace();
    } catch (error) {
      setFormError(
        error instanceof TypeError
          ? `Backend connection failed. Start the Spring Boot API or point NEXT_PUBLIC_API_BASE_URL to a live backend. Current API: ${API_BASE}`
          : error instanceof Error
            ? error.message
            : "Resume analysis failed.",
      );
    } finally {
      setResumeBusy(false);
    }
  }

  async function analyzeJobDescription(input?: { text?: string; file?: File }) {
    setJdBusy(true);
    setFormError("");
    try {
      const formData = new FormData();
      const text = input?.text?.trim() ?? generatorForm.getValues("jobDescriptionText")?.trim();
      if (text) {
        formData.append("text", text);
      }
      if (input?.file) {
        formData.append("file", input.file);
        setJdFileName(input.file.name);
      }
      if (!text && !input?.file) {
        throw new Error("Paste a job description or upload a JD file before analyzing.");
      }

      const response = await fetch(`${API_BASE}/analyze/job-description`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error("Unable to analyze job description.");
      }
      const data = (await response.json()) as JobDescriptionAnalysis;
      setJdAnalysis(data);
      if (!generatorForm.getValues("title")) {
        generatorForm.setValue("title", `${data.company} ${titleCase(generatorForm.getValues("kind"))}`);
      }
      await refreshWorkspace();
    } catch (error) {
      setFormError(
        error instanceof TypeError
          ? `Backend connection failed. Start the Spring Boot API or point NEXT_PUBLIC_API_BASE_URL to a live backend. Current API: ${API_BASE}`
          : error instanceof Error
            ? error.message
            : "JD analysis failed.",
      );
    } finally {
      setJdBusy(false);
    }
  }

  async function onGenerate(values: GeneratorForm) {
    setFormError("");
    if (!resumeAnalysis) {
      setFormError("Upload and analyze your resume first.");
      return;
    }
    if (!jdAnalysis) {
      setFormError("Provide and analyze the job description first.");
      return;
    }
    if (!provider) {
      setFormError("Select an AI provider before generating.");
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch(`${API_BASE}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: values.kind,
              title: values.title,
              tone: values.tone,
              additionalContext: values.additionalContext,
              resumeAnalysis,
              jobDescriptionAnalysis: jdAnalysis,
              provider,
              outputFormat: values.outputFormat,
              resumeStyle: values.resumeStyle,
            }),
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Generation failed." }));
            setFormError(error.message ?? "Generation failed.");
            return;
          }
          const generated = (await response.json()) as GeneratedDocument;
          const generatedSections = extractEditableSections(generated.content);
          setGeneratedDocuments((current) => [generated, ...current]);
          setDrafts((current) => ({ ...current, [generated.id]: generated.content }));
          setEditingDocs((current) => ({ ...current, [generated.id]: false }));
          setSelectedSections((current) => ({
            ...current,
            [generated.id]: generatedSections[0]?.name ?? "",
          }));
          setSectionInstructions((current) => ({ ...current, [generated.id]: "" }));
          await refreshWorkspace();
        } catch (error: unknown) {
          setFormError(
            error instanceof TypeError
              ? `Backend connection failed. Start the Spring Boot API or point NEXT_PUBLIC_API_BASE_URL to a live backend. Current API: ${API_BASE}`
              : "Generation failed.",
          );
        }
      })();
    });
  }

  async function downloadGeneratedDocument(document: GeneratedDocument, format: "DOCX" | "PDF") {
    const draft = drafts[document.id] ?? document.content;
    const style = readResumeStyle(document.metadata.resumeStyle);
    if (format === "DOCX") {
      const templateAvailable = document.metadata.templateAvailable === true;
      if (document.kind === "RESUME" && templateAvailable) {
        try {
          const response = await fetch(`${API_BASE}/export/docx`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              generatedDocumentId: document.id,
              title: document.title,
              documentContent: draft,
            }),
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Unable to export DOCX." }));
            throw new Error(error.message ?? "Unable to export DOCX.");
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = window.document.createElement("a");
          anchor.href = url;
          anchor.download = `${document.title}.docx`;
          anchor.click();
          URL.revokeObjectURL(url);
          return;
        } catch (error) {
          setFormError(error instanceof Error ? error.message : "Unable to export DOCX.");
          return;
        }
      }
      void exportDocx(document.title, draft, style);
      return;
    }
    exportPdf(document.title, draft, style);
  }

  async function editSectionWithOpenAi(document: GeneratedDocument) {
    if (!resumeAnalysis || !jdAnalysis) {
      setFormError("Resume and job description analysis are required before section editing.");
      return;
    }
    const sectionName = selectedSections[document.id] ?? "";
    const instruction = sectionInstructions[document.id]?.trim() ?? "";
    const draft = drafts[document.id] ?? document.content;
    const style = readResumeStyle(document.metadata.resumeStyle);

    if (!sectionName) {
      setFormError("Choose a section before editing with OpenAI.");
      return;
    }
    if (!instruction) {
      setFormError("Enter what you want to change in the selected section.");
      return;
    }

    setSectionBusy((current) => ({ ...current, [document.id]: true }));
    setFormError("");
    try {
      const response = await fetch(`${API_BASE}/edit-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentContent: draft,
          sectionName,
          instruction,
          resumeAnalysis,
          jobDescriptionAnalysis: jdAnalysis,
          resumeStyle: style,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Section update failed." }));
        throw new Error(error.message ?? "Section update failed.");
      }
      const edited = (await response.json()) as SectionEditResponse;
      setDrafts((current) => ({ ...current, [document.id]: edited.updatedDocument }));
      setEditingDocs((current) => ({ ...current, [document.id]: false }));
      setSectionInstructions((current) => ({ ...current, [document.id]: "" }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Section update failed.");
    } finally {
      setSectionBusy((current) => ({ ...current, [document.id]: false }));
    }
  }

  const readiness = useMemo(() => {
    const score = (resumeAnalysis ? 34 : 0) + (jdAnalysis ? 33 : 0) + (provider ? 33 : 0);
    return Math.min(100, score);
  }, [resumeAnalysis, jdAnalysis, provider]);

  const missingRequirements = [
    !resumeAnalysis ? "Resume analysis required" : "",
    !jdAnalysis ? "Job description analysis required" : "",
    !provider ? "AI provider selection required" : "",
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,138,92,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(18,98,240,0.22),_transparent_28%),linear-gradient(180deg,_var(--background),_#0e1728)] text-[var(--foreground)]">
      <div className="mx-auto flex max-w-[1500px] gap-6 px-4 py-6 lg:px-8">
        <aside className="hidden w-72 shrink-0 lg:block">
          <Card className="sticky top-6 space-y-6">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted-foreground)]">CareerOS AI</p>
              <h1 className="mt-3 text-3xl font-semibold">Resume review workflow</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                Upload your resume, keep its original structure, choose a style you are comfortable with, preview the result, edit it, and only then download it.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
                {theme === "light" ? <MoonStar className="mr-2 h-4 w-4" /> : <SunMedium className="mr-2 h-4 w-4" />}
                {theme === "light" ? "Dark" : "Light"}
              </Button>
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="rounded-xl border border-white/10 bg-black/10 px-3 text-sm"
              >
                <option value="">Select AI</option>
                {providers.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Generation readiness</span>
                <span>{readiness}%</span>
              </div>
              <Progress value={readiness} />
            </div>
            <div className="space-y-3">
              {categories.map((category) => (
                <a
                  key={category}
                  href={`#${category.toLowerCase()}`}
                  className="block rounded-2xl border border-white/8 px-4 py-3 text-sm text-[var(--muted-foreground)] transition hover:border-white/20 hover:text-[var(--foreground)]"
                >
                  {titleCase(category)}
                </a>
              ))}
            </div>
          </Card>
        </aside>

        <main className="flex-1 space-y-6">
          <section className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <Badge className="bg-[var(--brand)]/20 text-[var(--brand-contrast)]">Preview before download</Badge>
                  <h2 className="mt-4 text-4xl font-semibold leading-tight">
                    Keep your original resume format, compare style options, and only download after you review and edit the preview.
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-foreground)]">
                    The generated resume now follows your uploaded structure first, then applies the style you choose. Nothing downloads automatically anymore.
                  </p>
                  {IS_GITHUB_PAGES && API_BASE.includes("localhost") && (
                    <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                      This GitHub Pages site is frontend-only. It is currently configured to call <strong>{API_BASE}</strong>, which exists only on your local machine. Online uploads and parsing will not work until the backend is deployed and the frontend is rebuilt with a live API URL.
                    </p>
                  )}
                  {apiError && (
                    <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                      {apiError}
                    </p>
                  )}
                  {formError && <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{formError}</p>}
                </div>
                <div className="min-w-56 rounded-3xl border border-white/10 bg-black/15 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted-foreground)]">Study Progress</p>
                  <p className="mt-3 text-4xl font-semibold">{workspace?.dashboard.studyProgress ?? 0}%</p>
                  <div className="mt-4">
                    <Progress value={workspace?.dashboard.studyProgress ?? 0} />
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <Search className="h-4 w-4 text-[var(--brand)]" />
                <p className="text-sm font-medium">Knowledge Search</p>
              </div>
              <Input
                className="mt-4"
                placeholder='Try "Kafka experience" or "migration example"'
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <div className="mt-4 space-y-3">
                {searchResults.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">Search parsed resume content, job descriptions, stories, and notes.</p>
                ) : (
                  searchResults.map((result) => (
                    <div key={`${result.category}-${result.id}`} className="rounded-2xl border border-white/10 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{result.title}</p>
                        <Badge>{titleCase(result.category)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{result.excerpt}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {statCards.map(({ key, label, icon: Icon }) => (
              <Card key={key}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
                    <p className="mt-2 text-3xl font-semibold">{workspace?.dashboard[key as keyof WorkspaceSnapshot["dashboard"]] ?? 0}</p>
                  </div>
                  <Icon className="h-8 w-8 text-[var(--brand)]" />
                </div>
              </Card>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <Card>
              <div className="flex items-center gap-3">
                <Upload className="h-5 w-5 text-[var(--brand)]" />
                <div>
                  <h3 className="text-xl font-semibold">1. Upload Resume</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Upload your existing resume in PDF, DOCX, or TXT and extract your experience, stack, and detailed section structure.</p>
                </div>
              </div>
              <label className="mt-5 flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/10 p-6 text-center text-sm text-[var(--muted-foreground)]">
                <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(event) => event.target.files?.[0] && void onResumeUpload(event.target.files[0])} />
                {resumeBusy ? "Analyzing resume..." : resumeFileName ? `Uploaded: ${resumeFileName}` : "Choose resume file"}
              </label>
              {resumeAnalysis && (
                <div className="mt-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{resumeAnalysis.candidateName}</p>
                      <p className="text-sm text-[var(--muted-foreground)]">{resumeAnalysis.email || "No email detected"} · {resumeAnalysis.phone || "No phone detected"}</p>
                    </div>
                    <Badge>{resumeAnalysis.estimatedExperienceYears}+ years</Badge>
                  </div>
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]">{resumeAnalysis.summary || "No summary block was confidently detected, but the resume text is stored and usable."}</p>
                  <div className="flex flex-wrap gap-2">
                    {resumeAnalysis.techStack.map((tech) => (
                      <Badge key={tech}>{tech}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <FileSearch className="h-5 w-5 text-[var(--brand)]" />
                <div>
                  <h3 className="text-xl font-semibold">2. Provide Job Description</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Paste the JD directly or upload it as a file. One of these is required before generation.</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <Textarea placeholder="Paste the full job description here" {...generatorForm.register("jobDescriptionText")} />
                <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/10 p-5 text-center text-sm text-[var(--muted-foreground)]">
                  <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(event) => event.target.files?.[0] && void analyzeJobDescription({ file: event.target.files[0] })} />
                  {jdBusy ? "Analyzing JD..." : jdFileName ? `Uploaded: ${jdFileName}` : "Or upload JD file"}
                </label>
                <Button variant="secondary" onClick={() => void analyzeJobDescription({ text: generatorForm.getValues("jobDescriptionText") })}>
                  Analyze pasted JD
                </Button>
              </div>
              {jdAnalysis && (
                <div className="mt-5 space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm text-[var(--muted-foreground)]">Resume Match Score</p>
                      <p className="text-lg font-semibold">{jdAnalysis.matchScore}%</p>
                    </div>
                    <Progress value={jdAnalysis.matchScore} />
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)]">{jdAnalysis.jobTitle} · {jdAnalysis.company} · {jdAnalysis.domain}</p>
                  <div className="flex flex-wrap gap-2">
                    {jdAnalysis.skills.map((skill) => (
                      <Badge key={skill}>{skill}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <Card>
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-[var(--brand)]" />
                <div>
                  <h3 className="text-xl font-semibold">3. Choose Your Comfortable Resume Style</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Pick from ten styles. `Original Uploaded Format` keeps the second document style closest to your source resume.</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {resumeStyles.map((style) => {
                  const selected = generatorForm.watch("resumeStyle") === style.value;
                  return (
                    <button
                      key={style.value}
                      type="button"
                      onClick={() => generatorForm.setValue("resumeStyle", style.value)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        selected
                          ? "border-[var(--brand)] bg-[var(--brand)]/10"
                          : "border-white/10 bg-black/10 hover:border-white/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{style.label}</p>
                          <p className="mt-2 text-sm text-[var(--muted-foreground)]">{style.description}</p>
                        </div>
                        {selected && <Check className="h-4 w-4 text-[var(--brand)]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <Eye className="h-5 w-5 text-[var(--brand)]" />
                <div>
                  <h3 className="text-xl font-semibold">4. Generate, Review, Edit, Download</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Nothing downloads immediately. You review the preview first, then download only if you like it.</p>
                </div>
              </div>
              <form className="mt-5 space-y-3" onSubmit={generatorForm.handleSubmit(onGenerate)}>
                <select {...generatorForm.register("kind")} className="h-11 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm">
                  {["RESUME", "COVER_LETTER", "LINKEDIN", "RECRUITER_EMAIL"].map((kind) => (
                    <option key={kind} value={kind}>
                      {titleCase(kind)}
                    </option>
                  ))}
                </select>
                <Input placeholder="Generated document title" {...generatorForm.register("title")} />
                <Input placeholder="Tone" {...generatorForm.register("tone")} />
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm"
                >
                  <option value="">Select AI provider</option>
                  {providers.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <select {...generatorForm.register("outputFormat")} className="h-11 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm">
                  <option value="DOCX">DOCX</option>
                  <option value="PDF">PDF</option>
                  <option value="BOTH">DOCX + PDF</option>
                </select>
                <Textarea placeholder="Any extra instructions, constraints, or talking points" {...generatorForm.register("additionalContext")} />
                <Button disabled={isPending || !resumeAnalysis || !jdAnalysis || !provider} type="submit">
                  {isPending ? "Generating..." : `Generate preview with ${provider || "selected provider"}`}
                </Button>
                {missingRequirements.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-[var(--muted-foreground)]">
                    {missingRequirements.join(" · ")}
                  </div>
                )}
              </form>
            </Card>
          </section>

          <section className="grid gap-6">
            <Card>
              <div className="flex items-center gap-3">
                <FilePenLine className="h-5 w-5 text-[var(--brand)]" />
                <div>
                  <h3 className="text-xl font-semibold">Generated Preview</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Review the document, customize any section with OpenAI before final output, then download DOCX or PDF.</p>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                {generatedDocuments.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">No generated preview yet. After generation, your preview appears here instead of downloading automatically.</p>
                ) : (
                  generatedDocuments.map((document) => {
                    const style = readResumeStyle(document.metadata.resumeStyle);
                    const draft = drafts[document.id] ?? document.content;
                    const editing = editingDocs[document.id] ?? false;
                    const isResumeDocument = document.kind === "RESUME";
                    const sections = extractEditableSections(draft);
                    const selectedSection = selectedSections[document.id] || sections[0]?.name || "";
                    const currentSection = sections.find((section) => section.name === selectedSection);
                    return (
                      <div key={document.id} className="rounded-3xl border border-white/10 bg-black/10 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{document.title}</p>
                            <p className="text-sm text-[var(--muted-foreground)]">
                              {titleCase(document.kind)} via {document.provider} on {formatDate(document.createdAt)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge>{resumeStyles.find((item) => item.value === style)?.label ?? "Style"}</Badge>
                            {document.metadata.templateAvailable === true && <Badge>Template matched DOCX</Badge>}
                            <Button size="sm" variant="outline" onClick={() => setEditingDocs((current) => ({ ...current, [document.id]: !editing }))}>
                              {editing ? "Preview" : "Edit"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void downloadGeneratedDocument(document, "DOCX")}>
                              Download DOCX
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void downloadGeneratedDocument(document, "PDF")}>
                              Download PDF
                            </Button>
                          </div>
                        </div>
                        {document.kind === "RESUME" && document.metadata.templateAvailable !== true && (
                          <p className="mt-3 text-sm text-amber-200">
                            Exact format matching works best when the original resume was uploaded as `.docx`. This preview is still an approximation.
                          </p>
                        )}
                        {isResumeDocument && (
                          <div className="mt-4 rounded-3xl border border-white/10 bg-black/15 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-medium">Section Editor</p>
                                <p className="text-sm text-[var(--muted-foreground)]">Choose a section, describe the change, and only that section will be updated through OpenAI.</p>
                              </div>
                              <Badge>OpenAI section update</Badge>
                            </div>
                            <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr_auto]">
                              <select
                                value={selectedSection}
                                onChange={(event) => setSelectedSections((current) => ({ ...current, [document.id]: event.target.value }))}
                                className="h-11 rounded-xl border border-white/10 bg-black/10 px-3 text-sm"
                              >
                                {sections.map((section) => (
                                  <option key={section.name} value={section.name}>
                                    {section.name}
                                  </option>
                                ))}
                              </select>
                              <Input
                                placeholder="Example: rewrite this section for Walmart backend roles with stronger Java and Spring ownership"
                                value={sectionInstructions[document.id] ?? ""}
                                onChange={(event) => setSectionInstructions((current) => ({ ...current, [document.id]: event.target.value }))}
                              />
                              <Button
                                type="button"
                                disabled={sectionBusy[document.id] || sections.length === 0}
                                onClick={() => void editSectionWithOpenAi(document)}
                              >
                                {sectionBusy[document.id] ? "Updating..." : "Update Section"}
                              </Button>
                            </div>
                            {currentSection && (
                              <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
                                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Selected Section Preview</p>
                                <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-foreground)]">{currentSection.content}</pre>
                              </div>
                            )}
                          </div>
                        )}
                        {editing ? (
                          <Textarea
                            className="mt-4 min-h-[420px] font-mono"
                            value={draft}
                            onChange={(event) => setDrafts((current) => ({ ...current, [document.id]: event.target.value }))}
                          />
                        ) : (
                          <DocumentPreview content={draft} style={style} />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </section>

          <section className="grid gap-4">
            {categories.map((category) => (
              <Card key={category} id={category.toLowerCase()}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-semibold">{titleCase(category)}</h3>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {category === "RESUME" && "Parsed resumes are stored here with detected experience, skills, companies, and certifications."}
                      {category === "JOB_DESCRIPTION" && "Parsed job descriptions are stored here with required skills, technologies, role title, domain, and match signals."}
                      {category === "APPLICATION" && "Track companies, recruiters, status, interview stages, notes, and follow-up context."}
                      {category === "STAR_STORY" && "Capture leadership, conflict, production issue, migration, and optimization stories."}
                      {category === "INTERVIEW_NOTE" && "Prepare behavioral, technical, and system design responses by domain."}
                      {category === "CERTIFICATION" && "Track exam dates, expiration windows, study notes, and cloud platform coverage."}
                      {category === "STUDY_PLAN" && "Plan daily and weekly progress across DSA, Java, Spring Boot, cloud, and AI topics."}
                      {category === "COMPANY_RESEARCH" && "Store company briefs, interview patterns, tech stack notes, and salary context."}
                    </p>
                  </div>
                  <Badge>{workspace?.items[category]?.length ?? 0} entries</Badge>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {(workspace?.items[category] ?? []).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{item.title}</p>
                          <p className="text-sm text-[var(--muted-foreground)]">
                            {[item.organization, item.status].filter(Boolean).join(" · ") || "No metadata yet"}
                          </p>
                        </div>
                      </div>
                      {item.tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.tags.map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </div>
                      )}
                      {item.notes && <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">{item.notes}</p>}
                      <div className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
                        {renderWorkspaceContentSummary(item.content).map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}

function getLatestResumeAnalysis(workspace: WorkspaceSnapshot): ResumeAnalysis | null {
  const latest = workspace.items.RESUME?.[0];
  if (!latest) return null;
  const content = latest.content ?? {};
  const candidateName = readString(content.candidateName) || latest.organization || latest.title;
  return {
    title: latest.title,
    rawText: latest.notes ?? "",
    candidateName,
    email: readString(content.email),
    phone: readString(content.phone),
    summary: readString(content.summary),
    estimatedExperienceYears: readNumber(content.estimatedExperienceYears),
    techStack: readStringArray(content.techStack),
    skills: readStringArray(content.skills),
    experienceHighlights: readStringArray(content.experienceHighlights),
    companies: readStringArray(content.companies),
    education: readStringArray(content.education),
    certifications: readStringArray(content.certifications),
  };
}

function getLatestJobDescriptionAnalysis(workspace: WorkspaceSnapshot): JobDescriptionAnalysis | null {
  const latest = workspace.items.JOB_DESCRIPTION?.[0];
  if (!latest) return null;
  const content = latest.content ?? {};
  return {
    rawText: latest.notes ?? "",
    jobTitle: readString(content.jobTitle) || latest.title,
    company: readString(content.company) || latest.organization || "",
    skills: readStringArray(content.skills),
    responsibilities: readStringArray(content.responsibilities),
    technologies: readStringArray(content.technologies),
    domain: readString(content.domain),
    matchScore: readNumber(content.matchScore),
    missingKeywords: readStringArray(content.missingKeywords),
    suggestions: readStringArray(content.recommendations),
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readResumeStyle(value: unknown): ResumeStyleOption {
  return typeof value === "string" && resumeStyles.some((style) => style.value === value) ? (value as ResumeStyleOption) : "ORIGINAL_UPLOADED_FORMAT";
}

function extractEditableSections(content: string) {
  const lines = content.replace(/\r/g, "").split("\n");
  const sections: Array<{ name: string; content: string }> = [];
  let activeName = "";
  let activeLines: string[] = [];

  for (const line of lines) {
    if (isPreviewHeading(line)) {
      if (activeName) {
        sections.push({ name: activeName, content: activeLines.join("\n").trim() });
      }
      activeName = line.trim().replace(/:$/, "");
      activeLines = [line];
      continue;
    }
    if (activeName) {
      activeLines.push(line);
    }
  }

  if (activeName) {
    sections.push({ name: activeName, content: activeLines.join("\n").trim() });
  }

  return sections;
}

function renderWorkspaceContentSummary(content: Record<string, unknown>) {
  const entries = Object.entries(content)
    .flatMap(([key, value]) => {
      if (typeof value === "string" && value.trim()) {
        return [`${titleCase(key)}: ${value}`];
      }
      if (Array.isArray(value) && value.length > 0) {
        const stringValues = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        return stringValues.length > 0 ? [`${titleCase(key)}: ${stringValues.slice(0, 4).join(", ")}`] : [];
      }
      if (typeof value === "number") {
        return [`${titleCase(key)}: ${value}`];
      }
      return [];
    })
    .slice(0, 6);

  return entries.length > 0 ? entries : ["Parsed details are available for this item."];
}

function DocumentPreview({
  content,
  style,
}: {
  content: string;
  style: ResumeStyleOption;
}) {
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const classes = previewStyleClasses(style);

  return (
    <div className={`mt-4 rounded-3xl border border-white/10 p-8 ${classes.shell}`}>
      <div className="space-y-3">
        {lines.map((line, index) => {
          const isHeading = isPreviewHeading(line);
          const isName = isPreviewName(line, index);
          const isSubhead = isPreviewSubhead(line, index);
          if (isHeading) {
            return (
              <p key={`${line}-${index}`} className={`mt-5 text-sm font-semibold uppercase tracking-[0.18em] ${classes.heading}`}>
                {line}
              </p>
            );
          }
          return (
            <p key={`${line}-${index}`} className={`text-sm leading-7 ${classes.body}`}>
              <span
                className={
                  isName
                    ? `block text-center text-2xl font-semibold ${classes.title}`
                    : isSubhead
                      ? "block text-center text-sm font-medium tracking-[0.08em] text-slate-500"
                      : undefined
                }
              >
                {line}
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

function previewStyleClasses(style: ResumeStyleOption) {
  switch (style) {
    case "MODERN_MINIMAL":
      return { shell: "bg-slate-50 text-slate-900", title: "font-sans", heading: "text-sky-700", body: "font-sans text-slate-700" };
    case "EXECUTIVE_BRIEF":
      return { shell: "bg-stone-50 text-slate-900", title: "font-serif", heading: "text-slate-700", body: "font-serif text-slate-700" };
    case "ATS_COMPACT":
      return { shell: "bg-white text-black", title: "font-sans", heading: "text-black", body: "font-serif text-slate-700" };
    case "HARVARD_TRADITIONAL":
      return { shell: "bg-amber-50 text-stone-900", title: "font-serif", heading: "text-amber-900", body: "font-serif text-stone-700" };
    case "JAKE_CLEAN":
      return { shell: "bg-white text-slate-900", title: "font-sans", heading: "text-slate-600", body: "font-sans text-slate-700" };
    case "FAANG_TECHNICAL":
      return { shell: "bg-emerald-50 text-slate-900", title: "font-sans", heading: "text-emerald-800", body: "font-sans text-slate-700" };
    case "CONSULTING_POLISHED":
      return { shell: "bg-violet-50 text-slate-900", title: "font-serif", heading: "text-violet-700", body: "font-sans text-slate-700" };
    case "SENIOR_ENGINEERING":
      return { shell: "bg-blue-50 text-slate-900", title: "font-serif", heading: "text-blue-800", body: "font-serif text-slate-700" };
    case "CLASSIC_PROFESSIONAL":
      return { shell: "bg-zinc-50 text-slate-900", title: "font-serif", heading: "text-slate-700", body: "font-serif text-slate-700" };
    case "ORIGINAL_UPLOADED_FORMAT":
    default:
      return { shell: "bg-white text-slate-900", title: "font-serif", heading: "text-slate-800", body: "font-serif text-slate-700" };
  }
}

function isPreviewHeading(line: string) {
  const trimmed = line.trim().replace(/:$/, "");
  return (
    !/^[-•*]\s+/.test(trimmed) &&
    (/^[A-Z][A-Z\s&/()-]{2,}$/.test(trimmed) ||
      /^(Professional Summary|Technical Skills|Education|Professional Experience|Experience|Projects|Certifications|Awards|Additional Tailoring Notes|Summary)$/i.test(trimmed))
  );
}

function isPreviewName(line: string, index: number) {
  const trimmed = line.trim();
  return index === 0 && trimmed.length > 4 && trimmed.length < 60 && !isPreviewHeading(trimmed) && trimmed.split(/\s+/).length <= 6;
}

function isPreviewSubhead(line: string, index: number) {
  const trimmed = line.trim();
  return index > 0 && index < 3 && trimmed.length > 0 && trimmed.length < 90 && !isPreviewHeading(trimmed) && !/^[-•*]\s+/.test(trimmed);
}
