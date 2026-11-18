import { TripShell } from "@/components/trip-shell";

export default function TripLayout({ children }: { children: React.ReactNode }) {
  return <TripShell>{children}</TripShell>;
}
