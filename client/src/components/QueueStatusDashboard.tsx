import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Brain, 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  Coffee, 
  Sparkles, 
  TrendingUp,
  RefreshCw,
  X,
  BarChart3,
  Timer,
  Zap
} from "lucide-react";

interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface QueueStatusResponse {
  success: boolean;
  queueStatus: QueueStatus;
  dailyQuota: {
    used: number;
    limit: number;
    percentage: number;
    remaining: number;
  };
  statistics: {
    totalRequests: number;
    completionRate: number;
    funnyStats: {
      coffeeBreaksNeeded: number;
      aiHappinessLevel: number;
      digitalMagicLevel: string;
    };
  };
  messages: {
    statusMessage: string;
    priorityTip: string;
    quotaWarning?: string | null;
    encouragement: string;
  };
  tips: string[];
}

interface QueueStatusDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  compact?: boolean;
}

export function QueueStatusDashboard({ isOpen, onClose, compact = false }: QueueStatusDashboardProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, error, refetch } = useQuery<QueueStatusResponse>({
    queryKey: ["/api/queue/status"],
    refetchInterval: autoRefresh ? 30000 : false, // Refresh every 30 seconds if enabled
  });

  // Auto-refresh effect
  useEffect(() => {
    if (!isOpen) {
      setAutoRefresh(false);
    } else {
      setAutoRefresh(true);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getQueueStatusColor = (status: keyof QueueStatus, count: number) => {
    if (count === 0) return "bg-gray-100 text-gray-600";
    
    switch (status) {
      case "pending":
        return count > 10 ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700";
      case "processing":
        return "bg-yellow-100 text-yellow-700";
      case "completed":
        return "bg-green-100 text-green-700";
      case "failed":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

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
              AI Queue Status
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              data-testid="button-refresh-queue"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Oops!</AlertTitle>
              <AlertDescription>
                Failed to load queue status. Our dashboard might be taking a coffee break! ☕
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {data?.messages.statusMessage && (
                <p className="text-sm text-muted-foreground" data-testid="text-status-message">
                  {data.messages.statusMessage}
                </p>
              )}
              
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center">
                  <div className="text-lg font-semibold text-yellow-600" data-testid="text-pending-count">
                    {data?.queueStatus.pending || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-600" data-testid="text-completed-count">
                    {data?.queueStatus.completed || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Completed</div>
                </div>
              </div>

              {data?.dailyQuota && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Daily Quota</span>
                    <span data-testid="text-quota-usage">
                      {data.dailyQuota.used}/{data.dailyQuota.limit}
                    </span>
                  </div>
                  <Progress 
                    value={data.dailyQuota.percentage} 
                    className="h-2"
                    data-testid="progress-daily-quota"
                  />
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
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="card-queue-dashboard">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Brain className="h-6 w-6" />
                AI Queue Status Dashboard
              </CardTitle>
              <CardDescription>
                Your personal window into our digital brain's activities! 🧠✨
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
                data-testid="button-refresh-full"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                data-testid="button-close-dashboard"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {error ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Dashboard Hiccup!</AlertTitle>
              <AlertDescription>
                Our queue status dashboard seems to be having a coffee break! ☕ Please try refreshing.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Status Message */}
              {data?.messages.statusMessage && (
                <Alert>
                  <Sparkles className="h-4 w-4" />
                  <AlertTitle>Current Status</AlertTitle>
                  <AlertDescription data-testid="text-main-status">
                    {data.messages.statusMessage}
                  </AlertDescription>
                </Alert>
              )}

              {/* Quota Warning */}
              {data?.messages.quotaWarning && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Quota Alert</AlertTitle>
                  <AlertDescription data-testid="text-quota-warning">
                    {data.messages.quotaWarning}
                  </AlertDescription>
                </Alert>
              )}

              {/* Queue Status Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Pending</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600" data-testid="text-pending-full">
                      {data?.queueStatus.pending || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Waiting for analysis
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Processing</CardTitle>
                    <Zap className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-yellow-600" data-testid="text-processing-full">
                      {data?.queueStatus.processing || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      AI magic in progress
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Completed</CardTitle>
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600" data-testid="text-completed-full">
                      {data?.queueStatus.completed || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Successfully analyzed
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Failed</CardTitle>
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600" data-testid="text-failed-full">
                      {data?.queueStatus.failed || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Need attention
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Daily Quota */}
              {data?.dailyQuota && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Daily Quota Usage
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Used Today</span>
                        <span data-testid="text-quota-details">
                          {data.dailyQuota.used} / {data.dailyQuota.limit} requests ({data.dailyQuota.percentage}%)
                        </span>
                      </div>
                      <Progress 
                        value={data.dailyQuota.percentage} 
                        className="h-3"
                        data-testid="progress-quota-full"
                      />
                      <p className="text-xs text-muted-foreground">
                        {data.dailyQuota.remaining} requests remaining today
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Fun Statistics */}
              {data?.statistics && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Fun Statistics
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-lg font-semibold" data-testid="text-completion-rate">
                          {data.statistics.completionRate}%
                        </div>
                        <p className="text-sm text-muted-foreground">Success Rate</p>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold flex items-center justify-center gap-1">
                          <Coffee className="h-4 w-4" />
                          <span data-testid="text-coffee-breaks">
                            {data.statistics.funnyStats.coffeeBreaksNeeded}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">Coffee Breaks Needed</p>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold" data-testid="text-digital-magic">
                          {data.statistics.funnyStats.digitalMagicLevel}
                        </div>
                        <p className="text-sm text-muted-foreground">Digital Magic Level</p>
                      </div>
                    </div>
                    <div className="mt-4 text-center">
                      <Badge variant="outline" className="text-sm" data-testid="badge-ai-happiness">
                        AI Happiness: {data.statistics.funnyStats.aiHappinessLevel}% 😊
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Messages and Tips */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Priority Tip */}
                {data?.messages.priorityTip && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Priority Tips</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm" data-testid="text-priority-tip">
                        {data.messages.priorityTip}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Encouragement */}
                {data?.messages.encouragement && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Encouragement</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm" data-testid="text-encouragement">
                        {data.messages.encouragement}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Tips */}
              {data?.tips && data.tips.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Pro Tips
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {data.tips.map((tip, index) => (
                        <li key={index} className="text-sm flex items-start gap-2" data-testid={`tip-${index}`}>
                          <span className="text-muted-foreground">•</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Auto-refresh Toggle */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Timer className="h-4 w-4" />
                      <span className="text-sm">Auto-refresh every 30 seconds</span>
                    </div>
                    <Button
                      variant={autoRefresh ? "default" : "outline"}
                      size="sm"
                      onClick={() => setAutoRefresh(!autoRefresh)}
                      data-testid="button-toggle-refresh"
                    >
                      {autoRefresh ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}