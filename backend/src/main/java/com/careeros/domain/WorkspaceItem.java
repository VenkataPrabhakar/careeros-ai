package com.careeros.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "workspace_items")
public class WorkspaceItem {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 40)
	private WorkspaceCategory category;

	@Column(nullable = false)
	private String title;

	@Column
	private String organization;

	@Column
	private String status;

	@Column(name = "tags_json", columnDefinition = "TEXT", nullable = false)
	private String tagsJson = "[]";

	@Column(name = "content_json", columnDefinition = "TEXT", nullable = false)
	private String contentJson = "{}";

	@Column(columnDefinition = "TEXT")
	private String notes;

	@Column
	private LocalDate startDate;

	@Column
	private LocalDate endDate;

	@Column
	private Integer priority;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	@Column(nullable = false)
	private Instant updatedAt;

	@PrePersist
	void onCreate() {
		Instant now = Instant.now();
		createdAt = now;
		updatedAt = now;
	}

	@PreUpdate
	void onUpdate() {
		updatedAt = Instant.now();
	}
}
