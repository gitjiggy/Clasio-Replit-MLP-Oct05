import type { DocumentWithFolderAndTags } from "@shared/schema";

// Extended document type that includes version information
export interface DocumentWithVersionInfo extends DocumentWithFolderAndTags {
  currentVersionNumber?: number;
  versionCount?: number;
}

/**
 * Generate display name for documents using AI concise name with version suffix
 * @param document - Document with optional version information
 * @returns Display name with version suffix if multiple versions exist
 */
export function getDocumentDisplayName(document: DocumentWithVersionInfo): string {
  // Use AI-generated concise name if available, otherwise fall back to document name
  const baseName = document.aiConciseName || document.name;
  
  // Add version suffix only when multiple versions exist
  if (document.versionCount && document.versionCount > 1 && document.currentVersionNumber) {
    return `${baseName} v${document.currentVersionNumber}`;
  }
  
  return baseName;
}

/**
 * Get tooltip text for document display
 * @param document - Document with optional version information  
 * @returns Tooltip text showing original filename when AI name is used
 */
export function getDocumentTooltip(document: DocumentWithVersionInfo): string {
  if (document.aiConciseName) {
    return `Original: ${document.originalName || document.name}`;
  }
  return document.name;
}