import { useRef, useState, FormEvent, ChangeEvent } from "react";

export default function MessageInput({
  onSendText,
  onSendFile,
}: {
  onSendText: (content: string) => void;
  onSendFile: (file: File) => void;
}) {
  const [value, setValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSendText(trimmed);
    setValue("");
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onSendFile(file);
    e.target.value = "";
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-slate-200 p-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
        aria-label="Attach file"
      >
        📎
      </button>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type a message..."
        className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm"
      />
      <button type="submit" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white">
        Send
      </button>
    </form>
  );
}
