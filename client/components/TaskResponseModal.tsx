import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Loader, CheckCircle, XCircle, MessageSquare } from "lucide-react";
import { supabase, Task as TaskType } from "../lib/supabase";
import { formatTaskDeadline } from "../lib/taskDeadline";
import { formatTaskAmount, getTaskAmount, getSettlementCurrencies } from "../lib/taskCurrency";
import DeadlineCountdown from "./DeadlineCountdown";
import { toast } from "../hooks/use-toast";

interface TaskResponseModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: TaskType | null;
  workerId: string;
  workerName: string;
  onResponseSubmitted?: () => void;
}

type ResponseAction = "accept" | "decline" | "propose";

export const TaskResponseModal: React.FC<TaskResponseModalProps> = ({
  isOpen,
  onClose,
  task,
  workerId,
  workerName,
  onResponseSubmitted,
}) => {
  const [selectedAction, setSelectedAction] = useState<ResponseAction | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [quotedPrice, setQuotedPrice] = useState("");
  const [proposalNotes, setProposalNotes] = useState("");
  const [proposedTimeline, setProposedTimeline] = useState("");
  const [proposedSettlementCurrency, setProposedSettlementCurrency] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rateAccepted, setRateAccepted] = useState(false);
  const [proposalRate, setProposalRate] = useState<{ fx_rate: number; rate_fetched_at: string | null } | null>(null);
  const [proposalRateError, setProposalRateError] = useState<string | null>(null);
  const [proposalRateAccepted, setProposalRateAccepted] = useState(false);
  const [bookedExchange, setBookedExchange] = useState<{
    provider: string | null;
    conversion_date: string;
    exchange_at: string | null;
    from_amount: number;
    to_ugx_amount: number;
  } | null>(null);
  const isConvertedRate = !!task && task.settlement_currency_code !== task.currency_code && !!task.settlement_fx_rate;
  const proposalSettlementCurrency =
    proposedSettlementCurrency || task?.settlement_currency_code || task?.currency_code || "";
  const isConvertedProposal = !!task && proposalSettlementCurrency !== task.currency_code;
  const rateGateBlocked =
    (selectedAction === "accept" && isConvertedRate && !rateAccepted) ||
    (selectedAction === "propose" && isConvertedProposal && (!proposalRate || !proposalRateAccepted));

  useEffect(() => {
    const conversionId = task?.settlement_fx_conversion_id;
    if (!isOpen || task?.settlement_fx_rate_source !== "books_exchange" || !conversionId) {
      setBookedExchange(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("books_fx_conversions")
        .select("provider, conversion_date, exchange_at, from_amount, to_ugx_amount")
        .eq("id", conversionId)
        .maybeSingle();
      if (!cancelled) setBookedExchange(data ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, task?.settlement_fx_conversion_id, task?.settlement_fx_rate_source]);

  useEffect(() => {
    if (!isOpen || selectedAction !== "propose" || !task || !isConvertedProposal) {
      setProposalRate(null);
      setProposalRateError(null);
      setProposalRateAccepted(false);
      return;
    }
    let cancelled = false;
    setProposalRate(null);
    setProposalRateError(null);
    setProposalRateAccepted(false);
    void (async () => {
      const { data, error } = await supabase.rpc("preview_task_settlement_rate", {
        p_task_id: task.id,
        p_settlement_currency: proposalSettlementCurrency,
      });
      if (cancelled) return;
      if (error) {
        setProposalRateError(error.message);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      setProposalRate(row ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedAction, task?.id, isConvertedProposal, proposalSettlementCurrency]);

  if (!task) return null;

  const handleSubmitResponse = async () => {
    if (!selectedAction) return;
    if (rateGateBlocked) return;

    setIsSubmitting(true);
    try {
      const { error: submitError } = await supabase.rpc("submit_task_response", {
        p_task_id: task.id,
        p_worker_id: workerId,
        p_action: selectedAction,
        p_response_message:
          selectedAction === "decline"
            ? declineReason
            : selectedAction === "propose"
              ? proposalNotes
              : null,
        p_rate_acknowledged: selectedAction === "propose" ? isConvertedProposal && proposalRateAccepted : selectedAction === "accept" && rateAccepted,
        p_quoted_price: selectedAction === "propose" && quotedPrice ? parseFloat(quotedPrice) : null,
        p_proposal_notes: selectedAction === "propose" ? proposalNotes : null,
        p_proposed_timeline: selectedAction === "propose" ? proposedTimeline : null,
        p_proposed_settlement_currency_code: selectedAction === "propose" ? proposalSettlementCurrency : null,
      });

      if (submitError) throw submitError;

      toast({
        title: "Success",
        description:
          selectedAction === "accept"
            ? "Task accepted! You'll see it in your Todo List."
            : selectedAction === "decline"
              ? "Task declined. The manager has been notified."
              : "Proposal submitted! The manager will review your quote.",
      });

      // Reset and close
      setSelectedAction(null);
      setDeclineReason("");
      setQuotedPrice("");
      setProposalNotes("");
      setProposedTimeline("");
      setProposedSettlementCurrency("");
      setRateAccepted(false);
      setProposalRateAccepted(false);
      onClose();
      onResponseSubmitted?.();
    } catch (error) {
      console.error("Error submitting response:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to submit response",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-100 text-red-800";
      case "high":
        return "bg-orange-100 text-orange-800";
      case "medium":
        return "bg-yellow-100 text-yellow-800";
      case "low":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-sheraton-navy">
                Respond to Task
              </h2>
            </div>
          </DialogTitle>
          <DialogDescription className="pt-2">
            You have been assigned a task. Review the details below and choose
            your action.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Task Details Card */}
          <Card className="bg-sheraton-cream border-sheraton-gold/30">
            <CardHeader>
              <CardTitle className="text-base text-sheraton-navy">
                {task.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-700">{task.description}</p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">
                    Priority
                  </p>
                  <Badge className={`${getPriorityColor(task.priority)} mt-1`}>
                    {task.priority}
                  </Badge>
                </div>

                {task.due_date && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">
                      Due Date
                    </p>
                    <p className="font-semibold text-sheraton-navy mt-1">
                      {formatTaskDeadline(task.due_date)}
                    </p>
                    <DeadlineCountdown dueDate={task.due_date} done={task.status === "completed"} className="mt-1" />
                  </div>
                )}

                {task.estimated_time && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">
                      Est. Time
                    </p>
                    <p className="font-semibold text-sheraton-navy mt-1">
                      {task.estimated_time}
                    </p>
                  </div>
                )}

                {getTaskAmount(task) !== null && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">
                      Budget
                    </p>
                    <p className="font-semibold text-green-700 mt-1">
                      {formatTaskAmount(getTaskAmount(task)!, task.currency_code)}
                    </p>
                  </div>
                )}

                {task.category && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">
                      Category
                    </p>
                    <p className="font-semibold text-sheraton-navy mt-1 capitalize">
                      {task.category}
                    </p>
                  </div>
                )}

                {task.payment_terms && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase">
                      Payment Terms
                    </p>
                    <p className="font-semibold text-sheraton-navy mt-1 text-xs">
                      {task.payment_terms}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action Selection */}
          <div className="space-y-3">
            <p className="font-semibold text-sheraton-navy">What would you like to do?</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setSelectedAction("accept")}
                className={`p-3 rounded-lg border-2 transition-all ${
                  selectedAction === "accept"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 hover:border-green-300 bg-white"
                }`}
              >
                <CheckCircle className="h-5 w-5 mx-auto mb-2 text-green-600" />
                <p className="font-semibold text-sm text-gray-900">Accept</p>
                <p className="text-xs text-gray-500 mt-1">
                  Take this task now
                </p>
              </button>

              <button
                onClick={() => setSelectedAction("decline")}
                className={`p-3 rounded-lg border-2 transition-all ${
                  selectedAction === "decline"
                    ? "border-red-500 bg-red-50"
                    : "border-gray-200 hover:border-red-300 bg-white"
                }`}
              >
                <XCircle className="h-5 w-5 mx-auto mb-2 text-red-600" />
                <p className="font-semibold text-sm text-gray-900">Decline</p>
                <p className="text-xs text-gray-500 mt-1">
                  Can't do this task
                </p>
              </button>

              <button
                onClick={() => setSelectedAction("propose")}
                className={`p-3 rounded-lg border-2 transition-all ${
                  selectedAction === "propose"
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-blue-300 bg-white"
                }`}
              >
                <MessageSquare className="h-5 w-5 mx-auto mb-2 text-blue-600" />
                <p className="font-semibold text-sm text-gray-900">Propose</p>
                <p className="text-xs text-gray-500 mt-1">
                  Suggest different terms
                </p>
              </button>
            </div>
          </div>

          {/* Conditional Forms */}
          {selectedAction === "decline" && (
            <div className="space-y-3 p-4 bg-red-50 rounded-lg border border-red-200">
              <Label htmlFor="decline-reason" className="font-semibold">
                Why are you declining? (optional)
              </Label>
              <Textarea
                id="decline-reason"
                placeholder="Please explain why you cannot take this task..."
                rows={4}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
            </div>
          )}

          {selectedAction === "propose" && (
            <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div>
                <Label htmlFor="quoted-price" className="font-semibold">
                  Quoted Price
                </Label>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-gray-600">{task.currency_code}</span>
                  <Input
                    id="quoted-price"
                    type="number"
                    placeholder="0.00"
                    step="0.01"
                    value={quotedPrice}
                    onChange={(e) => setQuotedPrice(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="proposed-timeline" className="font-semibold">
                  Proposed Timeline
                </Label>
                <Input
                  id="proposed-timeline"
                  placeholder="e.g., 2-3 days, 1 week, etc."
                  value={proposedTimeline}
                  onChange={(e) => setProposedTimeline(e.target.value)}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="proposed-settlement-currency" className="font-semibold">
                  Paid in
                </Label>
                <select
                  id="proposed-settlement-currency"
                  value={proposedSettlementCurrency}
                  onChange={(e) => setProposedSettlementCurrency(e.target.value)}
                  className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
                >
                  <option value="">
                    Keep current payout ({task.settlement_currency_code || task.currency_code})
                  </option>
                  {getSettlementCurrencies(task.currency_code).map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-2">
                  If different from the task currency, the rate below applies when the manager accepts.
                </p>
              </div>

              {isConvertedProposal && (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
                  {proposalRateError ? (
                    <p className="text-sm text-red-700">{proposalRateError}</p>
                  ) : !proposalRate ? (
                    <p className="text-sm text-amber-900">Loading the exchange rate...</p>
                  ) : (
                    <>
                      <p className="text-sm text-amber-900">
                        If the manager accepts, you will be paid in {proposalSettlementCurrency} at this rate:{" "}
                        <span className="font-semibold">
                          1 {task.currency_code} = {Number(proposalRate.fx_rate).toLocaleString(undefined, { maximumFractionDigits: 8 })} {proposalSettlementCurrency}
                        </span>
                      </p>
                      {proposalRate.rate_fetched_at && (
                        <p className="text-xs text-amber-800">
                          Rate taken {new Date(proposalRate.rate_fetched_at).toLocaleString()}
                        </p>
                      )}
                      <label className="flex items-start gap-2 text-sm text-amber-900">
                        <input
                          type="checkbox"
                          checked={proposalRateAccepted}
                          onChange={(e) => setProposalRateAccepted(e.target.checked)}
                          className="mt-1"
                        />
                        <span>I accept this rate for this proposal.</span>
                      </label>
                    </>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="proposal-notes" className="font-semibold">
                  Additional Notes
                </Label>
                <Textarea
                  id="proposal-notes"
                  placeholder="Explain your proposal, any special requirements, or questions..."
                  rows={4}
                  value={proposalNotes}
                  onChange={(e) => setProposalNotes(e.target.value)}
                  className="mt-2"
                />
              </div>
            </div>
          )}

          {selectedAction === "accept" && (
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-green-800">
                Accept this task to set it in your Todo List, get in progress and complete it.
              </p>
            </div>
          )}

          {selectedAction === "accept" && isConvertedRate && task && (
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
              <p className="text-sm text-amber-900">
                You will be paid in {task.settlement_currency_code} at the exchange rate of:{" "}
                <span className="font-semibold">
                  1 {task.currency_code} = {Number(task.settlement_fx_rate).toLocaleString(undefined, { maximumFractionDigits: 8 })} {task.settlement_currency_code}
                </span>
              </p>
              <p className="text-xs text-amber-800">
                {task.settlement_fx_rate_source === "books_exchange"
                  ? bookedExchange
                    ? `This rate was provided by ${bookedExchange.provider || "provider not recorded"} · ${
                        bookedExchange.exchange_at
                          ? new Date(bookedExchange.exchange_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
                          : bookedExchange.conversion_date
                      } · ${(Number(bookedExchange.to_ugx_amount) / Number(bookedExchange.from_amount)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${task.settlement_currency_code} per 1 ${task.currency_code}.`
                    : "This rate came from a recorded exchange in Books."
                  : task.settlement_fx_rate_source === "hotel_edited"
                    ? "This rate was set by the hotel."
                    : "This rate is live at Exchangerate."}
              </p>
              <label className="flex items-start gap-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={rateAccepted}
                  onChange={(e) => setRateAccepted(e.target.checked)}
                  className="mt-1"
                />
                <span>I accept this rate for this task.</span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter className="gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmitResponse}
            disabled={!selectedAction || isSubmitting || rateGateBlocked}
            className={
              selectedAction === "accept"
                ? "bg-green-600 hover:bg-green-700 text-white"
                : selectedAction === "decline"
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "sheraton-gradient text-white"
            }
          >
            {isSubmitting ? (
              <>
                <Loader className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                {selectedAction === "accept"
                  ? "Accept Task"
                  : selectedAction === "decline"
                    ? "Decline Task"
                    : "Submit Proposal"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TaskResponseModal;
