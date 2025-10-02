import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
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
        <h1 className="text-3xl md:text-4xl font-light text-gray-900 dark:text-gray-100 mb-6 md:mb-8 tracking-wide">
          Privacy Policy
        </h1>
        
        <div className="max-w-none">
          <p className="text-base md:text-lg text-gray-700 dark:text-gray-300 mb-6 md:mb-8 font-light">
            Your privacy matters to us. This Privacy Policy explains what information we collect, how we use it, and how we protect it.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">1. Information We Collect</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li><strong>Account info:</strong> name, email (via Firebase Authentication).</li>
            <li><strong>Usage info:</strong> crash reports, analytics (via Firebase/Google Analytics).</li>
            <li><strong>Documents:</strong> files you upload or connect from Google Drive.</li>
          </ul>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">2. How We Use Information</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li>To provide the service (store, classify, and let you search your documents).</li>
            <li>To improve performance and reliability through analytics.</li>
            <li>To respond to user support requests.</li>
          </ul>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">3. Document Processing & AI</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4 font-light">We use Google Gemini AI for:</p>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li>Summaries (2–3 lines)</li>
            <li>Key topics (up to 5)</li>
            <li>Document type (e.g., invoice, contract, ID)</li>
            <li>Filing category (e.g., taxes, medical, insurance)</li>
            <li>Word count</li>
          </ul>
          <p className="text-gray-700 dark:text-gray-300 mt-4 font-light">
            <strong>Important:</strong> Your documents are NOT used to train AI models.
          </p>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 mt-2 font-light">
            <li>Google Gemini API does not retain documents after processing.</li>
            <li>Each analysis request is independent and private.</li>
          </ul>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">4. Document Storage</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li>Documents are stored securely in Google Cloud Storage (GCS).</li>
            <li>Metadata (like tags, categories) is stored in Firestore/Postgres.</li>
            <li>Documents are encrypted and accessed only via signed URLs.</li>
          </ul>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">5. Sharing of Information</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4 font-light">
            We do not sell or share your personal data with advertisers. We only use third-party services required to run Clasio.ai:
          </p>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li>Firebase (authentication, analytics, crash reporting)</li>
            <li>Google Gemini AI (document analysis)</li>
            <li>Google Drive (document ingest, if user connects)</li>
            <li>Replit (backend hosting)</li>
          </ul>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">6. Data Retention & Deletion</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li>You may request deletion of your documents and account at any time, even if you stop using the service.</li>
            <li>Deleted data will be permanently removed from GCS and related systems within a reasonable timeframe.</li>
          </ul>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">7. Security</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            We take reasonable steps to protect your documents with encryption and secure access. However, no system is 100% secure, so please use Clasio.ai responsibly.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">8. Children's Privacy</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Clasio.ai is not directed to children under 18. We do not knowingly collect data from children.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">9. Changes to Privacy Policy</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            We may update this Privacy Policy from time to time. We'll notify users of significant changes by posting updates on the website.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">10. Contact Us</h2>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            If you have questions, please reach out to us at support@clasio.ai
          </p>
        </div>
      </main>
    </div>
  );
}
