import { get, set } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

const KEY = "sosco_offline_queue_v1";
export const MAX_QUEUE = 100;

export type QueueOpType = "expense.create" | "check.create";

export interface QueueOp {
  id: string;
  type: QueueOpType;
  label: string; // human readable
  payload: any;
  createdAt: number;
  attempts: number;
  lastError?: string;
  status: "pending" | "failed";
}

type Listener = (q: QueueOp[]) => void;
const listeners = new Set<Listener>();
let cache: QueueOp[] | null = null;

async function load(): Promise<QueueOp[]> {
  if (cache) return cache;
  const v = (await get<QueueOp[]>(KEY)) ?? [];
  cache = v;
  return v;
}

async function save(q: QueueOp[]) {
  cache = q;
  await set(KEY, q);
  listeners.forEach((l) => l(q));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  load().then((q) => l(q));
  return () => {
    listeners.delete(l);
  };
}

export async function getQueue(): Promise<QueueOp[]> {
  return load();
}

export async function enqueue(op: Omit<QueueOp, "id" | "createdAt" | "attempts" | "status">): Promise<QueueOp> {
  const q = await load();
  if (q.length >= MAX_QUEUE) {
    throw new Error(`الطابور ممتلئ (الحد الأقصى ${MAX_QUEUE} عملية). قم بمزامنة الموجود أولاً.`);
  }
  const item: QueueOp = {
    ...op,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
    status: "pending",
  };
  await save([...q, item]);
  return item;
}

export async function removeOp(id: string) {
  const q = await load();
  await save(q.filter((o) => o.id !== id));
}

export async function retryOp(id: string) {
  const q = await load();
  await save(q.map((o) => (o.id === id ? { ...o, status: "pending", lastError: undefined } : o)));
}

async function runOne(op: QueueOp): Promise<void> {
  if (op.type === "expense.create") {
    const { error } = await supabase.rpc("create_expense_atomic", op.payload);
    if (error) throw error;
  } else if (op.type === "check.create") {
    const { error } = await supabase.from("funding_checks").insert(op.payload);
    if (error) throw error;
  } else {
    throw new Error(`نوع غير معروف: ${op.type}`);
  }
}

let processing = false;
export async function processQueue(): Promise<{ ok: number; failed: number }> {
  if (processing) return { ok: 0, failed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: 0, failed: 0 };
  processing = true;
  let ok = 0;
  let failed = 0;
  try {
    let q = await load();
    for (const op of q.filter((o) => o.status === "pending")) {
      try {
        await runOne(op);
        q = (await load()).filter((o) => o.id !== op.id);
        await save(q);
        ok++;
      } catch (e: any) {
        q = (await load()).map((o) =>
          o.id === op.id
            ? { ...o, attempts: o.attempts + 1, lastError: e?.message ?? String(e), status: "failed" as const }
            : o,
        );
        await save(q);
        failed++;
      }
    }
  } finally {
    processing = false;
  }
  return { ok, failed };
}
