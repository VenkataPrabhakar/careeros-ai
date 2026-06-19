package com.careeros.repository;

import com.careeros.domain.WorkspaceCategory;
import com.careeros.domain.WorkspaceItem;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkspaceItemRepository extends JpaRepository<WorkspaceItem, Long> {

	List<WorkspaceItem> findAllByCategoryOrderByUpdatedAtDesc(WorkspaceCategory category);
}
