import { describe, expect, it } from "vitest";
import { friendlyError } from "./friendlyError";

describe("friendlyError", () => {
  it("says the common backend messages like a person, in German", () => {
    expect(friendlyError("no logged-in account")).toBe("Kein angemeldetes Konto frei – melde unter „Accounts“ ein Claude- oder Codex-Konto an.");
    expect(friendlyError("Error: Session is not running")).toBe("Die Sitzung läuft gerade nicht – starte sie zuerst.");
    expect(friendlyError("The board is too big (max 4 MB)")).toBe("Das Board ist zu groß (höchstens 4 MB).");
    expect(friendlyError("The official `codex` CLI was not found. Install it or set its path in Settings.")).toContain("codex-CLI wurde nicht gefunden");
    expect(friendlyError("Choose an account for Atlas")).toBe("Wähle zuerst ein Konto für Atlas.");
    expect(friendlyError("Working directory C:/x no longer exists")).toBe("Der Arbeitsordner C:/x existiert nicht (mehr).");
  });

  it("leaves unknown messages and English rooms alone", () => {
    expect(friendlyError("Something quite specific happened")).toBe("Something quite specific happened");
    expect(friendlyError("no logged-in account", true)).toBe("no logged-in account");
    expect(friendlyError("Error: Session is not running", true)).toBe("Session is not running");
  });
});
