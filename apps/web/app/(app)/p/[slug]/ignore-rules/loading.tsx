export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto grid max-w-6xl gap-6">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
