export default function PresenceDot({ online, className = "" }: { online: boolean; className?: string }) {
  return (
    <span
      className={`block h-3 w-3 rounded-full border-2 border-white ${online ? "bg-green-500" : "bg-slate-300"} ${className}`}
      aria-label={online ? "Online" : "Offline"}
    />
  );
}
