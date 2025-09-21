import { Request, Response, NextFunction } from 'express';
import { logger } from './logging';
import { ScopedDB } from '../db/scopedQueries';

/**
 * SMB-Enhanced: Comprehensive file validation and security service
 * Provides tiered file limits, enhanced MIME validation, storage quotas, and security checks
 */

// SMB-focused file size limits by tier (in bytes)
export const FILE_SIZE_LIMITS = {
  free: 10 * 1024 * 1024,      // 10MB for free tier
  pro: 50 * 1024 * 1024,       // 50MB for pro tier  
  enterprise: 100 * 1024 * 1024 // 100MB for enterprise tier
};

// SMB-focused storage quotas by tier (in MB)
export const STORAGE_QUOTAS = {
  free: 5 * 1024,        // 5GB storage
  pro: 50 * 1024,        // 50GB storage
  enterprise: 500 * 1024  // 500GB storage
};

// Enhanced MIME type validation with security focus
export const ALLOWED_MIME_TYPES = {
  // Document types (core SMB documents)
  documents: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/rtf'
  ],
  
  // Image types (business graphics, scanned documents)
  images: [
    'image/jpeg',
    'image/png', 
    'image/gif',
    'image/webp',
    'image/tiff',
    'image/bmp'
  ],
  
  // Archive types (for bulk document sharing)
  archives: [
    'application/zip',
    'application/x-zip-compressed'
  ],
  
  // Text formats (common in SMB workflows)
  text: [
    'text/plain',
    'text/csv',
    'application/json'
  ]
};

// Get all allowed MIME types
export const ALL_ALLOWED_MIME_TYPES = [
  ...ALLOWED_MIME_TYPES.documents,
  ...ALLOWED_MIME_TYPES.images,
  ...ALLOWED_MIME_TYPES.archives,
  ...ALLOWED_MIME_TYPES.text
];

// Magic number validation for enhanced security
const MAGIC_NUMBERS: Record<string, Buffer[]> = {
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  'application/zip': [Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from([0x50, 0x4B, 0x05, 0x06])],
  'image/gif': [Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
};

// Security patterns to detect potentially malicious files
const SECURITY_PATTERNS = {
  // Common executable file signatures that should never be allowed
  maliciousSignatures: [
    Buffer.from([0x4D, 0x5A]), // PE/DOS executable
    Buffer.from([0x7F, 0x45, 0x4C, 0x46]), // ELF executable  
    Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]), // Java class file
    Buffer.from([0xFE, 0xED, 0xFA]), // Mach-O executable
  ],
  
  // Suspicious filename patterns
  suspiciousExtensions: [
    '.exe', '.scr', '.bat', '.cmd', '.com', '.vbs', '.js', '.jar',
    '.app', '.deb', '.rpm', '.dmg', '.pkg', '.msi', '.ps1'
  ],
  
  // Double extension attacks (e.g., document.pdf.exe)
  doubleExtensionPattern: /\.[a-zA-Z0-9]{2,4}\.(exe|scr|bat|cmd|com|vbs|js|jar|app|deb|rpm|dmg|pkg|msi|ps1)$/i
};

/**
 * Enhanced file validation service
 */
export class FileValidationService {
  
  /**
   * Get file size limit for organization tier
   */
  static getFileSizeLimit(tier: string): number {
    return FILE_SIZE_LIMITS[tier as keyof typeof FILE_SIZE_LIMITS] || FILE_SIZE_LIMITS.free;
  }
  
  /**
   * Get storage quota for organization tier  
   */
  static getStorageQuota(tier: string): number {
    return STORAGE_QUOTAS[tier as keyof typeof STORAGE_QUOTAS] || STORAGE_QUOTAS.free;
  }
  
  /**
   * Validate file against security patterns and magic numbers
   */
  static async validateFileContent(buffer: Buffer, filename: string, mimeType: string): Promise<{
    isValid: boolean;
    reason?: string;
    securityRisk?: string;
  }> {
    try {
      // Check for suspicious filename patterns
      const suspiciousExt = SECURITY_PATTERNS.suspiciousExtensions.find(ext => 
        filename.toLowerCase().endsWith(ext)
      );
      if (suspiciousExt) {
        logger.security('suspicious_file_extension_blocked', { filename, extension: suspiciousExt });
        return {
          isValid: false,
          reason: 'Executable file extensions are not allowed',
          securityRisk: `Suspicious extension: ${suspiciousExt}`
        };
      }
      
      // Check for double extension attacks
      if (SECURITY_PATTERNS.doubleExtensionPattern.test(filename)) {
        logger.security('double_extension_attack_blocked', { filename });
        return {
          isValid: false,
          reason: 'Double extension files are not allowed',
          securityRisk: 'Potential double extension attack'
        };
      }
      
      // Check for malicious file signatures
      for (const maliciousSig of SECURITY_PATTERNS.maliciousSignatures) {
        if (buffer.subarray(0, maliciousSig.length).equals(maliciousSig)) {
          logger.security('malicious_signature_blocked', { filename, mimeType });
          return {
            isValid: false,
            reason: 'File contains executable code',
            securityRisk: 'Malicious binary signature detected'
          };
        }
      }
      
      // Validate magic numbers for supported types
      if (MAGIC_NUMBERS[mimeType]) {
        const expectedMagicNumbers = MAGIC_NUMBERS[mimeType];
        const isValidMagic = expectedMagicNumbers.some(magic => 
          buffer.subarray(0, magic.length).equals(magic)
        );
        
        if (!isValidMagic) {
          logger.security('magic_number_mismatch', { filename, mimeType, expectedMagic: expectedMagicNumbers });
          return {
            isValid: false,
            reason: 'File content does not match declared type',
            securityRisk: 'MIME type spoofing attempt'
          };
        }
      }
      
      return { isValid: true };
      
    } catch (error) {
      logger.error('File validation error', error);
      return {
        isValid: false,
        reason: 'File validation failed',
        securityRisk: 'Unable to validate file security'
      };
    }
  }
  
  /**
   * Validate file upload against organization quotas and limits
   */
  static async validateUpload(
    organizationId: string,
    fileSize: number,
    mimeType: string,
    filename: string,
    currentStorageUsed: number,
    organizationTier: string
  ): Promise<{
    isValid: boolean;
    reason?: string;
    quotaExceeded?: boolean;
  }> {
    try {
      // Check file size limit for tier
      const maxFileSize = this.getFileSizeLimit(organizationTier);
      if (fileSize > maxFileSize) {
        logger.business('file_size_limit_exceeded', {
          organizationId,
          fileSize,
          maxFileSize,
          tier: organizationTier,
          filename
        });
        return {
          isValid: false,
          reason: `File size ${Math.round(fileSize / 1024 / 1024)}MB exceeds ${organizationTier} tier limit of ${Math.round(maxFileSize / 1024 / 1024)}MB`,
          quotaExceeded: true
        };
      }
      
      // Check storage quota
      const maxStorage = this.getStorageQuota(organizationTier);
      const fileSizeMb = Math.ceil(fileSize / 1024 / 1024);
      
      if ((currentStorageUsed + fileSizeMb) > maxStorage) {
        logger.business('storage_quota_exceeded', {
          organizationId,
          currentStorageUsed,
          fileSizeMb,
          maxStorage,
          tier: organizationTier,
          filename
        });
        return {
          isValid: false,
          reason: `Upload would exceed ${organizationTier} tier storage quota of ${Math.round(maxStorage / 1024)}GB. Current usage: ${Math.round(currentStorageUsed / 1024)}GB`,
          quotaExceeded: true
        };
      }
      
      // Check MIME type
      if (!ALL_ALLOWED_MIME_TYPES.includes(mimeType)) {
        logger.security('invalid_mime_type_blocked', {
          organizationId,
          mimeType,
          filename
        });
        return {
          isValid: false,
          reason: `File type ${mimeType} is not allowed`
        };
      }
      
      return { isValid: true };
      
    } catch (error) {
      logger.error('Upload validation error', error, { organizationId, filename });
      return {
        isValid: false,
        reason: 'Upload validation failed'
      };
    }
  }
}

/**
 * SMB-Enhanced: File validation middleware for Express routes
 */
export function validateFileUpload() {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.organizationId;
      
      if (!organizationId) {
        logger.warn('File upload attempted without organization context');
        return res.status(400).json({ error: 'Organization context required for file upload' });
      }
      
      // Get organization details from database
      const organization = await ScopedDB.getOrganization(organizationId);
      if (!organization) {
        logger.warn('Organization not found for file upload', { organizationId });
        return res.status(400).json({ error: 'Invalid organization context' });
      }
      
      // For routes with file upload, validate each file
      if (req.file) {
        // Single file upload (multer single)
        const file = req.file;
        
        const validation = await FileValidationService.validateUpload(
          organizationId,
          file.size,
          file.mimetype,
          file.originalname,
          organization.storageUsedMb || 0,
          organization.plan || 'free'
        );
        
        if (!validation.isValid) {
          logger.business('file_upload_rejected', {
            organizationId,
            filename: file.originalname,
            reason: validation.reason,
            quotaExceeded: validation.quotaExceeded
          });
          
          return res.status(validation.quotaExceeded ? 413 : 400).json({
            error: validation.reason,
            quotaExceeded: validation.quotaExceeded,
            tier: organization.plan || 'free'
          });
        }
        
        // Validate file content
        if (file.buffer) {
          const contentValidation = await FileValidationService.validateFileContent(
            file.buffer,
            file.originalname,
            file.mimetype
          );
          
          if (!contentValidation.isValid) {
            logger.security('file_content_validation_failed', {
              organizationId,
              filename: file.originalname,
              reason: contentValidation.reason,
              securityRisk: contentValidation.securityRisk
            });
            
            return res.status(400).json({
              error: contentValidation.reason,
              securityRisk: contentValidation.securityRisk
            });
          }
        }
      } else if (req.files && Array.isArray(req.files)) {
        // Multiple file uploads (multer array)
        for (const file of req.files) {
          const validation = await FileValidationService.validateUpload(
            organizationId,
            file.size,
            file.mimetype,
            file.originalname,
            organization.storageUsedMb || 0,
            organization.plan || 'free'
          );
          
          if (!validation.isValid) {
            logger.business('file_upload_rejected', {
              organizationId,
              filename: file.originalname,
              reason: validation.reason,
              quotaExceeded: validation.quotaExceeded
            });
            
            return res.status(validation.quotaExceeded ? 413 : 400).json({
              error: validation.reason,
              quotaExceeded: validation.quotaExceeded,
              tier: organization.plan || 'free'
            });
          }
          
          // Validate file content
          if (file.buffer) {
            const contentValidation = await FileValidationService.validateFileContent(
              file.buffer,
              file.originalname,
              file.mimetype
            );
            
            if (!contentValidation.isValid) {
              logger.security('file_content_validation_failed', {
                organizationId,
                filename: file.originalname,
                reason: contentValidation.reason,
                securityRisk: contentValidation.securityRisk
              });
              
              return res.status(400).json({
                error: contentValidation.reason,
                securityRisk: contentValidation.securityRisk
              });
            }
          }
        }
      }
      
      next();
      
    } catch (error) {
      logger.error('File validation middleware error', error);
      res.status(500).json({ error: 'File validation failed' });
    }
  };
}