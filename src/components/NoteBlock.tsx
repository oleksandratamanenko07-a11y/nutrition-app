/** Окремий блок коментаря в картці страви; нічого не показує, якщо коментаря немає */
export function NoteBlock({ title, text }: { title: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="note-block">
      <div className="note-title">{title}</div>
      <p className="note-text">{text}</p>
    </div>
  );
}
