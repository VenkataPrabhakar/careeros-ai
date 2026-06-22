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
  OutputFormat,
  ResumeAnalysis,
  SearchResult,
  WorkspaceCategory,
  WorkspaceSnapshot,
} from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import {
  BriefcaseBusiness,
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
const IS_GITHUB_PAGES =
  typeof window !== "undefined" && window.location.hostname.includes("github.io");

const generatorSchema = z.object({
  kind: z.enum(["RESUME", "COVER_LETTER", "LINKEDIN", "RECRUITER_EMAIL"]),
  title: z.string().min(2, "Title is required"),
  tone: z.string().min(2, "Tone is required"),
  jobDescriptionText: z.string().optional(),
  additionalContext: z.string().optional(),
  outputFormat: z.enum(["DOCX", "PDF", "BOTH"]),
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
            }),
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Generation failed." }));
            setFormError(error.message ?? "Generation failed.");
            return;
          }
          const generated = (await response.json()) as GeneratedDocument;
          setGeneratedDocuments((current) => [generated, ...current]);
          autoExport(generated.title, generated.content, values.outputFormat);
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

  function autoExport(title: string, content: string, outputFormat: OutputFormat) {
    if (outputFormat === "DOCX") {
      void exportDocx(title, content);
      return;
    }
    if (outputFormat === "PDF") {
      exportPdf(title, content);
      return;
    }
    void exportDocx(title, content);
    exportPdf(title, content);
  }

  const readiness = useMemo(() => {
    const score =
      (resumeAnalysis ? 34 : 0) +
      (jdAnalysis ? 33 : 0) +
      (provider ? 33 : 0);
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
              <h1 className="mt-3 text-3xl font-semibold">Resume to JD pipeline</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                Upload your resume, parse your real experience and tech stack, analyze the target JD, choose a provider, and generate export-ready files.
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
                  <Badge className="bg-[var(--brand)]/20 text-[var(--brand-contrast)]">Required provider and format selection</Badge>
                  <h2 className="mt-4 text-4xl font-semibold leading-tight">
                    Generate a tailored document only after your resume and the target job description have both been parsed.
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-foreground)]">
                    The app now uses your uploaded resume as the source of truth for experience, companies, tech stack, certifications, and strengths. Then it aligns that data against a pasted or uploaded JD before generation.
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
                  <p className="text-sm text-[var(--muted-foreground)]">Upload your existing resume in PDF, DOCX, or TXT and extract your experience, stack, skills, and certifications.</p>
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
                  <div>
                    <p className="font-medium">Experience highlights</p>
                    <ul className="mt-2 space-y-2 text-sm text-[var(--muted-foreground)]">
                      {resumeAnalysis.experienceHighlights.slice(0, 5).map((highlight) => (
                        <li key={highlight}>• {highlight}</li>
                      ))}
                    </ul>
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
                <Textarea
                  placeholder="Paste the full job description here"
                  {...generatorForm.register("jobDescriptionText")}
                />
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
                  <div>
                    <p className="font-medium">Missing keywords</p>
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                      {jdAnalysis.missingKeywords.join(", ") || "Strong alignment on the extracted skills."}
                    </p>
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
                  <h3 className="text-xl font-semibold">3. Generate Final Document</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Provider selection is required. Output format is required. The chosen format is downloaded automatically after generation.</p>
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
                  {isPending ? "Generating..." : `Generate with ${provider || "selected provider"}`}
                </Button>
                {missingRequirements.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-[var(--muted-foreground)]">
                    {missingRequirements.join(" · ")}
                  </div>
                )}
              </form>
            </Card>

            <Card>
              <h3 className="text-xl font-semibold">Generated Documents</h3>
              <div className="mt-4 space-y-3">
                {generatedDocuments.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">Generated files will appear here after the resume and JD pipeline is complete.</p>
                ) : (
                  generatedDocuments.map((document) => (
                    <div key={document.id} className="rounded-2xl border border-white/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{document.title}</p>
                          <p className="text-sm text-[var(--muted-foreground)]">
                            {titleCase(document.kind)} via {document.provider} on {formatDate(document.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void exportDocx(document.title, document.content)}>
                            DOCX
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => exportPdf(document.title, document.content)}>
                            PDF
                          </Button>
                        </div>
                      </div>
                      <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-[var(--muted-foreground)]">
                        {document.content}
                      </pre>
                    </div>
                  ))
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
                      <pre className="mt-3 overflow-x-auto rounded-2xl bg-black/15 p-3 text-xs text-[var(--muted-foreground)]">
                        {JSON.stringify(item.content, null, 2)}
                      </pre>
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
  if (!latest) {
    return null;
  }
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
  if (!latest) {
    return null;
  }
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
