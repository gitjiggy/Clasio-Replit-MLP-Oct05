import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Users, TrendingUp, HardDrive, RefreshCw, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { useState } from "react";

interface SystemMetrics {
  total_documents: number;
  total_users: number;
  documents_per_user: number;
  storage_used_mb: number;
  storage_used_gb: number;
}

interface AnalyticsResponse {
  success: boolean;
  metrics: SystemMetrics;
  timestamp: string;
}

export default function Analytics() {
  const { user } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<AnalyticsResponse>({
    queryKey: ["/api/analytics/system-metrics"],
    enabled: !!user,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-indigo-950 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-indigo-500" />
              Analytics Dashboard
            </CardTitle>
            <CardDescription>
              Sign in to view system analytics and metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => setShowLoginModal(true)} 
              className="w-full"
              data-testid="button-signin-analytics"
            >
              Sign In to View Analytics
            </Button>
          </CardContent>
        </Card>
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  if (user.email !== "niraj.desai@gmail.com") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-indigo-950 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-amber-200 dark:border-amber-800">
          <CardHeader>
            <CardTitle className="text-amber-600 dark:text-amber-400">Access Restricted</CardTitle>
            <CardDescription>
              This analytics dashboard is only accessible to authorized administrators.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              You are currently signed in as: <strong>{user.email}</strong>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-indigo-950 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Error Loading Analytics</CardTitle>
            <CardDescription>
              Failed to load system metrics. Please try again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => refetch()} 
              variant="outline"
              data-testid="button-retry-analytics"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = data?.metrics;
  const lastUpdated = data?.timestamp ? new Date(data.timestamp).toLocaleString() : "N/A";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-indigo-950">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl md:text-4xl font-light text-gray-900 dark:text-white flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-indigo-500" />
              Analytics Dashboard
            </h1>
            <Button
              onClick={() => refetch()}
              variant="outline"
              size="sm"
              disabled={isLoading}
              data-testid="button-refresh-analytics"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <p className="text-gray-600 dark:text-gray-400 font-light">
            Real-time system metrics and usage statistics
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Last updated: {lastUpdated}
          </p>
        </div>

        {/* Metrics Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="animate-pulse" data-testid={`card-loading-${i}`}>
                <CardHeader className="pb-3">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2"></div>
                  <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Total Documents */}
            <Card className="border-indigo-200 dark:border-indigo-800 hover:shadow-lg transition-shadow" data-testid="card-total-documents">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-light text-gray-600 dark:text-gray-400">
                    Total Documents
                  </CardTitle>
                  <FileText className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="text-3xl font-light text-gray-900 dark:text-white mt-2" data-testid="text-total-documents">
                  {metrics?.total_documents?.toLocaleString() || "0"}
                </div>
              </CardHeader>
            </Card>

            {/* Total Users */}
            <Card className="border-purple-200 dark:border-purple-800 hover:shadow-lg transition-shadow" data-testid="card-total-users">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-light text-gray-600 dark:text-gray-400">
                    Total Users
                  </CardTitle>
                  <Users className="w-5 h-5 text-purple-500" />
                </div>
                <div className="text-3xl font-light text-gray-900 dark:text-white mt-2" data-testid="text-total-users">
                  {metrics?.total_users?.toLocaleString() || "0"}
                </div>
              </CardHeader>
            </Card>

            {/* Docs per User */}
            <Card className="border-violet-200 dark:border-violet-800 hover:shadow-lg transition-shadow" data-testid="card-docs-per-user">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-light text-gray-600 dark:text-gray-400">
                    Docs per User
                  </CardTitle>
                  <TrendingUp className="w-5 h-5 text-violet-500" />
                </div>
                <div className="text-3xl font-light text-gray-900 dark:text-white mt-2" data-testid="text-docs-per-user">
                  {metrics?.documents_per_user?.toFixed(1) || "0.0"}
                </div>
              </CardHeader>
            </Card>

            {/* Storage Used */}
            <Card className="border-indigo-200 dark:border-indigo-800 hover:shadow-lg transition-shadow" data-testid="card-storage-used">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-light text-gray-600 dark:text-gray-400">
                    Storage Used
                  </CardTitle>
                  <HardDrive className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="text-3xl font-light text-gray-900 dark:text-white mt-2" data-testid="text-storage-used">
                  {metrics?.storage_used_gb?.toFixed(2) || "0.00"} GB
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1" data-testid="text-storage-mb">
                  ({metrics?.storage_used_mb?.toFixed(2) || "0.00"} MB)
                </p>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Additional Info */}
        <Card className="mt-8" data-testid="card-info">
          <CardHeader>
            <CardTitle className="text-lg font-light">About These Metrics</CardTitle>
            <CardDescription className="font-light">
              These metrics are calculated in real-time from your PostgreSQL database and represent the current state of your Clasio document management system.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600 dark:text-gray-400 font-light">
            <div className="flex items-start gap-2">
              <span className="text-indigo-500">•</span>
              <p><strong className="font-normal">Total Documents:</strong> Number of active documents (excluding deleted/trashed items)</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-500">•</span>
              <p><strong className="font-normal">Total Users:</strong> Unique authenticated users who have uploaded at least one document</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-violet-500">•</span>
              <p><strong className="font-normal">Docs per User:</strong> Average number of documents per user across all users</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-500">•</span>
              <p><strong className="font-normal">Storage Used:</strong> Total file storage consumed by all documents in the system</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
