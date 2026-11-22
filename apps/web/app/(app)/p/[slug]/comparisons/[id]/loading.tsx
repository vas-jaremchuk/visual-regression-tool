export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto grid max-w-[100rem] gap-6">
      <div className="h-8 w-96 animate-pulse rounded-md bg-muted" />
      <div className="h-8 w-full animate-pulse rounded-full bg-muted" />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="h-[560px] animate-pulse rounded-md bg-muted" />
        <div className="h-[560px] animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
