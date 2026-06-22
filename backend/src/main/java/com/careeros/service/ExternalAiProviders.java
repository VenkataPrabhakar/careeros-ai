package com.careeros.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.springframework.ai.chat.prompt.PromptTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.reactive.function.client.WebClient;

abstract class BaseProviderService implements AiProviderService {

	private final WebClient webClient;
	private final String apiKey;
	private final ObjectMapper objectMapper = new ObjectMapper();

	protected BaseProviderService(WebClient.Builder builder, String baseUrl, String apiKey) {
		this.webClient = builder.baseUrl(baseUrl).build();
		this.apiKey = apiKey;
	}

	protected boolean hasApiKey() {
		return apiKey != null && !apiKey.isBlank();
	}

	protected String apiKey() {
		return apiKey;
	}

	protected WebClient webClient() {
		return webClient;
	}

	protected String fallback(String systemPrompt, String userPrompt, Map<String, Object> metadata) {
		String subject = String.valueOf(metadata.getOrDefault("subject", "career artifact"));
		String tone = String.valueOf(metadata.getOrDefault("tone", "clear, grounded, and specific"));
		PromptTemplate promptTemplate = new PromptTemplate("""
			You are a careful career writing assistant.
			System intent: {systemPrompt}
			User request: {userPrompt}
			Subject: {subject}
			Tone: {tone}

			Write a polished output with concise sections, specific language, and realistic phrasing.
			Do not invent employers, metrics, or technologies that are not in the prompt.
			""");
		return promptTemplate.render(Map.of(
			"systemPrompt", systemPrompt,
			"userPrompt", userPrompt,
			"subject", subject,
			"tone", tone
		));
	}

	protected String postJson(String uri, Object body, String authHeader) {
		return webClient.post()
			.uri(uri)
			.header(HttpHeaders.AUTHORIZATION, authHeader)
			.contentType(MediaType.APPLICATION_JSON)
			.bodyValue(body)
			.retrieve()
			.bodyToMono(String.class)
			.block();
	}

	protected String parseOpenAiResponse(String rawJson) {
		try {
			Map<String, Object> root = objectMapper.readValue(rawJson, new TypeReference<>() {});
			Object outputText = root.get("output_text");
			if (outputText instanceof String text && !text.isBlank()) {
				return text;
			}
			Object output = root.get("output");
			if (output instanceof List<?> items) {
				StringBuilder builder = new StringBuilder();
				for (Object item : items) {
					if (item instanceof Map<?, ?> itemMap) {
						Object content = itemMap.get("content");
						if (content instanceof List<?> contentItems) {
							for (Object contentItem : contentItems) {
								if (contentItem instanceof Map<?, ?> contentMap) {
									Object textValue = contentMap.get("text");
									if (textValue instanceof String text && !text.isBlank()) {
										if (!builder.isEmpty()) {
											builder.append("\n");
										}
										builder.append(text);
									}
								}
							}
						}
					}
				}
				if (!builder.isEmpty()) {
					return builder.toString();
				}
			}
			return rawJson;
		} catch (Exception exception) {
			return rawJson;
		}
	}

	protected String extractApiErrorMessage(String rawJson, String fallbackMessage) {
		try {
			Map<String, Object> root = objectMapper.readValue(rawJson, new TypeReference<>() {});
			Object error = root.get("error");
			if (error instanceof Map<?, ?> errorMap) {
				Object message = errorMap.get("message");
				if (message instanceof String text && !text.isBlank()) {
					return text;
				}
			}
		} catch (Exception ignored) {
			// fall through to fallback
		}
		return fallbackMessage;
	}
}

@Service
class OpenAiProviderService extends BaseProviderService {

	OpenAiProviderService(WebClient.Builder builder, @Value("${OPENAI_API_KEY:}") String apiKey) {
		super(builder, "https://api.openai.com/v1", apiKey);
	}

	@Override
	public String providerName() {
		return ProviderType.OPENAI.name();
	}

	@Override
	public String generate(String systemPrompt, String userPrompt, Map<String, Object> metadata) {
		if (!hasApiKey()) {
			return fallback(systemPrompt, userPrompt, metadata);
		}
		Map<String, Object> payload = Map.of(
			"model", "gpt-4.1-mini",
			"input", java.util.List.of(
				Map.of("role", "system", "content", systemPrompt),
				Map.of("role", "user", "content", userPrompt)
			)
		);
		try {
			String rawJson = postJson("/responses", payload, "Bearer " + apiKey());
			return parseOpenAiResponse(rawJson);
		} catch (WebClientResponseException exception) {
			String message = extractApiErrorMessage(exception.getResponseBodyAsString(), "OpenAI request failed");
			throw new IllegalStateException("OpenAI API error: " + message, exception);
		} catch (Exception exception) {
			throw new IllegalStateException("OpenAI request failed: " + exception.getMessage(), exception);
		}
	}
}

@Service
class ClaudeProviderService extends BaseProviderService {

	ClaudeProviderService(WebClient.Builder builder, @Value("${ANTHROPIC_API_KEY:}") String apiKey) {
		super(builder, "https://api.anthropic.com/v1", apiKey);
	}

	@Override
	public String providerName() {
		return ProviderType.CLAUDE.name();
	}

	@Override
	public String generate(String systemPrompt, String userPrompt, Map<String, Object> metadata) {
		if (!hasApiKey()) {
			return fallback(systemPrompt, userPrompt, metadata);
		}
		return webClient().post()
			.uri("/messages")
			.header("x-api-key", apiKey())
			.header("anthropic-version", "2023-06-01")
			.contentType(MediaType.APPLICATION_JSON)
			.bodyValue(Map.of(
				"model", "claude-3-5-sonnet-latest",
				"max_tokens", 1200,
				"system", systemPrompt,
				"messages", java.util.List.of(Map.of("role", "user", "content", userPrompt))
			))
			.retrieve()
			.bodyToMono(String.class)
			.block();
	}
}

@Service
class GeminiProviderService extends BaseProviderService {

	GeminiProviderService(WebClient.Builder builder, @Value("${GEMINI_API_KEY:}") String apiKey) {
		super(builder, "https://generativelanguage.googleapis.com/v1beta", apiKey);
	}

	@Override
	public String providerName() {
		return ProviderType.GEMINI.name();
	}

	@Override
	public String generate(String systemPrompt, String userPrompt, Map<String, Object> metadata) {
		if (!hasApiKey()) {
			return fallback(systemPrompt, userPrompt, metadata);
		}
		return webClient().post()
			.uri(uriBuilder -> uriBuilder.path("/models/gemini-1.5-flash:generateContent")
				.queryParam("key", apiKey())
				.build())
			.contentType(MediaType.APPLICATION_JSON)
			.bodyValue(Map.of(
				"system_instruction", Map.of("parts", java.util.List.of(Map.of("text", systemPrompt))),
				"contents", java.util.List.of(Map.of("parts", java.util.List.of(Map.of("text", userPrompt))))
			))
			.retrieve()
			.bodyToMono(String.class)
			.block();
	}
}

@Service
class PerplexityProviderService extends BaseProviderService {

	PerplexityProviderService(WebClient.Builder builder, @Value("${PERPLEXITY_API_KEY:}") String apiKey) {
		super(builder, "https://api.perplexity.ai", apiKey);
	}

	@Override
	public String providerName() {
		return ProviderType.PERPLEXITY.name();
	}

	@Override
	public String generate(String systemPrompt, String userPrompt, Map<String, Object> metadata) {
		if (!hasApiKey()) {
			return fallback(systemPrompt, userPrompt, metadata);
		}
		return postJson("/chat/completions", Map.of(
			"model", "sonar",
			"messages", java.util.List.of(
				Map.of("role", "system", "content", systemPrompt),
				Map.of("role", "user", "content", userPrompt)
			)
		), "Bearer " + apiKey());
	}
}
