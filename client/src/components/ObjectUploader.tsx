import { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Eye, ArrowRight, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Upload state machine
type UploadState = "idle" | "signing" | "uploading" | "finalizing" | "analyzing" | "done" | "error";

// Duplicate detection modal state
interface DuplicateModalState {
  isOpen: boolean;
  file?: File;
  duplicateInfo?: {
    message: string;
    duplicateCount: number;
    existingDocs: Array<{
      id: string;
      name: string;
      uploadDate: string;
    }>;
  };
  onResolve?: (decision: 'view' | 'proceed' | 'cancel') => void;
}

// Helper function to get file type from filename
const getFileTypeFromName = (filename: string): string => {
  const extension = filename.toLowerCase().split('.').pop();
  switch (extension) {
    case 'pdf': return 'pdf';
    case 'doc': case 'docx': return 'docx';
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

// Rotating flavor text for each upload stage
const FLAVOR = {
  signing: [
    "Filing the intergalactic paperwork for your files…",
    "Calculating the perfect trajectory for your documents…",
    "Asking the cloud politely to prepare some storage space…",
    "Summoning digital carrier pigeons for your files…",
    "Teaching your documents proper cloud etiquette…",
    "Booking first-class tickets to the cloud…",
    "Negotiating with the internet for safe passage…",
  ],
  uploading: [
    "Transmogrifying your files through quantum tubes…",
    "Packing bits into tiny suitcases…",
    "Politely asking the cloud to hold these for you…",
    "Teaching your files how to fly through the internet…",
    "Zipping your documents through our digital pneumatic tubes…",
  ],
  finalizing: [
    "Stamping passports and checking in metadata…",
    "Teaching your docs to introduce themselves nicely…",
    "Arranging your files in our digital filing cabinet…",
    "Making sure everything has a proper home…",
  ],
  analyzing: [
    "Letting our librarian-bot skim the highlights…",
    "Extracting wisdom with gentle robot hands…",
    "Teaching our AI to read between the lines…",
  ],
  done: ["All set! High-fives delivered."],
  error: ["Uh-oh. The cloud sneezed. Let's retry."]
} as const;

// Custom hook for rotating flavor text
function useFlavor(state: UploadState) {
  const [idx, setIdx] = useState(0);
  
  useEffect(() => {
    if (state === "done" || state === "error" || state === "idle") return;
    
    const arr = FLAVOR[state] || ["Working…"];
    const timer = setInterval(() => {
      setIdx(i => (i + 1) % arr.length);
    }, 2500);
    
    return () => clearInterval(timer);
  }, [state]);
  
  const arr = FLAVOR[state] || ["Working…"];
  return arr[idx] || "Working…";
}

// Concurrency helper for parallel uploads with abort support
async function uploadAllWithConcurrency(
  signed: { url: string; method: string; headers: Record<string, string>; objectPath: string }[],
  files: File[],
  abortSignal?: AbortSignal,
  limit = 5
): Promise<void> {
  const queue = [...files.keys()];
  let active = 0;
  let firstError: any = null;

  return new Promise<void>((resolve, reject) => {
    // Set up abort handler to resolve gracefully when cancelled
    const abortHandler = () => {
      console.log("🚫 Upload cancelled - resolving gracefully");
      resolve();
    };
    
    if (abortSignal) {
      // If already aborted, resolve gracefully
      if (abortSignal.aborted) {
        console.log("🚫 Signal already aborted - resolving gracefully");
        resolve();
        return;
      }
      abortSignal.addEventListener('abort', abortHandler);
    }
    
    const cleanupAndResolve = (result?: any) => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve();
      }
    };
    
    const next = () => {
      // If we have an error and prefer to fail fast, uncomment:
      // if (firstError) return reject(firstError);
      
      if (queue.length === 0 && active === 0) {
        return firstError ? cleanupAndResolve(firstError) : cleanupAndResolve();
      }
      
      while (active < limit && queue.length > 0) {
        const i = queue.shift()!;
        active++;
        
        // Use EXACT headers from server; do not invent/transform
        const { url, method, headers } = signed[i]; // headers: { "Content-Type": "<MIME>" }
        
        // Client-side logging: log before PUT
        console.log(`📤 Client uploading:`, {
          objectPath: signed[i].objectPath,
          method: method || "PUT",
          "Content-Type": headers["Content-Type"]
        });
        
        fetch(url, { 
          method: method || "PUT", 
          headers, // Use exact headers from server
          body: files[i],
          signal: abortSignal
        })
          .then(r => { 
            if (!r.ok) {
              console.error(`❌ Upload failed for ${signed[i].objectPath}: ${r.status} ${r.statusText}`);
              throw new Error(`PUT ${r.status} ${r.statusText}`);
            }
            console.log(`✅ Upload succeeded for ${signed[i].objectPath}`);
          })
          .catch(e => { 
            if (!firstError) firstError = e; 
          })
          .finally(() => { 
            active--; 
            next(); 
          });
      }
    };
    next();
  });
}

// Helper function to get Firebase ID token
const getFirebaseIdToken = async (): Promise<string> => {
  try {
    const { auth } = await import("@/lib/firebase");
    const currentUser = auth.currentUser;
    
    if (!currentUser) {
      return "";
    }
    
    const idToken = await currentUser.getIdToken();
    return idToken || "";
  } catch (error) {
    console.error("❌ Failed to get Firebase ID token:", error);
    return "";
  }
};

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  buttonClassName?: string;
  children: ReactNode;
  onSuccess?: (docIds: string[]) => void;
  onClose?: () => void;
  onViewExistingDocument?: (documentId: string) => void;
}

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Modern file upload component with state machine pattern, flavor text, and auto-close.
 * 
 * Features:
 * - State machine pattern (idle → signing → uploading → finalizing → done/error)
 * - Auto-close modal on success after 400ms delay
 * - Rotating flavor text for each upload stage
 * - Concurrency-controlled parallel uploads
 * - Proper error handling with partial success scenarios
 * - Success toast notifications
 * - Proactive file size limit display and validation
 */
export function ObjectUploader({
  maxNumberOfFiles = 10,
  maxFileSize = 52428800, // 50MB default
  buttonClassName,
  children,
  onSuccess,
  onClose,
  onViewExistingDocument,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [state, setState] = useState<UploadState>("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [duplicateModal, setDuplicateModal] = useState<DuplicateModalState>({ isOpen: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const userCancelledRef = useRef<boolean>(false); // Track if user initiated cancellation
  const userExplicitlyCancelledRef = useRef<boolean>(false); // Track explicit modal cancellation
  const { toast } = useToast();
  
  const flavorText = useFlavor(state);
  
  // Cancel upload function
  const cancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      userCancelledRef.current = true; // Mark as user-initiated cancellation
      abortControllerRef.current.abort("Upload cancelled by user");
      abortControllerRef.current = null;
      setState("idle");
      setShowModal(false);
      setErrors([]);
      setSelectedFiles([]);
      toast({
        title: "Upload cancelled",
        description: "File upload has been cancelled.",
      });
    }
  }, [toast]);
  
  // File selection handler
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    
    // Show modal and immediate feedback as soon as files are selected
    setShowModal(true);
    setState("signing"); // Show immediate feedback before any processing
    setSelectedFiles(files);
    setErrors([]); // Clear any previous errors
    
    // Validate file count
    if (files.length > maxNumberOfFiles) {
      setErrors([`Please select no more than ${maxNumberOfFiles} files.`]);
      setState("error");
      return;
    }
    
    // Validate file sizes with better error messages
    const oversizedFiles = files.filter(file => file.size > maxFileSize);
    if (oversizedFiles.length > 0) {
      const maxSizeFormatted = formatFileSize(maxFileSize);
      const oversizedDetails = oversizedFiles.map(f => `${f.name} (${formatFileSize(f.size)})`).join(', ');
      setErrors([
        `File size limit exceeded: ${oversizedDetails}. Maximum allowed: ${maxSizeFormatted}. Please select smaller files.`
      ]);
      setState("error");
      return;
    }
    
    // Start upload process immediately after validation
    if (files.length > 0) {
      // Use setTimeout to avoid race conditions with state updates
      setTimeout(() => handleUpload(files), 0);
    }
  }, [maxNumberOfFiles, maxFileSize]);

  // Main upload function with state machine
  const handleUpload = useCallback(async (files: File[]) => {
    console.log('🎬 handleUpload started with', files.length, 'files');
    setErrors([]);

    // Clean up any existing AbortController first
    if (abortControllerRef.current) {
      console.log('🧹 Cleaning up existing AbortController');
      abortControllerRef.current = null;
    }

    // Reset user cancellation flags for new upload session
    userCancelledRef.current = false;
    userExplicitlyCancelledRef.current = false;

    // Create new AbortController for this upload
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    console.log('✨ Created new AbortController, signal.aborted:', signal.aborted);

    try {
      // Step 1: Get signed URLs (batch sign) - use real MIME types  
      const fileData = files.map(f => ({
        name: f.name,
        mimeType: f.type || 'application/octet-stream', // Real MIME from File.type
        size: f.size // Include size for server logging
      }));
      
      console.log('🚀 Starting bulk upload with files:', fileData);
      
      // Check if signal is already aborted before making request
      if (signal.aborted) {
        console.error('❌ Signal was already aborted before bulk-upload-urls request');
        setState("error");
        setErrors(["Upload was cancelled before it could start"]);
        return;
      }
      
      // Client: make batch failure non-blocking and don't show the red modal if fallback kicks in
      console.log('📡 Making bulk-upload-urls request...');
      const r = await apiRequest('/api/documents/bulk-upload-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileData }),
        signal: signal
      });
      
      console.log('📡 Bulk-upload-urls response:', r);
      
      let signed;
      let warningFiles: any[] = [];
      if (!r.ok || !r.results || r.results.every((x: any) => !x.ok)) {
        // silently proceed with per-file signing & PUT
        const perFilePromises = files.map(async (file) => {
          try {
            // Use single file upload endpoint as fallback
            const formData = new FormData();
            formData.append('file', file);
            let result;
            try {
              result = await apiRequest('/api/documents/upload-proxy', {
                method: 'POST',
                body: formData,
                signal: signal
              });
            } catch (error: any) {
              // Handle 409 conflict (duplicate detection) specially
              if (error.status === 409 && error.data?.requiresUserDecision && error.data?.type === 'duplicate_detected') {
                result = error.data; // Use the error response data for duplicate handling
              } else {
                throw error; // Re-throw other errors
              }
            }
            
            // Handle duplicate detection - upload paused, awaiting user decision
            if (result.requiresUserDecision && result.type === 'duplicate_detected') {
              // Show modal with 3 options and wait for user choice
              return new Promise((resolve) => {
                setDuplicateModal({
                  isOpen: true,
                  file,
                  duplicateInfo: {
                    message: result.message,
                    duplicateCount: result.duplicateCount,
                    existingDocs: result.existingDocs || []
                  },
                  onResolve: (decision) => {
                    setDuplicateModal({ isOpen: false });
                    
                    if (decision === 'proceed') {
                      // User chose "Proceed with upload anyway" - retry upload
                      const retryFormData = new FormData();
                      retryFormData.append('file', file);
                      retryFormData.append('forceUpload', 'true');
                      
                      // Retry with forceUpload flag - handle the same way as initial upload
                      (async () => {
                        try {
                          let retryResult;
                          try {
                            retryResult = await apiRequest('/api/documents/upload-proxy', {
                              method: 'POST',
                              body: retryFormData,
                              signal: signal
                            });
                          } catch (retryError: any) {
                            // If we get another 409 with forceUpload=true, that's an unexpected error
                            if (retryError.status === 409) {
                              console.error("Unexpected 409 on retry with forceUpload=true:", retryError);
                            }
                            throw retryError;
                          }
                          resolve({ success: true, docId: retryResult.docId });
                        } catch (retryError) {
                          console.error("Retry upload error:", retryError);
                          resolve({ success: false, error: 'upload_failed' });
                        }
                      })();
                    } else if (decision === 'view') {
                      // User chose "View File" - navigate to existing document
                      const firstExisting = result.existingDocs?.[0];
                      if (firstExisting) {
                        console.log("Opening existing document:", firstExisting.id);
                        // Close all modals
                        setShowModal(false);
                        setState("idle");
                        setSelectedFiles([]);
                        setErrors([]);
                        // Call parent callback to open document
                        if (onViewExistingDocument) {
                          onViewExistingDocument(firstExisting.id);
                        }
                      }
                      resolve({ success: false, error: 'user_chose_view', skipErrorHandling: true });
                    } else {
                      // User chose "Don't bother uploading"
                      console.log("User cancelled upload for duplicate file");
                      userExplicitlyCancelledRef.current = true;
                      setShowModal(false);
                      setState("idle");
                      setSelectedFiles([]);
                      setErrors([]);
                      resolve({ success: false, error: 'user_cancelled', reason: 'duplicate_cancelled', skipErrorHandling: true });
                    }
                  }
                });
              });
            }
            
            return { success: true, docId: result.docId };
          } catch (error: any) {
            // Handle abort errors gracefully in fallback path
            if ((error.name === 'AbortError' || error?.code === 'ABORT_ERR') && userCancelledRef.current) {
              console.log("🚫 User cancelled fallback upload for file:", file.name);
              return { success: false, error: 'user_cancelled', skipErrorHandling: true };
            }
            // Handle actual errors
            console.error("Upload error:", error);
            return { success: false, error: 'upload_failed' };
          }
        });
        
        // Make Promise.all cancellable by wrapping it with abort signal
        const perFileResults = await new Promise<any[]>((resolve, reject) => {
          // If already aborted, resolve with empty results
          if (signal.aborted) {
            console.log("🚫 Signal already aborted - resolving with empty results");
            resolve([]);
            return;
          }
          
          // Set up abort handler to resolve gracefully
          const abortHandler = () => {
            console.log("🚫 Upload cancelled - resolving with empty results");
            resolve([]);
          };
          signal.addEventListener('abort', abortHandler);
          
          // Run Promise.all
          Promise.all(perFilePromises)
            .then(results => {
              signal.removeEventListener('abort', abortHandler);
              resolve(results);
            })
            .catch(error => {
              signal.removeEventListener('abort', abortHandler);
              reject(error);
            });
        });
        const successfulUploads = perFileResults.filter(r => r.success);
        const failedUploads = perFileResults.filter(r => !r.success && !r.skipErrorHandling);
        const userCancelledUploads = perFileResults.filter(r => !r.success && r.skipErrorHandling);
        const docIds = successfulUploads.map(r => r.docId).filter(Boolean);
        const warningCount = perFileResults.filter(r => r.hadWarning).length;
        
        // If we have any successful uploads OR only user-cancelled uploads, transition to analyzing
        if (successfulUploads.length > 0 || (failedUploads.length === 0 && userCancelledUploads.length > 0)) {
          onSuccess?.(docIds);
          
          if (successfulUploads.length > 0) {
            // Transition to analyzing state instead of going directly to done
            setState("analyzing");
            
            let description = `Uploaded ${successfulUploads.length} file${successfulUploads.length !== 1 ? 's' : ''}. We'll analyze them in the background.`;
            if (warningCount > 0) {
              description += ` (${warningCount} had duplicate warnings)`;
            }
            
            toast({
              title: "Upload successful!",
              description,
            });
            
            // Start monitoring background processing and transition to done after a delay
            setTimeout(() => {
              setState("done");
              setTimeout(() => {
                setShowModal(false);
                setState("idle");
                setSelectedFiles([]);
                setErrors([]);
              }, 1500); // Show "Done!" for a bit longer
            }, 3000); // Show analyzing state for 3 seconds to indicate background processing
          } else {
            // For user-cancelled uploads, go directly to done
            setState("done");
            setTimeout(() => {
              setShowModal(false);
              setState("idle");
              setSelectedFiles([]);
              setErrors([]);
            }, 400);
          }
          // For user-cancelled uploads (View File/Don't Bother), we don't show success toast
        } else {
          // All uploads failed for actual errors
          setState("error");
          setErrors(["Upload failed. Please try again."]);
          return;
        }
        
        return; // Exit early
      } else {
        // Handle duplicate detections that require user decision 
        const duplicatesRequiringDecision = r.results.filter((x: any) => x.requiresUserDecision && x.type === 'duplicate_detected');
        const failedFiles = r.results.filter((x: any) => !x.ok && !x.requiresUserDecision);
        const warningFiles: any[] = []; // For tracking warning files
        
        // If any files require user decision for duplicates, handle them with modal
        if (duplicatesRequiringDecision.length > 0) {
          // Handle each duplicate file with the proper 3-option modal
          for (let i = 0; i < duplicatesRequiringDecision.length; i++) {
            const fileResult = duplicatesRequiringDecision[i];
            const originalFile = files.find(f => f.name === fileResult.name);
            
            if (originalFile) {
              // Show modal and wait for user decision
              const userDecision = await new Promise<'view' | 'proceed' | 'cancel'>((resolve) => {
                setDuplicateModal({
                  isOpen: true,
                  file: originalFile,
                  duplicateInfo: {
                    message: fileResult.message,
                    duplicateCount: fileResult.duplicateCount,
                    existingDocs: fileResult.existingDocs || []
                  },
                  onResolve: (decision) => {
                    setDuplicateModal({ isOpen: false });
                    resolve(decision);
                  }
                });
              });
              
              // Handle user decision
              if (userDecision === 'proceed') {
                // User chose to upload anyway - retry this file individually with forceUpload
                try {
                  const formData = new FormData();
                  formData.append('file', originalFile);
                  formData.append('forceUpload', 'true');
                  
                  const retryResult = await apiRequest('/api/documents/upload-proxy', {
                    method: 'POST',
                    body: formData,
                    signal: signal
                  });
                  
                  console.log(`✅ Force uploaded duplicate file: ${originalFile.name}`);
                  warningFiles.push(retryResult);
                } catch (error) {
                  console.error(`❌ Failed to force upload ${originalFile.name}:`, error);
                }
              } else if (userDecision === 'view') {
                // User chose to view existing file - open document modal
                if (fileResult.existingDocs && fileResult.existingDocs.length > 0) {
                  const firstDoc = fileResult.existingDocs[0];
                  console.log("Opening existing document:", firstDoc.id);
                  // Close all modals
                  setShowModal(false);
                  setState("idle");
                  setSelectedFiles([]);
                  setErrors([]);
                  // Call parent callback to open document
                  if (onViewExistingDocument) {
                    onViewExistingDocument(firstDoc.id);
                  }
                }
              } else if (userDecision === 'cancel') {
                // User chose not to upload - close modal and reset
                console.log("User cancelled upload for duplicate file");
                userExplicitlyCancelledRef.current = true;
                setShowModal(false);
                setState("idle");
                setSelectedFiles([]);
                setErrors([]);
                return; // Exit the upload function
              }
            }
          }
        }
        
        // Use batch results for all files that got signed URLs (including those with warnings)
        signed = { uploadURLs: r.results.filter((x: any) => x.ok) };
        
        if (failedFiles.length > 0) {
          console.warn(`Some files failed to sign: ${failedFiles.map((f: any) => f.name).join(', ')}`);
        }
        
        // Only fail if there are actual failures, not warnings
        if (signed.uploadURLs.length === 0) {
          setState("error");
          setErrors(["No files could be uploaded. Please try again."]);
          return;
        }
      }

      setState("uploading");
      
      // Step 2: Upload files with concurrency  
      // Only upload files that passed duplicate check and got signed URLs
      const filesToUpload = files.filter((file, index) => 
        r.results[index].ok
      );
      await uploadAllWithConcurrency(signed.uploadURLs, filesToUpload, signal, 5);

      setState("finalizing");
      
      // Step 3: Finalize - create document records
      // Only include files that were successfully uploaded (filter out duplicates)
      const successfulUploads = signed.uploadURLs;
      const documentsData = successfulUploads.map((signedData: any, index: number) => {
        // Find the original file for this upload
        const originalFileIndex = files.findIndex((file, fileIndex) => 
          r.results[fileIndex].ok && r.results[fileIndex].objectPath === signedData.objectPath
        );
        const file = files[originalFileIndex];
        
        return {
          uploadURL: signedData.url,
          name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
          originalName: file.name,
          fileSize: file.size,
          fileType: getFileTypeFromName(file.name),
          mimeType: file.type || 'application/octet-stream',
        };
      });

      const finalize = await apiRequest('/api/documents/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: documentsData,
          analyzeImmediately: true,
        })
      });

      // Check for any failures
      const failed = finalize.results?.filter((r: any) => !r.ok)?.map((r: any) => r.reason) || [];

      if (failed.length > 0) {
        setErrors(failed);
        setState("error");
      } else {
        // Transition to analyzing state for REAL analysis polling
        setState("analyzing");
        
        // Notify parent first
        onSuccess?.(finalize.docIds || []);
        
        // Show success toast
        const successCount = finalize.docIds?.length || 0;
        const warningCount = warningFiles?.length || 0;
        
        let description = `Uploaded ${successCount} file${successCount !== 1 ? 's' : ''}. Analyzing with AI...`;
        if (warningCount > 0) {
          description += ` (${warningCount} had warnings)`;
        }
        
        toast({
          title: "Upload successful!",
          description,
        });
        
        // Poll for AI analysis completion
        const docIds = finalize.docIds || [];
        let pollAttempts = 0;
        const maxPollAttempts = 60; // 60 attempts * 2s = 2 minutes max
        
        const checkAnalysisComplete = async () => {
          try {
            pollAttempts++;
            
            // Check each document's analysis status
            const docStatuses = await Promise.all(
              docIds.map(async (docId: string) => {
                try {
                  const doc = await apiRequest(`/api/documents/${docId}`);
                  return {
                    docId,
                    hasAISummary: !!doc.aiSummary,
                    hasFolderId: !!doc.folderId
                  };
                } catch (err) {
                  console.error(`Error checking document ${docId}:`, err);
                  return { docId, hasAISummary: false, hasFolderId: false };
                }
              })
            );
            
            const allAnalyzed = docStatuses.every(s => s.hasAISummary);
            const allOrganized = docStatuses.every(s => s.hasFolderId);
            
            if (allAnalyzed && allOrganized) {
              // Analysis AND Smart Organization complete!
              toast({
                title: "Analysis complete!",
                description: "Documents analyzed and organized.",
              });
              
              setState("done");
              
              // Refresh the page after a brief delay
              setTimeout(() => {
                window.location.reload();
              }, 1000);
            } else if (pollAttempts >= maxPollAttempts) {
              // Timeout - analysis taking too long
              toast({
                title: "Analysis in progress",
                description: "Taking longer than expected. Check back soon.",
                variant: "destructive"
              });
              
              setState("done");
              setTimeout(() => {
                setShowModal(false);
                setState("idle");
                setSelectedFiles([]);
                setErrors([]);
              }, 1500);
            } else {
              // Keep polling
              setTimeout(checkAnalysisComplete, 2000);
            }
          } catch (error) {
            console.error("Error polling analysis status:", error);
            // On error, stop polling and close modal
            setState("done");
            setTimeout(() => {
              setShowModal(false);
              setState("idle");
              setSelectedFiles([]);
              setErrors([]);
            }, 1500);
          }
        };
        
        // Start polling after a brief delay
        setTimeout(checkAnalysisComplete, 2000);
      }

    } catch (e: any) {
      // Handle abort operations gracefully
      if (e.name === 'AbortError' || e?.code === 'ABORT_ERR' || e.message === 'Upload cancelled by user' || userCancelledRef.current) {
        console.log("🚫 Upload was cancelled by user - returning gracefully");
        return; // Don't show error state for user-initiated cancellation
      }
      
      // Only log and show actual errors, not user cancellations
      console.error("Upload failed:", e);
      
      // Handle specific error types with user-friendly messages
      let errorMessage = e?.message || "Upload failed";
      
      if (e?.status === 413) {
        // File size error - use server message if available, otherwise provide clear guidance
        errorMessage = e?.message || `File too large. Maximum allowed size is ${formatFileSize(maxFileSize)}. Please select a smaller file.`;
      } else if (e?.status === 400 && e?.data?.code === 'INVALID_FILE_SIGNATURE') {
        // MIME validation error
        errorMessage = e?.message || "File type validation failed. The file content doesn't match its file extension.";
      } else if (e?.status === 400 && e?.data?.code === 'FILE_SIZE_EXCEEDED') {
        // Another file size error variant
        errorMessage = e?.message || `File size limit exceeded. Maximum allowed: ${formatFileSize(maxFileSize)}`;
      }
      
      setErrors([errorMessage]);
      setState("error");
    } finally {
      // Clean up abort controller
      console.log('🧹 Cleaning up AbortController in finally block');
      abortControllerRef.current = null;
    }
  }, [toast, onSuccess]);

  // Retry failed uploads
  const handleRetry = useCallback(() => {
    if (selectedFiles.length > 0) {
      handleUpload(selectedFiles);
    }
  }, [selectedFiles, handleUpload]);

  // Reset state when closing modal
  const handleModalClose = useCallback((open: boolean) => {
    // Allow closing if user explicitly cancelled or if not in active states
    if (!open && (userExplicitlyCancelledRef.current || (state !== "uploading" && state !== "finalizing" && state !== "signing" && state !== "analyzing"))) {
      userExplicitlyCancelledRef.current = false; // Reset the flag
      setShowModal(false);
      setState("idle");
      setErrors([]);
      setSelectedFiles([]);
      onClose?.();
    } else if (!open && (state === "uploading" || state === "finalizing" || state === "signing" || state === "analyzing")) {
      // Prevent closing during active uploads or analysis - keep modal open
      setShowModal(true);
    }
  }, [state, onClose]);

  return (
    <div>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
        accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif,.webp,.csv,.xlsx,.xls,.pptx,.ppt"
      />
      
      {/* Upload Button */}
      <Button 
        onClick={() => fileInputRef.current?.click()} 
        className={buttonClassName}
        disabled={state === "uploading" || state === "finalizing" || state === "analyzing"}
        data-testid="button-upload"
      >
        {state === "uploading" || state === "finalizing" || state === "analyzing" ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            {state === "analyzing" ? "Analyzing..." : "Uploading..."}
          </>
        ) : (
          children
        )}
      </Button>

      {/* Upload Modal */}
      <Dialog open={showModal} onOpenChange={handleModalClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {state === "signing" ? "Preparing uploads…" :
               state === "uploading" ? "Uploading…" :
               state === "finalizing" ? "Finishing up…" :
               state === "analyzing" ? "AI Analysis in Progress…" :
               state === "done" ? "Done!" :
               state === "error" ? "Some files need attention" : "Upload Files"}
            </DialogTitle>
            {/* Show upload limits proactively when idle */}
            {state === "idle" && (
              <div className="text-xs text-muted-foreground mt-2 space-y-1 bg-muted/50 p-3 rounded-md">
                <div className="font-medium text-foreground">Upload Limits:</div>
                <div>• Maximum file size: {formatFileSize(maxFileSize)}</div>
                <div>• Maximum files per upload: {maxNumberOfFiles}</div>
                <div>• Supported types: PDF, Word, Excel, PowerPoint, Images, Text, CSV</div>
              </div>
            )}
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Flavor text */}
            <p className="text-sm text-muted-foreground">
              {flavorText}
            </p>

            {/* Progress indicator */}
            <Progress 
              value={state === "done" ? 100 : undefined}
              className="w-full"
            />
            
            {/* File list */}
            {selectedFiles.length > 0 && (
              <div className="space-y-2 overflow-hidden">
                <h4 className="text-sm font-medium">Files:</h4>
                <ul className="space-y-1 text-sm text-muted-foreground overflow-hidden">
                  {selectedFiles.map((file, index) => (
                    <li key={index} className="flex items-center justify-between gap-2 min-w-0">
                      <span className="truncate flex-1 min-w-0">{file.name}</span>
                      <span className="text-xs whitespace-nowrap flex-shrink-0">{formatFileSize(file.size)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Cancel button - only show during active upload states */}
            {(state === "signing" || state === "uploading" || state === "finalizing") && (
              <div className="flex justify-center">
                <Button
                  onClick={cancelUpload}
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  data-testid="button-cancel-upload"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Cancel Upload
                </Button>
              </div>
            )}

            {/* Error list */}
            {errors.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-destructive">Errors:</h4>
                <ul className="space-y-1 text-sm text-destructive list-disc ml-5">
                  {errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
                {state === "error" && selectedFiles.length > 0 && (
                  <Button
                    onClick={handleRetry}
                    variant="outline"
                    size="sm"
                    className="mt-2"
                  >
                    Retry Failed
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicate Detection Modal */}
      <Dialog open={duplicateModal.isOpen} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-yellow-600">
              Duplicate File Detected! ⚠️
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {duplicateModal.duplicateInfo?.message}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3">
              <p className="text-sm">
                <strong>File:</strong> {duplicateModal.file?.name}
              </p>
              <p className="text-sm mt-1">
                <strong>Already exists:</strong> {duplicateModal.duplicateInfo?.duplicateCount} time{duplicateModal.duplicateInfo?.duplicateCount !== 1 ? 's' : ''}
              </p>
              {duplicateModal.duplicateInfo?.existingDocs?.[0] && (
                <p className="text-sm mt-1">
                  <strong>Original:</strong> "{duplicateModal.duplicateInfo.existingDocs[0].name}"
                </p>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">What would you like to do?</p>
              
              <div className="grid grid-cols-1 gap-2">
                {/* View File Option */}
                <Button
                  onClick={() => duplicateModal.onResolve?.('view')}
                  variant="outline"
                  className="w-full justify-start"
                  data-testid="button-view-existing"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Existing File
                </Button>

                {/* Proceed Option */}
                <Button
                  onClick={() => duplicateModal.onResolve?.('proceed')}
                  variant="default"
                  className="w-full justify-start bg-blue-600 hover:bg-blue-700"
                  data-testid="button-proceed-upload"
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Proceed with Upload Anyway
                </Button>

                {/* Cancel Option */}
                <Button
                  onClick={() => duplicateModal.onResolve?.('cancel')}
                  variant="destructive"
                  className="w-full justify-start"
                  data-testid="button-cancel-upload"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Don't Bother Uploading
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
