import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Upload,
  X,
  Camera,
  FileDown,
  Link2,
  AlertCircle,
  FileWarning,
  FileCheck
} from "lucide-react";

interface EmptyStateDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload?: () => void;
}

export function EmptyStateDashboard({ isOpen, onClose, onUpload }: EmptyStateDashboardProps) {
  if (!isOpen) return null;

  const handleUploadClick = () => {
    onClose();
    if (onUpload) {
      // Small delay to ensure modal closes before opening upload
      setTimeout(() => onUpload(), 100);
    }
  };

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

  const quickActions = [
    { 
      icon: Camera, 
      title: "Snap a photo of any receipt", 
      subtitle: "AI extracts and categorizes everything",
      color: "text-indigo-600 dark:text-indigo-400"
    },
    { 
      icon: FileDown, 
      title: "Drop that PDF you just downloaded", 
      subtitle: "Drag and drop anywhere",
      color: "text-purple-600 dark:text-purple-400"
    },
    { 
      icon: Link2, 
      title: "Connect Drive - organize without uploading", 
      subtitle: "Sync existing documents instantly",
      color: "text-blue-600 dark:text-blue-400"
    },
  ];

  const auditQuestions = [
    {
      icon: AlertCircle,
      question: "Do you have documents older than 2019?",
      solution: "Auto-archive with smart date detection",
      color: "text-amber-600 dark:text-amber-400"
    },
    {
      icon: FileWarning,
      question: "Any unsigned contracts floating around?",
      solution: "Track signatures & missing approvals",
      color: "text-orange-600 dark:text-orange-400"
    },
    {
      icon: FileCheck,
      question: "Receipts without warranty info attached?",
      solution: "Link related docs automatically",
      color: "text-teal-600 dark:text-teal-400"
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-gradient-to-br from-white via-purple-50/30 to-indigo-50/30 dark:from-gray-950 dark:via-purple-950/20 dark:to-indigo-950/20 border-2 border-purple-200/40 dark:border-purple-800/40">
        <CardHeader className="border-b border-purple-200/40 dark:border-purple-800/40 pb-2.5">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-light tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 dark:from-purple-400 dark:to-indigo-400">
                Welcome to Clasio ✨
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs font-light tracking-wide">
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

        <CardContent className="space-y-3 mt-3 pb-3">
          {/* Quick Win Scenarios */}
          <div className="space-y-1.5">
            <h3 className="text-sm font-normal tracking-wide text-muted-foreground px-1">
              Got 30 seconds? Try this:
            </h3>
            <div className="grid grid-cols-1 gap-1.5">
              {quickActions.map((action, index) => {
                const Icon = action.icon;
                return (
                  <div
                    key={index}
                    className="flex items-center gap-2.5 p-2.5 bg-white/60 dark:bg-gray-800/60 rounded-lg border border-purple-100/50 dark:border-purple-800/30 hover:border-purple-200 dark:hover:border-purple-700 transition-colors"
                  >
                    <Icon className={`h-4 w-4 ${action.color} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-normal tracking-wide truncate">{action.title}</p>
                      <p className="text-[10px] text-muted-foreground font-light tracking-wide truncate">
                        {action.subtitle}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Document Audit */}
          <div className="space-y-1.5">
            <h3 className="text-sm font-normal tracking-wide text-muted-foreground px-1">
              Quick Document Audit
            </h3>
            <div className="grid grid-cols-1 gap-1.5">
              {auditQuestions.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div
                    key={index}
                    className="flex items-center gap-2.5 p-2.5 bg-white/60 dark:bg-gray-800/60 rounded-lg border border-purple-100/50 dark:border-purple-800/30"
                  >
                    <Icon className={`h-4 w-4 ${item.color} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-normal tracking-wide">{item.question}</p>
                      <p className="text-[10px] text-muted-foreground font-light tracking-wide italic">
                        → {item.solution}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CTA Button */}
          <Button
            className="bg-gradient-to-r from-purple-600 to-indigo-600 dark:from-purple-500 dark:to-indigo-500 text-white hover:opacity-90 font-light tracking-wide w-full mt-2"
            onClick={handleUploadClick}
            data-testid="button-start-uploading"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Your First Document
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
