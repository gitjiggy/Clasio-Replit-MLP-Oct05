import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LoginModal } from "@/components/LoginModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, ScanEye, Zap, ShieldCheck, BanIcon, Building2 } from "lucide-react";
import heroImage from "@assets/noBgColor (1)_1759383165014.png";

export default function Landing() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailForm.from,
          to: 'support@clasio.ai',
          subject: emailForm.subject,
          message: emailForm.message
        })
      });

      if (response.ok) {
        toast({
          title: "Message sent!",
          description: "We'll get back to you soon.",
        });
        setShowContactModal(false);
        setEmailForm({ from: "", subject: "", message: "" });
      } else {
        throw new Error('Failed to send message');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-gray-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Premium Hero Section - Full Viewport */}
      <section className="relative min-h-screen flex flex-col overflow-hidden">
        {/* Premium Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-700 to-pink-600 dark:from-indigo-900 dark:via-purple-900 dark:to-pink-900"></div>
        
        {/* Animated Gradient Overlay for Depth */}
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 via-purple-500/20 to-pink-500/20 animate-pulse" style={{ animationDuration: '8s' }}></div>
        
        {/* Mesh Gradient Effect */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 left-0 w-96 h-96 bg-blue-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
          <div className="absolute top-0 right-0 w-96 h-96 bg-purple-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
          <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
        </div>
        {/* Elegant Header */}
        <header className="relative top-0 left-0 right-0 z-50 bg-transparent">
          <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16 py-6 md:py-8 flex justify-end items-center">
            <div className="flex gap-3 md:gap-4">
              <Button
                disabled
                className="bg-white hover:bg-white/90 text-purple-700 font-medium tracking-wide shadow-lg text-lg md:text-xl px-6 py-3 cursor-not-allowed"
                data-testid="button-sign-up"
              >
                SIGN UP
              </Button>
              <Button
                onClick={handleSignIn}
                className="bg-[#facf39] hover:bg-[#facf39]/90 text-gray-900 font-light tracking-wide shadow-lg text-lg md:text-xl px-6 py-3"
                data-testid="button-sign-in"
              >
                SIGN IN
              </Button>
            </div>
          </div>
        </header>

        {/* Hero Content - Premium Logo Display */}
        <div className="relative flex-1 flex flex-col items-center justify-center pt-20 md:pt-24 pb-16 md:pb-20">
          <div className="w-full max-w-5xl mx-auto px-6">
            {/* Logo Container with Glassmorphism Effect */}
            <div className="relative backdrop-blur-sm bg-white/5 rounded-3xl p-8 md:p-12 border border-white/10 shadow-2xl">
              <div className="relative">
                <img
                  src={heroImage}
                  alt="Clasio - Documents, Meet AI"
                  className="w-full h-auto max-w-3xl mx-auto drop-shadow-2xl"
                />
              </div>
            </div>
            
            {/* Tagline */}
            <div className="px-6 md:px-12 lg:px-16 mt-12 md:mt-16">
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-light text-center text-white leading-tight tracking-tight">
                <div>Clasio organizes your document chaos,</div>
                <div className="mt-2">so you don't have to.</div>
              </h1>
              <div className="flex flex-col sm:flex-row gap-5 md:gap-6 justify-center items-center mt-10 md:mt-12">
                <Button
                  onClick={handleSignIn}
                  size="lg"
                  className="bg-white hover:bg-white/90 text-purple-700 font-medium tracking-wide text-xl px-12 md:px-14 py-7 md:py-8 shadow-2xl"
                  data-testid="button-hero-sign-in"
                >
                  GET STARTED
                </Button>
                <Button
                  disabled
                  size="lg"
                  className="bg-[#facf39] hover:bg-[#facf39]/90 text-gray-900 font-light tracking-wide text-xl px-12 md:px-14 py-7 md:py-8 shadow-2xl cursor-not-allowed"
                  data-testid="button-try-demo"
                >
                  TRY DEMO
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works - Compact Spacing */}
      <section className="py-16 md:py-20 bg-gradient-to-b from-purple-50/30 via-white to-white dark:from-purple-950/10 dark:via-gray-950 dark:to-gray-950">
        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <h2 className="text-4xl md:text-6xl font-light text-center text-gray-900 dark:text-white mb-12 md:mb-16 tracking-tight">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-8 md:gap-10">
            <div className="text-center group" data-testid="card-capture">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-8 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Sparkles className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-white mb-5 tracking-wide">Capture</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-lg">
                Snap with your camera, upload from your device, or import from Google Drive.
              </p>
            </div>

            <div className="text-center group" data-testid="card-organize">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center mb-8 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                <ScanEye className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-white mb-5 tracking-wide">Organize</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-lg">
                AI auto-sorts documents into the right place, securely and reliably.
              </p>
            </div>

            <div className="text-center group" data-testid="card-find">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-8 mx-auto shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Zap className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-white mb-5 tracking-wide">Find</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-lg">
                Search by voice or text to surface any document or detail in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Why You'll Love Clasio - Compact Cards */}
      <section className="py-16 md:py-20 bg-white dark:bg-gray-950">
        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <h2 className="text-4xl md:text-6xl font-light text-center text-gray-900 dark:text-white mb-12 md:mb-16 tracking-tight">
            Why you will love Clasio
          </h2>
          <div className="grid md:grid-cols-2 gap-6 md:gap-8">
            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 hover:border-purple-500 dark:hover:border-purple-500 transition-all duration-300 hover:shadow-2xl" data-testid="card-snap-save">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg">
                <Sparkles className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-3xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">
                Snap it. Save it. Fuhgeddaboudit.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-xl">
                Capture once. Stored, secured, and searchable forever.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 hover:border-purple-500 dark:hover:border-purple-500 transition-all duration-300 hover:shadow-2xl" data-testid="card-talk-doc">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center mb-6 shadow-lg">
                <Zap className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-3xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">
                Talk to your doc.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-xl">
                Ask naturally, and your documents answer instantly.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 hover:border-indigo-500 dark:hover:border-indigo-500 transition-all duration-300 hover:shadow-2xl" data-testid="card-privacy">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg">
                <ShieldCheck className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-3xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">
                Your docs. Your business.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-xl">
                Private by design. Never training LLMs. Yes, really.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 hover:border-pink-500 dark:hover:border-pink-500 transition-all duration-300 hover:shadow-2xl" data-testid="card-auto-organize">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center mb-6 shadow-lg">
                <ScanEye className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-3xl font-light text-gray-900 dark:text-white mb-4 tracking-wide">
                Folders, Schmolders.
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed font-light text-xl">
                Chaos out, clarity in. Every file files itself.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Infinite Scrolling Trust Strip - At Bottom */}
      <section className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 dark:from-indigo-900 dark:via-purple-900 dark:to-pink-900 py-6 overflow-hidden">
        <div className="flex animate-scroll whitespace-nowrap">
          {[...Array(4)].map((_, groupIndex) => (
            <div key={groupIndex} className="flex items-center gap-16 px-8">
              <div className="flex items-center gap-4" data-testid="trust-private">
                <ShieldCheck className="w-6 h-6 text-white" />
                <p className="text-white font-light tracking-wide text-base md:text-lg">PRIVATE BY DESIGN</p>
              </div>
              <div className="flex items-center gap-4" data-testid="trust-no-training">
                <BanIcon className="w-6 h-6 text-white" />
                <p className="text-white font-light tracking-wide text-base md:text-lg">NO TRAINING LLMS</p>
              </div>
              <div className="flex items-center gap-4" data-testid="trust-enterprise">
                <Building2 className="w-6 h-6 text-white" />
                <p className="text-white font-light tracking-wide text-base md:text-lg">ENTERPRISE GRADE</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Premium Footer */}
      <footer className="bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 py-12">
        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-base font-light text-gray-500 dark:text-gray-500 tracking-wide">
              © 2025 CLASIO. ALL RIGHTS RESERVED.
            </div>
            <div className="flex gap-8">
              <a
                href="/privacy"
                className="text-lg font-light text-gray-900 dark:text-white hover:text-[#55b3f3] dark:hover:text-[#55b3f3] transition-colors tracking-wide"
                data-testid="link-privacy"
              >
                PRIVACY
              </a>
              <a
                href="/legal"
                className="text-lg font-light text-gray-900 dark:text-white hover:text-[#55b3f3] dark:hover:text-[#55b3f3] transition-colors tracking-wide"
                data-testid="link-legal"
              >
                LEGAL
              </a>
              <a
                href="/proof"
                className="text-lg font-light text-gray-900 dark:text-white hover:text-[#55b3f3] dark:hover:text-[#55b3f3] transition-colors tracking-wide"
                data-testid="link-proof"
              >
                PROOF
              </a>
              <button
                onClick={() => setShowContactModal(true)}
                className="text-lg font-light text-gray-900 dark:text-white hover:text-[#55b3f3] dark:hover:text-[#55b3f3] transition-colors tracking-wide"
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
              <Label htmlFor="from" className="font-light tracking-wide text-base">Your Email</Label>
              <Input
                id="from"
                type="email"
                value={emailForm.from}
                onChange={(e) => setEmailForm({ ...emailForm, from: e.target.value })}
                placeholder={user?.email || "your@email.com"}
                required
                className="font-light text-base"
                data-testid="input-contact-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject" className="font-light tracking-wide text-base">Subject</Label>
              <Input
                id="subject"
                type="text"
                value={emailForm.subject}
                onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                placeholder="What's this about?"
                required
                className="font-light text-base"
                data-testid="input-contact-subject"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message" className="font-light tracking-wide text-base">Message</Label>
              <Textarea
                id="message"
                value={emailForm.message}
                onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })}
                placeholder="Tell us what's on your mind..."
                rows={6}
                required
                className="font-light resize-none text-base"
                data-testid="input-contact-message"
              />
            </div>
            <div className="text-sm font-light text-gray-500 dark:text-gray-400">
              This will be sent to: support@clasio.ai
            </div>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#55b3f3] hover:bg-[#55b3f3]/90 text-white font-light tracking-wide text-base"
              data-testid="button-send-contact"
            >
              {isSubmitting ? "SENDING..." : "SEND MESSAGE"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
