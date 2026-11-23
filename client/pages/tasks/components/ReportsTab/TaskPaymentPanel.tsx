import React, { useEffect, useState } from "react";
import { supabase, Task as TaskType, WorkerTaskPayment } from "../../../../lib/supabase";
import { toast } from "../../../../hooks/use-toast";
import { formatTaskAmount } from "../../../../lib/taskCurrency";

const PAYMENT_METHODS: Array<{ value: WorkerTaskPayment["payment_method"]; label: string }> = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

interface TaskPaymentPanelProps {
  task: TaskType;
}

const TaskPaymentPanel: React.FC<TaskPaymentPanelProps> = ({ task }) => {
  const [payment, setPayment] = useState<WorkerTaskPayment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [method, setMethod] = useState<WorkerTaskPayment["payment_method"]>("bank_transfer");
  const [reference, setReference] = useState("");

  const agreedAmount = task.final_amount ?? 0;
  const hasAgreedAmount = agreedAmount > 0;

  const loadPayment = async () => {
    const { data, error } = await supabase
      .from("worker_task_payments")
      .select("id, task_id, amount, tax_amount, currency_code, payout_currency_code, fx_rate, fx_rate_source, fx_rate_fetched_at, converted_amount, converted_tax_amount, payment_method, payment_reference, paid_at, confirmation_status, worker_acknowledged_at")
      .eq("task_id", task.id)
      .maybeSingle();
    if (error) {
      toast({ title: "Could not load payment", description: error.message, variant: "destructive" });
    }
    setPayment(data ?? null);
    setIsLoading(false);
  };

  useEffect(() => {
    setIsLoading(true);
    void loadPayment();
    const interval = window.setInterval(() => void loadPayment(), 5000);
    return () => window.clearInterval(interval);
  }, [task.id]);

  const handleRecordPayment = async () => {
    const trimmedReference = reference.trim();
    if (!trimmedReference) {
      toast({ title: "Reference required", description: "Enter the payment reference before recording.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    const { error } = await supabase.rpc("record_worker_task_payment", {
      p_task_id: task.id,
      p_payment_method: method,
      p_payment_reference: trimmedReference,
    });
    setIsSaving(false);
    if (error) {
      toast({ title: "Payment not recorded", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Payment recorded", description: "The worker will be asked to confirm receipt before the receipt is issued." });
    setReference("");
    void loadPayment();
  };

  if (isLoading) return null;

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border-2 border-sheraton-gold">
      <h3 className="text-lg font-semibold text-sheraton-navy mb-4">Worker Payment</h3>
      <div className="mb-4 text-sm">
        <p className="text-gray-600">Agreed amount</p>
        <p className="font-medium text-gray-900">
          {hasAgreedAmount ? formatTaskAmount(agreedAmount, task.currency_code) : "No agreed amount on this task"}
        </p>
      </div>

      {payment ? (
        <div className={`p-4 rounded-lg text-sm space-y-1 ${payment.confirmation_status !== "pending_confirmation" ? "bg-green-50 border border-green-200 text-green-800" : "bg-amber-50 border border-amber-200 text-amber-900"}`}>
          <p className="font-semibold">
            {payment.confirmation_status === "confirmed" ? "Worker confirmed receipt" : payment.confirmation_status === "legacy_settled" ? "Paid before worker confirmation tracking" : "Payment recorded · awaiting the worker's confirmation"} · {payment.amount.toLocaleString()} {payment.currency_code} on {new Date(payment.paid_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
          {payment.tax_amount > 0 && (
            <p>VAT included: {payment.tax_amount.toLocaleString()} {payment.currency_code}</p>
          )}
          {payment.payout_currency_code && payment.payout_currency_code !== payment.currency_code && payment.fx_rate !== null && payment.converted_amount !== null && (
            <div className="pt-1 border-t border-green-200 space-y-1">
              <p>Payment to {task.assignee_name ?? "worker"}: {payment.converted_amount.toLocaleString()} {payment.payout_currency_code}</p>
              <p>
                Exchange rate used: 1 {payment.currency_code} = {payment.fx_rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {payment.payout_currency_code}
                {payment.fx_rate_source === "manual" ? " (entered manually)" : payment.fx_rate_fetched_at ? ` (live on ${new Date(payment.fx_rate_fetched_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })})` : ""}
              </p>
            </div>
          )}
          <p>Method: {PAYMENT_METHODS.find((item) => item.value === payment.payment_method)?.label ?? payment.payment_method}</p>
          <p>Reference: {payment.payment_reference}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="worker-payment-method" className="block text-sm font-medium text-gray-700 mb-1">
              Payment method
            </label>
            <select
              id="worker-payment-method"
              value={method}
              onChange={(event) => setMethod(event.target.value as WorkerTaskPayment["payment_method"])}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              {PAYMENT_METHODS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          {task.settlement_currency_code && task.settlement_currency_code !== task.currency_code && task.settlement_fx_rate ? (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
              Paid in {task.settlement_currency_code} at the agreed rate: 1 {task.currency_code} = {Number(task.settlement_fx_rate).toLocaleString(undefined, { maximumFractionDigits: 8 })} {task.settlement_currency_code}
            </div>
          ) : task.currency_code ? (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
              Paid in {task.settlement_currency_code || task.currency_code}{!task.settlement_currency_code || task.settlement_currency_code === task.currency_code ? " (same as task)" : " (rate unavailable)"}
            </div>
          ) : null}
          <div>
            <label htmlFor="worker-payment-reference" className="block text-sm font-medium text-gray-700 mb-1">
              Payment reference
            </label>
            <input
              id="worker-payment-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={120}
              placeholder="Transfer ID or receipt number"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleRecordPayment()}
            disabled={!hasAgreedAmount || isSaving || !reference.trim()}
            className="px-4 py-2 bg-sheraton-gold text-sheraton-navy rounded-lg font-semibold disabled:opacity-50"
          >
            {isSaving ? "Recording..." : "Record payment"}
          </button>
        </div>
      )}
    </div>
  );
};

export default TaskPaymentPanel;
