package com.careeros.service;

import java.util.Map;

public interface AiProviderService {

	String providerName();

	String generate(String systemPrompt, String userPrompt, Map<String, Object> metadata);
}
