import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Upload,
  FolderOpen,
  Mail,
  HardDrive,
  Image,
  X,
  Calendar
} from "lucide-react";

interface EmptyStateDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EmptyStateDashboard({ isOpen, onClose }: EmptyStateDashboardProps) {
  if (!isOpen) return null;

  // Time-aware context
  const getTimeContext = () => {
    const now = new Date();
    const month = now.getMonth();
    const day = now.getDay();
    const date = now.getDate();
    const lastDayOfMonth = new Date(now.getFullYear(), month + 1, 0).getDate();

    // January - Tax season
    if (month === 0) {
      return "Tax season prep - start with last year's receipts";
    }
    // Monday
    if (day === 1) {
      return "Weekly expense reports made simple";
    }
    // Last 3 days of month
    if (date >= lastDayOfMonth - 2) {
      return "Invoice organization time";
    }
    // Default
    return "Start organizing your documents today";
  };

  // Documents you'll need this month
  const getMonthlyDocuments = () => {
    const month = new Date().getMonth();
    
    if (month === 2) { // March
      return "Tax documents checklist";
    }
    if (month === 8) { // September
      return "Back-to-school forms";
    }
    if (month === 11) { // December
      return "Year-end expense reports";
    }
    return "Monthly document organization";
  };

  const documentLocations = [
    { icon: FolderOpen, title: "Downloads folder", subtitle: "usually 50+ forgotten files" },
    { icon: FolderOpen, title: "Desktop", subtitle: "those \"temporary\" PDFs" },
    { icon: Mail, title: "Email attachments", subtitle: "receipts, invoices" },
    { icon: HardDrive, title: "Google Drive", subtitle: "unorganized chaos" },
    { icon: Image, title: "Photos app", subtitle: "pictures of documents" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-3xl max-h-[85vh] overflow-y-auto bg-gradient-to-br from-white via-purple-50/30 to-indigo-50/30 dark:from-gray-950 dark:via-purple-950/20 dark:to-indigo-950/20 border-2 border-purple-200/40 dark:border-purple-800/40">
        <CardHeader className="border-b border-purple-200/40 dark:border-purple-800/40 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-light tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 dark:from-purple-400 dark:to-indigo-400">
                Welcome to Clasio ✨
              </CardTitle>
              <CardDescription className="mt-1 text-sm font-light tracking-wide">
                {getTimeContext()}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="hover:bg-purple-100 dark:hover:bg-purple-900/30"
              data-testid="button-close-empty-state"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 mt-4 pb-4">
          {/* Quick Win Scenarios - First */}
          <Card className="border-indigo-200/50 dark:border-indigo-800/50 bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-gray-900/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-light tracking-wide flex items-center gap-2">
                <Upload className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                Got 30 seconds? Try this:
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-start gap-3 p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-xl">📱</span>
                <div>
                  <p className="text-sm font-normal tracking-wide">Snap a photo of any receipt</p>
                  <p className="text-xs text-muted-foreground font-light tracking-wide">
                    AI will extract and categorize everything
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-xl">📎</span>
                <div>
                  <p className="text-sm font-normal tracking-wide">Drop that PDF you just downloaded</p>
                  <p className="text-xs text-muted-foreground font-light tracking-wide">
                    Drag and drop anywhere on this page
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-xl">🔗</span>
                <div>
                  <p className="text-sm font-normal tracking-wide">Connect Drive - organize without uploading</p>
                  <p className="text-xs text-muted-foreground font-light tracking-wide">
                    Sync your existing documents instantly
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Documents You'll Need This Month */}
          <Card className="border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-white dark:from-purple-950/20 dark:to-gray-900/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-light tracking-wide flex items-center gap-2">
                <Calendar className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                Documents You'll Need This Month
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-normal tracking-wide">{getMonthlyDocuments()}</p>
            </CardContent>
          </Card>

          {/* Document Graveyard */}
          <Card className="border-amber-200/50 dark:border-amber-800/50 bg-gradient-to-br from-amber-50/50 to-white dark:from-amber-950/20 dark:to-gray-900/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-light tracking-wide">
                Documents Living in Digital Purgatory
              </CardTitle>
              <CardDescription className="text-xs font-light tracking-wide">
                Where are your documents hiding?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {documentLocations.map((location, index) => {
                const Icon = location.icon;
                return (
                  <div
                    key={index}
                    className="flex items-center gap-2.5 p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <Icon className="h-4 w-4 text-amber-500" />
                    <div className="flex-1">
                      <p className="text-sm font-normal tracking-wide">{location.title}</p>
                      <p className="text-xs text-muted-foreground font-light italic">
                        {location.subtitle}
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* CTA Button - Always visible */}
          <div className="text-center pt-2">
            <p className="text-sm font-light tracking-wide text-muted-foreground mb-3">
              Rescue them with Clasio →
            </p>
            <Button
              className="bg-gradient-to-r from-purple-600 to-indigo-600 dark:from-purple-500 dark:to-indigo-500 text-white hover:opacity-90 font-light tracking-wide w-full"
              onClick={onClose}
              data-testid="button-start-uploading"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Your First Document
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
