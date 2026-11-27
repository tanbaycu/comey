export function SkeletonCards() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Đang tải dữ liệu">
      <div className="cm-panel grid sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.06]">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-5 space-y-2.5">
            <div className="h-3 w-24 rounded-[4px] bg-zinc-200/80" />
            <div className="h-6 w-32 rounded-[4px] bg-zinc-200" />
            <div className="h-3 w-20 rounded-[4px] bg-zinc-100" />
          </div>
        ))}
      </div>
      <div className="cm-panel p-5 space-y-3">
        <div className="h-4 w-44 rounded-[4px] bg-zinc-200" />
        <div className="h-10 w-full rounded-[6px] bg-zinc-100" />
        <div className="h-10 w-full rounded-[6px] bg-zinc-100" />
        <div className="h-10 w-full rounded-[6px] bg-zinc-100" />
      </div>
    </div>
  );
}
