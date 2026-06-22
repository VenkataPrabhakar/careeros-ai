package com.careeros.service;

import com.careeros.domain.GeneratedDocument;
import com.careeros.domain.WorkspaceCategory;
import com.careeros.domain.WorkspaceItem;
import com.careeros.repository.GeneratedDocumentRepository;
import com.careeros.repository.WorkspaceItemRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityNotFoundException;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
@RequiredArgsConstructor
@Transactional
public class CareerWorkspaceService {

	private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};
	private static final TypeReference<List<String>> LIST_TYPE = new TypeReference<>() {};
	private static final Set<String> STOP_WORDS = Set.of(
		"the", "and", "for", "with", "that", "this", "from", "into", "your", "have", "will", "you", "our", "about",
		"their", "they", "are", "was", "were", "been", "being", "able", "must", "need", "requirements", "responsible"
	);
	private static final Set<String> KNOWN_TECH = Set.of(
		"java", "spring", "springboot", "springboot3", "springboot2", "springbootmicroservices", "hibernate", "jpa", "sql",
		"mysql", "postgresql", "sqlite", "oracle", "mongodb", "kafka", "rabbitmq", "aws", "azure", "gcp", "docker",
		"kubernetes", "react", "nextjs", "typescript", "javascript", "nodejs", "microservices", "rest", "graphql",
		"terraform", "jenkins", "githubactions", "maven", "gradle", "redis", "elasticsearch"
	);

	private final WorkspaceItemRepository workspaceItemRepository;
	private final GeneratedDocumentRepository generatedDocumentRepository;
	private final AiProviderFactory aiProviderFactory;
	private final ObjectMapper objectMapper;

	@Value("${careeros.ai.default-provider:OPENAI}")
	private String defaultProvider;

	public WorkspaceSnapshot getSnapshot() {
		List<WorkspaceItem> items = workspaceItemRepository.findAll();
		Map<WorkspaceCategory, List<WorkspaceItemDto>> grouped = new EnumMap<>(WorkspaceCategory.class);
		for (WorkspaceCategory category : WorkspaceCategory.values()) {
			grouped.put(category, new ArrayList<>());
		}
		for (WorkspaceItem item : items.stream().sorted(Comparator.comparing(WorkspaceItem::getUpdatedAt).reversed()).toList()) {
			grouped.get(item.getCategory()).add(toDto(item));
		}

		long interviews = items.stream()
			.filter(item -> item.getCategory() == WorkspaceCategory.APPLICATION)
			.filter(item -> "INTERVIEW".equalsIgnoreCase(item.getStatus()) || "SCREENING".equalsIgnoreCase(item.getStatus()))
			.count();
		long studyComplete = items.stream()
			.filter(item -> item.getCategory() == WorkspaceCategory.STUDY_PLAN)
			.filter(item -> "DONE".equalsIgnoreCase(item.getStatus()))
			.count();
		long studyTotal = items.stream().filter(item -> item.getCategory() == WorkspaceCategory.STUDY_PLAN).count();

		return new WorkspaceSnapshot(
			new DashboardStats(
				grouped.get(WorkspaceCategory.RESUME).size(),
				grouped.get(WorkspaceCategory.JOB_DESCRIPTION).size(),
				grouped.get(WorkspaceCategory.APPLICATION).size(),
				(int) interviews,
				grouped.get(WorkspaceCategory.CERTIFICATION).size(),
				studyTotal == 0 ? 0 : (int) Math.round((studyComplete * 100.0) / studyTotal)
			),
			grouped,
			generatedDocumentRepository.findTop20ByOrderByCreatedAtDesc().stream().map(this::toGeneratedDto).toList()
		);
	}

	public WorkspaceItemDto saveItem(WorkspaceCategory category, ItemUpsertRequest request) {
		WorkspaceItem item = new WorkspaceItem();
		merge(item, category, request);
		return toDto(workspaceItemRepository.save(item));
	}

	public WorkspaceItemDto updateItem(Long id, ItemUpsertRequest request) {
		WorkspaceItem item = workspaceItemRepository.findById(id).orElseThrow(() -> new EntityNotFoundException("Item not found"));
		merge(item, item.getCategory(), request);
		return toDto(workspaceItemRepository.save(item));
	}

	public void deleteItem(Long id) {
		workspaceItemRepository.deleteById(id);
	}

	public List<SearchResult> searchKnowledge(String query) {
		List<String> queryTokens = tokenize(query);
		return workspaceItemRepository.findAll().stream()
			.map(item -> new SearchResult(item.getId(), item.getCategory().name(), item.getTitle(), score(item, queryTokens), excerpt(item)))
			.filter(result -> result.score() > 0)
			.sorted(Comparator.comparing(SearchResult::score).reversed())
			.limit(12)
			.toList();
	}

	public ResumeAnalysis analyzeResume(MultipartFile file) {
		String text = extractText(file);
		ResumeAnalysis analysis = parseResume(text, file.getOriginalFilename());
		saveDerivedWorkspaceItem(
			WorkspaceCategory.RESUME,
			analysis.title(),
			analysis.candidateName(),
			"PARSED",
			analysis.techStack(),
			analysis.rawText(),
			Map.of(
				"candidateName", analysis.candidateName(),
				"email", analysis.email(),
				"phone", analysis.phone(),
				"summary", analysis.summary(),
				"techStack", analysis.techStack(),
				"skills", analysis.skills(),
				"experienceHighlights", analysis.experienceHighlights(),
				"companies", analysis.companies(),
				"education", analysis.education(),
				"certifications", analysis.certifications()
			)
		);
		return analysis;
	}

	public JobDescriptionAnalysis analyzeJobDescription(String jobDescriptionText, MultipartFile file) {
		String text = StringUtils.hasText(jobDescriptionText) ? jobDescriptionText : extractText(file);
		if (!StringUtils.hasText(text)) {
			throw new IllegalArgumentException("Provide a job description through direct text input or file upload.");
		}
		JobDescriptionAnalysis analysis = parseJobDescription(text);
		saveDerivedWorkspaceItem(
			WorkspaceCategory.JOB_DESCRIPTION,
			analysis.jobTitle(),
			analysis.company(),
			"PARSED",
			analysis.technologies(),
			analysis.rawText(),
			Map.of(
				"jobTitle", analysis.jobTitle(),
				"company", analysis.company(),
				"skills", analysis.skills(),
				"responsibilities", analysis.responsibilities(),
				"technologies", analysis.technologies(),
				"domain", analysis.domain(),
				"matchScore", analysis.matchScore(),
				"missingKeywords", analysis.missingKeywords(),
				"recommendations", analysis.suggestions()
			)
		);
		return analysis;
	}

	public GeneratedDocumentDto generateArtifact(GenerateRequest request) {
		validateGenerateRequest(request);
		ProviderType provider = request.provider() == null ? ProviderType.valueOf(defaultProvider) : request.provider();
		AiProviderService aiProvider = aiProviderFactory.getProvider(provider);
		if (aiProvider == null) {
			throw new IllegalArgumentException("Unsupported AI provider selected.");
		}

		ResumeAnalysis resumeAnalysis = request.resumeAnalysis();
		JobDescriptionAnalysis jobDescriptionAnalysis = request.jobDescriptionAnalysis();
		String systemPrompt = buildSystemPrompt(request.kind(), request.outputFormat());
		String userPrompt = buildGenerationPrompt(request, resumeAnalysis, jobDescriptionAnalysis);
		String content;
		try {
			content = unwrapAiResponse(aiProvider.generate(systemPrompt, userPrompt, Map.of(
				"subject", request.title(),
				"tone", request.tone() == null ? "clear, practical, and confident" : request.tone(),
				"provider", provider.name()
			)));
		} catch (Exception exception) {
			content = buildLocalFallbackArtifact(request, resumeAnalysis, jobDescriptionAnalysis, provider, exception.getMessage());
		}

		GeneratedDocument document = new GeneratedDocument();
		document.setKind(request.kind().toUpperCase(Locale.US));
		document.setProvider(provider.name());
		document.setTitle(request.title());
		document.setContent(content);
		document.setMetadataJson(writeJson(Map.of(
			"jobTitle", jobDescriptionAnalysis.jobTitle(),
			"company", jobDescriptionAnalysis.company(),
			"tone", request.tone(),
			"outputFormat", request.outputFormat().name(),
			"resumeStyle", request.resumeStyle().name(),
			"resumeTechStack", resumeAnalysis.techStack(),
			"jdSkills", jobDescriptionAnalysis.skills()
		)));
		return toGeneratedDto(generatedDocumentRepository.save(document));
	}

	public SectionEditResponse editGeneratedSection(SectionEditRequest request) {
		validateSectionEditRequest(request);
		AiProviderService aiProvider = aiProviderFactory.getProvider(ProviderType.OPENAI);
		if (aiProvider == null) {
			throw new IllegalArgumentException("OpenAI provider is not available for section editing.");
		}

		List<String> documentLines = preserveLines(request.documentContent());
		SectionSlice targetSection = findSectionSlice(documentLines, request.sectionName());
		if (targetSection == null) {
			throw new IllegalArgumentException("Unable to find the selected section in the current document preview.");
		}

		String selectedSection = String.join("\n", targetSection.lines());
		String systemPrompt = """
			You are editing one section of a professional resume.
			Update only the selected section.
			Preserve the section heading, truthfulness, and the existing resume format style.
			Do not add new sections. Do not return explanations. Return only the revised section text.
			""";
		String userPrompt = writeJson(Map.of(
			"sectionName", request.sectionName(),
			"editInstruction", request.instruction(),
			"resumeStyle", request.resumeStyle().name(),
			"targetRole", request.jobDescriptionAnalysis().jobTitle(),
			"targetCompany", request.jobDescriptionAnalysis().company(),
			"selectedSection", selectedSection,
			"resumeSummary", request.resumeAnalysis().summary(),
			"resumeTechStack", request.resumeAnalysis().techStack(),
			"jdSkills", request.jobDescriptionAnalysis().skills()
		));

		String updatedSection;
		try {
			updatedSection = unwrapAiResponse(aiProvider.generate(systemPrompt, userPrompt, Map.of(
				"subject", request.sectionName(),
				"tone", "precise, resume-ready, and truthful",
				"provider", ProviderType.OPENAI.name()
			)));
		} catch (Exception exception) {
			throw new IllegalStateException(exception.getMessage(), exception);
		}

		String normalizedSection = normalizeSectionOutput(request.sectionName(), updatedSection);
		List<String> revisedLines = new ArrayList<>();
		revisedLines.addAll(documentLines.subList(0, targetSection.startIndex()));
		revisedLines.addAll(preserveLines(normalizedSection));
		revisedLines.addAll(documentLines.subList(targetSection.endExclusive(), documentLines.size()));
		String updatedDocument = revisedLines.stream().collect(Collectors.joining("\n")).trim();

		return new SectionEditResponse(
			request.sectionName(),
			normalizedSection,
			updatedDocument,
			ProviderType.OPENAI.name()
		);
	}

	private void validateGenerateRequest(GenerateRequest request) {
		if (request.provider() == null) {
			throw new IllegalArgumentException("Selecting an AI provider is required.");
		}
		if (request.resumeAnalysis() == null || !StringUtils.hasText(request.resumeAnalysis().rawText())) {
			throw new IllegalArgumentException("Upload and analyze your resume before generating.");
		}
		if (request.jobDescriptionAnalysis() == null || !StringUtils.hasText(request.jobDescriptionAnalysis().rawText())) {
			throw new IllegalArgumentException("Provide a job description through text input or upload before generating.");
		}
		if (request.outputFormat() == null) {
			throw new IllegalArgumentException("Choose an output format before generating.");
		}
		if (request.resumeStyle() == null) {
			throw new IllegalArgumentException("Choose a resume style before generating.");
		}
	}

	private void validateSectionEditRequest(SectionEditRequest request) {
		if (!StringUtils.hasText(request.documentContent())) {
			throw new IllegalArgumentException("Generate a resume preview before editing a section.");
		}
		if (!StringUtils.hasText(request.sectionName())) {
			throw new IllegalArgumentException("Choose a section to edit.");
		}
		if (!StringUtils.hasText(request.instruction())) {
			throw new IllegalArgumentException("Enter what you want to change in the selected section.");
		}
		if (request.resumeAnalysis() == null || request.jobDescriptionAnalysis() == null) {
			throw new IllegalArgumentException("Resume and job description analysis are required for section editing.");
		}
		if (request.resumeStyle() == null) {
			throw new IllegalArgumentException("Resume style is required for section editing.");
		}
	}

	private String buildSystemPrompt(String kind, OutputFormat outputFormat) {
		String formatInstruction = switch (outputFormat) {
			case DOCX -> "Return clean content optimized for a Word document with consistent section headings and bullet structure.";
			case PDF -> "Return clean content optimized for a PDF with professional spacing, headings, and concise bullet sections.";
			case BOTH -> "Return clean content optimized for both Word and PDF export with professional headings, compact paragraphs, and clean bullets.";
		};
		return switch (kind.toUpperCase(Locale.US)) {
			case "RESUME" -> "Generate an ATS-friendly resume tailored to the target role. Preserve the uploaded resume's overall format as closely as possible, including section order, heading style, and writing rhythm, while updating content for the target role. Use precise section headings, strong action verbs, quantified bullets, and truthful claims only. " + formatInstruction;
			case "COVER_LETTER" -> "Generate a concise, tailored, human-sounding cover letter. Keep it professional and specific. " + formatInstruction;
			case "LINKEDIN" -> "Generate a polished LinkedIn message with a natural opening, tailored context, and a respectful call to action. " + formatInstruction;
			case "RECRUITER_EMAIL" -> "Generate a recruiter email with a compelling subject line and a polished email body. " + formatInstruction;
			default -> "Generate a polished career artifact. " + formatInstruction;
		};
	}

	private String buildLocalFallbackArtifact(
		GenerateRequest request,
		ResumeAnalysis resumeAnalysis,
		JobDescriptionAnalysis jobDescriptionAnalysis,
		ProviderType provider,
		String failureReason
	) {
		String title = switch (request.kind().toUpperCase(Locale.US)) {
			case "COVER_LETTER" -> "COVER LETTER";
			case "LINKEDIN" -> "LINKEDIN MESSAGE";
			case "RECRUITER_EMAIL" -> "RECRUITER EMAIL";
			default -> "RESUME";
		};

		if (request.kind().equalsIgnoreCase("RESUME")) {
			return buildResumeStyleFallback(request, resumeAnalysis, jobDescriptionAnalysis);
		}

		List<String> lines = new ArrayList<>();
		lines.add(title);
		lines.add("");
		lines.add("Candidate: " + resumeAnalysis.candidateName());
		lines.add("Target Role: " + jobDescriptionAnalysis.jobTitle());
		lines.add("Target Company: " + jobDescriptionAnalysis.company());
		lines.add("Tone: " + request.tone());
		lines.add("");
		List<String> preferredSections = extractResumeSectionHeadings(resumeAnalysis.rawText());
		if (request.kind().equalsIgnoreCase("RESUME") && !preferredSections.isEmpty()) {
			lines.add("SOURCE FORMAT");
			lines.add(String.join(" | ", preferredSections));
			lines.add("");
		}
		lines.add(preferredSections.contains("PROFESSIONAL SUMMARY") ? "PROFESSIONAL SUMMARY" : "PROFESSIONAL SUMMARY");
		lines.add(resumeAnalysis.summary());
		lines.add("");
		lines.add(preferredSections.contains("TECHNICAL SKILLS") ? "TECHNICAL SKILLS" : "CORE SKILLS");
		resumeAnalysis.techStack().forEach(skill -> lines.add("- " + skill));
		lines.add("");
		lines.add(preferredSections.contains("EXPERIENCE") ? "EXPERIENCE" : "ROLE ALIGNMENT");
		jobDescriptionAnalysis.skills().forEach(skill -> lines.add("- Matches target need: " + skill));
		lines.add("");
		lines.add(preferredSections.contains("PROFESSIONAL EXPERIENCE") ? "PROFESSIONAL EXPERIENCE" : "EXPERIENCE HIGHLIGHTS");
		resumeAnalysis.experienceHighlights().forEach(highlight -> lines.add("- " + highlight));
		lines.add("");
		lines.add(preferredSections.contains("CERTIFICATIONS") ? "CERTIFICATIONS" : "CERTIFICATIONS");
		if (resumeAnalysis.certifications().isEmpty()) {
			lines.add("- No certifications detected in uploaded resume.");
		} else {
			resumeAnalysis.certifications().forEach(certification -> lines.add("- " + certification));
		}
		lines.add("");
		lines.add("NOTES");
		lines.add("Generated with local fallback because provider " + provider.name() + " failed at runtime.");
		if (StringUtils.hasText(failureReason)) {
			lines.add("Provider error: " + failureReason);
		}
		return String.join("\n", lines);
	}

	private String buildResumeStyleFallback(
		GenerateRequest request,
		ResumeAnalysis resumeAnalysis,
		JobDescriptionAnalysis jobDescriptionAnalysis
	) {
		List<String> lines = new ArrayList<>();
		String contactLine = StreamOf(
			resumeAnalysis.email(),
			resumeAnalysis.phone()
		).filter(StringUtils::hasText).collect(Collectors.joining("   |   "));

		lines.add(resumeAnalysis.candidateName());
		if (StringUtils.hasText(jobDescriptionAnalysis.jobTitle())) {
			lines.add(jobDescriptionAnalysis.jobTitle());
		}
		if (StringUtils.hasText(contactLine)) {
			lines.add(contactLine);
		}
		lines.add("Professional Summary");
		lines.add("");
		List<String> summaryBlock = extractSectionBlock(
			resumeAnalysis.rawText(),
			List.of("Professional Summary", "Summary"),
			List.of("Technical Skills", "Skills", "Education", "Professional Experience", "Experience")
		);
		if (summaryBlock.isEmpty()) {
			lines.add("• " + resumeAnalysis.summary());
		} else {
			summaryBlock.forEach(line -> lines.add(formatAsBulletIfNeeded(line)));
		}
		lines.add("");
		lines.add("Technical Skills");
		lines.add("");
		List<String> technicalSkillsBlock = extractSectionBlock(
			resumeAnalysis.rawText(),
			List.of("Technical Skills", "Skills"),
			List.of("Education", "Professional Experience", "Experience")
		);
		if (technicalSkillsBlock.isEmpty()) {
			resumeAnalysis.techStack().forEach(skill -> lines.add(skill));
		} else {
			lines.addAll(technicalSkillsBlock);
		}
		lines.add("");
		lines.add("Education");
		lines.add("");
		List<String> educationBlock = extractSectionBlock(
			resumeAnalysis.rawText(),
			List.of("Education"),
			List.of("Professional Experience", "Experience")
		);
		if (educationBlock.isEmpty()) {
			resumeAnalysis.education().forEach(lines::add);
		} else {
			lines.addAll(educationBlock);
		}
		lines.add("");
		lines.add("Professional Experience");
		lines.add("");
		List<String> experienceBlock = extractSectionBlock(
			resumeAnalysis.rawText(),
			List.of("Professional Experience", "Experience", "Work Experience"),
			List.of("Certifications", "Projects", "Awards")
		);
		if (experienceBlock.isEmpty()) {
			resumeAnalysis.experienceHighlights().forEach(highlight -> lines.add("• " + highlight));
		} else {
			lines.addAll(tailorExperienceBlock(experienceBlock, jobDescriptionAnalysis.skills()));
		}
		if (StringUtils.hasText(request.additionalContext())) {
			lines.add("");
			lines.add("Additional Tailoring Notes");
			lines.add(request.additionalContext());
		}
		return String.join("\n", lines);
	}

	private String buildGenerationPrompt(GenerateRequest request, ResumeAnalysis resumeAnalysis, JobDescriptionAnalysis jobDescriptionAnalysis) {
		Map<String, Object> context = new LinkedHashMap<>();
		context.put("kind", request.kind());
		context.put("title", request.title());
		context.put("tone", request.tone());
		context.put("company", jobDescriptionAnalysis.company());
		context.put("jobTitle", jobDescriptionAnalysis.jobTitle());
		context.put("selectedProvider", request.provider().name());
		context.put("outputFormat", request.outputFormat().name());
		context.put("resumeStyle", request.resumeStyle().name());
		context.put("resumeAnalysis", resumeAnalysis);
		context.put("jobDescriptionAnalysis", jobDescriptionAnalysis);
		context.put("resumeTemplate", Map.of(
			"sectionHeadings", extractResumeSectionHeadings(resumeAnalysis.rawText()),
			"topLines", nonEmptyLines(resumeAnalysis.rawText()).stream().limit(18).toList(),
			"professionalSummaryBlock", extractSectionBlock(resumeAnalysis.rawText(), List.of("Professional Summary", "Summary"), List.of("Technical Skills", "Skills", "Education", "Professional Experience", "Experience")),
			"technicalSkillsBlock", extractSectionBlock(resumeAnalysis.rawText(), List.of("Technical Skills", "Skills"), List.of("Education", "Professional Experience", "Experience")),
			"educationBlock", extractSectionBlock(resumeAnalysis.rawText(), List.of("Education"), List.of("Professional Experience", "Experience")),
			"experienceBlock", extractSectionBlock(resumeAnalysis.rawText(), List.of("Professional Experience", "Experience", "Work Experience"), List.of("Certifications", "Projects", "Awards")),
			"preserveFormat", true
		));
		context.put("additionalContext", request.additionalContext());
		context.put("instructions", List.of(
			"Use the parsed resume information as the source of truth for experience, skills, certifications, and technologies.",
			"Align strongly to the job description keywords without inventing experience.",
			"If kind is RESUME, preserve the uploaded resume's section order and formatting style as closely as possible.",
			"Reuse the same section names from the uploaded resume whenever possible.",
			"If kind is RESUME, keep the existing Technical Skills section format from the uploaded resume instead of inventing a brand-new tech stack layout.",
			"If kind is RESUME, do not add helper sections like SOURCE FORMAT, ROLE ALIGNMENT, or NOTES.",
			"If kind is RESUME, follow the selected resumeStyle while still prioritizing the uploaded resume's original structure when resumeStyle is ORIGINAL_UPLOADED_FORMAT.",
			"Keep formatting ready for both DOCX and PDF export.",
			"Ensure the result is recruiter-ready and professional."
		));
		return writeJson(context);
	}

	private List<String> extractResumeSectionHeadings(String rawResumeText) {
		LinkedHashSet<String> headings = new LinkedHashSet<>();
		for (String line : nonEmptyLines(rawResumeText)) {
			String normalized = line.replace(":", "").trim();
			if (normalized.length() > 2 && normalized.length() < 40) {
				boolean looksLikeHeading = normalized.equals(normalized.toUpperCase(Locale.US))
					|| normalized.matches("(?i)(professional summary|summary|experience|professional experience|work experience|skills|technical skills|education|projects|certifications|awards|profile|core competencies)");
				if (looksLikeHeading) {
					headings.add(normalized.toUpperCase(Locale.US));
				}
			}
			if (headings.size() >= 10) {
				break;
			}
		}
		return List.copyOf(headings);
	}

	private List<String> extractSectionBlock(String rawResumeText, List<String> startCandidates, List<String> stopCandidates) {
		List<String> lines = nonEmptyLines(rawResumeText);
		int startIndex = -1;
		for (int index = 0; index < lines.size(); index++) {
			String normalized = normalizeHeading(lines.get(index));
			if (startCandidates.stream().map(this::normalizeHeading).anyMatch(normalized::equals)) {
				startIndex = index + 1;
				break;
			}
		}
		if (startIndex == -1 || startIndex >= lines.size()) {
			return List.of();
		}
		List<String> collected = new ArrayList<>();
		Set<String> normalizedStops = stopCandidates.stream().map(this::normalizeHeading).collect(Collectors.toSet());
		for (int index = startIndex; index < lines.size(); index++) {
			String current = lines.get(index);
			if (normalizedStops.contains(normalizeHeading(current))) {
				break;
			}
			collected.add(current);
		}
		return collected;
	}

	private List<String> tailorExperienceBlock(List<String> experienceBlock, List<String> jdSkills) {
		if (jdSkills.isEmpty()) {
			return experienceBlock;
		}
		return experienceBlock.stream()
			.filter(line -> !line.equalsIgnoreCase("ROLE ALIGNMENT"))
			.map(line -> {
				if (line.startsWith("•") || line.startsWith("-")) {
					return line;
				}
				return line;
			})
			.toList();
	}

	private String formatAsBulletIfNeeded(String line) {
		String trimmed = line.trim();
		if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
			return trimmed.startsWith("-") ? "• " + trimmed.substring(1).trim() : trimmed;
		}
		return "• " + trimmed;
	}

	private String normalizeHeading(String value) {
		return value.replace(":", "").trim().toUpperCase(Locale.US);
	}

	private List<String> preserveLines(String text) {
		return Arrays.stream(text.replace("\r", "").split("\n", -1)).toList();
	}

	private boolean isSectionHeadingLine(String line) {
		String trimmed = line.trim();
		if (!StringUtils.hasText(trimmed)) {
			return false;
		}
		String normalized = normalizeHeading(trimmed);
		return trimmed.equals(trimmed.toUpperCase(Locale.US))
			|| normalized.matches("(PROFESSIONAL SUMMARY|SUMMARY|TECHNICAL SKILLS|SKILLS|EDUCATION|PROFESSIONAL EXPERIENCE|EXPERIENCE|WORK EXPERIENCE|PROJECTS|CERTIFICATIONS|AWARDS|ADDITIONAL TAILORING NOTES)");
	}

	private SectionSlice findSectionSlice(List<String> lines, String requestedSectionName) {
		String requested = normalizeHeading(requestedSectionName);
		for (int index = 0; index < lines.size(); index++) {
			if (!isSectionHeadingLine(lines.get(index))) {
				continue;
			}
			if (!normalizeHeading(lines.get(index)).equals(requested)) {
				continue;
			}
			int endExclusive = lines.size();
			for (int inner = index + 1; inner < lines.size(); inner++) {
				if (isSectionHeadingLine(lines.get(inner))) {
					endExclusive = inner;
					break;
				}
			}
			return new SectionSlice(index, endExclusive, lines.subList(index, endExclusive));
		}
		return null;
	}

	private String normalizeSectionOutput(String sectionName, String updatedSection) {
		String cleaned = updatedSection == null ? "" : updatedSection.replace("\r", "").trim();
		if (!StringUtils.hasText(cleaned)) {
			return sectionName.trim();
		}
		List<String> lines = preserveLines(cleaned).stream().map(String::stripTrailing).toList();
		if (lines.isEmpty()) {
			return sectionName.trim();
		}
		if (!normalizeHeading(lines.get(0)).equals(normalizeHeading(sectionName))) {
			List<String> revised = new ArrayList<>();
			revised.add(sectionName.trim());
			revised.addAll(lines);
			return revised.stream().collect(Collectors.joining("\n")).trim();
		}
		return lines.stream().collect(Collectors.joining("\n")).trim();
	}

	@SafeVarargs
	private final <T> java.util.stream.Stream<T> StreamOf(T... values) {
		return Arrays.stream(values).filter(Objects::nonNull);
	}

	private ResumeAnalysis parseResume(String text, String fileName) {
		List<String> lines = nonEmptyLines(text);
		String candidateName = lines.isEmpty() ? "Candidate" : lines.get(0);
		String title = (fileName == null || fileName.isBlank()) ? candidateName + " Resume" : stripExtension(fileName);
		String email = findFirst(text, "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");
		String phone = findFirst(text, "(\\+?\\d[\\d\\s().-]{8,}\\d)");
		List<String> techStack = extractTechStack(text);
		List<String> skills = extractSkillsSection(text, techStack);
		List<String> experienceHighlights = lines.stream()
			.filter(line -> line.matches("(?i).*(developed|built|designed|led|implemented|migrated|optimized|improved|delivered|supported).*"))
			.limit(8)
			.toList();
		List<String> companies = lines.stream()
			.filter(line -> line.matches(".*\\b(Inc|LLC|Corp|Corporation|Technologies|Solutions|Systems|Services|Labs|Consulting)\\b.*"))
			.limit(6)
			.toList();
		List<String> education = lines.stream()
			.filter(line -> line.matches("(?i).*(bachelor|master|university|college|institute|mba|b\\.tech|m\\.tech).*"))
			.limit(4)
			.toList();
		List<String> certifications = lines.stream()
			.filter(line -> line.matches("(?i).*(aws|azure|gcp|kubernetes|certified|certification).*"))
			.limit(6)
			.toList();
		String summary = lines.stream()
			.skip(1)
			.filter(line -> line.length() > 40)
			.limit(3)
			.collect(Collectors.joining(" "));
		int experienceYears = estimateExperienceYears(text, experienceHighlights);
		return new ResumeAnalysis(
			title,
			text,
			candidateName,
			email,
			phone,
			summary,
			experienceYears,
			techStack,
			skills,
			experienceHighlights,
			companies,
			education,
			certifications
		);
	}

	private JobDescriptionAnalysis parseJobDescription(String text) {
		List<String> tokens = tokenize(text).stream().distinct().toList();
		List<String> skills = extractTechStack(text);
		List<String> responsibilities = nonEmptyLines(text).stream()
			.filter(line -> line.strip().matches("(?i).*(build|design|lead|own|deliver|support|optimize|collaborate|develop|architect|implement).*"))
			.limit(8)
			.toList();
		List<String> technologies = tokens.stream().filter(KNOWN_TECH::contains).toList();
		String domain = inferDomain(text);
		String jobTitle = detectJobTitle(text);
		String company = detectCompany(text);
		List<String> resumeKeywords = workspaceItemRepository.findAllByCategoryOrderByUpdatedAtDesc(WorkspaceCategory.RESUME).stream()
			.flatMap(item -> tokenize(item.getContentJson()).stream())
			.distinct()
			.toList();
		List<String> missing = skills.stream().filter(skill -> !resumeKeywords.contains(skill.toLowerCase(Locale.US))).toList();
		int matchScore = Math.max(25, Math.min(97, 100 - (missing.size() * 7)));
		List<String> suggestions = List.of(
			"Highlight the same technologies and domain terminology used in the role description.",
			"Use outcome-based bullets with scale, performance, reliability, and delivery impact.",
			"Match the role title, stack, and leadership scope in the summary and core skills sections."
		);
		return new JobDescriptionAnalysis(text, jobTitle, company, skills, responsibilities, technologies, domain, matchScore, missing, suggestions);
	}

	private String unwrapAiResponse(String rawResponse) {
		if (!StringUtils.hasText(rawResponse)) {
			return "";
		}
		return rawResponse
			.replace("\\n", "\n")
			.replace("\\\"", "\"")
			.trim();
	}

	private int score(WorkspaceItem item, List<String> queryTokens) {
		String haystack = String.join(" ", item.getTitle(), safe(item.getOrganization()), safe(item.getNotes()), safe(item.getContentJson()), safe(item.getTagsJson())).toLowerCase(Locale.US);
		int score = 0;
		for (String token : queryTokens) {
			if (haystack.contains(token)) {
				score += item.getTitle().toLowerCase(Locale.US).contains(token) ? 5 : 2;
			}
		}
		return score;
	}

	private String excerpt(WorkspaceItem item) {
		String source = safe(item.getNotes()) + " " + safe(item.getContentJson());
		return source.length() <= 180 ? source : source.substring(0, 180) + "...";
	}

	private String inferDomain(String text) {
		String normalized = text.toLowerCase(Locale.US);
		if (normalized.contains("retail")) return "Retail";
		if (normalized.contains("airline") || normalized.contains("travel")) return "Airline";
		if (normalized.contains("healthcare") || normalized.contains("clinical")) return "Healthcare";
		if (normalized.contains("automotive") || normalized.contains("vehicle")) return "Automotive";
		if (normalized.contains("finance") || normalized.contains("bank") || normalized.contains("payments")) return "Financial Services";
		return "General";
	}

	private List<String> tokenize(String input) {
		return input == null ? List.of() : Arrays.stream(input.toLowerCase(Locale.US).split("[^a-z0-9+#.]+"))
			.filter(token -> token.length() > 2)
			.filter(token -> !STOP_WORDS.contains(token))
			.toList();
	}

	private String extractText(MultipartFile file) {
		if (file == null || file.isEmpty()) {
			return "";
		}
		String fileName = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase(Locale.US);
		try (InputStream inputStream = file.getInputStream()) {
			if (fileName.endsWith(".pdf")) {
				try (var document = Loader.loadPDF(file.getBytes())) {
					return new PDFTextStripper().getText(document);
				}
			}
			if (fileName.endsWith(".docx")) {
				try (XWPFDocument document = new XWPFDocument(inputStream)) {
					return document.getParagraphs().stream().map(paragraph -> paragraph.getText()).collect(Collectors.joining("\n"));
				}
			}
			return new String(file.getBytes(), StandardCharsets.UTF_8);
		} catch (IOException exception) {
			throw new IllegalArgumentException("Unable to read uploaded file", exception);
		}
	}

	private List<String> extractTechStack(String text) {
		LinkedHashSet<String> stack = tokenize(text).stream()
			.filter(KNOWN_TECH::contains)
			.map(this::normalizeTechToken)
			.collect(Collectors.toCollection(LinkedHashSet::new));
		return List.copyOf(stack);
	}

	private List<String> extractSkillsSection(String text, List<String> fallbackTechStack) {
		List<String> lines = nonEmptyLines(text);
		List<String> skillLines = lines.stream()
			.filter(line -> line.matches("(?i).*(skills|technologies|technical skills|core competencies).*"))
			.limit(3)
			.toList();
		LinkedHashSet<String> skills = new LinkedHashSet<>(fallbackTechStack);
		for (String line : skillLines) {
			skills.addAll(Arrays.stream(line.split("[:,|/]"))
				.map(String::trim)
				.filter(value -> value.length() > 2)
				.limit(12)
				.toList());
		}
		return List.copyOf(skills);
	}

	private int estimateExperienceYears(String text, List<String> experienceHighlights) {
		Matcher matcher = Pattern.compile("(\\d{1,2})\\+?\\s+years").matcher(text.toLowerCase(Locale.US));
		if (matcher.find()) {
			return Integer.parseInt(matcher.group(1));
		}
		return Math.max(1, Math.min(20, experienceHighlights.size()));
	}

	private String detectJobTitle(String text) {
		List<String> lines = nonEmptyLines(text);
		return lines.stream()
			.filter(line -> line.matches("(?i).*(engineer|developer|architect|manager|lead|consultant|specialist).*"))
			.findFirst()
			.orElse("Target Role");
	}

	private String detectCompany(String text) {
		List<String> lines = nonEmptyLines(text);
		return lines.stream()
			.filter(line -> line.matches("(?i).*(at |client:|company:).*"))
			.findFirst()
			.map(line -> line.replaceFirst("(?i).*(at |client:|company:)", "").trim())
			.filter(StringUtils::hasText)
			.orElse("Target Company");
	}

	private String findFirst(String text, String regex) {
		Matcher matcher = Pattern.compile(regex).matcher(text);
		if (!matcher.find()) {
			return "";
		}
		if (matcher.groupCount() >= 1) {
			String captured = matcher.group(1);
			return captured == null ? matcher.group() : captured;
		}
		return matcher.group();
	}

	private List<String> nonEmptyLines(String text) {
		return text.lines().map(String::trim).filter(StringUtils::hasText).toList();
	}

	private String normalizeTechToken(String token) {
		return switch (token) {
			case "springboot", "springboot2", "springboot3" -> "Spring Boot";
			case "nextjs" -> "Next.js";
			case "nodejs" -> "Node.js";
			case "githubactions" -> "GitHub Actions";
			case "postgresql" -> "PostgreSQL";
			case "mysql" -> "MySQL";
			case "sql" -> "SQL";
			case "aws" -> "AWS";
			case "gcp" -> "GCP";
			case "jpa" -> "JPA";
			case "rest" -> "REST";
			default -> token.substring(0, 1).toUpperCase(Locale.US) + token.substring(1);
		};
	}

	private String stripExtension(String fileName) {
		int dotIndex = fileName.lastIndexOf('.');
		return dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
	}

	private void saveDerivedWorkspaceItem(
		WorkspaceCategory category,
		String title,
		String organization,
		String status,
		List<String> tags,
		String notes,
		Map<String, Object> content
	) {
		WorkspaceItem item = new WorkspaceItem();
		item.setCategory(category);
		item.setTitle(title);
		item.setOrganization(organization);
		item.setStatus(status);
		item.setTagsJson(writeJson(tags));
		item.setNotes(notes.length() > 4000 ? notes.substring(0, 4000) : notes);
		item.setContentJson(writeJson(content));
		workspaceItemRepository.save(item);
	}

	private void merge(WorkspaceItem item, WorkspaceCategory category, ItemUpsertRequest request) {
		item.setCategory(category);
		item.setTitle(request.title());
		item.setOrganization(request.organization());
		item.setStatus(request.status());
		item.setNotes(request.notes());
		item.setStartDate(request.startDate());
		item.setEndDate(request.endDate());
		item.setPriority(request.priority());
		item.setTagsJson(writeJson(request.tags() == null ? List.of() : request.tags()));
		item.setContentJson(writeJson(request.content() == null ? Map.of() : request.content()));
	}

	private WorkspaceItemDto toDto(WorkspaceItem item) {
		return new WorkspaceItemDto(
			item.getId(),
			item.getCategory().name(),
			item.getTitle(),
			item.getOrganization(),
			item.getStatus(),
			readList(item.getTagsJson()),
			readMap(item.getContentJson()),
			item.getNotes(),
			item.getStartDate(),
			item.getEndDate(),
			item.getPriority(),
			item.getCreatedAt().toString(),
			item.getUpdatedAt().toString()
		);
	}

	private GeneratedDocumentDto toGeneratedDto(GeneratedDocument document) {
		return new GeneratedDocumentDto(
			document.getId(),
			document.getKind(),
			document.getProvider(),
			document.getTitle(),
			document.getContent(),
			readMap(document.getMetadataJson()),
			document.getCreatedAt().toString()
		);
	}

	private Map<String, Object> readMap(String value) {
		try {
			return objectMapper.readValue(value, MAP_TYPE);
		} catch (IOException exception) {
			return Map.of();
		}
	}

	private List<String> readList(String value) {
		try {
			return objectMapper.readValue(value, LIST_TYPE);
		} catch (IOException exception) {
			return List.of();
		}
	}

	private String writeJson(Object value) {
		try {
			return objectMapper.writeValueAsString(value);
		} catch (IOException exception) {
			throw new IllegalStateException("Unable to serialize data", exception);
		}
	}

	private static String safe(String value) {
		return value == null ? "" : value;
	}

	public record DashboardStats(
		int resumeCount,
		int jobDescriptionCount,
		int applicationCount,
		int upcomingInterviews,
		int certificationCount,
		int studyProgress
	) {}

	public record WorkspaceSnapshot(
		DashboardStats dashboard,
		Map<WorkspaceCategory, List<WorkspaceItemDto>> items,
		List<GeneratedDocumentDto> generatedDocuments
	) {}

	public record WorkspaceItemDto(
		Long id,
		String category,
		String title,
		String organization,
		String status,
		List<String> tags,
		Map<String, Object> content,
		String notes,
		LocalDate startDate,
		LocalDate endDate,
		Integer priority,
		String createdAt,
		String updatedAt
	) {}

	public record ItemUpsertRequest(
		String title,
		String organization,
		String status,
		List<String> tags,
		Map<String, Object> content,
		String notes,
		LocalDate startDate,
		LocalDate endDate,
		Integer priority
	) {}

	public record SearchResult(Long id, String category, String title, int score, String excerpt) {}

	public record ResumeAnalysis(
		String title,
		String rawText,
		String candidateName,
		String email,
		String phone,
		String summary,
		int estimatedExperienceYears,
		List<String> techStack,
		List<String> skills,
		List<String> experienceHighlights,
		List<String> companies,
		List<String> education,
		List<String> certifications
	) {}

	public record JobDescriptionAnalysis(
		String rawText,
		String jobTitle,
		String company,
		List<String> skills,
		List<String> responsibilities,
		List<String> technologies,
		String domain,
		int matchScore,
		List<String> missingKeywords,
		List<String> suggestions
	) {}

	public enum OutputFormat {
		DOCX,
		PDF,
		BOTH
	}

	public enum ResumeStyle {
		ORIGINAL_UPLOADED_FORMAT,
		CLASSIC_PROFESSIONAL,
		MODERN_MINIMAL,
		EXECUTIVE_BRIEF,
		ATS_COMPACT,
		HARVARD_TRADITIONAL,
		JAKE_CLEAN,
		FAANG_TECHNICAL,
		CONSULTING_POLISHED,
		SENIOR_ENGINEERING
	}

	public record GenerateRequest(
		@NotBlank String kind,
		@NotBlank String title,
		String tone,
		String additionalContext,
		@NotNull ResumeAnalysis resumeAnalysis,
		@NotNull JobDescriptionAnalysis jobDescriptionAnalysis,
		@NotNull ProviderType provider,
		@NotNull OutputFormat outputFormat,
		@NotNull ResumeStyle resumeStyle
	) {}

	public record SectionEditRequest(
		@NotBlank String documentContent,
		@NotBlank String sectionName,
		@NotBlank String instruction,
		@NotNull ResumeAnalysis resumeAnalysis,
		@NotNull JobDescriptionAnalysis jobDescriptionAnalysis,
		@NotNull ResumeStyle resumeStyle
	) {}

	public record GeneratedDocumentDto(
		Long id,
		String kind,
		String provider,
		String title,
		String content,
		Map<String, Object> metadata,
		String createdAt
	) {}

	public record SectionEditResponse(
		String sectionName,
		String updatedSection,
		String updatedDocument,
		String provider
	) {}

	private record SectionSlice(int startIndex, int endExclusive, List<String> lines) {}
}
