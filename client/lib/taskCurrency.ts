export const TASK_CURRENCIES = [
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "CAD", label: "CAD — Canadian Dollar ($)" },
  { code: "AUD", label: "AUD — Australian Dollar ($)" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)" },
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "CNY", label: "CNY — Chinese Yuan (¥)" },
  { code: "INR", label: "INR — Indian Rupee (₹)" },
  { code: "RWF", label: "RWF — Rwandan Franc" },
  { code: "KES", label: "KES — Kenyan Shilling" },
  { code: "TZS", label: "TZS — Tanzanian Shilling" },
  { code: "CDF", label: "CDF — Congolese Franc" },
  { code: "UGX", label: "UGX — Ugandan Shilling" },
  { code: "ZAR", label: "ZAR — South African Rand" },
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
];

export const getSettlementCurrencies = (taskCurrency?: string | null) =>
  TASK_CURRENCIES.filter(({ code }) => code === "UGX" || code === "USD" || code === taskCurrency);

export const getTaskAmount = (task: {
  budget: number | string | null;
  final_amount: number | string | null;
}) => {
  const amount = task.final_amount ?? task.budget;
  return amount === null ? null : Number(amount);
};

export const formatTaskAmount = (amount: number, currency?: string | null) =>
  currency
    ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)
    : amount.toFixed(2);
