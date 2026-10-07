import { randomUUID } from "node:crypto";

/** Fake "Acme Billing" data the agent works against. */

export interface Account {
  id: string;
  name: string;
  tier: "Enterprise" | "Growth" | "Starter";
  arr: number;
  owner: string;
}

export interface Order {
  id: string;
  accountId: string;
  item: string;
  amount: number;
  date: string;
  status: "delivered" | "shipped" | "refunded" | "partially_refunded";
}

export interface Refund {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  createdAt: string;
  /** Who the API believes performed the refund – the audit trail story. */
  performedBy: string;
  actor: string;
  authorization: string;
}

export const ACCOUNTS: Account[] = [
  { id: "ACC-100", name: "Globex Corporation", tier: "Enterprise", arr: 480_000, owner: "Alex Rivera" },
  { id: "ACC-200", name: "Initech", tier: "Growth", arr: 96_000, owner: "Jordan Lee" },
  { id: "ACC-300", name: "Umbrella Health", tier: "Enterprise", arr: 1_250_000, owner: "Alex Rivera" },
  { id: "ACC-400", name: "Hooli Labs", tier: "Starter", arr: 18_000, owner: "Jordan Lee" },
];

const SEED_ORDERS: Order[] = [
  { id: "ORD-1001", accountId: "ACC-100", item: "Analytics add-on (annual)", amount: 12_000, date: "2026-08-14", status: "delivered" },
  { id: "ORD-1002", accountId: "ACC-100", item: "Onboarding workshop", amount: 2_400, date: "2026-09-02", status: "delivered" },
  { id: "ORD-2001", accountId: "ACC-200", item: "Seat expansion (25 seats)", amount: 7_500, date: "2026-09-20", status: "delivered" },
  { id: "ORD-2002", accountId: "ACC-200", item: "Priority support (monthly)", amount: 350, date: "2026-10-01", status: "delivered" },
  { id: "ORD-3001", accountId: "ACC-300", item: "HIPAA compliance pack", amount: 45_000, date: "2026-07-30", status: "delivered" },
  { id: "ORD-4001", accountId: "ACC-400", item: "Starter plan (annual)", amount: 1_200, date: "2026-09-28", status: "shipped" },
];

interface BillingState {
  orders: Order[];
  refunds: Refund[];
}

const g = globalThis as typeof globalThis & { __o4aaBilling?: BillingState };
export const billing: BillingState = (g.__o4aaBilling ??= { orders: structuredClone(SEED_ORDERS), refunds: [] });

export function resetBilling() {
  billing.orders = structuredClone(SEED_ORDERS);
  billing.refunds = [];
}

export function recordRefund(order: Order, amount: number, reason: string, performedBy: string, actor: string, authorization: string) {
  const refunded = billing.refunds.filter((r) => r.orderId === order.id).reduce((sum, r) => sum + r.amount, 0) + amount;
  order.status = refunded >= order.amount ? "refunded" : "partially_refunded";
  const refund: Refund = {
    id: `RF-${randomUUID().slice(0, 8).toUpperCase()}`,
    orderId: order.id,
    amount,
    reason,
    createdAt: new Date().toISOString(),
    performedBy,
    actor,
    authorization,
  };
  billing.refunds.push(refund);
  return refund;
}
