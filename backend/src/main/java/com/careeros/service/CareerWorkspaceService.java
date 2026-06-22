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
		String content = unwrapAiResponse(aiProvider.generate(systemPrompt, userPrompt, Map.of(
			"subject", request.title(),
			"tone", request.tone() == null ? "clear, practical, and confident" : request.tone(),
			"provider", provider.name()
		)));

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
			"resumeTechStack", resumeAnalysis.techStack(),
			"jdSkills", jobDescriptionAnalysis.skills()
		)));
		return toGeneratedDto(generatedDocumentRepository.save(document));
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
	}

	private String buildSystemPrompt(String kind, OutputFormat outputFormat) {
		String formatInstruction = switch (outputFormat) {
			case DOCX -> "Return clean content optimized for a Word document with consistent section headings and bullet structure.";
			case PDF -> "Return clean content optimized for a PDF with professional spacing, headings, and concise bullet sections.";
			case BOTH -> "Return clean content optimized for both Word and PDF export with professional headings, compact paragraphs, and clean bullets.";
		};
		return switch (kind.toUpperCase(Locale.US)) {
			case "RESUME" -> "Generate an ATS-friendly resume tailored to the target role. Use precise section headings, strong action verbs, quantified bullets, and truthful claims only. " + formatInstruction;
			case "COVER_LETTER" -> "Generate a concise, tailored, human-sounding cover letter. Keep it professional and specific. " + formatInstruction;
			case "LINKEDIN" -> "Generate a polished LinkedIn message with a natural opening, tailored context, and a respectful call to action. " + formatInstruction;
			case "RECRUITER_EMAIL" -> "Generate a recruiter email with a compelling subject line and a polished email body. " + formatInstruction;
			default -> "Generate a polished career artifact. " + formatInstruction;
		};
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
		context.put("resumeAnalysis", resumeAnalysis);
		context.put("jobDescriptionAnalysis", jobDescriptionAnalysis);
		context.put("additionalContext", request.additionalContext());
		context.put("instructions", List.of(
			"Use the parsed resume information as the source of truth for experience, skills, certifications, and technologies.",
			"Align strongly to the job description keywords without inventing experience.",
			"Keep formatting ready for both DOCX and PDF export.",
			"Ensure the result is recruiter-ready and professional."
		));
		return writeJson(context);
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

	public record GenerateRequest(
		@NotBlank String kind,
		@NotBlank String title,
		String tone,
		String additionalContext,
		@NotNull ResumeAnalysis resumeAnalysis,
		@NotNull JobDescriptionAnalysis jobDescriptionAnalysis,
		@NotNull ProviderType provider,
		@NotNull OutputFormat outputFormat
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
}
