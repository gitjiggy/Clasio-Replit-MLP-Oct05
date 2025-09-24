import { useState } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import { DashboardModal } from "@uppy/react";
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

// Helper function to get file type from filename
const getFileTypeFromName = (filename: string): string => {
  const extension = filename.toLowerCase().split('.').pop();
  switch (extension) {
    case 'pdf': return 'pdf';
    case 'doc': case 'docx': return 'doc';
    case 'txt': return 'txt';
    case 'jpg': case 'jpeg': return 'jpg';
    case 'png': return 'png';
    case 'gif': return 'gif';
    case 'webp': return 'webp';
    case 'csv': return 'csv';
    case 'xlsx': case 'xls': return 'xlsx';
    case 'pptx': case 'ppt': return 'pptx';
    default: return 'txt';
  }
};

// Helper function to get Firebase ID token
const getFirebaseIdToken = async (): Promise<string> => {
  try {
    // Import the actual firebase function
    const { getGoogleAccessToken } = await import("@/lib/firebase");
    const idToken = await getGoogleAccessToken();
    return idToken || "";
  } catch (error) {
    console.error("Failed to get Firebase ID token:", error);
    return "";
  }
};

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  buttonClassName?: string;
  children: ReactNode;
  // Bulk upload support
  enableBulkUpload?: boolean;
  onGetBulkUploadParameters?: (fileNames: string[]) => Promise<{
    uploadURLs: Array<{ method: "PUT"; url: string }>;
    bulkUploadConfig: {
      folderId?: string | null;
      tagIds?: string[];
      analyzeImmediately?: boolean;
      message: string;
      funnyTip: string;
    };
  }>;
  onBulkUploadComplete?: (result: {
    successful: number;
    failed: number;
    details: Array<{ success: boolean; originalName: string; error?: string }>;
    message: string;
    aiAnalysis: {
      status: string;
      message: string;
      queueStatus: {
        pending: number;
        processing: number;
        completed: number;
        failed: number;
      };
    };
  }) => void;
}

/**
 * A file upload component that renders as a button and provides a modal interface for
 * file management.
 * 
 * Features:
 * - Renders as a customizable button that opens a file upload modal
 * - Provides a modal interface for:
 *   - File selection
 *   - File preview
 *   - Upload progress tracking
 *   - Upload status display
 * 
 * The component uses Uppy under the hood to handle all file upload functionality.
 * All file management features are automatically handled by the Uppy dashboard modal.
 * 
 * @param props - Component props
 * @param props.maxNumberOfFiles - Maximum number of files allowed to be uploaded
 *   (default: 1)
 * @param props.maxFileSize - Maximum file size in bytes (default: 10MB)
 * @param props.onGetUploadParameters - Function to get upload parameters (method and URL).
 *   Typically used to fetch a presigned URL from the backend server for direct-to-S3
 *   uploads.
 * @param props.onComplete - Callback function called when upload is complete. Typically
 *   used to make post-upload API calls to update server state and set object ACL
 *   policies.
 * @param props.buttonClassName - Optional CSS class name for the button
 * @param props.children - Content to be rendered inside the button
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
  enableBulkUpload = false,
  onGetBulkUploadParameters,
  onBulkUploadComplete,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  
  const [uppy] = useState(() => {
    const uppyInstance = new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
      },
      autoProceed: false,
    });

    if (enableBulkUpload && onGetBulkUploadParameters && onBulkUploadComplete) {
      // Bulk upload mode - custom upload handling
      uppyInstance.on("upload", async () => {
        setIsBulkUploading(true);
        try {
          const files = uppyInstance.getFiles();
          if (files.length === 0) return;

          // Get bulk upload URLs with rate limit error handling
          let bulkResponse;
          try {
            bulkResponse = await onGetBulkUploadParameters(files.map(file => file.name).filter((name): name is string => name !== undefined));
          } catch (error) {
            console.error("Error getting bulk upload URLs:", error);
            if (error instanceof Error && (error.message.includes("429") || error.message.includes("speed racer") || error.message.includes("Too many bulk uploads"))) {
              setUploadStatus("🐹 Our upload hamsters need a coffee break! Please wait a few minutes and try again.");
              setUploadProgress(0);
              setIsBulkUploading(false);
              setTimeout(() => {
                setUploadStatus("");
                setShowModal(false);
              }, 5000);
              return;
            }
            throw error;
          }
          
          // Upload files - try direct GCS first, fallback to server proxy on CORS errors
          const uploadPromises = files.map(async (file, index) => {
            try {
              const uploadURL = bulkResponse.uploadURLs[index];
              setUploadStatus(`📤 Uploading "${file.name}" - our digital postman is hard at work!`);
              setUploadProgress(40 + (index / files.length) * 40);
              
              try {
                // Try direct GCS upload first
                const response = await fetch(uploadURL.url, {
                  method: uploadURL.method || 'PUT',
                  body: file.data,
                  headers: {
                    'Content-Type': file.type || 'application/octet-stream',
                  },
                });
                
                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(`Direct upload failed: ${response.status} ${response.statusText} - ${errorText}`);
                }
                
                return {
                  success: true,
                  originalName: file.name || 'unknown',
                  uploadURL: uploadURL.url,
                  fileSize: file.size,
                  fileType: getFileTypeFromName(file.name || 'unknown'),
                  mimeType: file.type || 'application/octet-stream',
                };
              } catch (directUploadError) {
                // If direct upload fails (likely CORS), fallback to server-side upload
                console.warn(`Direct upload failed for ${file.name}, trying server proxy:`, directUploadError);
                setUploadStatus(`🔄 Retrying "${file.name}" via server proxy...`);
                
                const formData = new FormData();
                formData.append('file', file.data as File, file.name);
                
                const idToken = await getFirebaseIdToken();
                const proxyResponse = await fetch('/api/documents/upload-proxy', {
                  method: 'POST',
                  body: formData,
                  headers: {
                    'Authorization': `Bearer ${idToken}`,
                  },
                });
                
                if (!proxyResponse.ok) {
                  const errorText = await proxyResponse.text();
                  throw new Error(`Server proxy upload failed: ${proxyResponse.status} ${proxyResponse.statusText} - ${errorText}`);
                }
                
                const proxyResult = await proxyResponse.json();
                return {
                  success: true,
                  originalName: file.name || 'unknown',
                  objectPath: proxyResult.objectPath,
                  docId: proxyResult.docId,
                  fileSize: proxyResult.fileSize,
                  fileType: proxyResult.fileType,
                  mimeType: proxyResult.mimeType,
                };
              }
            } catch (error) {
              return {
                success: false,
                originalName: file.name || 'unknown',
                error: error instanceof Error ? error.message : String(error),
              };
            }
          });
          
          const uploadResults = await Promise.all(uploadPromises);
          const successful = uploadResults.filter(r => r.success);
          const failed = uploadResults.filter(r => !r.success);
          
          setUploadStatus("🎉 Files uploaded! Now registering them in our digital library...");
          setUploadProgress(80);
          
          // Create documents via bulk API
          if (successful.length > 0) {
            const documentsData = successful.map(result => ({
              uploadURL: (result as any).uploadURL,
              name: result.originalName.replace(/\.[^/.]+$/, ""), // Remove extension
              originalName: result.originalName,
              fileSize: (result as any).fileSize,
              fileType: (result as any).fileType,
              mimeType: (result as any).mimeType,
            }));
            
            try {
              const requestBody = {
                documents: documentsData,
                folderId: bulkResponse.bulkUploadConfig.folderId,
                tagIds: bulkResponse.bulkUploadConfig.tagIds,
                analyzeImmediately: bulkResponse.bulkUploadConfig.analyzeImmediately,
              };
              
              
              // Get fresh Firebase token using the same method as bulk-upload-urls
              const { auth } = await import("@/lib/firebase");
              const firebaseToken = auth.currentUser ? await auth.currentUser.getIdToken() : "";
              
              const response = await fetch('/api/documents/bulk', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${firebaseToken}`,
                },
                body: JSON.stringify(requestBody),
              });
              
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error('Bulk document creation failed:', response.status, response.statusText);
                throw new Error(`Bulk document creation failed: ${response.status} ${response.statusText} - ${errorText}`);
              }
              
              const bulkResult = await response.json();
              
              setUploadStatus("🎊 Success! Your documents are now safely stored and ready for AI analysis!");
              setUploadProgress(100);
              
              // Show completion message for a moment
              setTimeout(() => {
                onBulkUploadComplete({
                  successful: successful.length,
                  failed: failed.length,
                  details: uploadResults,
                  message: bulkResult.message,
                  aiAnalysis: bulkResult.aiAnalysis,
                });
                
                // Clear files from Uppy and close modal
                uppyInstance.cancelAll();
                setShowModal(false);
                setUploadStatus("");
                setUploadProgress(0);
              }, 2000);
            } catch (error) {
              console.error('Bulk document creation failed:', error instanceof Error ? error.message : String(error));
              
              // Handle bulk creation failure with user-friendly message
              setUploadStatus("⚠️ Files uploaded but failed to register in database. Contact support if this persists.");
              setUploadProgress(100);
              
              // Still notify about upload completion but with error details
              setTimeout(() => {
                onBulkUploadComplete({
                  successful: 0, // Mark as failed since database creation failed
                  failed: successful.length,
                  details: successful.map(result => ({
                    ...result,
                    success: false,
                    error: `Database registration failed: ${error instanceof Error ? error.message : String(error)}`
                  })),
                  message: "Files uploaded to storage but database registration failed",
                  aiAnalysis: {
                    status: "failed",
                    message: "Database registration failed - no AI analysis performed",
                    queueStatus: { pending: 0, processing: 0, completed: 0, failed: successful.length }
                  },
                });
                
                // Clear files from Uppy and close modal
                uppyInstance.cancelAll();
                setShowModal(false);
                setUploadStatus("");
                setUploadProgress(0);
              }, 3000);
            }
          }
        } catch (error) {
          console.error('Bulk upload failed:', error);
        } finally {
          setIsBulkUploading(false);
        }
      });
    } else {
      // Single upload mode - use existing AWS S3 plugin
      uppyInstance
        .use(AwsS3, {
          shouldUseMultipart: false,
          getUploadParameters: onGetUploadParameters,
        })
        .on("complete", (result) => {
          onComplete?.(result);
        });
    }
    
    return uppyInstance;
  });

  return (
    <div>
      <Button 
        onClick={() => setShowModal(true)} 
        className={buttonClassName}
        disabled={isBulkUploading}
        data-testid="button-upload"
      >
        {isBulkUploading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Uploading...
          </>
        ) : (
          children
        )}
      </Button>

      {/* Upload Status Overlay */}
      {isBulkUploading && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="text-center space-y-4">
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {uploadStatus || "Processing your files..."}
              </div>
              
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {uploadProgress}% complete
              </div>
              
              {uploadProgress < 100 && (
                <div className="text-xs text-gray-500 dark:text-gray-500">
                  Please don't close this window while we work our magic! ✨
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
