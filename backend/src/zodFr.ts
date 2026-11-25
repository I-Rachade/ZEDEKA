import { z } from "zod";
import { MISSING_FIELD } from "./util.js";

// Messages de validation en français pour toute l'API (les messages donnés champ par champ restent prioritaires).
z.config({
  customError: (issue) => {
    switch (issue.code) {
      case "invalid_type":
        return issue.input === undefined ? MISSING_FIELD : "type invalide";
      case "too_small":
        return issue.origin === "string" ? `au moins ${issue.minimum} caractère(s)` : `minimum ${issue.minimum}`;
      case "too_big":
        return issue.origin === "string" ? `au plus ${issue.maximum} caractères` : `maximum ${issue.maximum}`;
      case "invalid_value":
        return "valeur non autorisée";
      default:
        return undefined;
    }
  },
});
