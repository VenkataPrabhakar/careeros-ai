package com.careeros.service;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class AiProviderFactory {

	private final Map<ProviderType, AiProviderService> providers = new EnumMap<>(ProviderType.class);

	public AiProviderFactory(List<AiProviderService> providerServices) {
		for (AiProviderService provider : providerServices) {
			providers.put(ProviderType.valueOf(provider.providerName()), provider);
		}
	}

	public AiProviderService getProvider(ProviderType providerType) {
		return providers.get(providerType);
	}
}
