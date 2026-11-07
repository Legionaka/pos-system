export type AuthActionState = {
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
} | null;
