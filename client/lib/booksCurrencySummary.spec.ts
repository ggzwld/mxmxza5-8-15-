import { describe, expect, it } from "vitest";
import { summarizeBooksBySourceCurrency } from "./booksCurrencySummary";

describe("summarizeBooksBySourceCurrency", () => {
  it("keeps invoice and expense totals separate by original currency", () => {
    expect(summarizeBooksBySourceCurrency(
      [
        { currency_code: "USD", subtotal: 100, status: "paid" },
        { currency_code: " USD ", subtotal: 40, status: "draft" },
        { currency_code: "UGX", subtotal: 200, status: "sent" },
      ],
      [
        { currency_code: "USD", amount: 20, tax_amount: 4, payment_status: "paid", vat_recoverable: true },
        { currency_code: "UGX", amount: 30, tax_amount: 6, payment_status: "paid", vat_recoverable: false },
        { currency_code: "EUR", amount: 90, tax_amount: 0, payment_status: "refunded", vat_recoverable: false },
      ],
    )).toEqual([
      { currency_code: "UGX", invoice_income: 200, expenses: 36 },
      { currency_code: "USD", invoice_income: 100, expenses: 20 },
    ]);
  });
});
