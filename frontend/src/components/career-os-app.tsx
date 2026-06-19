"use client";

import { useDeferredValue, useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { exportDocx, exportMarkdown, exportPdf } from "@/lib/export";
import { formatDate, titleCase } from "@/lib/utils";
import { GeneratedDocument, JobDescriptionAnalysis, SearchResult, WorkspaceCategory, WorkspaceSnapshot } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { BriefcaseBusiness, FileText, MessageSquareText, MoonStar, Search, Sparkles, SunMedium, Target, Trophy } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";

const itemSchema = z.object({
  category: z.enum([
    "RESUME",
    "JOB_DESCRIPTION",
    "APPLICATION",
    "STAR_STORY",
    "INTERVIEW_NOTE",
    "CERTIFICATION",
    "STUDY_PLAN",
    "COMPANY_RESEARCH",
  ]),
  title: z.string().min(2),
  organization: z.string().optional(),
  status: z.string().optional(),
  tags: z.string().optional(),
  notes: z.string().optional(),
  content: z.string().optional(),
});

const generatorSchema = z.object({
  kind: z.enum(["RESUME", "COVER_LETTER", "LINKEDIN", "RECRUITER_EMAIL", "INTERVIEW_PREP", "COMPANY_RESEARCH", "HUMANIZE"]),
  title: z.string().min(2),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  tone: z.string().optional(),
  jobDescription: z.string().optional(),
  additionalContext: z.string().optional(),
});

type ItemForm = z.infer<typeof itemSchema>;
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
  const [analysis, setAnalysis] = useState<JobDescriptionAnalysis | null>(null);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [isPending, startTransition] = useTransition();
  const [analysisPending, setAnalysisPending] = useState(false);

  const itemForm = useForm<ItemForm>({
    resolver: zodResolver(itemSchema),
    defaultValues: { category: "RESUME", title: "", status: "", tags: "", notes: "", content: "{}" },
  });

  const generatorForm = useForm<GeneratorForm>({
    resolver: zodResolver(generatorSchema),
    defaultValues: { kind: "RESUME", title: "", company: "", jobTitle: "", tone: "Humanized", jobDescription: "", additionalContext: "" },
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void Promise.all([
      fetch(`${API_BASE}/workspace`).then((response) => response.json()),
      fetch(`${API_BASE}/providers`).then((response) => response.json()),
    ]).then(([workspaceData, providersData]) => {
      setWorkspace(workspaceData);
      setGeneratedDocuments(workspaceData.generatedDocuments);
      setProviders(providersData);
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
  }

  async function onCreateItem(values: ItemForm) {
    const body = {
      title: values.title,
      organization: values.organization,
      status: values.status,
      tags: values.tags?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [],
      notes: values.notes,
      content: values.content ? JSON.parse(values.content) : {},
    };
    startTransition(async () => {
      await fetch(`${API_BASE}/items/${values.category}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      itemForm.reset({ ...itemForm.getValues(), title: "", organization: "", status: "", tags: "", notes: "", content: "{}" });
      await refreshWorkspace();
    });
  }

  async function onGenerate(values: GeneratorForm) {
    startTransition(async () => {
      const response = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, provider }),
      });
      const generated = await response.json();
      setGeneratedDocuments((current) => [generated, ...current]);
      generatorForm.reset({ ...generatorForm.getValues(), title: "", company: "", jobTitle: "", jobDescription: "", additionalContext: "" });
      await refreshWorkspace();
    });
  }

  async function onAnalyzeFile(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    setAnalysisPending(true);
    try {
      const response = await fetch(`${API_BASE}/analyze/job-description`, {
        method: "POST",
        body: formData,
      });
      setAnalysis(await response.json());
    } finally {
      setAnalysisPending(false);
    }
  }

  async function deleteItem(id: number) {
    await fetch(`${API_BASE}/items/${id}`, { method: "DELETE" });
    await refreshWorkspace();
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,138,92,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(18,98,240,0.22),_transparent_28%),linear-gradient(180deg,_var(--background),_#0e1728)] text-[var(--foreground)]">
      <div className="mx-auto flex max-w-[1500px] gap-6 px-4 py-6 lg:px-8">
        <aside className="hidden w-72 shrink-0 lg:block">
          <Card className="sticky top-6 space-y-6">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted-foreground)]">CareerOS AI</p>
              <h1 className="mt-3 text-3xl font-semibold">Personal AI career platform</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                Local-first workspace for resumes, applications, interview prep, certification tracking, study plans, and AI-powered outreach.
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
                {providers.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              {categories.map((category) => (
                <a key={category} href={`#${category.toLowerCase()}`} className="block rounded-2xl border border-white/8 px-4 py-3 text-sm text-[var(--muted-foreground)] transition hover:border-white/20 hover:text-[var(--foreground)]">
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
                <div className="max-w-2xl">
                  <Badge className="bg-[var(--brand)]/20 text-[var(--brand-contrast)]">Production-ready foundation</Badge>
                  <h2 className="mt-4 text-4xl font-semibold leading-tight">
                    Build tailored resumes, outreach, and interview prep from one master career knowledge base.
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-foreground)]">
                    This workspace keeps your resume intelligence, STAR stories, job targets, certifications, and generated artifacts in one place while letting you switch AI providers whenever you want.
                  </p>
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
                placeholder='Try "Kafka experience" or "production issue"'
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <div className="mt-4 space-y-3">
                {searchResults.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">Search your stored experiences, stories, study items, and notes.</p>
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

          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-[var(--brand)]" />
                <div>
                  <h3 className="text-xl font-semibold">AI Generator</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Generate ATS resumes, cover letters, LinkedIn messages, recruiter emails, company research, and interview prep.</p>
                </div>
              </div>
              <form className="mt-5 space-y-3" onSubmit={generatorForm.handleSubmit(onGenerate)}>
                <select {...generatorForm.register("kind")} className="h-11 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm">
                  {["RESUME", "COVER_LETTER", "LINKEDIN", "RECRUITER_EMAIL", "INTERVIEW_PREP", "COMPANY_RESEARCH", "HUMANIZE"].map((kind) => (
                    <option key={kind} value={kind}>
                      {titleCase(kind)}
                    </option>
                  ))}
                </select>
                <Input placeholder="Artifact title" {...generatorForm.register("title")} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Input placeholder="Company" {...generatorForm.register("company")} />
                  <Input placeholder="Job title" {...generatorForm.register("jobTitle")} />
                </div>
                <Input placeholder="Tone" {...generatorForm.register("tone")} />
                <Textarea placeholder="Paste the target job description or prompt context" {...generatorForm.register("jobDescription")} />
                <Textarea placeholder="Additional context, constraints, or source notes" {...generatorForm.register("additionalContext")} />
                <Button disabled={isPending} type="submit">
                  {isPending ? "Generating..." : `Generate with ${provider}`}
                </Button>
              </form>
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <Target className="h-5 w-5 text-[var(--brand)]" />
                <div>
                  <h3 className="text-xl font-semibold">Job Description Analyzer</h3>
                  <p className="text-sm text-[var(--muted-foreground)]">Upload PDF, DOCX, or TXT files and compare them against your stored resume knowledge.</p>
                </div>
              </div>
              <label className="mt-5 flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/10 p-6 text-center text-sm text-[var(--muted-foreground)]">
                <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(event) => event.target.files?.[0] && void onAnalyzeFile(event.target.files[0])} />
                {analysisPending ? "Analyzing..." : "Upload a job description"}
              </label>
              {analysis && (
                <div className="mt-5 space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm text-[var(--muted-foreground)]">Resume Match Score</p>
                      <p className="text-lg font-semibold">{analysis.matchScore}%</p>
                    </div>
                    <Progress value={analysis.matchScore} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {analysis.skills.map((skill) => (
                      <Badge key={skill}>{skill}</Badge>
                    ))}
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)]">Domain: {analysis.domain}</p>
                  <div>
                    <p className="font-medium">Missing keywords</p>
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">{analysis.missingKeywords.join(", ") || "Strong alignment on the extracted skills."}</p>
                  </div>
                </div>
              )}
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <Card>
              <h3 className="text-xl font-semibold">Capture New Knowledge</h3>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">Store resumes, job descriptions, STAR stories, applications, certifications, interview notes, and study tasks.</p>
              <form className="mt-5 space-y-3" onSubmit={itemForm.handleSubmit(onCreateItem)}>
                <select {...itemForm.register("category")} className="h-11 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm">
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {titleCase(category)}
                    </option>
                  ))}
                </select>
                <Input placeholder="Title" {...itemForm.register("title")} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Input placeholder="Organization or company" {...itemForm.register("organization")} />
                  <Input placeholder="Status" {...itemForm.register("status")} />
                </div>
                <Input placeholder="Tags separated by commas" {...itemForm.register("tags")} />
                <Textarea placeholder='JSON content, for example {"skills":["Java","Spring Boot"]}' {...itemForm.register("content")} />
                <Textarea placeholder="Notes" {...itemForm.register("notes")} />
                <Button disabled={isPending} type="submit">
                  Save item
                </Button>
              </form>
            </Card>

            <Card>
              <h3 className="text-xl font-semibold">Generated Documents</h3>
              <div className="mt-4 space-y-3">
                {generatedDocuments.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">Generated resumes, cover letters, and outreach will appear here.</p>
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
                          <Button size="sm" variant="outline" onClick={() => exportDocx(document.title, document.content)}>
                            DOCX
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => exportPdf(document.title, document.content)}>
                            PDF
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => exportMarkdown(document.title, document.content)}>
                            Markdown
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
                      {category === "RESUME" && "Manage multiple resume versions, projects, certifications, and ATS-ready source content."}
                      {category === "JOB_DESCRIPTION" && "Store target roles, extracted requirements, responsibilities, and technology stacks."}
                      {category === "APPLICATION" && "Track company, recruiter, status, interview stages, notes, and follow-up context."}
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
                        <Button size="sm" variant="ghost" onClick={() => void deleteItem(item.id)}>
                          Delete
                        </Button>
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
