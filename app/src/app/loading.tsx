export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="h-6 w-48 animate-pulse rounded bg-white/10" />
      <div className="mt-4 h-3 w-72 animate-pulse rounded bg-white/[0.07]" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-white/10 bg-white/[0.02]" />
        ))}
      </div>
    </div>
  );
}
