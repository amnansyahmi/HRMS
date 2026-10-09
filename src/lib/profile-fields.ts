export const profileFields = [
  { key: "phone", label: "Phone", max: 40 },
  { key: "address", label: "Home address", max: 1000 },
  { key: "emergencyName", label: "Emergency contact name", max: 100 },
  { key: "emergencyPhone", label: "Emergency contact phone", max: 40 },
] as const;
export type ProfileKey = (typeof profileFields)[number]["key"];
