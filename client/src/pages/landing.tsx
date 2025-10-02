import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LoginModal } from "@/components/LoginModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, ScanEye, Zap, ShieldCheck, BanIcon, Building2 } from "lucide-react";
import heroImage from "@assets/with_padding_1759374990669.png";

export default function Landing() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [emailForm, setEmailForm] = useState({
    from: "",
    subject: "",
    message: ""
  });

  useEffect(() => {
    if (user) {
      setLocation("/documents");
    }
  }, [user, setLocation]);

  useEffect(() => {
    if (user && showContactModal) {
      setEmailForm(prev => ({ ...prev, from: user.email || "" }));
    }
  }, [user, showContactModal]);

  const handleSignIn = () => {
    setShowLoginModal(true);
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Email functionality would integrate with backend
    console.log("Email to support@clasio.ai:", emailForm);
    setShowContactModal(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-gray-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Premium Hero Section - Full Viewport */}
      <section className="relative min-h-screen flex flex-col">
        {/* Elegant Header */}
        <header className="absolute top-0 left-0 right-0 z-50 bg-transparent">
          <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16 py-6 md:py-8 flex justify-between items-center">
            <div className="text-2xl md:text-3xl font-light tracking-wide text-gray-900 dark:text-white">
              CLASIO
            </div>
            <div className="flex gap-3 md:gap-4">
              <Button
                variant="ghost"
                onClick={handleSignIn}
                className="text-gray-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/5 font-light tracking-wide"
                data-testid="button-sign-in"
              >
                SIGN IN
              </Button>
              <Button
                onClick={handleSignIn}
                className="bg-[#facf39] hover:bg-[#facf39]/90 text-gray-900 font-light tracking-wide shadow-lg"
                data-testid="button-sign-up"
              >
                SIGN IN
              </Button>
            </div>
          </div>
        </header>

        {/* Hero Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 md:px-12 lg:px-16 pt-24 pb-12 md:pt-32 md:pb-20">
          <div className="w-full max-w-5xl mx-auto">
            <img
              src={heroImage}
              alt="Clasio - Documents, Meet AI"
              className="w-full max-w-3xl mx-auto mb-8 md:mb-12 drop-shadow-2xl"
            />
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-light text-center text-gray-900 dark:text-white mb-12 md:mb-16 leading-tight tracking-tight max-w-4xl mx-auto">
              Clasio organizes your document chaos, so you don't have to.
            </h1>
            <div className="flex flex-col sm:flex-row gap-4 md:gap-6 justify-center items-center">
              <Button
                onClick={handleSignIn}
                size="lg"
                className="bg-[#55b3f3] hover:bg-[#55b3f3]/90 text-white font-light tracking-wide text-base md:text-lg px-10 md:px-12 py-6 md:py-7 shadow-xl"
                data-testid="button-hero-sign-in"
              >
                GET STARTED
              </Button>
              <Button
                disabled
                size="lg"
                variant="outline"
                className="border-2 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white font-light tracking-wide text-base md:text-lg px-10 md:px-12 py-6 md:py-7"
                data-testid="button-try-demo"
              >
                TRY DEMO
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Infinite Scrolling Trust Strip */}
      <section className="bg-gradient-to-r from-[#55b3f3] to-[#4a9fd9] py-4 overflow-hidden">
        <div className="flex animate-scroll whitespace-nowrap">
          {[...Array(4)].map((_, groupIndex) => (
            <div key={groupIndex} className="flex items-center gap-12 px-6">
              <div className="flex items-center gap-3" data-testid="trust-private">
                <ShieldCheck className="w-5 h-5 text-white" />
                <p className="text-white font-light tracking-wide text-sm">PRIVATE BY DESIGN</p>
              </div>
              <div className="flex items-center gap-3" data-testid="trust-no-training">
                <BanIcon className="w-5 h-5 text-white" />
                <p className="text-white font-light tracking-wide text-sm">NO TRAINING LLMS</p>
              </div>
              <div className="flex items-center gap-3" data-testid="trust-enterprise">
                <Building2 className="w-5 h-5 text-white" />
                <p className="text-white font-light tracking-wide text-sm">ENTERPRISE GRADE</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works - Premium Spacing */}
      <section className="py-24 md:py-32 bg-white dark:bg-gray-950">
        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <h2 className="text-3xl md:text-5xl font-light text-center text-gray-900 dark:text-white mb-20 tracking-tight">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-12 md:gap-16">
            <div className="text-center group" data-testid="card-capture">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#55b3f3] to-[#4a9fd9] flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl md:text-2xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">Capture</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light">
                Snap with your camera, upload from your device, or import from Google Drive.
              </p>
            </div>

            <div className="text-center group" data-testid="card-organize">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#facf39] to-[#e6b82e] flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                <ScanEye className="w-8 h-8 text-gray-900" />
              </div>
              <h3 className="text-xl md:text-2xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">Organize</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light">
                AI auto-sorts documents into the right place, securely and reliably.
              </p>
            </div>

            <div className="text-center group" data-testid="card-find">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#55b3f3] to-[#4a9fd9] flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl md:text-2xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">Find</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light">
                Search by voice or text to surface any document or detail in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Why You'll Love Clasio - Premium Cards */}
      <section className="py-24 md:py-32 bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-950">
        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <h2 className="text-3xl md:text-5xl font-light text-center text-gray-900 dark:text-white mb-20 tracking-tight">
            Why you will love Clasio
          </h2>
          <div className="grid md:grid-cols-2 gap-8 md:gap-12">
            <div className="bg-white dark:bg-gray-950 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 hover:border-[#55b3f3] dark:hover:border-[#55b3f3] transition-all duration-300 hover:shadow-2xl" data-testid="card-snap-save">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#55b3f3] to-[#4a9fd9] flex items-center justify-center mb-6 shadow-lg">
                <Sparkles className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-2xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">
                Snap it. Save it. Fuhgeddaboudit.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-lg">
                Capture once. Stored, secured, and searchable forever.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-950 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 hover:border-[#facf39] dark:hover:border-[#facf39] transition-all duration-300 hover:shadow-2xl" data-testid="card-talk-doc">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#facf39] to-[#e6b82e] flex items-center justify-center mb-6 shadow-lg">
                <Zap className="w-7 h-7 text-gray-900" />
              </div>
              <h3 className="text-2xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">
                Talk to your doc.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-lg">
                Ask naturally, and your documents answer instantly.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-950 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 hover:border-[#55b3f3] dark:hover:border-[#55b3f3] transition-all duration-300 hover:shadow-2xl" data-testid="card-privacy">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#55b3f3] to-[#4a9fd9] flex items-center justify-center mb-6 shadow-lg">
                <ShieldCheck className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-2xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">
                Your docs. Your business.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-lg">
                Private by design. Never training LLMs. Yes, really.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-950 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 hover:border-[#facf39] dark:hover:border-[#facf39] transition-all duration-300 hover:shadow-2xl" data-testid="card-auto-organize">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#facf39] to-[#e6b82e] flex items-center justify-center mb-6 shadow-lg">
                <ScanEye className="w-7 h-7 text-gray-900" />
              </div>
              <h3 className="text-2xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">
                Folders, Schmolders.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-lg">
                Chaos out, clarity in. Every file files itself.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Premium CTA */}
      <section className="py-24 md:py-32 bg-gradient-to-br from-[#55b3f3] to-[#4a9fd9]">
        <div className="max-w-4xl mx-auto px-6 md:px-12 text-center">
          <h2 className="text-3xl md:text-5xl lg:text-6xl font-light text-white mb-12 tracking-tight leading-tight">
            Ready to end document chaos?
          </h2>
          <Button
            onClick={handleSignIn}
            size="lg"
            className="bg-white hover:bg-gray-100 text-[#55b3f3] font-light tracking-wide text-lg px-12 py-7 shadow-2xl"
            data-testid="button-get-started"
          >
            GET STARTED FREE
          </Button>
        </div>
      </section>

      {/* Premium Footer */}
      <footer className="bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 py-12">
        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-sm font-light text-gray-500 dark:text-gray-500 tracking-wide">
              © 2025 CLASIO. ALL RIGHTS RESERVED.
            </div>
            <div className="flex gap-8">
              <a
                href="/privacy"
                className="text-base font-light text-gray-900 dark:text-white hover:text-[#55b3f3] dark:hover:text-[#55b3f3] transition-colors tracking-wide"
                data-testid="link-privacy"
              >
                PRIVACY
              </a>
              <a
                href="/legal"
                className="text-base font-light text-gray-900 dark:text-white hover:text-[#55b3f3] dark:hover:text-[#55b3f3] transition-colors tracking-wide"
                data-testid="link-legal"
              >
                LEGAL
              </a>
              <a
                href="/proof"
                className="text-base font-light text-gray-900 dark:text-white hover:text-[#55b3f3] dark:hover:text-[#55b3f3] transition-colors tracking-wide"
                data-testid="link-proof"
              >
                PROOF
              </a>
              <button
                onClick={() => setShowContactModal(true)}
                className="text-base font-light text-gray-900 dark:text-white hover:text-[#55b3f3] dark:hover:text-[#55b3f3] transition-colors tracking-wide"
                data-testid="link-contact"
              >
                CONTACT US
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* Login Modal */}
      <LoginModal open={showLoginModal} onOpenChange={setShowLoginModal} />

      {/* Contact Modal */}
      <Dialog open={showContactModal} onOpenChange={setShowContactModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-light tracking-wide">Contact Us</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleContactSubmit} className="space-y-6 mt-4">
            <div className="space-y-2">
              <Label htmlFor="from" className="font-light tracking-wide">Your Email</Label>
              <Input
                id="from"
                type="email"
                value={emailForm.from}
                onChange={(e) => setEmailForm({ ...emailForm, from: e.target.value })}
                placeholder={user?.email || "your@email.com"}
                required
                className="font-light"
                data-testid="input-contact-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject" className="font-light tracking-wide">Subject</Label>
              <Input
                id="subject"
                type="text"
                value={emailForm.subject}
                onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                placeholder="What's this about?"
                required
                className="font-light"
                data-testid="input-contact-subject"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message" className="font-light tracking-wide">Message</Label>
              <Textarea
                id="message"
                value={emailForm.message}
                onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })}
                placeholder="Tell us what's on your mind..."
                rows={6}
                required
                className="font-light resize-none"
                data-testid="input-contact-message"
              />
            </div>
            <div className="text-xs font-light text-gray-500 dark:text-gray-400">
              This will be sent to: support@clasio.ai
            </div>
            <Button
              type="submit"
              className="w-full bg-[#55b3f3] hover:bg-[#55b3f3]/90 text-white font-light tracking-wide"
              data-testid="button-send-contact"
            >
              SEND MESSAGE
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
