import { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Upload state machine
type UploadState = "idle" | "signing" | "uploading" | "finalizing" | "done" | "error";

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
    "Sharpening quills… generating upload scrolls.",
    "Filing the intergalactic paperwork for your files…",
    "Calculating the perfect trajectory for your documents…",
    "Asking the cloud politely to prepare some storage space…",
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

// Concurrency helper for parallel uploads
async function uploadAllWithConcurrency(
  signed: { url: string; method: string; headers: Record<string, string>; objectPath: string }[],
  files: File[],
  limit = 5
): Promise<void> {
  const queue = [...files.keys()];
  let active = 0;
  let firstError: any = null;

  return new Promise<void>((resolve, reject) => {
    const next = () => {
      // If we have an error and prefer to fail fast, uncomment:
      // if (firstError) return reject(firstError);
      
      if (queue.length === 0 && active === 0) {
        return firstError ? reject(firstError) : resolve();
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
          body: files[i] 
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
}

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
 */
export function ObjectUploader({
  maxNumberOfFiles = 10,
  maxFileSize = 52428800, // 50MB default
  buttonClassName,
  children,
  onSuccess,
  onClose,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [state, setState] = useState<UploadState>("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  const flavorText = useFlavor(state);
  
  // File selection handler
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    
    // Show modal as soon as files are selected
    setShowModal(true);
    
    // Validate file count
    if (files.length > maxNumberOfFiles) {
      setErrors([`Please select no more than ${maxNumberOfFiles} files.`]);
      setState("error");
      return;
    }
    
    // Validate file sizes
    const oversizedFiles = files.filter(file => file.size > maxFileSize);
    if (oversizedFiles.length > 0) {
      setErrors([
        `Files too large: ${oversizedFiles.map(f => f.name).join(', ')}. Max size: ${Math.round(maxFileSize / 1024 / 1024)}MB`
      ]);
      setState("error");
      return;
    }
    
    setSelectedFiles(files);
    if (files.length > 0) {
      handleUpload(files);
    }
  }, [maxNumberOfFiles, maxFileSize]);

  // Main upload function with state machine
  const handleUpload = useCallback(async (files: File[]) => {
    setState("signing");
    setErrors([]);

    try {
      // Step 1: Get signed URLs (batch sign) - use real MIME types  
      const fileData = files.map(f => ({
        name: f.name,
        mimeType: f.type || 'application/octet-stream', // Real MIME from File.type
        size: f.size // Include size for server logging
      }));
      
      // Client: make batch failure non-blocking and don't show the red modal if fallback kicks in
      const r = await apiRequest('/api/documents/bulk-upload-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileData })
      });
      
      let signed;
      if (!r.ok || !r.results || r.results.every((x: any) => !x.ok)) {
        toast({
          title: "Using fallback upload method",
          description: "Uploading files individually",
        });
        // silently proceed with per-file signing & PUT
        const perFilePromises = files.map(async (file) => {
          try {
            // Use single file upload endpoint as fallback
            const formData = new FormData();
            formData.append('file', file);
            const result = await apiRequest('/api/documents/upload-proxy', {
              method: 'POST',
              body: formData
            });
            return { success: true, docId: result.docId };
          } catch (error: any) {
            // Handle duplicate file error specifically
            if (error.message.includes('409') && error.message.includes('duplicate_file')) {
              try {
                const errorResponse = JSON.parse(error.message.split(': ')[1]);
                toast({
                  title: "Duplicate File Detected! 🚨",
                  description: errorResponse.message,
                  variant: "destructive",
                });
                return { success: false, error: 'duplicate' };
              } catch {
                // Fallback for duplicate error handling
                toast({
                  title: "Duplicate File Detected! 🚨", 
                  description: "This file already exists in your collection!",
                  variant: "destructive",
                });
                return { success: false, error: 'duplicate' };
              }
            }
            throw error; // Re-throw other errors
          }
        });
        
        const perFileResults = await Promise.all(perFilePromises);
        const successfulUploads = perFileResults.filter(r => r.success);
        const duplicateUploads = perFileResults.filter(r => r.error === 'duplicate');
        const docIds = successfulUploads.map(r => r.docId).filter(Boolean);
        
        // If we have any successful uploads, show success
        if (successfulUploads.length > 0) {
          setState("done");
          onSuccess?.(docIds);
          toast({
            title: "Upload successful!",
            description: `Uploaded ${successfulUploads.length} file${successfulUploads.length !== 1 ? 's' : ''}. We'll analyze them in the background.`,
          });
        } else if (duplicateUploads.length > 0) {
          // All uploads were duplicates - show funny messages and close gracefully
          setState("done");
          const funnyMessages = [
            "Déjà vu detected! All these files are already chilling in your collection! 😎",
            "File twins everywhere! Your storage doesn't need photocopies! 📋",
            "All duplicates found! No cloning allowed in this dimension! 🌌",
            "Every file already exists! Are you testing my memory? 🧠"
          ];
          const randomMessage = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];
          setErrors([randomMessage]);
          
          // Close modal after showing the funny message
          setTimeout(() => {
            setShowModal(false);
            setState("idle");
            setSelectedFiles([]);
            setErrors([]);
          }, 2500); // Give users time to read the funny message
          return;
        } else {
          // All uploads failed for other reasons
          setState("error");
          setErrors(["Upload failed. Please try again."]);
          return;
        }
        
        setTimeout(() => {
          setShowModal(false);
          setState("idle");
          setSelectedFiles([]);
          setErrors([]);
        }, 400);
        return; // Exit early
      } else {
        // Check for duplicate files in the results
        const duplicateFiles = r.results.filter((x: any) => !x.ok && x.reason === 'duplicate_file');
        const otherFailedFiles = r.results.filter((x: any) => !x.ok && x.reason !== 'duplicate_file');
        
        // Show duplicate file toasts
        if (duplicateFiles.length > 0) {
          duplicateFiles.forEach((file: any) => {
            toast({
              title: "Duplicate File Detected! 🚨",
              description: file.message || "This file already exists in your collection!",
              variant: "destructive",
            });
          });
        }
        
        // use batch results for those that are ok; fallback only the few that failed to sign for other reasons
        signed = { uploadURLs: r.results.filter((x: any) => x.ok) };
        
        if (otherFailedFiles.length > 0) {
          console.warn(`Some files failed to sign: ${otherFailedFiles.map((f: any) => f.name).join(', ')}`);
        }
        
        // If all files were duplicates, show funny message and close gracefully
        if (signed.uploadURLs.length === 0) {
          setState("done");
          const funnyMessages = [
            "Déjà vu detected! All these files are already chilling in your collection! 😎",
            "File twins everywhere! Your storage doesn't need photocopies! 📋",
            "All duplicates found! No cloning allowed in this dimension! 🌌",
            "Every file already exists! Are you testing my memory? 🧠"
          ];
          const randomMessage = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];
          setErrors([randomMessage]);
          
          // Close modal after showing the funny message
          setTimeout(() => {
            setShowModal(false);
            setState("idle");
            setSelectedFiles([]);
            setErrors([]);
          }, 2500); // Give users time to read the funny message
          return;
        }
      }

      setState("uploading");
      
      // Step 2: Upload files with concurrency  
      // Only upload files that passed duplicate check and got signed URLs
      const filesToUpload = files.filter((file, index) => 
        r.results[index].ok
      );
      await uploadAllWithConcurrency(signed.uploadURLs, filesToUpload, 5);

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
        setState("done");
        
        // Notify parent first, then auto-close
        onSuccess?.(finalize.docIds || []);
        
        // Auto-close after brief success display
        setTimeout(() => {
          setShowModal(false);
          setState("idle");
          setSelectedFiles([]);
          setErrors([]);
          
          // Show success toast AFTER modal closes
          const successCount = finalize.docIds?.length || 0;
          toast({
            title: "Upload successful!",
            description: `Uploaded ${successCount} file${successCount !== 1 ? 's' : ''}. We'll analyze them in the background.`,
          });
        }, 400);
      }

    } catch (e: any) {
      console.error("Upload failed:", e);
      setErrors([e?.message || "Upload failed"]);
      setState("error");
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
    // Only allow closing when not in active upload states
    if (!open && state !== "uploading" && state !== "finalizing" && state !== "signing") {
      setShowModal(false);
      setState("idle");
      setErrors([]);
      setSelectedFiles([]);
      onClose?.();
    } else if (!open && (state === "uploading" || state === "finalizing" || state === "signing")) {
      // Prevent closing during active uploads - keep modal open
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
        disabled={state === "uploading" || state === "finalizing"}
        data-testid="button-upload"
      >
        {state === "uploading" || state === "finalizing" ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Uploading...
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
               state === "done" ? "Done!" :
               state === "error" ? "Some files need attention" : "Upload Files"}
            </DialogTitle>
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
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Files:</h4>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {selectedFiles.map((file, index) => (
                    <li key={index} className="flex items-center justify-between">
                      <span className="truncate">{file.name}</span>
                      <span className="text-xs">{Math.round(file.size / 1024)}KB</span>
                    </li>
                  ))}
                </ul>
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
    </div>
  );
}
