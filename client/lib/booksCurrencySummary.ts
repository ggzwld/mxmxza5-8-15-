type InvoiceSource = { currency_code: string; subtotal: number; status: string };
type ExpenseSource = { currency_code: string; amount: number; tax_amount: number; payment_status: string; vat_recoverable: boolean };

export const summarizeBooksBySourceCurrency = (invoices: InvoiceSource[], expenses: ExpenseSource[]) => {
  const totals = new Map<string, { currency_code: string; invoice_income: number; expenses: number }>();
  const getTotals = (currency: string) => {
    const code = currency.trim();
    const existing = totals.get(code);
    if (existing) return existing;
    const next = { currency_code: code, invoice_income: 0, expenses: 0 };
    totals.set(code, next);
    return next;
  };

  for (const invoice of invoices) {
    if (["sent", "overdue", "paid"].includes(invoice.status)) {
      getTotals(invoice.currency_code).invoice_income += Number(invoice.subtotal);
    }
  }
  for (const expense of expenses) {
    if (expense.payment_status !== "refunded") {
      getTotals(expense.currency_code).expenses += Number(expense.amount) + (expense.vat_recoverable ? 0 : Number(expense.tax_amount));
    }
  }

  return [...totals.values()].sort((left, right) => left.currency_code.localeCompare(right.currency_code));
};
