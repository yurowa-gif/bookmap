"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Counter, Print, Shutter } from "@/components/film";
import { PlacePicker } from "@/components/place-picker";
import { Button, Notice, Spinner, messageFor, useToast } from "@/components/ui";
import { processPhoto, type ProcessedPhoto } from "@/lib/image/process";
import { useFrames, usePlaces, useQueuedShots } from "@/lib/queries";
import { dropShot, enqueueShot, retryShot } from "@/lib/queue/runtime";
import { useTrip } from "@/lib/session";

const PRESET_PLACE_KEY = "bookmap.presetPlace";

/** 지도에서 "여기서 찍기"를 누르면 그 장소를 미리 골라 둔다. */
export function presetPlace(placeId: string) {
  try {
    window.sessionStorage.setItem(PRESET_PLACE_KEY, placeId);
  } catch {
    // 저장소를 못 쓰면 미리 고르지 않을 뿐이다.
  }
}

function readPreset(): string | null {
  try {
    return window.sessionStorage.getItem(PRESET_PLACE_KEY);
  } catch {
    return null;
  }
}

function clearPreset() {
  try {
    window.sessionStorage.removeItem(PRESET_PLACE_KEY);
  } catch {
    // 지울 수 없어도 문제없다.
  }
}

interface Draft {
  processed: ProcessedPhoto;
  previewUrl: string;
  takenAt: Date;
}

export function CameraScreen() {
  const { trip, member } = useTrip();
  const toast = useToast();
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  const frames = useFrames(trip.id);
  const places = usePlaces(trip.id).data ?? [];
  const queued = useQueuedShots(trip.id, member.id);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(readPreset);
  const [memo, setMemo] = useState("");
  const [processing, setProcessing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [flash, setFlash] = useState(0);

  // 미리 골라 둔 장소는 한 번만 쓴다.
  useEffect(clearPreset, []);

  // 미리보기 주소는 쓰고 나면 해제한다.
  useEffect(() => {
    if (!draft) return;
    return () => URL.revokeObjectURL(draft.previewUrl);
  }, [draft]);

  const mine = useMemo(() => (frames.data ?? []).filter((f) => f.member_id === member.id), [frames.data, member.id]);
  const serverIds = useMemo(() => new Set(mine.map((f) => f.id)), [mine]);
  const waiting = queued.filter((s) => s.state === "queued");
  const rejected = queued.filter((s) => s.state === "rejected");
  // 서버가 아직 모르는 대기 컷도 필름을 쓴 것으로 센다.
  const used = mine.length + waiting.filter((s) => !serverIds.has(s.id)).length;
  const remaining = Math.max(0, member.film - used);
  const place = places.find((p) => p.id === placeId) ?? null;

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // 같은 파일을 다시 골라도 반응하도록
    if (!file) return;
    setProcessing(true);
    try {
      const takenAt = new Date();
      const processed = await processPhoto(file, takenAt);
      setDraft({ processed, previewUrl: URL.createObjectURL(processed.photo), takenAt });
    } catch (error) {
      toast(messageFor(error instanceof Error ? error.message : "UNKNOWN"), "error");
    } finally {
      setProcessing(false);
    }
  }

  async function wind() {
    if (!draft) return;
    const { processed, takenAt } = draft;
    const [photo, thumb] = await Promise.all([processed.photo.arrayBuffer(), processed.thumb.arrayBuffer()]);
    await enqueueShot({
      id: crypto.randomUUID(),
      tripId: trip.id,
      memberId: member.id,
      placeId,
      memo: memo.trim(),
      takenAt: takenAt.toISOString(),
      photo,
      thumb,
      width: processed.width,
      height: processed.height,
      state: "queued",
      error: null,
      attempts: 0,
      createdAt: Date.now(),
    });
    setDraft(null);
    setMemo("");
    setFlash((n) => n + 1);
    toast(`${used + 1}번 컷을 감았습니다.`);
  }

  if (draft) {
    return (
      <div className="flex flex-col gap-4 px-4 py-5">
        <Print src={draft.previewUrl} />
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex min-h-14 items-center justify-between rounded-lg border border-line bg-well px-3.5 text-left"
        >
          <span>
            <span className="label block">장소</span>
            <span className="block text-[16px] font-semibold">{place ? place.name : "어디서 찍었나요?"}</span>
          </span>
          <span className="text-[13px] text-kodak">{place ? "바꾸기" : "고르기"}</span>
        </button>
        <label className="flex flex-col gap-1.5">
          <span className="label">메모</span>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder="이 순간을 한두 줄로 남겨 보세요."
            className="rounded-lg border border-line bg-well px-3.5 py-3 text-[16px] leading-relaxed placeholder:text-faint focus:border-kodak focus:outline-none"
          />
          <span className="tabular self-end text-[12px] text-faint">{memo.length}/300</span>
        </label>
        <div className="flex gap-2">
          <Button onClick={() => setDraft(null)} className="flex-1">
            다시 찍기
          </Button>
          <Button tone="primary" onClick={() => void wind()} className="flex-[2]">
            필름 감기 · 1컷 사용
          </Button>
        </div>
        <p className="text-center text-[12px] text-faint">감은 컷은 되돌릴 수 없습니다. 남은 필름 {remaining}컷.</p>
        <PlacePicker
          tripId={trip.id}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={(id) => {
            setPlaceId(id);
            setPickerOpen(false);
          }}
          allowNone
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-140px)] flex-col px-4 py-5">
      <div className="flex items-start justify-between">
        <Counter value={remaining} label="남은 컷" />
        <div className="text-right">
          <p className="label">필름</p>
          <p className="tabular text-[15px] font-bold text-kodak">ISO 400 · {member.film} EXP</p>
          {waiting.length > 0 ? (
            <p className="pt-1 text-[12px] text-stamp">전송 대기 {waiting.length}컷</p>
          ) : (
            <p className="pt-1 text-[12px] text-faint">모두 전송됨</p>
          )}
        </div>
      </div>

      <div className="leather relative my-6 flex flex-1 items-center justify-center rounded-2xl border border-line">
        {flash > 0 ? <div key={flash} className="animate-flash pointer-events-none absolute inset-0 rounded-2xl bg-white" /> : null}
        {/* 뷰파인더 모서리 */}
        {["top-4 left-4 border-t-2 border-l-2", "top-4 right-4 border-t-2 border-r-2", "bottom-4 left-4 border-b-2 border-l-2", "bottom-4 right-4 border-b-2 border-r-2"].map(
          (corner) => (
            <span key={corner} className={`absolute size-6 border-kodak/70 ${corner}`} aria-hidden />
          ),
        )}
        <div className="px-10 py-12 text-center">
          {processing ? (
            <div className="flex flex-col items-center gap-3 text-dim">
              <Spinner className="size-6" />
              <p className="text-[14px]">필름에 옮기는 중</p>
            </div>
          ) : remaining === 0 ? (
            <>
              <p className="text-[20px] font-bold">필름을 다 썼어요</p>
              <p className="pt-2 text-[14px] leading-relaxed text-dim">스물네 컷이 모두 찼습니다. 인화 탭에서 내 필름을 볼 수 있어요.</p>
            </>
          ) : (
            <>
              <p className="text-[20px] font-bold">{place ? place.name : "셔터를 눌러 찍으세요"}</p>
              <p className="pt-2 text-[14px] leading-relaxed text-dim">
                {trip.developed_at
                  ? "현상이 끝났습니다. 지금 찍는 컷은 바로 공개됩니다."
                  : "찍은 사진은 선생님이 현상할 때까지 나만 볼 수 있습니다."}
              </p>
            </>
          )}
        </div>
      </div>

      {rejected.length > 0 ? (
        <div className="mb-4 flex flex-col gap-2">
          {rejected.map((shot) => (
            <Notice key={shot.id} tone="warn">
              <p>전송하지 못한 컷이 있습니다: {messageFor(shot.error ?? "UNKNOWN")}</p>
              <div className="flex gap-2 pt-2">
                <Button onClick={() => void retryShot(shot.id)} className="min-h-10 flex-1">
                  다시 보내기
                </Button>
                <Button tone="quiet" onClick={() => void dropShot(shot.id)} className="min-h-10">
                  지우기
                </Button>
              </div>
            </Notice>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-3 pb-2">
        <Shutter onPress={() => cameraInput.current?.click()} disabled={remaining === 0 || processing} />
        <button
          type="button"
          onClick={() => libraryInput.current?.click()}
          disabled={remaining === 0 || processing}
          className="min-h-11 px-3 text-[13px] text-dim underline underline-offset-4 disabled:opacity-40"
        >
          폰 앨범에서 고르기
        </button>
      </div>

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={libraryInput} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  );
}
