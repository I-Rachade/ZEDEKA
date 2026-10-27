import { describe, expect, it } from "vitest";
import { guessZone, hashOtp, newOtpCode, normalizePhone, phoneTail } from "./customer.js";

describe("normalizePhone", () => {
  it("accepte les formats courants", () => {
    expect(normalizePhone("90 11 22 33")).toBe("+22890112233");
    expect(normalizePhone("+228 90112233")).toBe("+22890112233");
    expect(normalizePhone("0022890112233")).toBe("+22890112233");
    expect(normalizePhone("228-90-11-22-33")).toBe("+22890112233");
  });
  it("refuse les numéros invalides", () => {
    expect(normalizePhone("1234567")).toBeNull();
    expect(normalizePhone("0011223344")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("garde les 8 derniers chiffres pour rapprocher les commandes", () => {
    expect(phoneTail("+22890112233")).toBe("90112233");
  });
});

describe("codes", () => {
  it("6 chiffres et empreinte liée au numéro", () => {
    expect(newOtpCode()).toMatch(/^\d{6}$/);
    expect(hashOtp("+22890112233", "123456", "s")).not.toBe(hashOtp("+22891112233", "123456", "s"));
    expect(hashOtp("+22890112233", "123456", "s")).toBe(hashOtp("+22890112233", "123456", "s"));
  });
});

describe("guessZone", () => {
  const zones = [
    { id: "z1", name: "Zone 1 – Centre (Tokoin, Bè, Nyékonakpoè)" },
    { id: "z2", name: "Zone 2 – Agoè, Adidogomé, Baguida" },
  ];
  it("retrouve la zone depuis le quartier, sans accents ni casse", () => {
    expect(guessZone(zones, "Tokoin Casablanca")?.id).toBe("z1");
    expect(guessZone(zones, "be kpota")?.id).toBe("z1");
    expect(guessZone(zones, "ADIDOGOME")?.id).toBe("z2");
  });
  it("renvoie null si rien ne correspond", () => {
    expect(guessZone(zones, "Kégué")).toBeNull();
    expect(guessZone(zones, "zone")).toBeNull();
    expect(guessZone(zones, "")).toBeNull();
  });
});
