package com.careeros.web;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebCorsConfig implements WebMvcConfigurer {

	private final String[] allowedOrigins;

	public WebCorsConfig(@Value("${careeros.cors.allowed-origins:*}") String allowedOrigins) {
		this.allowedOrigins = Arrays.stream(allowedOrigins.split(","))
			.map(String::trim)
			.filter(StringUtils::hasText)
			.toArray(String[]::new);
	}

	@Override
	public void addCorsMappings(CorsRegistry registry) {
		if (allowedOrigins.length == 1 && "*".equals(allowedOrigins[0])) {
			registry.addMapping("/api/**")
				.allowedOriginPatterns("*")
				.allowedMethods("*")
				.allowedHeaders("*");
			return;
		}

		registry.addMapping("/api/**")
			.allowedOrigins(allowedOrigins)
			.allowedMethods("*")
			.allowedHeaders("*");
	}
}
