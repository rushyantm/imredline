/*
  A short CSS path for the pinned element — a breadcrumb for triage, not a
  guaranteed-unique locator.

  Aradea's version, not Nutrition Nest's: it escapes ids and classes with
  CSS.escape, disambiguates class-less siblings with :nth-of-type, stops at
  the nearest landmark so the path stays readable, and caps the result.
*/

const LANDMARK = "section,header,footer,article,main,nav,aside";

export function selectorFor(target: Element | null, maxParts = 5): string {
  if (!target) return "";
  const parts: string[] = [];
  for (
    let node: Element | null = target;
    node && node !== document.body && parts.length < maxParts;
    node = node.parentElement
  ) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${CSS.escape(node.id)}`);
      break;
    }
    const classes = [...node.classList]
      // Framework-internal classes (`__next`, `_hash`) say nothing to a reader.
      .filter((c) => !c.startsWith("__"))
      .slice(0, 2)
      .map((c) => `.${CSS.escape(c)}`)
      .join("");
    part += classes;
    if (!classes && node.parentElement) {
      const siblings = [...node.parentElement.children].filter((s) => s.tagName === node!.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    if (node.matches(LANDMARK)) break;
  }
  return parts.join(" > ").slice(-500);
}
