import { Trash2, AlertTriangle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface MobileMoreMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onDeleteAll: () => void;
  hasDocuments: boolean;
  isDeleting: boolean;
}

export function MobileMoreMenu({
  isOpen,
  onClose,
  onDeleteAll,
  hasDocuments,
  isDeleting
}: MobileMoreMenuProps) {
  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className="lg:hidden rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="text-xl font-light tracking-wide">Actions</SheetTitle>
          <SheetDescription className="font-light tracking-wide">
            Manage your documents
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {hasDocuments ? (
            <>
              {/* Warning Alert */}
              <Alert className="border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20">
                <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                <AlertDescription className="text-sm text-rose-700 dark:text-rose-300 font-light tracking-wide">
                  This will permanently delete all your documents. This action cannot be undone.
                </AlertDescription>
              </Alert>

              {/* Delete All Button */}
              <Button
                variant="destructive"
                onClick={() => {
                  onDeleteAll();
                  onClose();
                }}
                disabled={isDeleting}
                className="w-full h-14 text-base font-light tracking-wide gap-2"
                data-testid="mobile-delete-all-confirm"
              >
                <Trash2 className="h-5 w-5" />
                {isDeleting ? "Deleting..." : "Delete All Documents"}
              </Button>

              {/* Cancel Button */}
              <Button
                variant="outline"
                onClick={onClose}
                className="w-full h-12 text-base font-light tracking-wide"
                data-testid="mobile-delete-all-cancel"
              >
                Cancel
              </Button>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground font-light tracking-wide">
              <p>No documents to delete</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
