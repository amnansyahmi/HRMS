export const profileInstructions =
  "An original self-reflection questionnaire for team conversations. Choose the response closest to your usual approach. There are no correct answers. This is not a validated psychological test or a basis for hiring decisions.";
const prompts = [
  "When starting unfamiliar work, I usually…",
  "In a team discussion, I tend to…",
  "When a deadline approaches, I prefer to…",
  "When plans change unexpectedly, I first…",
  "When receiving feedback, I find it helpful to…",
  "When helping a colleague, I usually…",
  "When choosing between options, I prefer to…",
  "When solving a disagreement, I tend to…",
];
const discOptions = [
  [
    "Choose a direction and start",
    "Talk through possibilities",
    "Build a comfortable routine",
    "Check the requirements carefully",
  ],
  [
    "Focus on decisions",
    "Build energy and participation",
    "Make room for everyone",
    "Ask for evidence and detail",
  ],
  [
    "Prioritise the outcome",
    "Keep everyone motivated",
    "Maintain steady progress",
    "Check quality and completeness",
  ],
  [
    "Take action quickly",
    "Explore new possibilities",
    "Help the team adjust",
    "Understand what has changed",
  ],
  [
    "State the next action clearly",
    "Discuss it openly",
    "Give time for a thoughtful response",
    "Offer specific examples",
  ],
  [
    "Remove a blocker",
    "Encourage and connect people",
    "Listen and support",
    "Explain the details",
  ],
  [
    "Compare likely results",
    "Explore with other people",
    "Consider consistency",
    "Review information systematically",
  ],
  [
    "Address the issue directly",
    "Keep the conversation positive",
    "Seek a workable compromise",
    "Clarify the facts",
  ],
];
const dopeOptions = [
  [
    "Work with someone supportive",
    "Understand the details",
    "Explore it with others",
    "Set an ambitious first step",
  ],
  [
    "Listen to concerns",
    "Check the reasoning",
    "Connect ideas and people",
    "Bring the group to a decision",
  ],
  [
    "Keep a steady pace",
    "Check the important details",
    "Encourage the group",
    "Prioritise the finish",
  ],
  [
    "Check how others are affected",
    "Review what needs updating",
    "Explore the opportunity",
    "Adapt and move forward",
  ],
  [
    "Give reassurance and time",
    "Be clear and specific",
    "Make it a conversation",
    "Focus on next steps",
  ],
  [
    "Listen patiently",
    "Share useful information",
    "Offer encouragement",
    "Help make a decision",
  ],
  [
    "Look for a balanced fit",
    "Compare the evidence",
    "Talk it through",
    "Choose and act",
  ],
  [
    "Find common ground",
    "Separate facts from assumptions",
    "Keep people talking",
    "Resolve the immediate issue",
  ],
];
export function profileTemplate(type: "DISC" | "DOPE") {
  return {
    title: `${type} team reflection`,
    type,
    instructions: profileInstructions,
    questions: prompts.map((prompt, i) => ({
      prompt,
      options: type === "DISC" ? discOptions[i] : dopeOptions[i],
      correctIndex: 0,
    })),
  };
}
export function scoreProfile(type: string, answers: number[]) {
  if (!["DISC", "DOPE"].includes(type)) return {};
  const labels =
    type === "DISC"
      ? ["Dominance", "Influence", "Steadiness", "Conscientiousness"]
      : ["Dove", "Owl", "Peacock", "Eagle"];
  return Object.fromEntries(
    labels.map((label, i) => [
      label,
      Math.round(
        (answers.filter((a) => a === i).length / answers.length) * 100,
      ),
    ]),
  );
}
