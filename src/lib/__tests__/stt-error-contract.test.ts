import { describe, it, expect } from "vitest";
import { STT_ERROR_PREFIX, isSttErrorMessage } from "../functions/stt.function";

/**
 * Префикс ошибки STT — контракт между производителем строки и теми, кто
 * отличает ошибку от расшифровки. Регрессия: при переименовании продукта
 * префикс сменили на "Echo AI STT Error", а две проверки остались на старом
 * тексте — и ошибки попадали в живые субтитры как реплики собеседника.
 */
describe("STT error contract", () => {
  it("recognises a message built from the prefix", () => {
    expect(isSttErrorMessage(`${STT_ERROR_PREFIX}: provider not provided`)).toBe(
      true
    );
  });

  it("recognises the prefix regardless of case", () => {
    expect(isSttErrorMessage(STT_ERROR_PREFIX.toUpperCase())).toBe(true);
  });

  it("treats a real transcription as a transcription", () => {
    expect(isSttErrorMessage("Расскажите про ваш опыт с React")).toBe(false);
    expect(isSttErrorMessage("")).toBe(false);
    expect(isSttErrorMessage(null)).toBe(false);
    expect(isSttErrorMessage(undefined)).toBe(false);
  });

  it("does not fire on the old product name", () => {
    // Старое имя не должно узнаваться: иначе проверка молча расходится с
    // производителем строки.
    expect(isSttErrorMessage("Pluely STT Error: boom")).toBe(false);
  });
});
