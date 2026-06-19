package com.careeros.web;

import jakarta.persistence.EntityNotFoundException;
import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

	@ExceptionHandler(EntityNotFoundException.class)
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public Map<String, Object> handleNotFound(EntityNotFoundException exception) {
		return Map.of(
			"timestamp", Instant.now().toString(),
			"message", exception.getMessage()
		);
	}

	@ExceptionHandler({IllegalArgumentException.class, MethodArgumentNotValidException.class})
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public Map<String, Object> handleBadRequest(Exception exception) {
		return Map.of(
			"timestamp", Instant.now().toString(),
			"message", exception.getMessage()
		);
	}
}
