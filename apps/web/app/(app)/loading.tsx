export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto grid max-w-5xl gap-6">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
