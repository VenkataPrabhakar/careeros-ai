package com.careeros.service;

import com.careeros.domain.GeneratedDocument;
import com.careeros.domain.WorkspaceCategory;
import com.careeros.domain.WorkspaceItem;
import com.careeros.repository.GeneratedDocumentRepository;
import com.careeros.repository.WorkspaceItemRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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

	public JobDescriptionAnalysis analyzeJobDescription(MultipartFile file) {
		String text = extractText(file);
		List<String> tokens = tokenize(text).stream().distinct().toList();
		List<String> skills = tokens.stream().filter(token -> token.matches("java|spring|kafka|aws|azure|gcp|docker|kubernetes|react|typescript|sql|microservices")).toList();
		List<String> technologies = tokens.stream().filter(token -> token.matches("java|spring|springboot|aws|azure|gcp|kafka|docker|kubernetes|react|nextjs|typescript|mysql|postgresql|sqlite")).toList();
		List<String> responsibilities = text.lines()
			.filter(line -> line.strip().matches("(?i).*(build|design|lead|own|deliver|support|optimize|collaborate).*"))
			.map(String::trim)
			.limit(6)
			.toList();
		String domain = inferDomain(text);
		List<String> resumeKeywords = workspaceItemRepository.findAllByCategoryOrderByUpdatedAtDesc(WorkspaceCategory.RESUME).stream()
			.flatMap(item -> tokenize(item.getContentJson()).stream())
			.distinct()
			.toList();
		List<String> missing = skills.stream().filter(skill -> !resumeKeywords.contains(skill)).toList();
		int matchScore = Math.max(25, Math.min(97, 100 - (missing.size() * 8)));
		List<String> suggestions = List.of(
			"Mirror the job's core stack in your skills and experience sections.",
			"Quantify delivery impact with scale, latency, cost, and uptime metrics.",
			"Use the exact domain language that appears in the description."
		);
		return new JobDescriptionAnalysis(text, skills, responsibilities, technologies, domain, matchScore, missing, suggestions);
	}

	public GeneratedDocumentDto generateArtifact(GenerateRequest request) {
		ProviderType provider = request.provider() == null ? ProviderType.valueOf(defaultProvider) : request.provider();
		AiProviderService aiProvider = aiProviderFactory.getProvider(provider);
		String systemPrompt = switch (request.kind().toUpperCase(Locale.US)) {
			case "RESUME" -> "Generate an ATS-friendly resume tailored to the target role. Use crisp bullets, active verbs, and truthful claims only.";
			case "COVER_LETTER" -> "Generate a concise, human-sounding cover letter tailored to the role and company.";
			case "LINKEDIN" -> "Generate a short professional LinkedIn message that sounds warm, specific, and respectful of the recipient's time.";
			case "RECRUITER_EMAIL" -> "Generate a recruiter email with a clear subject line, context, and a soft, professional call to action.";
			case "INTERVIEW_PREP" -> "Generate focused interview preparation notes with likely questions, sample answers, and role-specific talking points.";
			case "COMPANY_RESEARCH" -> "Generate a concise company brief with business context, likely tech stack, interview cues, and role alignment notes.";
			case "HUMANIZE" -> "Rewrite the text in a natural, human voice while preserving truthfulness and key facts.";
			default -> "Generate a polished career artifact.";
		};
		String userPrompt = buildUserPrompt(request);
		String content = unwrapAiResponse(aiProvider.generate(systemPrompt, userPrompt, Map.of(
			"subject", request.title(),
			"tone", request.tone() == null ? "clear, practical, and confident" : request.tone()
		)));

		GeneratedDocument document = new GeneratedDocument();
		document.setKind(request.kind().toUpperCase(Locale.US));
		document.setProvider(provider.name());
		document.setTitle(request.title());
		document.setContent(content);
		document.setMetadataJson(writeJson(Map.of(
			"jobTitle", request.jobTitle(),
			"company", request.company(),
			"tone", request.tone(),
			"sourceItemIds", request.sourceItemIds()
		)));
		return toGeneratedDto(generatedDocumentRepository.save(document));
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

	private String buildUserPrompt(GenerateRequest request) {
		Map<String, Object> context = new LinkedHashMap<>();
		context.put("title", request.title());
		context.put("company", request.company());
		context.put("jobTitle", request.jobTitle());
		context.put("tone", request.tone());
		context.put("jobDescription", request.jobDescription());
		context.put("sourceMaterials", request.sourceItemIds() == null ? List.of() : request.sourceItemIds().stream()
			.map(id -> workspaceItemRepository.findById(id).orElse(null))
			.filter(java.util.Objects::nonNull)
			.map(this::toDto)
			.toList());
		context.put("additionalContext", request.additionalContext());
		return writeJson(context);
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
		return "General";
	}

	private List<String> tokenize(String input) {
		return input == null ? List.of() : java.util.Arrays.stream(input.toLowerCase(Locale.US).split("[^a-z0-9+#.]+"))
			.filter(token -> token.length() > 2)
			.filter(token -> !STOP_WORDS.contains(token))
			.toList();
	}

	private String extractText(MultipartFile file) {
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
			return new String(file.getBytes());
		} catch (IOException exception) {
			throw new IllegalArgumentException("Unable to read uploaded file", exception);
		}
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

	public record JobDescriptionAnalysis(
		String rawText,
		List<String> skills,
		List<String> responsibilities,
		List<String> technologies,
		String domain,
		int matchScore,
		List<String> missingKeywords,
		List<String> suggestions
	) {}

	public record GenerateRequest(
		String kind,
		String title,
		String company,
		String jobTitle,
		String tone,
		String jobDescription,
		List<Long> sourceItemIds,
		String additionalContext,
		ProviderType provider
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
