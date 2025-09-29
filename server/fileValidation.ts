// Conservative File Size Limits (20MB Maximum)
// Enhanced File Validation with Friendly Errors

import multer from 'multer';
import path from 'path';
import { randomBytes } from 'crypto';

export const FILE_SIZE_LIMITS = {
  // All file types capped at 20MB - no exceptions!
  'application/pdf': 20 * 1024 * 1024,
  'image/jpeg': 20 * 1024 * 1024,
  'image/png': 20 * 1024 * 1024,
  'image/gif': 20 * 1024 * 1024,
  'image/webp': 20 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 20 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 20 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 20 * 1024 * 1024,
  'application/vnd.ms-excel': 20 * 1024 * 1024,
  'application/msword': 20 * 1024 * 1024,
  'application/vnd.ms-powerpoint': 20 * 1024 * 1024,
  'text/plain': 20 * 1024 * 1024,
  'text/csv': 20 * 1024 * 1024,
  'default': 20 * 1024 * 1024 // Universal 20MB limit
} as const;

// Quirky file size error messages
const FILE_SIZE_ERROR_MESSAGES = [
  "Whoa there, speed racer! 🏎️ That file is larger than our servers can handle. Keep it under 20MB and we'll be best friends! 🤝",
  "Houston, we have a problem! 🚀 Your file is too big for our digital filing cabinet. Try compressing it or splitting it into smaller chunks! 📁✂️",
  "That file is chonkier than a well-fed cat! 🐱‍👤 Please slim it down to under 20MB so our servers don't get indigestion! 🤖💊",
  "Your file is throwing our servers a surprise party they weren't ready for! 🎉 Keep it under 20MB and everyone stays happy! 😄",
  "Plot twist: Your file is bigger than some movies! 🎬 Let's keep things snappy with files under 20MB, shall we? 🎭",
  "Our servers are on a diet! 🥗 They can only digest files smaller than 20MB. Help them stay healthy! 💪",
  "That file is like trying to fit an elephant through a mouse hole! 🐘🕳️ Compress it to under 20MB and watch the magic happen! ✨"
];

export function getFileSizeLimit(mimeType: string): number {
  return FILE_SIZE_LIMITS[mimeType as keyof typeof FILE_SIZE_LIMITS] || FILE_SIZE_LIMITS.default;
}

export function validateFileSize(fileSize: number, mimeType: string, fileName?: string): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const limit = getFileSizeLimit(mimeType);

  if (fileSize > limit) {
    const fileMB = Math.round(fileSize / (1024 * 1024) * 10) / 10;
    const limitMB = Math.round(limit / (1024 * 1024));

    // Pick a random quirky message
    const quirkMessage = FILE_SIZE_ERROR_MESSAGES[Math.floor(Math.random() * FILE_SIZE_ERROR_MESSAGES.length)];

    return {
      valid: false,
      error: `${quirkMessage}\n\n📊 File details:\n• Your file: ${fileName || 'Unknown'} (${fileMB}MB)\n• Our limit: ${limitMB}MB\n• Overage: ${(fileMB - limitMB).toFixed(1)}MB\n\n💡 Try compressing your file or splitting it into smaller parts!`,
      details: {
        fileName: fileName || 'Unknown',
        fileSize: fileSize,
        fileSizeMB: fileMB,
        limit: limit,
        limitMB: limitMB,
        overageMB: fileMB - limitMB
      }
    };
  }

  return { valid: true };
}

// Enhanced Multer configuration
export function createUploadMiddleware() {
  // Ensure /tmp directory exists for disk storage
  const tmpDir = path.join(process.cwd(), 'tmp');
  
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, tmpDir);
      },
      filename: (req, file, cb) => {
        // Generate unique filename with original extension
        const uniqueSuffix = Date.now() + '-' + randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
      }
    }),
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB hard limit
      files: 1,
      fieldSize: 2 * 1024 * 1024, // 2MB for form fields
      fieldNameSize: 100, // Field name length
      fields: 10 // Max number of fields
    },
    fileFilter: (req, file, cb) => {
      // Basic file type validation
      const allowedMimeTypes = Object.keys(FILE_SIZE_LIMITS);

      if (!allowedMimeTypes.includes(file.mimetype) && file.mimetype !== 'application/octet-stream') {
        const error = new Error(`File type ${file.mimetype} is not supported! 📄❌ We support PDFs, Office docs, images, and text files. 📋✅`);
        (error as any).code = 'UNSUPPORTED_FILE_TYPE';
        return cb(error as any, false);
      }

      console.log(`📁 Upload attempt: ${file.originalname}, MIME: ${file.mimetype}`);
      cb(null, true);
    }
  });
}

// Multer error handler with quirky messages
export function multerErrorHandler(error: any, req: any, res: any, next: any) {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        const fileMB = req.file ? Math.round(req.file.size / (1024 * 1024) * 10) / 10 : 'Unknown';
        const quirkMessage = FILE_SIZE_ERROR_MESSAGES[Math.floor(Math.random() * FILE_SIZE_ERROR_MESSAGES.length)];
        return res.status(413).json({
          error: 'File too large',
          message: `${quirkMessage}\n\n📊 Your file: ${fileMB}MB\n• Our limit: 20MB\n\n💡 Try compressing your file or splitting it into smaller parts!`,
          code: 'FILE_TOO_LARGE',
          details: {
            maxSize: '20MB',
            actualSize: `${fileMB}MB`
          }
        });
        
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          error: 'Too many files',
          message: 'One file at a time, please! 📂✋ We can only handle one file per upload to keep things organized.',
          code: 'TOO_MANY_FILES'
        });
        
      case 'LIMIT_FIELD_COUNT':
        return res.status(400).json({
          error: 'Too many fields',
          message: 'Whoa there! 📝 You have too many form fields. Keep it simple and try again!',
          code: 'TOO_MANY_FIELDS'
        });
        
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: 'Unexpected file',
          message: 'Surprise files are fun, but not here! 🎁❌ Make sure you\'re uploading to the right field.',
          code: 'UNEXPECTED_FILE'
        });
        
      default:
        return res.status(400).json({
          error: 'Upload error',
          message: 'Something went sideways with your upload! 🤷‍♂️ Try again, and if it keeps happening, let us know!',
          code: error.code || 'UPLOAD_ERROR'
        });
    }
  }

  // Handle custom file validation errors
  if (error.code === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(400).json({
      error: 'Unsupported file type',
      message: error.message,
      code: 'UNSUPPORTED_FILE_TYPE'
    });
  }

  // Generic error fallback
  console.error('Unexpected upload error:', error);
  return res.status(500).json({
    error: 'Server error',
    message: 'Our servers are having a moment! 😅 Please try again in a few seconds.',
    code: 'INTERNAL_SERVER_ERROR'
  });
}