import { describe, expect, it } from "vitest";
import { isTransientDbError, retryTransient } from "./retryTransient.js";

describe("nouvel essai après une coupure passagère de la base", () => {
  it("reconnaît une coupure, pas une vraie erreur", () => {
    expect(isTransientDbError(new Error("DriverAdapterError: D1_ERROR: Network connection lost."))).toBe(true);
    expect(isTransientDbError(new Error("D1_ERROR: UNIQUE constraint failed: Order.code"))).toBe(false);
  });

  it("réessaie une fois après une coupure", async () => {
    let calls = 0;
    const result = await retryTransient(async () => {
      calls++;
      if (calls === 1) throw new Error("Network connection lost.");
      return "ok";
    }, 1);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("ne réessaie pas une vraie erreur, ni plus d'une fois", async () => {
    let calls = 0;
    await expect(retryTransient(async () => (calls++, Promise.reject(new Error("syntax error"))), 1)).rejects.toThrow("syntax error");
    expect(calls).toBe(1);
    calls = 0;
    await expect(retryTransient(async () => (calls++, Promise.reject(new Error("Network connection lost."))), 1)).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
