import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LoginModal } from "@/components/LoginModal";
import { Camera, FileUp, FolderSearch, Search, Mic, Shield, Clock, Ban, Building } from "lucide-react";
import heroImage from "@assets/g+ihSqAuBg7pgAAAABJRU5ErkJggg==_1759367618851.png";

export default function Landing() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    if (user) {
      setLocation("/documents");
    }
  }, [user, setLocation]);

  const handleSignIn = () => {
    setShowLoginModal(true);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-10 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-[#55b3f3]">Clasio</div>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={handleSignIn}
              className="text-gray-900 dark:text-gray-100 hover:bg-[#55b3f3]/10"
              data-testid="button-sign-in"
            >
              Sign In
            </Button>
            <Button
              disabled
              className="bg-[#facf39] hover:bg-[#facf39]/90 text-gray-900 font-semibold"
              data-testid="button-sign-up"
            >
              Sign Up Free
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 md:px-8 lg:px-10 py-12 md:py-20">
        <div className="text-center">
          <img
            src={heroImage}
            alt="Clasio - Documents, Meet AI"
            className="w-full max-w-4xl mx-auto mb-8 md:mb-12"
          />
          <h1 className="text-2xl md:text-4xl lg:text-5xl font-semibold text-gray-900 dark:text-gray-100 mb-8 leading-tight max-w-4xl mx-auto">
            Clasio organizes your document chaos, so you don't have to.
          </h1>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              onClick={handleSignIn}
              size="lg"
              className="bg-[#55b3f3] hover:bg-[#55b3f3]/90 text-white font-semibold text-lg px-8 py-6"
              data-testid="button-hero-sign-in"
            >
              Sign In
            </Button>
            <Button
              disabled
              size="lg"
              variant="outline"
              className="border-2 border-[#facf39] text-gray-900 dark:text-gray-100 font-semibold text-lg px-8 py-6"
              data-testid="button-try-demo"
            >
              Try Demo
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-gray-50 dark:bg-gray-900 py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-10">
          <h2 className="text-3xl md:text-4xl font-semibold text-gray-900 dark:text-gray-100 text-center mb-12">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 md:p-8 shadow-sm" data-testid="card-capture">
              <div className="w-12 h-12 rounded-full bg-[#55b3f3]/10 flex items-center justify-center mb-4">
                <Camera className="w-6 h-6 text-[#55b3f3]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">Capture</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Snap with your camera, upload from your device, or import from Google Drive.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 md:p-8 shadow-sm" data-testid="card-organize">
              <div className="w-12 h-12 rounded-full bg-[#facf39]/10 flex items-center justify-center mb-4">
                <FolderSearch className="w-6 h-6 text-[#facf39]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">Organize</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                AI auto-sorts documents into the right place, securely and reliably.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 md:p-8 shadow-sm" data-testid="card-find">
              <div className="w-12 h-12 rounded-full bg-[#55b3f3]/10 flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-[#55b3f3]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">Find</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Search by voice or text to surface any document or detail in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Why You'll Love Clasio */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-10">
          <h2 className="text-3xl md:text-4xl font-semibold text-gray-900 dark:text-gray-100 text-center mb-12">
            Why you will love Clasio
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 md:p-8" data-testid="card-snap-save">
              <div className="w-12 h-12 rounded-full bg-[#55b3f3]/10 flex items-center justify-center mb-4">
                <FileUp className="w-6 h-6 text-[#55b3f3]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Snap it. Save it. Fuhgeddaboudit.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Capture once. Stored, secured, and searchable forever.
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 md:p-8" data-testid="card-talk-doc">
              <div className="w-12 h-12 rounded-full bg-[#facf39]/10 flex items-center justify-center mb-4">
                <Mic className="w-6 h-6 text-[#facf39]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Talk to your doc.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Ask naturally, and your documents answer instantly.
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 md:p-8" data-testid="card-privacy">
              <div className="w-12 h-12 rounded-full bg-[#55b3f3]/10 flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-[#55b3f3]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Your docs. Your business.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Private by design. Never training LLMs. Yes, really.
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 md:p-8" data-testid="card-auto-organize">
              <div className="w-12 h-12 rounded-full bg-[#facf39]/10 flex items-center justify-center mb-4">
                <FolderSearch className="w-6 h-6 text-[#facf39]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Folders, Schmolders.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Chaos out, clarity in. Every file files itself.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Strip */}
      <section className="bg-[#55b3f3] py-8">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div className="flex flex-col items-center" data-testid="trust-private">
              <Shield className="w-8 h-8 text-white mb-2" />
              <p className="text-white font-medium text-sm md:text-base">Private by design</p>
            </div>
            <div className="flex flex-col items-center" data-testid="trust-fast">
              <Clock className="w-8 h-8 text-white mb-2" />
              <p className="text-white font-medium text-sm md:text-base">Organize in minutes</p>
            </div>
            <div className="flex flex-col items-center" data-testid="trust-no-training">
              <Ban className="w-8 h-8 text-white mb-2" />
              <p className="text-white font-medium text-sm md:text-base">No training LLMs</p>
            </div>
            <div className="flex flex-col items-center" data-testid="trust-enterprise">
              <Building className="w-8 h-8 text-white mb-2" />
              <p className="text-white font-medium text-sm md:text-base">Enterprise grade</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Band */}
      <section className="py-16 md:py-24 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-6 md:px-8 lg:px-10 text-center">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold text-gray-900 dark:text-gray-100 mb-8">
            Ready to end document chaos?
          </h2>
          <Button
            onClick={handleSignIn}
            size="lg"
            className="bg-[#55b3f3] hover:bg-[#55b3f3]/90 text-white font-semibold text-lg px-10 py-6"
            data-testid="button-get-started"
          >
            Get Started Free
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 py-8">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              © 2025 Clasio. All rights reserved.
            </div>
            <div className="flex gap-6">
              <a
                href="/privacy"
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-[#55b3f3] transition-colors"
                data-testid="link-privacy"
              >
                Privacy
              </a>
              <a
                href="/legal"
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-[#55b3f3] transition-colors"
                data-testid="link-legal"
              >
                Legal
              </a>
              <a
                href="/proof"
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-[#55b3f3] transition-colors"
                data-testid="link-proof"
              >
                Proof
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Login Modal */}
      <LoginModal open={showLoginModal} onOpenChange={setShowLoginModal} />
    </div>
  );
}
