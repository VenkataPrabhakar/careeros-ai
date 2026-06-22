package com.careeros.web;

import com.careeros.domain.WorkspaceCategory;
import com.careeros.service.CareerWorkspaceService;
import com.careeros.service.CareerWorkspaceService.GenerateRequest;
import com.careeros.service.CareerWorkspaceService.ItemUpsertRequest;
import com.careeros.service.CareerWorkspaceService.SectionEditRequest;
import jakarta.validation.Valid;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
@RequestMapping("/api")
public class CareerController {

	private final CareerWorkspaceService careerWorkspaceService;

	@GetMapping("/workspace")
	public CareerWorkspaceService.WorkspaceSnapshot getWorkspace() {
		return careerWorkspaceService.getSnapshot();
	}

	@GetMapping("/providers")
	public List<String> getProviders() {
		return Arrays.stream(com.careeros.service.ProviderType.values()).map(Enum::name).toList();
	}

	@PostMapping("/items/{category}")
	@ResponseStatus(HttpStatus.CREATED)
	public CareerWorkspaceService.WorkspaceItemDto createItem(@PathVariable String category, @Valid @RequestBody ItemUpsertRequest request) {
		return careerWorkspaceService.saveItem(parseCategory(category), request);
	}

	@PutMapping("/items/{id}")
	public CareerWorkspaceService.WorkspaceItemDto updateItem(@PathVariable Long id, @Valid @RequestBody ItemUpsertRequest request) {
		return careerWorkspaceService.updateItem(id, request);
	}

	@DeleteMapping("/items/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void deleteItem(@PathVariable Long id) {
		careerWorkspaceService.deleteItem(id);
	}

	@GetMapping("/search")
	public List<CareerWorkspaceService.SearchResult> search(@RequestParam("q") String query) {
		return careerWorkspaceService.searchKnowledge(query);
	}

	@PostMapping("/analyze/resume")
	public CareerWorkspaceService.ResumeAnalysis analyzeResume(@RequestParam("file") MultipartFile file) {
		return careerWorkspaceService.analyzeResume(file);
	}

	@PostMapping("/analyze/job-description")
	public CareerWorkspaceService.JobDescriptionAnalysis analyzeJobDescription(
		@RequestParam(value = "text", required = false) String text,
		@RequestParam(value = "file", required = false) MultipartFile file
	) {
		return careerWorkspaceService.analyzeJobDescription(text, file);
	}

	@PostMapping("/generate")
	@ResponseStatus(HttpStatus.CREATED)
	public CareerWorkspaceService.GeneratedDocumentDto generate(@Valid @RequestBody GenerateRequest request) {
		return careerWorkspaceService.generateArtifact(request);
	}

	@PostMapping("/edit-section")
	public CareerWorkspaceService.SectionEditResponse editSection(@Valid @RequestBody SectionEditRequest request) {
		return careerWorkspaceService.editGeneratedSection(request);
	}

	@GetMapping("/health")
	public Map<String, String> health() {
		return Map.of("status", "ok");
	}

	private WorkspaceCategory parseCategory(String category) {
		return WorkspaceCategory.valueOf(category.toUpperCase(Locale.US));
	}
}
