package com.careeros.repository;

import com.careeros.domain.GeneratedDocument;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GeneratedDocumentRepository extends JpaRepository<GeneratedDocument, Long> {

	List<GeneratedDocument> findTop20ByOrderByCreatedAtDesc();
}
