export default function Loading() {
  return (
    <div className="loading-state space-y-4">
      <div className="skeleton-block h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton-block h-32" />
        ))}
      </div>
    </div>
  );
}
