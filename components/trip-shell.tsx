"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Sheet, Spinner } from "@/components/ui";
import { formatDate } from "@/components/screens/join";
import { useTripInfo, useTripLive } from "@/lib/queries";
import { TripProvider, useSession } from "@/lib/session";
import type { Membership } from "@/lib/types";

type Tab = { href: string; label: string; icon: React.ReactNode };

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const icons = {
  camera: (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...stroke}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...stroke}>
      <path d="M12 21s-6-5.5-6-10.5a6 6 0 0 1 12 0C18 15.500 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2" />
    </svg>
  ),
  album: (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...stroke}>
      <rect x="3.500" y="5" width="17" height="14" rx="1" />
      <path d="M7.500 5v14M16.500 5v14M3.500 9.500h4M3.500 14.500h4M16.500 9.500h4M16.500 14.500h4" />
    </svg>
  ),
  guide: (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...stroke}>
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M9 11h6M9 15h6" />
    </svg>
  ),
  teacher: (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...stroke}>
      <path d="M4 19h16M7 19v-6M12 19V6M17 19v-9" />
    </svg>
  ),
};

function TabBar({ membership, wide }: { membership: Membership; wide: boolean }) {
  const pathname = usePathname();
  const tabs: Tab[] = [
    { href: "/camera", label: "카메라", icon: icons.camera },
    { href: "/map", label: "지도", icon: icons.map },
    { href: "/album", label: "인화", icon: icons.album },
    { href: "/guide", label: "안내", icon: icons.guide },
  ];
  if (membership.member.role === "teacher") tabs.push({ href: "/teacher", label: "교사", icon: icons.teacher });

  return (
    <nav
      aria-label="기행 메뉴"
      className={`fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[480px] border-t border-line bg-body/95 pb-[env(safe-area-inset-bottom)] backdrop-blur ${
        wide ? "lg:max-w-none lg:justify-center" : ""
      }`}
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
              wide ? "lg:max-w-[120px]" : ""
            } ${active ? "font-bold text-kodak" : "text-dim"}`}
          >
            {tab.icon}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Header({ membership }: { membership: Membership }) {
  const router = useRouter();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { trip, member } = membership;

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-body/95 px-4 pt-[max(env(safe-area-inset-top),10px)] pb-2.5 backdrop-blur">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-bold">{trip.title}</p>
        <p className="text-[11px] text-dim">{formatDate(trip.trip_date)}</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-well px-3 text-[13px]"
      >
        <span className="font-semibold">{member.name}</span>
        <span className="text-dim">{member.role === "teacher" ? "교사" : member.team}</span>
      </button>

      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirmLeave(false);
        }}
        title="내 정보"
      >
        <div className="flex flex-col gap-3 pb-3">
          <div className="leather rounded-xl border border-line p-4">
            <p className="text-[17px] font-bold">{member.name}</p>
            <p className="text-[13px] text-dim">
              {member.role === "teacher" ? "교사" : member.team || "모둠 없음"} · 필름 {member.film}컷
            </p>
          </div>
          {session.memberships.length > 1 ? (
            <div className="flex flex-col gap-2">
              <p className="label">다른 기행</p>
              {session.memberships
                .filter((m) => m.trip.id !== trip.id)
                .map((m) => (
                  <Button
                    key={m.trip.id}
                    onClick={() => {
                      session.select(m.trip.id);
                      setOpen(false);
                      router.push(m.member.role === "teacher" ? "/teacher" : "/camera");
                    }}
                  >
                    {m.trip.title}
                  </Button>
                ))}
            </div>
          ) : null}
          <Button onClick={() => router.push("/?join=1")}>다른 기행에 입장하기</Button>
          {confirmLeave ? (
            <div className="flex flex-col gap-2 rounded-xl border border-safelight/40 p-3">
              <p className="text-[14px] leading-relaxed text-dim">
                이 기기에서 나갑니다. 찍은 컷은 그대로 남고, 같은 이름과 PIN으로 다시 들어올 수 있습니다.
              </p>
              <Button
                tone="danger"
                onClick={async () => {
                  await session.leave();
                  router.replace("/");
                }}
              >
                나가기
              </Button>
            </div>
          ) : (
            <Button tone="quiet" onClick={() => setConfirmLeave(true)}>
              이 기기에서 나가기
            </Button>
          )}
        </div>
      </Sheet>
    </header>
  );
}

function LiveTrip({ membership, children }: { membership: Membership; children: React.ReactNode }) {
  const pathname = usePathname();
  useTripLive(membership.trip.id);
  // 현상 여부처럼 자주 바뀌는 값은 따로 새로 읽어 덮어쓴다.
  const fresh = useTripInfo(membership.trip.id).data;
  const value = fresh ? { ...membership, trip: fresh } : membership;
  // 지도 화면은 넓은 화면에서 창 높이에 딱 맞춰 두 칸으로 펼친다.
  const wide = pathname === "/map";
  return (
    <TripProvider value={value}>
      <div
        className={`app-shell flex flex-col pb-[calc(58px+env(safe-area-inset-bottom))] ${
          wide ? "app-shell-wide lg:h-dvh" : ""
        }`}
      >
        <Header membership={value} />
        <main className={`flex-1 ${wide ? "lg:min-h-0" : ""}`}>{children}</main>
        <TabBar membership={value} wide={wide} />
      </div>
    </TripProvider>
  );
}

/** 기행 안쪽 화면의 틀. 입장하지 않았으면 입장 화면으로 보낸다. */
export function TripShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const missing = session.status !== "loading" && !session.current;

  useEffect(() => {
    if (missing) router.replace("/");
  }, [missing, router]);

  if (!session.current) {
    return (
      <div className="app-shell flex items-center justify-center text-dim">
        <Spinner />
      </div>
    );
  }
  return <LiveTrip membership={session.current}>{children}</LiveTrip>;
}
