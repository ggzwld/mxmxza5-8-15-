import { describe, expect, it } from "vitest";
import { getSettlementCurrencies } from "./taskCurrency";

describe("getSettlementCurrencies", () => {
  it("allows the task currency alongside USD and UGX", () => {
    expect(getSettlementCurrencies("EUR").map(({ code }) => code).sort()).toEqual(["EUR", "UGX", "USD"]);
  });

  it("does not duplicate a task currency that is USD or UGX", () => {
    expect(getSettlementCurrencies("USD").map(({ code }) => code).sort()).toEqual(["UGX", "USD"]);
    expect(getSettlementCurrencies("UGX").map(({ code }) => code).sort()).toEqual(["UGX", "USD"]);
  });
});
