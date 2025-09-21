// Comprehensive document classifications that Gemini AI recognizes
// These are based on common document categories and types that AI models are trained on

export const DOCUMENT_CATEGORIES = [
  "Business",
  "Education", 
  "Financial",
  "Legal",
  "Medical",
  "Technical",
  "Personal",
  "Academic",
  "Government",
  "Research",
  "Marketing",
  "HR",
  "Operations",
  "Compliance",
  "Creative",
  "Communication",
  "Project Management",
  "Sales",
  "Customer Service",
  "IT",
  "Engineering",
  "Real Estate",
  "Insurance",
  "Healthcare",
  "Scientific",
  "Administrative",
  "Training",
  "Policy",
  "Procurement",
  "Quality Assurance"
] as const;

export const DOCUMENT_TYPES_BY_CATEGORY: Record<string, string[]> = {
  "Business": [
    "Business Plan",
    "Proposal",
    "Contract",
    "Agreement",
    "Meeting Minutes",
    "Report",
    "Presentation",
    "Memo",
    "Policy Document",
    "Procedure Manual",
    "Strategic Plan",
    "Market Analysis",
    "Business Case",
    "Requirements Document",
    "Specification",
    "Vendor Agreement",
    "Partnership Agreement",
    "Non-disclosure Agreement",
    "Terms of Service",
    "Privacy Policy"
  ],
  "Financial": [
    "Invoice",
    "Receipt",
    "Financial Statement",
    "Budget",
    "Tax Document",
    "Bank Statement",
    "Purchase Order",
    "Expense Report",
    "Audit Report",
    "Financial Plan",
    "Investment Report",
    "Cash Flow Statement",
    "Balance Sheet",
    "Income Statement",
    "Tax Return",
    "Credit Report",
    "Insurance Document",
    "Loan Document",
    "Payment Record",
    "Account Statement"
  ],
  "Legal": [
    "Contract",
    "Legal Brief",
    "Court Filing",
    "Settlement Agreement",
    "Power of Attorney",
    "Will",
    "Lease Agreement",
    "Employment Contract",
    "License Agreement",
    "Terms and Conditions",
    "Legal Opinion",
    "Affidavit",
    "Deposition",
    "Patent Application",
    "Trademark Filing",
    "Copyright Document",
    "Compliance Document",
    "Regulatory Filing",
    "Legal Notice",
    "Subpoena"
  ],
  "Education": [
    "Syllabus",
    "Lesson Plan",
    "Assignment",
    "Exam",
    "Transcript",
    "Diploma",
    "Certificate",
    "Research Paper",
    "Thesis",
    "Dissertation",
    "Academic Article",
    "Course Material",
    "Study Guide",
    "Curriculum",
    "Grade Report",
    "Student Record",
    "Enrollment Form",
    "Application",
    "Recommendation Letter",
    "Academic Calendar"
  ],
  "Medical": [
    "Medical Record",
    "Lab Result",
    "Prescription",
    "Medical Report",
    "Discharge Summary",
    "Treatment Plan",
    "Insurance Claim",
    "Medical Certificate",
    "Patient Form",
    "Consent Form",
    "Medical History",
    "Diagnostic Report",
    "Radiology Report",
    "Pathology Report",
    "Clinical Notes",
    "Referral Letter",
    "Medical Invoice",
    "Vaccination Record",
    "Allergy Information",
    "Medication List"
  ],
  "Technical": [
    "Technical Documentation",
    "API Documentation",
    "User Manual",
    "Installation Guide",
    "Configuration Guide",
    "Technical Specification",
    "System Requirements",
    "Architecture Document",
    "Design Document",
    "Code Review",
    "Bug Report",
    "Test Plan",
    "Deployment Guide",
    "Troubleshooting Guide",
    "Release Notes",
    "Change Log",
    "Security Document",
    "Performance Report",
    "Technical Proposal",
    "Standard Operating Procedure"
  ],
  "Personal": [
    "Personal Statement",
    "Resume",
    "Cover Letter",
    "Reference Letter",
    "Personal Letter",
    "Journal Entry",
    "Diary",
    "Family Document",
    "Travel Document",
    "Personal Plan",
    "Goal Setting",
    "Personal Budget",
    "Personal Contract",
    "Emergency Contact",
    "Personal Information",
    "Identification Document",
    "Personal Record",
    "Personal Note",
    "Personal Schedule",
    "Personal Inventory"
  ],
  "Academic": [
    "Research Paper",
    "Journal Article",
    "Conference Paper",
    "Thesis",
    "Dissertation",
    "Literature Review",
    "Case Study",
    "White Paper",
    "Academic Proposal",
    "Grant Application",
    "Research Methodology",
    "Data Analysis",
    "Survey Results",
    "Academic Report",
    "Peer Review",
    "Abstract",
    "Bibliography",
    "Citation",
    "Academic Calendar",
    "Course Outline"
  ],
  "HR": [
    "Job Description",
    "Employee Handbook",
    "Performance Review",
    "Employment Contract",
    "Offer Letter",
    "Resignation Letter",
    "Training Record",
    "Disciplinary Record",
    "Payroll Document",
    "Benefits Information",
    "Policy Manual",
    "Organizational Chart",
    "Staff Directory",
    "Time Sheet",
    "Leave Request",
    "Performance Plan",
    "Training Material",
    "Recruitment Document",
    "Exit Interview",
    "Employee Survey"
  ],
  "Marketing": [
    "Marketing Plan",
    "Campaign Brief",
    "Creative Brief",
    "Brand Guidelines",
    "Market Research",
    "Customer Survey",
    "Advertising Copy",
    "Press Release",
    "Marketing Report",
    "Social Media Plan",
    "Content Strategy",
    "SEO Report",
    "Analytics Report",
    "Lead Generation Report",
    "Email Campaign",
    "Landing Page Copy",
    "Product Description",
    "Marketing Proposal",
    "Competitive Analysis",
    "Brand Manual"
  ],
  "Research": [
    "Research Proposal",
    "Research Report",
    "Data Collection Form",
    "Survey Questionnaire",
    "Interview Transcript",
    "Focus Group Report",
    "Experimental Design",
    "Statistical Analysis",
    "Research Findings",
    "Methodology Document",
    "Ethics Approval",
    "Consent Form",
    "Data Management Plan",
    "Literature Review",
    "Research Protocol",
    "Lab Notes",
    "Field Notes",
    "Research Summary",
    "Publication Draft",
    "Grant Report"
  ],
  "Government": [
    "Government Form",
    "Official Document",
    "Public Record",
    "Government Report",
    "Policy Document",
    "Regulation",
    "License",
    "Permit",
    "Certificate",
    "Government Contract",
    "Procurement Document",
    "Public Notice",
    "Meeting Minutes",
    "Agenda",
    "Resolution",
    "Ordinance",
    "Government Plan",
    "Budget Document",
    "Audit Report",
    "Compliance Report"
  ]
};

// Get all document types across all categories
export const ALL_DOCUMENT_TYPES = Object.values(DOCUMENT_TYPES_BY_CATEGORY).flat();

// Function to get document types for a specific category
export function getDocumentTypesForCategory(category: string): string[] {
  return DOCUMENT_TYPES_BY_CATEGORY[category] || [];
}

// Function to search categories by query
export function searchCategories(query: string): string[] {
  if (!query.trim()) return DOCUMENT_CATEGORIES.slice();
  
  const lowercaseQuery = query.toLowerCase();
  return DOCUMENT_CATEGORIES.filter(category =>
    category.toLowerCase().includes(lowercaseQuery)
  );
}

// Function to search document types by query and optionally filter by category
export function searchDocumentTypes(query: string, category?: string): string[] {
  const typesToSearch = category 
    ? getDocumentTypesForCategory(category)
    : ALL_DOCUMENT_TYPES;
  
  if (!query.trim()) return typesToSearch;
  
  const lowercaseQuery = query.toLowerCase();
  return typesToSearch.filter(type =>
    type.toLowerCase().includes(lowercaseQuery)
  );
}