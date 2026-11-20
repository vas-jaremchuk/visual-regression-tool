export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto grid max-w-4xl gap-6">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      <div className="h-48 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
