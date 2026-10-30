export interface AssistantContext {
  intent: string;
  categoryId: string | null;
  from: string;
  to: string;
}
export interface AssistantAnswer {
  status: "answered" | "clarification" | "unsupported";
  mode: "deterministic";
  kind: string;
  title: string;
  text: string;
  asOfDate: string;
  from: string | null;
  to: string | null;
  metrics: { label: string; value: string | null }[];
  evidence: {
    id: string;
    description: string;
    amount: string;
    type: string;
    date: string;
    category: string | null;
    source: string;
  }[];
  evidenceCount: number;
  assumptions: string[];
  links: { label: string; href: string }[];
  suggestions: string[];
  context: AssistantContext | null;
}
export const ASSISTANT_QUESTIONS = [
  "How much did I spend this month?",
  "How much did I spend on groceries last month?",
  "What were my largest expenses?",
  "How much have I earned this year?",
  "What is my current actual balance?",
  "How much will I have next month?",
  "What bills are due next week?",
  "What unusual expenses have I had recently?",
];
