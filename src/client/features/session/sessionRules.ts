import { type Session, sessionSchema } from "../../../shared/contracts/index.js";

export function updateSessionCreditLimit(session: Session, creditLimit: number): Session {
  const updated = {
    ...session,
    rules: {
      ...session.rules,
      creditLimit,
    },
  };

  return sessionSchema.parse(updated);
}
