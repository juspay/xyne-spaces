/**
 * Per-row category chip — used in agent rows and MCP rows. Pulls colors +
 * short label from the shared category registry so a "Code" chip looks
 * identical wherever it appears in the product.
 */

import {
  getCategoryDefinition,
  type AgentCategoryId,
} from "../../lib/agentCategory";

export interface CategoryChipProps {
  categoryId: AgentCategoryId;
  /** Optional override for the chip's data-id attribute prefix. */
  dataIdPrefix?: string;
}

export function CategoryChip({
  categoryId,
  dataIdPrefix = "category-chip",
}: CategoryChipProps) {
  const cat = getCategoryDefinition(categoryId);
  return (
    <span
      data-id={`${dataIdPrefix}-${cat.id}`}
      title={cat.label}
      className={`text-[11px] font-medium px-[8px] py-[1px] rounded-full border ${cat.chipClass}`}
    >
      {cat.shortLabel}
    </span>
  );
}
