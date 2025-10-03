import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyStateDashboard } from "@/components/EmptyStateDashboard";
import { 
  Brain, 
  X,
  BarChart3,
  FolderOpen,
  Tags,
  TrendingUp,
  Clock,
  Sparkles,
  FileText,
  HardDrive
} from "lucide-react";

interface FunFactsResponse {
  success: boolean;
  quotas: {
    files: {
      used: number;
      limit: number;
      percentage: number;
      remaining: number;
    };
    storage: {
      usedBytes: number;
      usedMB: number;
      usedGB: number;
      limitGB: number;
      percentage: number;
      remainingGB: number;
    };
  };
  insights: {
    organizationPatterns: {
      mostActiveFolder: string;
      tagCount: number;
      mostUsedTag: string;
    };
    aiClassification: {
      categorizationRate: string;
      documentTypes: string;
      timeSaved: string;
    };
    documentLifecycle: {
      oldestDocument: string;
      documentsThisMonth: string;
    };
    productivity: {
      speedup: string;
      driveSync: string;
      crossPlatform: string;
    };
    smartRecommendations: {
      untaggedDocs: string;
      storageOptimization: string;
    };
  };
}

interface QueueStatusDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  compact?: boolean;
  onUpload?: () => void;
}

export function QueueStatusDashboard({ isOpen, onClose, compact = false, onUpload }: QueueStatusDashboardProps) {
  const { data, isLoading, error, refetch } = useQuery<FunFactsResponse>({
    queryKey: ["/api/fun-facts"],
    refetchInterval: false,
  });

  if (!isOpen) return null;

  // Show empty state if user has 0 documents
  if (data?.quotas.files.used === 0 && !isLoading) {
    return <EmptyStateDashboard isOpen={isOpen} onClose={onClose} onUpload={onUpload} />;
  }

  const getQuotaColor = (percentage: number) => {
    if (percentage >= 90) return "bg-red-500";
    if (percentage >= 70) return "bg-orange-500"; 
    if (percentage >= 50) return "bg-yellow-500";
    return "bg-green-500";
  };

  if (compact) {
    // Compact view for embedding in other components
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Fun Facts
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert>
              <AlertDescription>
                Failed to load fun facts. Please try again! 
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {data?.quotas && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Files</span>
                    <span data-testid="text-file-quota">
                      {data.quotas.files.used}/{data.quotas.files.limit}
                    </span>
                  </div>
                  <Progress value={data.quotas.files.percentage} className="h-2" />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Full dashboard view
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-6xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-white via-purple-50/30 to-indigo-50/30 dark:from-gray-950 dark:via-purple-950/20 dark:to-indigo-950/20 border-2 border-purple-200/40 dark:border-purple-800/40" data-testid="card-queue-dashboard">
        <CardHeader className="border-b border-purple-200/40 dark:border-purple-800/40">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-3xl font-light tracking-wide flex items-center gap-3 text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 dark:from-purple-400 dark:to-indigo-400">
                <Brain className="h-7 w-7 text-purple-600 dark:text-purple-400" />
                Fun Facts
              </CardTitle>
              <CardDescription className="mt-2 text-sm font-light tracking-wide">
                Your Clasio journey in numbers ✨
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="hover:bg-purple-100 dark:hover:bg-purple-900/30"
              data-testid="button-close-dashboard"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 mt-6">
          {error ? (
            <Alert className="border-purple-200 dark:border-purple-800">
              <AlertDescription className="font-light tracking-wide">
                Failed to load fun facts. Please try refreshing!
              </AlertDescription>
            </Alert>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
            </div>
          ) : (
            <>
              {/* Quota Usage Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Files Quota */}
                <Card className="border-purple-200/50 dark:border-purple-800/50 bg-white/70 dark:bg-gray-900/70">
                  <CardHeader>
                    <CardTitle className="text-lg font-light tracking-wide flex items-center gap-2">
                      <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      File Count
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm font-light tracking-wide">
                        <span>Files Used</span>
                        <span className="font-normal" data-testid="text-file-quota-full">
                          {data?.quotas.files.used} / {data?.quotas.files.limit}
                        </span>
                      </div>
                      <Progress 
                        value={data?.quotas.files.percentage || 0} 
                        className="h-3"
                        data-testid="progress-file-quota"
                      />
                      <p className="text-xs text-muted-foreground font-light tracking-wide">
                        {data?.quotas.files.remaining} files remaining in your quota
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Storage Quota */}
                <Card className="border-indigo-200/50 dark:border-indigo-800/50 bg-white/70 dark:bg-gray-900/70">
                  <CardHeader>
                    <CardTitle className="text-lg font-light tracking-wide flex items-center gap-2">
                      <HardDrive className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      Storage Used
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm font-light tracking-wide">
                        <span>Storage Used</span>
                        <span className="font-normal" data-testid="text-storage-quota-full">
                          {data?.quotas.storage.usedGB} GB / {data?.quotas.storage.limitGB} GB
                        </span>
                      </div>
                      <Progress 
                        value={data?.quotas.storage.percentage || 0} 
                        className="h-3"
                        data-testid="progress-storage-quota"
                      />
                      <p className="text-xs text-muted-foreground font-light tracking-wide">
                        {data?.quotas.storage.remainingGB} GB remaining ({data?.quotas.storage.usedMB} MB used)
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Document Intelligence Analytics */}
              <Card className="border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-white dark:from-purple-950/20 dark:to-gray-900/70">
                <CardHeader>
                  <CardTitle className="text-xl font-light tracking-wide flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    Document Intelligence Analytics
                  </CardTitle>
                  <CardDescription className="font-light tracking-wide">Organization Patterns</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                    <FolderOpen className="h-5 w-5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm font-light tracking-wide" data-testid="text-active-folder">
                      {data?.insights.organizationPatterns.mostActiveFolder}
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                    <Tags className="h-5 w-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm font-light tracking-wide" data-testid="text-tag-usage">
                      {data?.insights.organizationPatterns.mostUsedTag}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* AI Classification Insights */}
              <Card className="border-indigo-200/50 dark:border-indigo-800/50 bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-gray-900/70">
                <CardHeader>
                  <CardTitle className="text-xl font-light tracking-wide flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                    AI Classification Insights
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm font-light tracking-wide" data-testid="text-categorization-rate">
                      {data?.insights.aiClassification.categorizationRate}
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                    <FileText className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm font-light tracking-wide" data-testid="text-document-types">
                      {data?.insights.aiClassification.documentTypes}
                    </p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                    <Clock className="h-5 w-5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm font-light tracking-wide" data-testid="text-time-saved">
                      {data?.insights.aiClassification.timeSaved}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Document Lifecycle & Productivity */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Document Lifecycle */}
                <Card className="border-slate-200/50 dark:border-slate-800/50 bg-white/70 dark:bg-gray-900/70">
                  <CardHeader>
                    <CardTitle className="text-lg font-light tracking-wide flex items-center gap-2">
                      <Clock className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                      Document Lifecycle
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm font-light tracking-wide" data-testid="text-oldest-document">
                      {data?.insights.documentLifecycle.oldestDocument}
                    </p>
                    <p className="text-sm font-light tracking-wide" data-testid="text-docs-this-month">
                      {data?.insights.documentLifecycle.documentsThisMonth}
                    </p>
                  </CardContent>
                </Card>

                {/* Productivity Metrics */}
                <Card className="border-green-200/50 dark:border-green-800/50 bg-white/70 dark:bg-gray-900/70">
                  <CardHeader>
                    <CardTitle className="text-lg font-light tracking-wide flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                      Productivity Metrics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm font-light tracking-wide" data-testid="text-speedup">
                      {data?.insights.productivity.speedup}
                    </p>
                    <p className="text-sm font-light tracking-wide" data-testid="text-drive-sync">
                      {data?.insights.productivity.driveSync}
                    </p>
                    <p className="text-sm font-light tracking-wide" data-testid="text-cross-platform">
                      {data?.insights.productivity.crossPlatform}
                    </p>
                  </CardContent>
                </Card>
              </div>

            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
