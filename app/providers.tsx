"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ToastProvider } from "@/components/ui";
import { flushQueue, listQueuedShots } from "@/lib/queue/runtime";
import { SessionProvider } from "@/lib/session";
import { isConfigured } from "@/lib/supabase/client";

/** 폰에 남아 있는 컷을 기회가 될 때마다 올린다: 앱을 열 때, 통신이 돌아올 때, 30초마다. */
function QueueRunner() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isConfigured) return;
    let stopped = false;

    const run = async () => {
      if (stopped || !navigator.onLine) return;
      const pending = (await listQueuedShots().catch(() => [])).some((s) => s.state === "queued");
      if (!pending) return;
      const report = await flushQueue().catch(() => null);
      if (report && report.sent + report.rejected > 0) {
        for (const key of ["frames", "rolls", "placeCounts"]) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };

    void run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(run, 30_000);
    return () => {
      stopped = true;
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionProvider>
          <QueueRunner />
          {children}
        </SessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
