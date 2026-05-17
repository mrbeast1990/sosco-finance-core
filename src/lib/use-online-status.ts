import { useEffect, useState } from "react";
import { subscribe as subscribeQueue, type QueueOp } from "./offline-queue";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useOfflineQueue(): QueueOp[] {
  const [q, setQ] = useState<QueueOp[]>([]);
  useEffect(() => subscribeQueue(setQ), []);
  return q;
}
