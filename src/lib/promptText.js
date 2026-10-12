// Fills the [NAME] placeholder in a prompt with the subject's nickname.
// A function replacer is used on purpose: with a plain string replacement,
// "$&", "$1", "$$" and similar sequences in a nickname are interpreted by
// String.prototype.replace instead of being shown literally.
export function fillPrompt(text, nickname) {
  const name = typeof nickname === "string" && nickname ? nickname : "[NAME]";
  return String(text ?? "").replace(/\[NAME\]/g, () => name);
}
