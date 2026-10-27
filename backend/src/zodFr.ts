import { z } from "zod";

// Messages de validation en français pour toute l'API.
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "champ obligatoire" : "type invalide" };
    case z.ZodIssueCode.too_small:
      return { message: issue.type === "string" ? `au moins ${issue.minimum} caractère(s)` : `minimum ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      return { message: issue.type === "string" ? `au plus ${issue.maximum} caractères` : `maximum ${issue.maximum}` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "valeur non autorisée" };
    default:
      return { message: ctx.defaultError };
  }
});
