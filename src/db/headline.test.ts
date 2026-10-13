import { expect, test } from "bun:test";
import { headlineDo } from ".";

test("headline em texto puro, de post antigo, aparece como está", () => {
  expect(headlineDo('{"headline":"Box pronto","apoio":"x"}')).toBe("Box pronto");
  expect(headlineDo("Box pronto para levar hoje")).toBe("Box pronto para levar hoje");
  expect(headlineDo(null)).toBeNull();
});
