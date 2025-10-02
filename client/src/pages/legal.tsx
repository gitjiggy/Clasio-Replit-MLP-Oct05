import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Legal() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-gray-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-4 md:py-6">
          <Link href="/">
            <Button variant="ghost" className="gap-2 font-light" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12">
        <h1 className="text-3xl md:text-4xl font-light text-gray-900 dark:text-gray-100 mb-3 md:mb-4 tracking-wide">
          Terms & Conditions
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 md:mb-8 font-light">Last updated: September 2025</p>
        
        <div className="max-w-none">
          <p className="text-base md:text-lg text-gray-700 dark:text-gray-300 mb-6 md:mb-8 font-light">
            Welcome to Clasio.ai! These Terms & Conditions ("Terms") explain your rights and responsibilities when using our service.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">1. Acceptance of Terms</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            By accessing or using Clasio.ai, you agree to these Terms. If you don't agree, please do not use our service.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">2. Who Can Use Clasio.ai</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Clasio.ai is available to both individuals and small/medium businesses. You must be at least 18 years old or have the legal authority to agree to these Terms.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">3. Free Service (MVP)</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Clasio.ai is currently free to use. If pricing is introduced in the future, users will be notified and provided new terms.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">4. What You Can Do</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li>Upload your own documents to Clasio.ai for personal or business use.</li>
            <li>Use Clasio.ai to organize, classify, and search your documents.</li>
          </ul>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">5. What You Cannot Do</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-2 font-light">You agree not to:</p>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li>Upload illegal, obscene, or infringing content.</li>
            <li>Use Clasio.ai for fraudulent, harmful, or abusive purposes.</li>
            <li>Attempt to hack, overload, or interfere with the service.</li>
          </ul>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">6. Document Handling & AI Analysis</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Clasio.ai uses Google Gemini AI to summarize and classify your documents. Your documents are not used to train AI models. Google does not retain your documents after processing. Each API call is private and independent.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">7. Service Availability</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            We do our best to keep Clasio.ai running smoothly, but we don't guarantee 100% uptime. The service may change or be discontinued at any time.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">8. Termination</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            We may suspend or terminate accounts that violate these Terms.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">9. Limitation of Liability</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Clasio.ai is provided "as is." We are not responsible for losses or damages resulting from use of the service.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">10. Changes to Terms</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            We may update these Terms from time to time. We'll notify users of significant changes by posting updates on the website.
          </p>
        </div>
      </main>
    </div>
  );
}
