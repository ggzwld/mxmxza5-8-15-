import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { downloadBooksDocument } from "../lib/attachmentDownload";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import FullscreenMediaViewer, { type FullscreenMediaItem } from "../components/FullscreenMediaViewer";
import { useToast } from "../hooks/use-toast";
import { useHotelTenant } from "../lib/hotelTenant";
import { isWorkerRole } from "../lib/roles";
import { BOOKS_SUPPORTED_CURRENCIES } from "../lib/booksCurrency";
import BooksTaxSettings from "./BooksTaxSettings";
import { calculateBooksTaxSummary, estimateIncomeTax, type IncomeTaxSchedule, type TaxEntityType } from "../lib/booksTaxSummary";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CircleDollarSign,
  FileText,
  Plus,
  Receipt,
  RefreshCw,
  Users,
} from "lucide-react";

type Contact = { id: string; name: string; type: "customer" | "vendor" | "both"; email: string | null; tax_id: string | null };
type Invoice = { id: string; invoice_number: string; contact_id: string | null; issue_date: string; issue_at: string | null; due_date: string; currency_code: string; subtotal: number; tax_amount: number; total_due: number; status: "draft" | "sent" | "paid" | "overdue" | "void"; invoice_url: string | null; receipt_url: string | null };
type TaxTreatment = "deductible" | "non_deductible" | "review";
type Expense = { id: string; description: string; contact_id: string | null; expense_date: string; expense_at: string | null; currency_code: string; amount: number; tax_amount: number; payment_status: "paid" | "unpaid" | "refunded"; purchase_source_type: string | null; tax_treatment: TaxTreatment; vat_recoverable: boolean; receipt_url: string | null };
type Account = { id: string; code: string; name: string; type: "asset" | "liability" | "equity" | "income" | "expense" };
type TaxRate = { id: string; name: string; country_code: string; rate_percentage: number; effective_from: string; effective_to: string | null; is_active: boolean; confirmed_at: string | null; tax_scope: "invoice" | "other" };
type OrganizationTaxProfile = { country_code: string; tax_entity_type: TaxEntityType | null };
type LedgerLine = { account_id: string; debit: number; credit: number; currency_code: string; transaction_date: string };
type LoyaltyPosting = { ledger_entry_id: string; amount_ugx: number; status: "pending" | "posted" | "failed"; journal_transaction_id: string | null; error_message: string | null; created_at: string };

type WorkerTaskPayment = { id: string; task_id: string; confirmation_status: "pending_confirmation" | "confirmed" | "legacy_settled"; worker_acknowledged_at: string | null; amount: number; currency_code: string; converted_amount: number | null; payout_currency_code: string | null; fx_rate: number | null; fx_rate_source: "same_currency" | "stored" | "manual" | "books_exchange" | "hotel_edited" | "hotel_approved" | null; payment_method: string; payment_reference: string; paid_at: string };

type FxConversion = { id: string; conversion_date: string; exchange_at: string | null; from_currency_code: string; from_amount: number; to_ugx_amount: number; carrying_ugx_per_unit: number; carrying_rate_recorded: boolean; realized_fx_difference: number; provider: string | null; reference: string | null };

const today = new Date().toISOString().slice(0, 10);
const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoneParts = (instant: Date, timezone: string) =>
  Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).map(({ type, value }) => [type, value]));
const localDateTimeInZone = (instant: Date, timezone: string) => {
  const parts = zoneParts(instant, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
const instantFromLocalDateTime = (local: string, timezone: string) => {
  const wallClock = new Date(`${local}:00Z`);
  const parts = zoneParts(wallClock, timezone);
  const shownAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(wallClock.getTime() - (shownAsUtc - wallClock.getTime()));
};
const formatDocumentDate = (date: string, at: string | null) => (at ? new Date(at).toLocaleString("en-GB", { timeZone: browserTimezone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
const formatExchangeTime = (instant: string) => new Date(instant).toLocaleString("en-GB", { timeZone: browserTimezone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const formatMoney = (value: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency.trim(), maximumFractionDigits: currency.trim() === "UGX" ? 0 : 2 }).format(value || 0);
const supportedCurrencies = BOOKS_SUPPORTED_CURRENCIES;

const PaymentRate = ({ payment, exchange }: { payment: WorkerTaskPayment; exchange: FxConversion | undefined }) => {
  if (payment.fx_rate_source === "same_currency" || !payment.fx_rate) return <>Same currency</>;
  const rate = Number(payment.fx_rate);
  if (payment.fx_rate_source === "books_exchange") {
    const provider = exchange?.provider || "recorded exchange";
    return <span title={exchange?.exchange_at ? `${provider} · ${formatExchangeTime(exchange.exchange_at)}` : provider}>{`${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${provider})`}</span>;
  }
  if (payment.fx_rate_source === "stored") return <>{`${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} (live rate)`}</>;
  const label = payment.fx_rate_source === "manual" ? "entered manually" : payment.fx_rate_source === "hotel_edited" || payment.fx_rate_source === "hotel_approved" ? "set by the hotel" : payment.fx_rate_source;
  return <>{`${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} (${label})`}</>;
};

type CurrencyTotals = { currency_code: string; invoice_total: number; income: number; expenses: number; net_result: number; tax_total: number; receivables: number; assets: number; liabilities: number; equity: number };

type SupabaseErrorLike = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null };
type BooksOperation = "books.load" | "books.contact.save" | "books.invoice.save" | "books.expense.save" | "books.expense.taxTreatment.save" | "books.tax.profile.save" | "books.tax.vat.save" | "books.tax.income.save" | "books.vatRegistration.save" | "books.fx.conversion.save";

const newCorrelationId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `books-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const sanitizeDiagnosticValue = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500) : value;
const reportBooksError = (operation: BooksOperation, correlationId: string, organizationId: string | null, recordId: string | null, error: SupabaseErrorLike) => {
  console.error("Books operation failed", {
    operation,
    correlationId,
    organizationId,
    recordId,
    supabase: {
      code: sanitizeDiagnosticValue(error.code),
      message: sanitizeDiagnosticValue(error.message),
      details: sanitizeDiagnosticValue(error.details),
      hint: sanitizeDiagnosticValue(error.hint),
    },
  });
};
const operationToast = (title: string, correlationId: string) => ({ title, description: `Please try again. If the problem continues, share reference ${correlationId} with support.`, variant: "destructive" as const });

type DocumentEntry = { label: string; typeLabel: string; url: string | null };
type DocumentLink = { label: string; item: FullscreenMediaItem };

const documentItemFromUrl = (url: string, label: string, typeLabel: string): FullscreenMediaItem => {
  const lastSegment = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
  const name = lastSegment.includes(".") ? lastSegment : label;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const type = /^(png|jpe?g|gif|webp|svg|bmp)$/.test(extension) ? "image" : /^(mp4|webm|mov)$/.test(extension) ? "video" : "file";
  return { url, type, typeLabel: type === "file" ? typeLabel : undefined, name, download: () => downloadBooksDocument(url) };
};

const BooksPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { tenant, loading: tenantLoading } = useHotelTenant();
  const requestedOrganizationId = searchParams.get("organization");
  const isPersonalWorkspace = searchParams.get("workspace") === "personal" || requestedOrganizationId === "personal";
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [isWorkerAccount, setIsWorkerAccount] = useState<boolean | null>(null);
  const [isWorkerBooksWorkspace, setIsWorkerBooksWorkspace] = useState(false);
  const initializedTaxSettingsFor = useRef<string | null>(null);
  const [baseCurrency, setBaseCurrency] = useState("UGX");
  const [workerBooksCurrencyLocked, setWorkerBooksCurrencyLocked] = useState(false);
  const [savingWorkerCurrency, setSavingWorkerCurrency] = useState(false);
  const [vatRegistered, setVatRegistered] = useState(false);
  const requestedCurrency = searchParams.get("currency");
  const viewMode = searchParams.get("view");
  const isConsolidatedView = viewMode === "consolidated";
  const isUsdView = viewMode === "usd";
  const [targetCurrency, setTargetCurrency] = useState(requestedCurrency && supportedCurrencies.some((code) => code === requestedCurrency) ? requestedCurrency : "USD");
  const [fxRates, setFxRates] = useState<Record<string, number>>({ UGX: 1 });
  const [fxAsOf, setFxAsOf] = useState<string | null>(null);
  const [fxProvider, setFxProvider] = useState<string | null>(null);
  const [fxError, setFxError] = useState("");
  const [currencyTotals, setCurrencyTotals] = useState<CurrencyTotals[]>([]);
  const [currencyTotalsError, setCurrencyTotalsError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [incomeTaxSchedules, setIncomeTaxSchedules] = useState<IncomeTaxSchedule[]>([]);
  const [organizationTaxProfile, setOrganizationTaxProfile] = useState<OrganizationTaxProfile>({ country_code: "UG", tax_entity_type: null });
  const [taxProfileForm, setTaxProfileForm] = useState<OrganizationTaxProfile>({ country_code: "UG", tax_entity_type: null });
  const [vatRateForm, setVatRateForm] = useState({ name: "URA VAT", rate: "18", effectiveFrom: today });
  const [incomeTaxForm, setIncomeTaxForm] = useState({ name: "URA Corporation Tax", rateMethod: "flat" as "flat" | "progressive", rate: "30", effectiveFrom: today });
  const [incomeTaxBrackets, setIncomeTaxBrackets] = useState([{ lowerBound: "0", upperBound: "", rate: "", baseTax: "0" }]);
  const [ledgerLines, setLedgerLines] = useState<LedgerLine[]>([]);
  const [loyaltyPostings, setLoyaltyPostings] = useState<LoyaltyPosting[]>([]);
  const [workerTaskPayments, setWorkerTaskPayments] = useState<WorkerTaskPayment[]>([]);
  const [fxConversions, setFxConversions] = useState<FxConversion[]>([]);
  const [taskById, setTaskById] = useState<Record<string, { title: string; settlement_fx_conversion_id: string | null }>>({});
  const [confirmingPaymentId, setConfirmingPaymentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [documentItems, setDocumentItems] = useState<FullscreenMediaItem[]>([]);
  const [documentIndex, setDocumentIndex] = useState<number | null>(null);

  const openDocuments = (links: DocumentLink[], index: number) => {
    setDocumentItems(links.map((link) => link.item));
    setDocumentIndex(index);
  };

  const renderDocumentButtons = (entries: DocumentEntry[]) => {
    const links: DocumentLink[] = entries.flatMap(({ label, typeLabel, url }) => (url ? [{ label, item: documentItemFromUrl(url, label, typeLabel) }] : []));
    if (links.length === 0) return <span className="text-muted-foreground">—</span>;
    return links.map((link, index) => (
      <button key={link.label} type="button" className="text-primary underline" onClick={() => openDocuments(links, index)}>
        {link.label}
      </button>
    ));
  };
  const [contactForm, setContactForm] = useState({ name: "", type: "customer" as Contact["type"], email: "", tax_id: "" });
  const [invoiceForm, setInvoiceForm] = useState({ invoice_number: "", contact_id: "", issue_date: localDateTimeInZone(new Date(), browserTimezone), due_date: today, subtotal: "", tax_rate_id: "" });
  const [expenseForm, setExpenseForm] = useState({ description: "", contact_id: "", expense_date: localDateTimeInZone(new Date(), browserTimezone), amount: "", tax_amount: "", tax_treatment: "review" as TaxTreatment, vat_recoverable: true });
  const [fxConversionForm, setFxConversionForm] = useState({ exchange_at: "", from_currency_code: "USD", from_amount: "", to_ugx_amount: "", carrying_ugx_per_unit: "", provider: "", reference: "" });
  const [taxPeriodStart, setTaxPeriodStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [taxPeriodEnd, setTaxPeriodEnd] = useState(`${new Date().getFullYear()}-12-31`);

  const loadBooks = async () => {
    const operation: BooksOperation = "books.load";
    const correlationId = newCorrelationId();
    setLoading(true);
    setCurrencyTotals([]);
    setCurrencyTotalsError(null);
    try {
      const { data: userData, error: authError } = await supabase.auth.getUser();
      if (authError) {
        reportBooksError(operation, correlationId, organizationId, null, authError);
        toast(operationToast("Books could not verify your session", correlationId));
        return;
      }
      if (!userData.user) {
        navigate(`/login?returnTo=${encodeURIComponent("/books")}`, { replace: true });
        return;
      }
      const { data: currentProfile, error: currentProfileError } = await supabase.from("user_profiles").select("role").eq("user_id", userData.user.id).maybeSingle();
      if (currentProfileError) throw currentProfileError;
      const workerAccount = isWorkerRole(currentProfile?.role);
      let orgId: string | null = null;
      let orgError: { message: string } | null = null;
      let workerBooksWorkspace = false;
      if (isPersonalWorkspace) {
        const result = await supabase.rpc("get_or_create_personal_books_organization");
        orgId = result.data;
        orgError = result.error;
      } else if (workerAccount && !requestedOrganizationId) {
        const result = await supabase.rpc("get_or_create_worker_books_organization");
        workerBooksWorkspace = true;
        orgId = result.data;
        orgError = result.error;
      } else if (requestedOrganizationId || tenant?.organizationId) {
        const selectedOrganizationId = tenant?.organizationId || requestedOrganizationId;
        if (tenant?.organizationId && requestedOrganizationId && requestedOrganizationId !== tenant.organizationId) {
          throw new Error("This Books workspace does not belong to the active hotel.");
        }
        const membership = await supabase.from("books_memberships").select("organization_id").eq("organization_id", selectedOrganizationId).eq("user_id", userData.user.id).maybeSingle();
        if (membership.error) throw membership.error;
        if (membership.data) {
          orgId = selectedOrganizationId;
        } else if (requestedOrganizationId) {
          throw new Error("You do not have access to this hotel’s Books workspace.");
        } else {
          const result = workerAccount
            ? await supabase.rpc("get_or_create_worker_books_organization")
            : await supabase.rpc("get_or_create_personal_books_organization");
          workerBooksWorkspace = workerAccount;
          orgId = result.data;
          orgError = result.error;
        }
      } else {
        const result = await supabase.rpc("get_or_create_books_organization");
        orgId = result.data;
        orgError = result.error;
      }
      if (orgError || !orgId) {
        if (orgError) reportBooksError(operation, correlationId, null, null, orgError);
        toast(operationToast("Books could not initialize your workspace", correlationId));
        return;
      }
      setOrganizationId(orgId);
      setIsWorkerBooksWorkspace(workerBooksWorkspace);
      const [org, contactResult, invoiceResult, expenseResult, accountResult, taxResult, incomeTaxResult, transactionResult, loyaltyPostingResult] = await Promise.all([
        supabase.from("books_organizations").select("name,base_currency,tax_country_code,tax_entity_type,vat_registered").eq("id", orgId).single(),
        supabase.from("books_contacts").select("id,name,type,email,tax_id").eq("organization_id", orgId).order("name"),
        supabase.from("books_invoices").select("id,invoice_number,contact_id,issue_date,issue_at,due_date,currency_code,subtotal,tax_amount,total_due,status,invoice_url,receipt_url").eq("organization_id", orgId).order("issue_date", { ascending: false }),
        supabase.from("books_expenses").select("id,description,contact_id,expense_date,expense_at,currency_code,amount,tax_amount,payment_status,purchase_source_type,tax_treatment,vat_recoverable,receipt_url").eq("organization_id", orgId).order("expense_date", { ascending: false }),
        supabase.from("books_accounts").select("id,code,name,type").eq("organization_id", orgId).order("code"),
        supabase.from("books_tax_rates").select("id,name,country_code,rate_percentage,effective_from,effective_to,is_active,confirmed_at,tax_scope").eq("organization_id", orgId).eq("is_active", true).order("effective_from", { ascending: false }),
        supabase.from("books_income_tax_rates").select("country_code,tax_entity_type,name,rate_method,rate_schedule,effective_from,effective_to,confirmed_at").eq("organization_id", orgId).order("effective_from", { ascending: false }),
        supabase.from("books_journal_transactions").select("id,transaction_date,books_journal_lines(account_id,debit,credit,currency_code)").eq("organization_id", orgId).order("transaction_date", { ascending: false }),
        supabase.from("hotel_loyalty_books_postings").select("ledger_entry_id,amount_ugx,status,journal_transaction_id,error_message,created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(20),
      ]);
      const results = [org, contactResult, invoiceResult, expenseResult, accountResult, taxResult, incomeTaxResult, transactionResult];
      const failedResult = results.find((result) => result.error);
      if (failedResult?.error) {
        reportBooksError(operation, correlationId, orgId, null, failedResult.error);
        toast(operationToast("Books could not refresh your records", correlationId));
        return;
      }
      setOrganizationName(org.data?.name || "");
      if (org.data?.base_currency) setBaseCurrency(org.data.base_currency.trim());
      setVatRegistered(org.data?.vat_registered === true);
      setWorkerBooksCurrencyLocked(workerBooksWorkspace && (transactionResult.data || []).length > 0);
      setFxConversionForm((current) => ({ ...current, exchange_at: current.exchange_at || localDateTimeInZone(new Date(), browserTimezone) }));
      const nextTaxProfile = { country_code: org.data?.tax_country_code?.trim() || "UG", tax_entity_type: org.data?.tax_entity_type || null } as OrganizationTaxProfile;
      setOrganizationTaxProfile(nextTaxProfile);
      setTaxProfileForm(nextTaxProfile);
      if (initializedTaxSettingsFor.current !== orgId) {
        setIncomeTaxForm((form) => ({ ...form, name: nextTaxProfile.country_code === "UG" && nextTaxProfile.tax_entity_type === "company" ? "URA Corporation Tax" : "Confirmed business income-tax schedule", rateMethod: nextTaxProfile.tax_entity_type === "company" ? "flat" : "progressive", rate: nextTaxProfile.country_code === "UG" && nextTaxProfile.tax_entity_type === "company" ? "30" : "" }));
        if (nextTaxProfile.tax_entity_type !== "company") setIncomeTaxBrackets([{ lowerBound: "0", upperBound: "", rate: "", baseTax: "0" }]);
        initializedTaxSettingsFor.current = orgId;
      }
      setContacts((contactResult.data || []) as Contact[]);
      setInvoices((invoiceResult.data || []) as Invoice[]);
      setExpenses((expenseResult.data || []) as Expense[]);
      setAccounts((accountResult.data || []) as Account[]);
      setTaxRates((taxResult.data || []) as TaxRate[]);
      setIncomeTaxSchedules((incomeTaxResult.data || []) as IncomeTaxSchedule[]);
      if (!loyaltyPostingResult.error) setLoyaltyPostings((loyaltyPostingResult.data || []) as LoyaltyPosting[]);
      const transactions = (transactionResult.data || []) as Array<{ id: string; transaction_date: string; books_journal_lines: Array<{ account_id: string; debit: number; credit: number; currency_code: string }> }>;
      setLedgerLines(transactions.flatMap((transaction) => transaction.books_journal_lines.map((line) => ({ ...line, transaction_date: transaction.transaction_date }))));
      const { data: paymentRows, error: paymentError } = await supabase.from("worker_task_payments").select("id,task_id,confirmation_status,worker_acknowledged_at,amount,currency_code,converted_amount,payout_currency_code,fx_rate,fx_rate_source,payment_method,payment_reference,paid_at").order("paid_at", { ascending: false });
      if (paymentError) reportBooksError(operation, correlationId, orgId, null, paymentError);
      setWorkerTaskPayments(paymentError ? [] : (paymentRows || []) as WorkerTaskPayment[]);
      const taskIds = [...new Set((paymentRows || []).map((payment) => payment.task_id))];
      const { data: taskRows, error: taskError } = taskIds.length ? await supabase.from("tasks").select("id,title,settlement_fx_conversion_id").in("id", taskIds) : { data: [], error: null };
      if (taskError) reportBooksError(operation, correlationId, orgId, null, taskError);
      setTaskById(Object.fromEntries((taskRows || []).map((task) => [task.id, { title: task.title, settlement_fx_conversion_id: task.settlement_fx_conversion_id }])));
      const { data: conversionRows, error: conversionError } = await supabase.from("books_fx_conversions").select("id,conversion_date,exchange_at,from_currency_code,from_amount,to_ugx_amount,carrying_ugx_per_unit,carrying_rate_recorded,realized_fx_difference,provider,reference").eq("organization_id", orgId).order("conversion_date", { ascending: false });
      if (conversionError) reportBooksError(operation, correlationId, orgId, null, conversionError);
      setFxConversions(conversionError ? [] : (conversionRows || []) as FxConversion[]);
      if (isConsolidatedView) {
        const { data: totals, error: totalsError } = await supabase.rpc("get_books_currency_totals", { target_organization_id: orgId });
        if (totalsError) {
          reportBooksError(operation, correlationId, orgId, null, totalsError);
          setCurrencyTotalsError("Currency totals could not refresh. Use Refresh to try again.");
          toast(operationToast("Books could not refresh your records", correlationId));
        } else {
          setCurrencyTotals((totals || []) as CurrencyTotals[]);
        }
        await refreshExchangeRates();
      }
    } catch (error) {
      reportBooksError(operation, correlationId, organizationId, null, error as SupabaseErrorLike);
      toast(operationToast("Books could not refresh your records", correlationId));
    } finally {
      setLoading(false);
    }
  };

  const confirmPaymentReceived = async (payment: WorkerTaskPayment) => {
    setConfirmingPaymentId(payment.id);
    const { error } = await supabase.rpc("confirm_worker_task_payment", { p_task_id: payment.task_id });
    if (error) {
      toast({ title: "Payment receipt not confirmed", description: error.message, variant: "destructive" });
      setConfirmingPaymentId(null);
      return;
    }
    toast({ title: "Payment receipt confirmed", description: "The invoice will be settled and the receipt sent to both accounts." });
    await loadBooks();
    setConfirmingPaymentId(null);
  };

  const refreshExchangeRates = async () => {
    try {
      const response = await fetch("/api/books/fx-rates");
      const payload = await response.json() as { rates?: Record<string, number>; asOf?: string; provider?: string; error?: string };
      if (!response.ok || !payload.rates) throw new Error(payload.error || "Exchange rates could not be refreshed");
      setFxRates(payload.rates);
      setFxAsOf(payload.asOf || null);
      setFxProvider(payload.provider || null);
      setFxError("");
    } catch (error) {
      setFxError(error instanceof Error ? error.message : "Exchange rates could not be refreshed");
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { data: profile } = userData.user
        ? await supabase.from("user_profiles").select("role").eq("user_id", userData.user.id).maybeSingle()
        : { data: null };
      if (!cancelled) setIsWorkerAccount(isWorkerRole(profile?.role));
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isWorkerAccount && isPersonalWorkspace) navigate("/books", { replace: true });
  }, [isWorkerAccount, isPersonalWorkspace, navigate]);

  useEffect(() => {
    if (tenantLoading || isWorkerAccount === null || (isWorkerAccount && isPersonalWorkspace)) return;
    void loadBooks();
  }, [isPersonalWorkspace, requestedOrganizationId, isConsolidatedView, tenantLoading, tenant?.organizationId, isWorkerAccount]);

  const currency = isConsolidatedView ? targetCurrency : isUsdView ? "USD" : baseCurrency;
  const visibleInvoices = invoices.filter((invoice) => invoice.currency_code.trim() === currency);
  const visibleExpenses = expenses.filter((expense) => expense.currency_code.trim() === currency);
  const exchangeForPayment = (payment: WorkerTaskPayment) => fxConversions.find((conversion) => conversion.id === taskById[payment.task_id]?.settlement_fx_conversion_id);
  const paymentForInvoice = (invoice: Invoice) => workerTaskPayments.find((payment) => invoice.invoice_number === `TASK-${payment.task_id}`);
  const paymentForExpense = (expense: Expense) => workerTaskPayments.find((payment) => taskById[payment.task_id] !== undefined && expense.description === `Worker payment: ${taskById[payment.task_id].title}`);
  const renderTaskLabel = (taskId: string, fallback: string) => (
      <>
        <span className="block text-xs font-normal text-muted-foreground">{`TASK #${taskId.slice(0, 8).toUpperCase()}`}</span>
        <span className="block max-w-[14rem] truncate">{taskById[taskId]?.title ?? fallback}</span>
      </>
    );
  const renderInvoiceLabel = (invoice: Invoice) => {
    const payment = paymentForInvoice(invoice);
    return payment ? renderTaskLabel(payment.task_id, invoice.invoice_number) : invoice.invoice_number;
  };
  const renderExpenseLabel = (expense: Expense) => {
    const payment = paymentForExpense(expense);
    return payment ? renderTaskLabel(payment.task_id, expense.description) : expense.description;
  };
  const renderPaymentRate = (payment: WorkerTaskPayment | undefined) => (payment ? <PaymentRate payment={payment} exchange={exchangeForPayment(payment)} /> : "—");
  const taxSummary = calculateBooksTaxSummary(invoices, expenses, currency, taxPeriodStart, taxPeriodEnd);
  const rawTaxableIncome = taxSummary.invoiceIncome - taxSummary.allowableDeductions;
  const taxableIncome = Math.max(rawTaxableIncome, 0);
  const incomeTaxEstimate = currency !== baseCurrency
    ? { status: "currency_mismatch" as const, estimatedTax: null, scheduleName: null }
    : taxSummary.expensesToReview > 0
      ? { status: "review_required" as const, estimatedTax: null, scheduleName: null }
      : estimateIncomeTax(rawTaxableIncome, organizationTaxProfile.country_code, organizationTaxProfile.tax_entity_type, taxPeriodEnd, incomeTaxSchedules);
  const effectiveInvoiceTaxRates = taxRates.filter((rate) => rate.tax_scope === "invoice" && rate.country_code.trim() === organizationTaxProfile.country_code && rate.confirmed_at && rate.effective_from <= invoiceForm.issue_date && (!rate.effective_to || rate.effective_to >= invoiceForm.issue_date));
  const defaultInvoiceTaxRate = [...effectiveInvoiceTaxRates].sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];
  const hasValidTaxPeriod = taxPeriodStart <= taxPeriodEnd;
  const isTaxProfileSaved = organizationTaxProfile.country_code === taxProfileForm.country_code && organizationTaxProfile.tax_entity_type === taxProfileForm.tax_entity_type;
  const tableExpenses = expenses;
  const visibleLedgerLines = ledgerLines.filter((line) => line.currency_code.trim() === currency);
  const customerContacts = contacts.filter((contact) => contact.type === "customer" || contact.type === "both");
  const vendorContacts = contacts.filter((contact) => contact.type === "vendor" || contact.type === "both");
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const ledgerTotal = (type: Account["type"], side: "debit" | "credit") => visibleLedgerLines.reduce((sum, line) => {
    const account = accountById.get(line.account_id);
    return account?.type === type ? sum + Number(line[side]) : sum;
  }, 0);
  const revenue = visibleInvoices.filter((invoice) => ["sent", "overdue", "paid"].includes(invoice.status)).reduce((sum, invoice) => sum + Number(invoice.subtotal), 0);
  const expensesTotal = visibleExpenses.filter((expense) => expense.payment_status !== "refunded").reduce((sum, expense) => sum + Number(expense.amount) + (expense.vat_recoverable ? 0 : Number(expense.tax_amount)), 0);
  const assets = ledgerTotal("asset", "debit") - ledgerTotal("asset", "credit");
  const liabilities = ledgerTotal("liability", "credit") - ledgerTotal("liability", "debit");
  const equity = ledgerTotal("equity", "credit") - ledgerTotal("equity", "debit") + revenue - expensesTotal;
  const openInvoices = visibleInvoices.filter((invoice) => invoice.status === "sent" || invoice.status === "overdue");
  const receivable = openInvoices.reduce((sum, invoice) => sum + Number(invoice.total_due), 0);
  const overdue = visibleInvoices.filter((invoice) => invoice.status === "overdue" || (invoice.status !== "paid" && invoice.due_date < today)).length;
  const contactName = (id: string | null) => contacts.find((contact) => contact.id === id)?.name || "Unassigned";
  const profit = revenue - expensesTotal;
  const fxFactor = (sourceCurrency: string) => {
    const sourceRate = fxRates[sourceCurrency.trim()];
    const destinationRate = fxRates[targetCurrency];
    return sourceRate && destinationRate ? destinationRate / sourceRate : null;
  };
  const convertTotal = (field: keyof Omit<CurrencyTotals, "currency_code">) => currencyTotals.reduce((sum, row) => {
    const factor = fxFactor(row.currency_code);
    return factor === null ? sum : sum + Number(row[field]) * factor;
  }, 0);
  const hasAllConversionRates = !currencyTotalsError && currencyTotals.length > 0 && currencyTotals.every((row) => fxFactor(row.currency_code) !== null);

  const saveContact = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !contactForm.name.trim()) return;
    const operation: BooksOperation = "books.contact.save";
    const correlationId = newCorrelationId();
    setSaving(true);
    try {
      const { error } = await supabase.from("books_contacts").insert({ organization_id: organizationId, name: contactForm.name.trim(), type: contactForm.type, email: contactForm.email.trim() || null, tax_id: contactForm.tax_id.trim() || null });
      if (error) {
        reportBooksError(operation, correlationId, organizationId, null, error);
        toast(operationToast("Could not save contact", correlationId));
        return;
      }
      setContactForm({ name: "", type: "customer", email: "", tax_id: "" });
      toast({ title: "Contact added" });
      await loadBooks();
    } catch (error) {
      reportBooksError(operation, correlationId, organizationId, null, error as SupabaseErrorLike);
      toast(operationToast("Could not save contact", correlationId));
    } finally {
      setSaving(false);
    }
  };

  const saveInvoice = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !invoiceForm.invoice_number.trim() || !invoiceForm.subtotal) return;
    const operation: BooksOperation = "books.invoice.save";
    const correlationId = newCorrelationId();
    setSaving(true);
    try {
      const selectedRate = invoiceForm.tax_rate_id === "none" ? undefined : effectiveInvoiceTaxRates.find((rate) => rate.id === invoiceForm.tax_rate_id) || (!invoiceForm.tax_rate_id ? defaultInvoiceTaxRate : undefined);
      if (invoiceForm.tax_rate_id !== "none" && !selectedRate) {
        toast({ title: "No confirmed tax rate applies", description: "Confirm a rate for this invoice date, or select No tax only when the supply is not taxable.", variant: "destructive" });
        return;
      }
      const invoiceNumber = invoiceForm.invoice_number.trim();
      const subtotal = Number(invoiceForm.subtotal);
      const { data: invoice, error } = await supabase.from("books_invoices").insert({ organization_id: organizationId, invoice_number: invoiceNumber, contact_id: invoiceForm.contact_id || null, issue_date: invoiceForm.issue_date.slice(0, 10), issue_at: instantFromLocalDateTime(invoiceForm.issue_date, browserTimezone).toISOString(), due_date: invoiceForm.due_date, currency_code: currency, subtotal, tax_rate_id: selectedRate?.id || null, tax_rate_percentage: selectedRate?.rate_percentage || 0, status: "draft" }).select("id").single();
      if (error || !invoice) {
        reportBooksError(operation, correlationId, organizationId, null, error || { message: "Invoice was not returned after creation" });
        toast(operationToast("Could not save invoice", correlationId));
        return;
      }
      const { error: lineError } = await supabase.from("books_invoice_lines").insert({ invoice_id: invoice.id, organization_id: organizationId, description: `Invoice ${invoiceNumber}`, quantity: 1, unit_price: subtotal });
      if (lineError) {
        reportBooksError(operation, correlationId, organizationId, invoice.id, lineError);
        await supabase.from("books_invoices").delete().eq("id", invoice.id).eq("organization_id", organizationId);
        toast(operationToast("Could not save invoice line", correlationId));
        return;
      }
      setInvoiceForm({ invoice_number: "", contact_id: "", issue_date: localDateTimeInZone(new Date(), browserTimezone), due_date: today, subtotal: "", tax_rate_id: "" });
      toast({ title: "Invoice saved", description: "The invoice is ready to review and send." });
      await loadBooks();
    } catch (error) {
      reportBooksError(operation, correlationId, organizationId, null, error as SupabaseErrorLike);
      toast(operationToast("Could not save invoice", correlationId));
    } finally {
      setSaving(false);
    }
  };

  const saveExpense = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !expenseForm.description.trim() || !expenseForm.amount) return;
    const operation: BooksOperation = "books.expense.save";
    const correlationId = newCorrelationId();
    setSaving(true);
    try {
      const { error } = await supabase.from("books_expenses").insert({ organization_id: organizationId, description: expenseForm.description.trim(), contact_id: expenseForm.contact_id || null, expense_date: expenseForm.expense_date.slice(0, 10), expense_at: instantFromLocalDateTime(expenseForm.expense_date, browserTimezone).toISOString(), currency_code: currency, amount: Number(expenseForm.amount), tax_amount: Number(expenseForm.tax_amount || 0), payment_status: "paid", purchase_source_type: null, purchase_source_id: null, tax_treatment: expenseForm.tax_treatment, vat_recoverable: vatRegistered && expenseForm.vat_recoverable });
      if (error) {
        reportBooksError(operation, correlationId, organizationId, null, error);
        toast(operationToast("Could not save expense", correlationId));
        return;
      }
      setExpenseForm({ description: "", contact_id: "", expense_date: localDateTimeInZone(new Date(), browserTimezone), amount: "", tax_amount: "", tax_treatment: "review", vat_recoverable: true });
      toast({ title: "Expense recorded" });
      await loadBooks();
    } catch (error) {
      reportBooksError(operation, correlationId, organizationId, null, error as SupabaseErrorLike);
      toast(operationToast("Could not save expense", correlationId));
    } finally {
      setSaving(false);
    }
  };

  const saveFxConversion = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId) return;
    const operation: BooksOperation = "books.fx.conversion.save";
    const correlationId = newCorrelationId();
    setSaving(true);
    try {
      const { error } = await supabase.rpc("record_books_fx_conversion", {
        p_organization_id: organizationId,
        p_conversion_date: fxConversionForm.exchange_at.slice(0, 10),
        p_exchange_at: instantFromLocalDateTime(fxConversionForm.exchange_at, browserTimezone).toISOString(),
        p_from_currency_code: fxConversionForm.from_currency_code,
        p_from_amount: Number(fxConversionForm.from_amount),
        p_to_ugx_amount: Number(fxConversionForm.to_ugx_amount),
        p_carrying_ugx_per_unit: fxConversionForm.carrying_ugx_per_unit.trim() ? Number(fxConversionForm.carrying_ugx_per_unit) : null,
        p_provider: fxConversionForm.provider.trim() || null,
        p_reference: fxConversionForm.reference.trim() || null,
      });
      if (error) {
        reportBooksError(operation, correlationId, organizationId, null, error);
        toast({ title: "Currency exchange not recorded", description: error.message, variant: "destructive" });
        return;
      }
      setFxConversionForm({ exchange_at: localDateTimeInZone(new Date(), browserTimezone), from_currency_code: "USD", from_amount: "", to_ugx_amount: "", carrying_ugx_per_unit: "", provider: "", reference: "" });
      toast({ title: "Currency exchange recorded", description: "The foreign currency was moved to UGX, and any gain or loss was posted." });
      await loadBooks();
    } catch (error) {
      reportBooksError(operation, correlationId, organizationId, null, error as SupabaseErrorLike);
      toast(operationToast("Could not record currency exchange", correlationId));
    } finally {
      setSaving(false);
    }
  };

  const saveTaxProfile = async () => {
    if (!organizationId) return;
    const { error } = await supabase.rpc("update_books_tax_profile", {
      target_organization_id: organizationId,
      target_country_code: taxProfileForm.country_code,
      target_tax_entity_type: taxProfileForm.tax_entity_type,
    });
    if (error) {
      const correlationId = newCorrelationId();
      reportBooksError("books.tax.profile.save", correlationId, organizationId, null, error);
      toast(operationToast("Could not save tax profile", correlationId));
      return;
    }
    setOrganizationTaxProfile(taxProfileForm);
    setIncomeTaxSchedules((schedules) => schedules.filter((schedule) => schedule.country_code === taxProfileForm.country_code));
    setIncomeTaxForm((form) => ({ ...form, name: taxProfileForm.country_code === "UG" && taxProfileForm.tax_entity_type === "company" ? "URA Corporation Tax" : "Confirmed business income-tax schedule", rateMethod: taxProfileForm.tax_entity_type === "company" ? "flat" : "progressive", rate: taxProfileForm.country_code === "UG" && taxProfileForm.tax_entity_type === "company" ? "30" : "" }));
    toast({ title: "Tax profile saved", description: "Income-tax estimates will only use a confirmed schedule for this entity type." });
    await loadBooks();
  };

  const saveVatRate = async () => {
    if (!organizationId) return;
    const { error } = await supabase.rpc("save_books_vat_rate", {
      target_organization_id: organizationId,
      target_name: vatRateForm.name.trim(),
      target_rate_percentage: Number(vatRateForm.rate),
      target_effective_from: vatRateForm.effectiveFrom,
      target_country_code: taxProfileForm.country_code,
    });
    if (error) {
      const correlationId = newCorrelationId();
      reportBooksError("books.tax.vat.save", correlationId, organizationId, null, error);
      toast(operationToast("Could not save VAT rate", correlationId));
      return;
    }
    toast({ title: "VAT rate saved", description: "It is effective from the selected date and will apply to matching invoices." });
    await loadBooks();
  };

  const confirmVatRate = async (rateId: string) => {
    if (!organizationId) return;
    const { error } = await supabase.rpc("confirm_books_vat_rate", { target_organization_id: organizationId, target_rate_id: rateId });
    if (error) {
      const correlationId = newCorrelationId();
      reportBooksError("books.tax.vat.save", correlationId, organizationId, rateId, error);
      toast(operationToast("Could not confirm VAT rate", correlationId));
      return;
    }
    toast({ title: "VAT rate confirmed" });
    await loadBooks();
  };

  const saveIncomeTaxSchedule = async () => {
    if (!organizationId || !organizationTaxProfile.tax_entity_type) return;
    if (incomeTaxForm.rateMethod === "flat" && (incomeTaxForm.rate === "" || Number(incomeTaxForm.rate) < 0 || Number(incomeTaxForm.rate) > 100)) {
      toast({ title: "Enter a valid flat tax rate", description: "The rate must be between 0% and 100%.", variant: "destructive" });
      return;
    }
    if (incomeTaxForm.rateMethod === "progressive" && incomeTaxBrackets.some((bracket, index) => !bracket.lowerBound || !bracket.rate || bracket.baseTax === "" || (index < incomeTaxBrackets.length - 1 && !bracket.upperBound) || (index === incomeTaxBrackets.length - 1 && bracket.upperBound))) {
      toast({ title: "Complete the progressive tax brackets", description: "Each bracket needs thresholds and a rate; only the final bracket can have no upper limit.", variant: "destructive" });
      return;
    }
    const rateSchedule = incomeTaxForm.rateMethod === "flat"
      ? [{ lower_bound: 0, upper_bound: null, rate_percentage: Number(incomeTaxForm.rate), base_tax: 0 }]
      : incomeTaxBrackets.map((bracket) => ({
        lower_bound: Number(bracket.lowerBound),
        upper_bound: bracket.upperBound ? Number(bracket.upperBound) : null,
        rate_percentage: Number(bracket.rate),
        base_tax: Number(bracket.baseTax),
      }));
    const { error } = await supabase.rpc("save_books_income_tax_schedule", {
      target_organization_id: organizationId,
      target_name: incomeTaxForm.name.trim(),
      target_tax_entity_type: organizationTaxProfile.tax_entity_type,
      target_rate_method: incomeTaxForm.rateMethod,
      target_effective_from: incomeTaxForm.effectiveFrom,
      target_rate_schedule: rateSchedule,
    });
    if (error) {
      const correlationId = newCorrelationId();
      reportBooksError("books.tax.income.save", correlationId, organizationId, null, error);
      toast(operationToast("Could not save income-tax schedule", correlationId));
      return;
    }
    toast({ title: "Income-tax schedule confirmed", description: "This schedule will be used for estimates for the selected entity type and effective period." });
    await loadBooks();
  };

  const saveWorkerBooksCurrency = async (nextCurrency: string) => {
    setSavingWorkerCurrency(true);
    const { data, error } = await supabase.rpc("set_worker_books_base_currency", { p_currency: nextCurrency });
    setSavingWorkerCurrency(false);
    if (error) {
      toast({ title: "Could not update Books currency", description: error.message, variant: "destructive" });
      return;
    }
    setBaseCurrency(String(data).trim());
    toast({ title: "Books reporting currency updated", description: "Task payout currencies are unchanged." });
  };

  const saveVatRegistration = async (nextVatRegistered: boolean) => {
    if (!organizationId) return;
    const operation: BooksOperation = "books.vatRegistration.save";
    const correlationId = newCorrelationId();
    setSaving(true);
    try {
      const { error } = await supabase.rpc("set_books_vat_registration", { target_organization_id: organizationId, target_vat_registered: nextVatRegistered });
      if (error) {
        reportBooksError(operation, correlationId, organizationId, null, error);
        toast(operationToast("Could not update VAT registration", correlationId));
        return;
      }
      setVatRegistered(nextVatRegistered);
      toast({ title: nextVatRegistered ? "VAT registration on" : "VAT registration off", description: "Applies to purchases recorded from now on." });
    } catch (error) {
      reportBooksError(operation, correlationId, organizationId, null, error as SupabaseErrorLike);
      toast(operationToast("Could not update VAT registration", correlationId));
    } finally {
      setSaving(false);
    }
  };

  const saveExpenseTaxTreatment = async (expense: Expense, taxTreatment: TaxTreatment) => {
    if (!organizationId || expense.tax_treatment === taxTreatment) return;
    const operation: BooksOperation = "books.expense.taxTreatment.save";
    const correlationId = newCorrelationId();
    const { error } = await supabase.from("books_expenses").update({ tax_treatment: taxTreatment }).eq("id", expense.id).eq("organization_id", organizationId);
    if (error) {
      reportBooksError(operation, correlationId, organizationId, expense.id, error);
      toast(operationToast("Could not update expense tax treatment", correlationId));
      return;
    }
    setExpenses((current) => current.map((item) => item.id === expense.id ? { ...item, tax_treatment: taxTreatment } : item));
  };

  const fxFromAmount = Number(fxConversionForm.from_amount);
  const fxToAmount = Number(fxConversionForm.to_ugx_amount);
  const fxCarryingRate = Number(fxConversionForm.carrying_ugx_per_unit);
  const fxImpliedRate = fxFromAmount > 0 && fxToAmount > 0 ? fxToAmount / fxFromAmount : null;
  const fxPreviewDifference = fxImpliedRate !== null && fxCarryingRate > 0 ? Math.round((fxToAmount - fxFromAmount * fxCarryingRate) * 10000) / 10000 : null;
  const currencyExchangeCard = !isPersonalWorkspace && isWorkerAccount !== true ? (
    <>
      <EntryCard title="Record currency exchange" onSubmit={saveFxConversion} saving={saving}>
        <p className="text-sm text-muted-foreground">Record a real exchange, such as USD sold at a bank or forex bureau for UGX. Enter the amount sold and the UGX received exactly as they happened. The purchase rate is the rate you paid when you got the foreign currency. Leave it blank if you don't know it.</p>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Exchange date and time"><Input type="datetime-local" value={fxConversionForm.exchange_at} onChange={(event) => setFxConversionForm({ ...fxConversionForm, exchange_at: event.target.value })} required /></Field>
          <Field label="Currency sold"><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={fxConversionForm.from_currency_code} onChange={(event) => setFxConversionForm({ ...fxConversionForm, from_currency_code: event.target.value })}>{supportedCurrencies.filter((code) => code !== "UGX").map((code) => <option key={code} value={code}>{code}</option>)}</select></Field>
          <Field label={`Amount sold (${fxConversionForm.from_currency_code})`}><Input type="number" min="0" step="0.01" value={fxConversionForm.from_amount} onChange={(event) => setFxConversionForm({ ...fxConversionForm, from_amount: event.target.value })} required /></Field>
          <Field label="UGX received"><Input type="number" min="0" step="0.01" value={fxConversionForm.to_ugx_amount} onChange={(event) => setFxConversionForm({ ...fxConversionForm, to_ugx_amount: event.target.value })} required /></Field>
          <Field label={`Purchase rate, optional (UGX per 1 ${fxConversionForm.from_currency_code})`}><Input type="number" min="0" step="0.00000001" value={fxConversionForm.carrying_ugx_per_unit} onChange={(event) => setFxConversionForm({ ...fxConversionForm, carrying_ugx_per_unit: event.target.value })} /></Field>
          <Field label="Provider (optional)"><Input value={fxConversionForm.provider} onChange={(event) => setFxConversionForm({ ...fxConversionForm, provider: event.target.value })} placeholder="Bank or forex bureau" /></Field>
          <Field label="Reference (optional)"><Input value={fxConversionForm.reference} onChange={(event) => setFxConversionForm({ ...fxConversionForm, reference: event.target.value })} placeholder="Receipt number" /></Field>
        </div>
        {fxImpliedRate !== null && <p className="text-sm">Rate you got in this exchange: 1 {fxConversionForm.from_currency_code} = {fxImpliedRate.toLocaleString(undefined, { maximumFractionDigits: 2 })} UGX. {fxPreviewDifference === null ? "No purchase rate entered, so no gain or loss will be calculated and this exchange will be marked for review." : fxPreviewDifference === 0 ? "No exchange gain or loss." : `Exchange ${fxPreviewDifference > 0 ? "gain" : "loss"}: ${formatMoney(Math.abs(fxPreviewDifference), "UGX")}.`}</p>}
      </EntryCard>
      {fxConversions.length > 0 && <DataTable headers={["Date", "Amount sold", "UGX received", "Purchase rate", "Exchange gain or loss", "Provider", "Reference"]}>{fxConversions.map((conversion) => <tr key={conversion.id} className="border-b"><td className="p-4">{conversion.exchange_at ? formatExchangeTime(conversion.exchange_at) : new Date(conversion.conversion_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td><td className="p-4">{formatMoney(Number(conversion.from_amount), conversion.from_currency_code)}</td><td className="p-4">{formatMoney(Number(conversion.to_ugx_amount), "UGX")}</td><td className="p-4 text-sm">{conversion.carrying_rate_recorded ? `${Number(conversion.carrying_ugx_per_unit).toLocaleString(undefined, { maximumFractionDigits: 8 })} UGX` : "Not entered"}</td><td className="p-4">{!conversion.carrying_rate_recorded ? "Not calculated" : Number(conversion.realized_fx_difference) > 0 ? <span className="font-medium text-emerald-700">Gain {formatMoney(Number(conversion.realized_fx_difference), "UGX")}</span> : Number(conversion.realized_fx_difference) < 0 ? <span className="font-medium text-red-600">Loss {formatMoney(Math.abs(Number(conversion.realized_fx_difference)), "UGX")}</span> : "None"}</td><td className="p-4">{conversion.provider || "—"}</td><td className="p-4 font-mono text-xs">{conversion.reference || "—"}</td></tr>)}</DataTable>}
    </>
  ) : null;

  if (loading) return <div className="min-h-screen bg-sheraton-cream/30 p-8"><div className="mx-auto max-w-7xl animate-pulse space-y-6"><div className="h-12 rounded bg-muted" /><div className="h-40 rounded bg-muted" /><div className="h-64 rounded bg-muted" /></div></div>;

  return (
    <div className="min-h-screen bg-gradient-to-b from-sheraton-cream/70 to-background">
      <div className={`container max-w-7xl py-8 ${documentIndex !== null ? "invisible" : ""}`}>
        <div className="mb-8 space-y-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl"><div className="mb-3 flex items-center gap-2"><BookOpen className="h-7 w-7 text-sheraton-gold" /><Badge className="bg-sheraton-gold text-sheraton-navy">Books</Badge></div><h1 className="text-3xl font-bold text-sheraton-navy sm:text-4xl">{isPersonalWorkspace ? "Personal Books" : isConsolidatedView ? "Consolidated financials" : isUsdView ? "USD Books" : "Your business finances"}</h1>{!isPersonalWorkspace && organizationName && <p className="mt-1 text-lg font-semibold text-sheraton-navy">{organizationName}</p>}<p className="mt-2 max-w-2xl text-muted-foreground">{isPersonalWorkspace ? "Purchases from signed-in hotel checkouts are recorded here separately from your hotel or business books." : "One secure Books workspace, with same-currency accounting views and transparent conversions using stored reference exchange rates."}</p></div>
            <div className="flex shrink-0 gap-2"><Button variant="outline" disabled={isWorkerAccount === true} onClick={() => { const nextParams = new URLSearchParams(searchParams); if (isPersonalWorkspace) { nextParams.delete("workspace"); nextParams.delete("organization"); } else { nextParams.set("workspace", "personal"); nextParams.delete("organization"); } navigate(`/books?${nextParams.toString()}`); }}>{isPersonalWorkspace ? "Business Books" : "Personal Books"}</Button><Button variant="outline" onClick={() => void loadBooks()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
          </div>
          {isConsolidatedView && <Card><CardContent className="space-y-3 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Convert consolidated totals</p><p className="text-xs text-muted-foreground">Reference rate · {fxProvider ?? "loading"} · {fxAsOf ? `source timestamp ${new Date(fxAsOf).toLocaleString()}` : "rates loading"}</p></div><div className="flex gap-2"><select aria-label="Converted reporting currency" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={targetCurrency} onChange={(event) => setTargetCurrency(event.target.value)}>{supportedCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}</select><Button type="button" variant="outline" onClick={() => void refreshExchangeRates()}><RefreshCw className="mr-2 h-4 w-4" />Refresh rates</Button></div></div>{fxError && <p role="alert" className="text-sm text-destructive">{fxError}</p>}</CardContent></Card>}
        </div>
        {currencyTotalsError && <div role="alert" className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><p>{currencyTotalsError}</p><Button variant="outline" size="sm" onClick={() => void loadBooks()}>Retry totals</Button></div>}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 md:grid-cols-7"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="contacts">Contacts</TabsTrigger><TabsTrigger value="invoices">Invoices</TabsTrigger><TabsTrigger value="expenses">Expenses</TabsTrigger><TabsTrigger value="tax">Tax summary</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger><TabsTrigger value="accounts">Chart of accounts</TabsTrigger></TabsList>
          <TabsContent value="overview" className="space-y-6">
            {isWorkerBooksWorkspace && !isConsolidatedView && !isPersonalWorkspace && <Card><CardHeader><CardTitle>Books reporting currency</CardTitle><p className="text-sm text-muted-foreground">This sets your Books reporting currency only. It does not change the currency agreed for task payouts.</p></CardHeader><CardContent className="space-y-2"><Label htmlFor="worker-books-base-currency">Reporting currency</Label><select id="worker-books-base-currency" className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm" value={baseCurrency} disabled={workerBooksCurrencyLocked || savingWorkerCurrency} onChange={(event) => void saveWorkerBooksCurrency(event.target.value)}>{!BOOKS_SUPPORTED_CURRENCIES.includes(baseCurrency as typeof BOOKS_SUPPORTED_CURRENCIES[number]) && <option value={baseCurrency}>{baseCurrency} (current)</option>}{BOOKS_SUPPORTED_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select>{workerBooksCurrencyLocked ? <p className="text-xs text-muted-foreground">Currency is locked because your Books has recorded transactions.</p> : <p className="text-xs text-muted-foreground">You can change this until your first Books transaction is recorded.</p>}</CardContent></Card>}
            {isConsolidatedView ? <><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label={`Income · ${targetCurrency}`} value={currencyTotalsError ? "Totals unavailable" : hasAllConversionRates ? formatMoney(convertTotal("income"), targetCurrency) : "Rates unavailable"} icon={<ArrowUpRight className="h-5 w-5" />} tone="green" /><Metric label={`Expenses · ${targetCurrency}`} value={currencyTotalsError ? "Totals unavailable" : hasAllConversionRates ? formatMoney(convertTotal("expenses"), targetCurrency) : "Rates unavailable"} icon={<ArrowDownToLine className="h-5 w-5" />} tone="red" /><Metric label={`Receivables · ${targetCurrency}`} value={currencyTotalsError ? "Totals unavailable" : hasAllConversionRates ? formatMoney(convertTotal("receivables"), targetCurrency) : "Rates unavailable"} icon={<CircleDollarSign className="h-5 w-5" />} tone="gold" /><Metric label={`Net income · ${targetCurrency}`} value={currencyTotalsError ? "Totals unavailable" : hasAllConversionRates ? formatMoney(convertTotal("net_result"), targetCurrency) : "Rates unavailable"} icon={<BarChart3 className="h-5 w-5" />} tone="green" /></div><Card className="overflow-hidden"><CardHeader className="border-b bg-muted/20"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Source currency breakdown</CardTitle><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Source amounts remain as recorded in Books. Converted overview totals and “Net income in {targetCurrency}” use rates from {fxProvider ?? "loading"} (rate date: {fxAsOf ? new Date(fxAsOf).toLocaleDateString() : "unavailable"}). These are comparison figures only; they do not change recorded amounts or create Books entries.</p></div><Badge variant="outline" className="w-fit shrink-0">Converted to {targetCurrency}</Badge></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead><tr className="border-b bg-muted/30"><th className="p-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source currency</th>{["Invoices", "Tax", "Expenses", "Net income"].map((label) => <th key={label} className="whitespace-nowrap p-4 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</th>)}<th className="whitespace-nowrap bg-sheraton-gold/10 p-4 text-right text-xs font-semibold uppercase tracking-wide text-sheraton-navy">Net income in {targetCurrency}</th></tr></thead><tbody>{currencyTotals.map((row) => { const factor = fxFactor(row.currency_code); return <tr key={row.currency_code} className="border-b last:border-0 hover:bg-muted/20"><td className="p-4"><Badge variant="outline" className="font-semibold">{row.currency_code}</Badge></td><td className="whitespace-nowrap p-4 text-right tabular-nums">{formatMoney(Number(row.invoice_total), row.currency_code)}</td><td className="whitespace-nowrap p-4 text-right tabular-nums">{formatMoney(Number(row.tax_total), row.currency_code)}</td><td className="whitespace-nowrap p-4 text-right tabular-nums">{formatMoney(Number(row.expenses), row.currency_code)}</td><td className="whitespace-nowrap p-4 text-right font-medium tabular-nums">{formatMoney(Number(row.net_result), row.currency_code)}</td><td className="whitespace-nowrap bg-sheraton-gold/5 p-4 text-right font-semibold tabular-nums">{factor === null ? "Rate unavailable" : formatMoney(Number(row.net_result) * factor, targetCurrency)}</td></tr>; })}</tbody></table></div></CardContent></Card></> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label={`Income · ${currency}`} value={formatMoney(revenue, currency)} icon={<ArrowUpRight className="h-5 w-5" />} tone="green" /><Metric label={`Expenses · ${currency}`} value={formatMoney(expensesTotal, currency)} icon={<ArrowDownToLine className="h-5 w-5" />} tone="red" /><Metric label={`Receivables · ${currency}`} value={formatMoney(receivable, currency)} icon={<CircleDollarSign className="h-5 w-5" />} tone="gold" /><Metric label={`Net income · ${currency}`} value={formatMoney(profit, currency)} icon={<BarChart3 className="h-5 w-5" />} tone={profit >= 0 ? "green" : "red"} /></div>}
            <div className="grid gap-6 lg:grid-cols-[1.3fr_.7fr]"><Card><CardHeader><CardTitle>Get started</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><QuickAction icon={<Users />} title="Add a contact" text="Customers and vendors" onClick={() => setActiveTab("contacts")} /><QuickAction icon={<FileText />} title="Create an invoice" text="Track money owed" onClick={() => setActiveTab("invoices")} /><QuickAction icon={<Receipt />} title="Record an expense" text="Keep costs current" onClick={() => setActiveTab("expenses")} /></CardContent></Card><Card><CardHeader><CardTitle>Attention needed</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>{overdue ? `${overdue} invoice${overdue === 1 ? "" : "s"} need follow-up.` : "No overdue invoices."}</p><p>{customerContacts.length} customer contacts and {vendorContacts.length} vendors are in your books.</p><Button variant="link" className="px-0" onClick={() => setActiveTab("reports")}>View financial reports →</Button></CardContent></Card></div>
            {loyaltyPostings.length > 0 && <Card><CardHeader><CardTitle>Rewards liability postings</CardTitle><p className="text-sm text-muted-foreground">Platform-funded loyalty accruals and reversals recorded in this Books organization.</p></CardHeader><CardContent><DataTable headers={["Posted date", "Amount (UGX)", "Status", "Journal"]}>{loyaltyPostings.map((posting) => <tr key={posting.ledger_entry_id} className="border-b"><td className="p-4">{new Date(posting.created_at).toLocaleDateString()}</td><td className="p-4">{formatMoney(Number(posting.amount_ugx), "UGX")}</td><td className="p-4"><Badge variant={posting.status === "posted" ? "default" : "outline"}>{posting.status}</Badge>{posting.status === "failed" && posting.error_message && <p className="mt-1 text-xs text-destructive">{posting.error_message}</p>}</td><td className="p-4 font-mono text-xs">{posting.journal_transaction_id || "Pending"}</td></tr>)}</DataTable></CardContent></Card>}
            {isWorkerAccount && workerTaskPayments.length > 0 && <Card><CardHeader><CardTitle>Task payments</CardTitle><p className="text-sm text-muted-foreground">When a hotel records a payment, confirm here only after you have received the funds. Confirmation settles your invoice and queues the receipt email to both accounts.</p></CardHeader><CardContent><DataTable headers={["Date recorded", "Original amount", "Payout amount", "Exchange rate", "Method", "Reference", "Confirmation"]}>{workerTaskPayments.map((payment) => <tr key={payment.id} className="border-b"><td className="p-4">{new Date(payment.paid_at).toLocaleDateString()}</td><td className="p-4">{formatMoney(Number(payment.amount), payment.currency_code)}</td><td className="p-4 font-semibold">{payment.converted_amount !== null ? formatMoney(Number(payment.converted_amount), payment.payout_currency_code || payment.currency_code) : "Payout amount unavailable"}</td><td className="p-4 text-sm"><PaymentRate payment={payment} exchange={exchangeForPayment(payment)} /></td><td className="p-4 capitalize">{payment.payment_method.replace("_", " ")}</td><td className="p-4 font-mono text-xs">{payment.payment_reference}</td><td className="p-4">{payment.confirmation_status === "confirmed" ? <Badge>Confirmed {payment.worker_acknowledged_at ? new Date(payment.worker_acknowledged_at).toLocaleDateString() : ""}</Badge> : payment.confirmation_status === "legacy_settled" ? <Badge variant="outline">Previously settled</Badge> : <div className="space-y-2"><Badge variant="outline">Awaiting confirmation</Badge><Button size="sm" disabled={confirmingPaymentId !== null} onClick={() => void confirmPaymentReceived(payment)}>{confirmingPaymentId === payment.id ? "Confirming…" : "Confirm receipt of payment"}</Button></div>}</td></tr>)}</DataTable></CardContent></Card>}
          </TabsContent>
          <TabsContent value="contacts" className="space-y-6"><Card><CardHeader><CardTitle>Add customer or vendor</CardTitle></CardHeader><CardContent><form onSubmit={saveContact} className="grid gap-4 md:grid-cols-5"><div className="space-y-2 md:col-span-2"><Label>Name *</Label><Input value={contactForm.name} onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })} placeholder="Business or person" required /></div><div className="space-y-2"><Label>Type</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={contactForm.type} onChange={(event) => setContactForm({ ...contactForm, type: event.target.value as Contact["type"] })}><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="both">Both</option></select></div><div className="space-y-2"><Label>Email</Label><Input type="email" value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} /></div><div className="flex items-end"><Button className="w-full sheraton-gradient text-white" disabled={saving}><Plus className="mr-2 h-4 w-4" />Add contact</Button></div></form></CardContent></Card><DataTable headers={["Name", "Type", "Email", "Tax ID"]}>{contacts.map((contact) => <tr key={contact.id} className="border-b"><td className="p-4 font-medium">{contact.name}</td><td className="p-4"><Badge variant="outline">{contact.type}</Badge></td><td className="p-4 text-muted-foreground">{contact.email || "—"}</td><td className="p-4 text-muted-foreground">{contact.tax_id || "—"}</td></tr>)}</DataTable></TabsContent>
          <TabsContent value="invoices" className="space-y-6"><EntryCard title="Create invoice" onSubmit={saveInvoice} saving={saving}><div className="grid gap-4 md:grid-cols-6"><Field label="Invoice number"><Input value={invoiceForm.invoice_number} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoice_number: event.target.value })} placeholder="INV-0001" required /></Field><Field label="Customer"><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={invoiceForm.contact_id} onChange={(event) => setInvoiceForm({ ...invoiceForm, contact_id: event.target.value })}><option value="">Select customer</option>{customerContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></Field><Field label="Issue date and time"><Input type="datetime-local" value={invoiceForm.issue_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, issue_date: event.target.value })} /></Field><Field label="Due date"><Input type="date" value={invoiceForm.due_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, due_date: event.target.value })} /></Field><Field label={`Subtotal (${currency})`}><Input type="number" min="0" step="0.01" value={invoiceForm.subtotal} onChange={(event) => setInvoiceForm({ ...invoiceForm, subtotal: event.target.value })} required /></Field><Field label="Tax rate"><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={invoiceForm.tax_rate_id} onChange={(event) => setInvoiceForm({ ...invoiceForm, tax_rate_id: event.target.value })}><option value="">Use confirmed default{defaultInvoiceTaxRate ? ` · ${defaultInvoiceTaxRate.name} ${defaultInvoiceTaxRate.rate_percentage}%` : " · unavailable"}</option><option value="none">No tax</option>{effectiveInvoiceTaxRates.map((rate) => <option key={rate.id} value={rate.id}>{rate.name} ({rate.rate_percentage}%)</option>)}</select></Field></div></EntryCard><DataTable headers={["Invoice", "Customer", "Issue date", "Due date", "Total (source currency)", "Exchange rate", "Converted from", "Status", "Documents"]}>{invoices.map((invoice) => <tr key={invoice.id} className="border-b"><td className="p-4 font-medium" title={invoice.invoice_number}>{renderInvoiceLabel(invoice)}</td><td className="p-4">{contactName(invoice.contact_id)}</td><td className="p-4">{formatDocumentDate(invoice.issue_date, invoice.issue_at)}</td><td className="p-4">{invoice.due_date}</td><td className="p-4 font-semibold">{formatMoney(Number(invoice.total_due), invoice.currency_code.trim())}</td><td className="p-4 text-sm">{renderPaymentRate(paymentForInvoice(invoice))}</td><td className="p-4 text-sm">{paymentForInvoice(invoice)?.currency_code.trim() ?? "—"}</td><td className="p-4"><Badge variant={invoice.status === "paid" ? "default" : "outline"}>{invoice.status}</Badge></td><td className="p-4"><div className="flex flex-col items-start gap-1">{renderDocumentButtons([{ label: "Invoice", typeLabel: "Invoice", url: invoice.invoice_url }, { label: "Receipt", typeLabel: "Receipt", url: invoice.receipt_url }])}</div></td></tr>)}</DataTable></TabsContent>
          <TabsContent value="expenses" className="space-y-6"><Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">VAT registration</p><p className="text-xs text-muted-foreground">When on, VAT paid on purchases is recorded as recoverable input VAT, separate from the expense amount.</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vatRegistered} disabled={saving} onChange={(event) => void saveVatRegistration(event.target.checked)} />VAT-registered business</label></CardContent></Card>{currencyExchangeCard}<EntryCard title="Record expense" onSubmit={saveExpense} saving={saving}><div className="grid gap-4 md:grid-cols-6"><Field label="Description"><Input value={expenseForm.description} onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })} placeholder="Internet, rent, supplies" required /></Field><Field label="Vendor"><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={expenseForm.contact_id} onChange={(event) => setExpenseForm({ ...expenseForm, contact_id: event.target.value })}><option value="">Select vendor</option>{vendorContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></Field><Field label="Date and time"><Input type="datetime-local" value={expenseForm.expense_date} onChange={(event) => setExpenseForm({ ...expenseForm, expense_date: event.target.value })} /></Field><Field label={`Amount (${currency})`}><Input type="number" min="0" step="0.01" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} required /></Field><Field label={`Tax (${currency})`}><Input type="number" min="0" step="0.01" value={expenseForm.tax_amount} onChange={(event) => setExpenseForm({ ...expenseForm, tax_amount: event.target.value })} /></Field>{vatRegistered && <Field label="Recoverable VAT"><label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={expenseForm.vat_recoverable} onChange={(event) => setExpenseForm({ ...expenseForm, vat_recoverable: event.target.checked })} />Input VAT</label></Field>}<Field label="Tax treatment"><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={expenseForm.tax_treatment} onChange={(event) => setExpenseForm({ ...expenseForm, tax_treatment: event.target.value as TaxTreatment })}><option value="review">Needs review</option><option value="deductible">Deductible</option><option value="non_deductible">Non-deductible</option></select></Field></div></EntryCard><DataTable headers={["Description", "Vendor", "Date", "Amount (source currency)", ...(currency !== "UGX" ? ["Exchange rate"] : []), "Payment", "Tax treatment", "Documents"]}>{tableExpenses.map((expense) => <tr key={expense.id} className="border-b"><td className="p-4 font-medium">{renderExpenseLabel(expense)}</td><td className="p-4">{contactName(expense.contact_id)}</td><td className="p-4">{formatDocumentDate(expense.expense_date, expense.expense_at)}</td><td className="p-4 font-semibold">{formatMoney(Number(expense.amount) + Number(expense.tax_amount), expense.currency_code.trim())}{expense.vat_recoverable && <span className="block text-xs font-normal text-muted-foreground">Input VAT {formatMoney(Number(expense.tax_amount), expense.currency_code.trim())}</span>}</td>{currency !== "UGX" && <td className="p-4 text-sm">{renderPaymentRate(paymentForExpense(expense))}</td>}<td className="p-4"><Badge variant="outline">{expense.payment_status}</Badge></td><td className="p-4"><select aria-label={`Tax treatment for ${expense.description}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={expense.tax_treatment} onChange={(event) => void saveExpenseTaxTreatment(expense, event.target.value as TaxTreatment)}><option value="review">Needs review</option><option value="deductible">Deductible</option><option value="non_deductible">Non-deductible</option></select></td><td className="p-4">{renderDocumentButtons([{ label: "Receipt", typeLabel: "Receipt", url: expense.receipt_url }])}</td></tr>)}</DataTable></TabsContent>
          <TabsContent value="tax" className="space-y-6">
            <Card><CardHeader><CardTitle>Tax organization summary</CardTitle><p className="text-sm text-muted-foreground">Organize your records and review possible deductions. This is not a tax return or a calculation of tax payable.</p></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Field label="Period start"><Input type="date" value={taxPeriodStart} max={taxPeriodEnd} onChange={(event) => setTaxPeriodStart(event.target.value)} /></Field><Field label="Period end"><Input type="date" value={taxPeriodEnd} min={taxPeriodStart} onChange={(event) => setTaxPeriodEnd(event.target.value)} /></Field></CardContent></Card>
            {!hasValidTaxPeriod ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Choose a period where the start date is on or before the end date.</p> : <>
              {currency !== baseCurrency && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Tax figures include only {currency} records; foreign-currency records are not converted. Income-tax estimates are available only in your Books base currency ({baseCurrency}).</p>}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label={`Gross invoice income · ${currency}`} value={formatMoney(taxSummary.invoiceIncome, currency)} icon={<ArrowUpRight className="h-5 w-5" />} tone="green" /><Metric label={`Allowable deductions recorded · ${currency}`} value={formatMoney(taxSummary.allowableDeductions, currency)} icon={<ArrowDownToLine className="h-5 w-5" />} tone="red" /><Metric label={rawTaxableIncome < 0 ? `Tax loss before carry-forward · ${currency}` : `Taxable income estimate · ${currency}`} value={formatMoney(Math.abs(rawTaxableIncome), currency)} icon={<BarChart3 className="h-5 w-5" />} tone="gold" /><Metric label={incomeTaxEstimate.status === "estimated" ? `Estimated income tax · ${currency}` : `Income-tax estimate · ${currency}`} value={incomeTaxEstimate.estimatedTax === null ? (incomeTaxEstimate.status === "currency_mismatch" ? `Use ${baseCurrency} view` : incomeTaxEstimate.status === "review_required" ? "Review expenses first" : "Not configured") : formatMoney(incomeTaxEstimate.estimatedTax, baseCurrency)} icon={<CircleDollarSign className="h-5 w-5" />} tone="gold" /><Metric label="Expenses needing review" value={String(taxSummary.expensesToReview)} icon={<Receipt className="h-5 w-5" />} tone="gold" /></div>
              <Card><CardHeader><CardTitle>Tax and deduction details</CardTitle><p className="text-sm text-muted-foreground">Amounts include only {currency} records dated in the selected period. Income uses sent, overdue, and paid invoice subtotals by issue date; it is not a cash-receipts total. Income-tax estimates are available only in the Books base currency ({baseCurrency}); foreign-currency records are not converted for tax.</p></CardHeader><CardContent><DataTable headers={["Measure", `Amount (${currency})`]}><tr className="border-b"><td className="p-4">Gross invoice income (subtotal, excluding tax)</td><td className="p-4 font-semibold">{formatMoney(taxSummary.invoiceIncome, currency)}</td></tr><tr className="border-b"><td className="p-4">Invoice tax recorded (separate from income)</td><td className="p-4 font-semibold">{formatMoney(taxSummary.invoiceTax, currency)}</td></tr><tr className="border-b"><td className="p-4">Allowable deductions marked deductible</td><td className="p-4 font-semibold">{formatMoney(taxSummary.allowableDeductions, currency)}</td></tr><tr className="border-b"><td className="p-4">Expenses marked non-deductible</td><td className="p-4 font-semibold">{formatMoney(taxSummary.nonDeductibleExpenses, currency)}</td></tr><tr className="border-b"><td className="p-4">Recoverable input VAT (not a deduction)</td><td className="p-4 font-semibold">{formatMoney(taxSummary.recoverableInputVat, currency)}</td></tr><tr className="border-b"><td className="p-4">Taxable income estimate (not below zero)</td><td className="p-4 font-semibold">{formatMoney(taxableIncome, currency)}</td></tr><tr><td className="p-4">Loss before any carry-forward (if applicable)</td><td className="p-4 font-semibold">{formatMoney(Math.max(-rawTaxableIncome, 0), currency)}</td></tr></DataTable><p className="mt-4 text-sm text-muted-foreground">Tax treatment is a bookkeeping classification, not a determination under local tax law. Existing expenses start as “Needs review.” Recoverable input VAT is shown separately and is not a deduction; VAT that is not recoverable stays within the deductible expense amount. Any income-tax amount is a rate-based estimate only and excludes tax credits, exemptions, and any applicable loss carry-forward rules.</p>{incomeTaxEstimate.scheduleName && <p className="mt-2 text-sm font-medium">Applied schedule: {incomeTaxEstimate.scheduleName} · effective on {taxPeriodEnd}</p>}<Button variant="link" className="px-0" onClick={() => setActiveTab("expenses")}>Review expense classifications →</Button></CardContent></Card>
              <BooksTaxSettings currency={baseCurrency} isTaxProfileSaved={isTaxProfileSaved} taxProfileForm={taxProfileForm} setTaxProfileForm={setTaxProfileForm} saveTaxProfile={() => void saveTaxProfile()} taxRates={taxRates} vatRateForm={vatRateForm} setVatRateForm={setVatRateForm} saveVatRate={() => void saveVatRate()} confirmVatRate={(rateId) => void confirmVatRate(rateId)} incomeTaxSchedules={incomeTaxSchedules} incomeTaxForm={incomeTaxForm} setIncomeTaxForm={setIncomeTaxForm} incomeTaxBrackets={incomeTaxBrackets} setIncomeTaxBrackets={setIncomeTaxBrackets} saveIncomeTaxSchedule={() => void saveIncomeTaxSchedule()} />
            </>}
          </TabsContent>
          <TabsContent value="reports" className="space-y-6">{isConsolidatedView ? <Card><CardHeader><CardTitle>Converted financial statements · {targetCurrency}</CardTitle><p className="text-sm text-muted-foreground">Source amounts remain unchanged in Books. Conversion uses the latest available public reference rate, which may differ from a bank or payment provider’s transaction rate, and is never used to alter accounting entries.</p></CardHeader><CardContent><DataTable headers={["Statement measure", `Converted total (${targetCurrency})`]}>{([["Invoice total", "invoice_total"], ["Income", "income"], ["Expenses", "expenses"], ["Net income", "net_result"], ["Tax and hotel levies", "tax_total"], ["Receivables", "receivables"], ["Assets", "assets"], ["Liabilities", "liabilities"], ["Equity", "equity"]] as const).map(([label, field]) => <tr key={field} className="border-b"><td className="p-4">{label}</td><td className="p-4 font-semibold">{currencyTotalsError ? "Totals unavailable" : hasAllConversionRates ? formatMoney(convertTotal(field), targetCurrency) : "Rates unavailable"}</td></tr>)}</DataTable></CardContent></Card> : <><div className="grid gap-6 lg:grid-cols-3"><ReportCard title="Profit & loss" rows={[["Income", revenue], ["Expenses", expensesTotal], ["Net income", profit]]} currency={currency} /><ReportCard title="Balance sheet" rows={[["Assets", assets], ["Liabilities", liabilities], ["Equity", equity]]} currency={currency} /><ReportCard title="Receivables" rows={[["Open invoices", receivable], ["Paid invoices", visibleInvoices.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + Number(invoice.total_due), 0)]]} currency={currency} /></div><Card><CardHeader><CardTitle>Ledger-backed reporting</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Reports are calculated from immutable journal lines created automatically when expenses are recorded and invoices are paid. The balance sheet follows Assets = Liabilities + Equity.</CardContent></Card></>}</TabsContent>
          <TabsContent value="accounts"><Card><CardHeader><CardTitle>Chart of accounts</CardTitle></CardHeader><CardContent>{accounts.length ? <DataTable headers={["Code", "Account", "Type"]}>{accounts.map((account) => <tr key={account.id} className="border-b"><td className="p-4 font-mono">{account.code}</td><td className="p-4 font-medium">{account.name}</td><td className="p-4"><Badge variant="outline">{account.type}</Badge></td></tr>)}</DataTable> : <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Your chart of accounts will appear here once your Books workspace is initialized.</div>}</CardContent></Card></TabsContent>
        </Tabs>
      </div>
      <FullscreenMediaViewer items={documentItems} selectedIndex={documentIndex} onSelectedIndexChange={setDocumentIndex} />
    </div>
  );
};

const Metric = ({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: "green" | "red" | "gold" }) => <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold text-sheraton-navy">{value}</p></div><span className={`rounded-full p-3 ${tone === "green" ? "bg-green-100 text-green-700" : tone === "red" ? "bg-red-100 text-red-700" : "bg-sheraton-gold/20 text-sheraton-gold"}`}>{icon}</span></CardContent></Card>;
const QuickAction = ({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) => <button onClick={onClick} className="rounded-lg border p-4 text-left transition-colors hover:bg-muted"><span className="mb-3 block text-sheraton-gold">{icon}</span><span className="block font-semibold">{title}</span><span className="text-sm text-muted-foreground">{text}</span></button>;
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="space-y-2"><Label>{label}</Label>{children}</div>;
const EntryCard = ({ title, onSubmit, saving, children }: { title: string; onSubmit: (event: FormEvent) => void; saving: boolean; children: React.ReactNode }) => <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent><form onSubmit={onSubmit} className="space-y-4">{children}<Button className="sheraton-gradient text-white" disabled={saving}><Plus className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save"}</Button></form></CardContent></Card>;
const DataTable = ({ headers, children }: { headers: string[]; children: React.ReactNode }) => <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[650px]"><thead><tr className="border-b bg-muted/30">{headers.map((header) => <th key={header} className="p-4 text-left text-sm font-semibold">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div></CardContent></Card>;
const ReportCard = ({ title, rows, currency }: { title: string; rows: [string, number][]; currency: string }) => <Card><CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader><CardContent className="space-y-3">{rows.map(([label, value]) => <div key={label} className="flex justify-between border-b pb-2 text-sm last:border-0"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{formatMoney(value, currency)}</span></div>)}</CardContent></Card>;

export default BooksPage;
