/*
  Which kind of screen is this? Owner ask (2026-09-13): the fixer should know
  whether to look at the phone or the desktop layout without guessing from
  pixel counts.

  Signals, in order of trust:
    navigator.userAgentData.mobile   Chromium says "this is a phone" — trust it.
    touch                            pointer:coarse or maxTouchPoints > 0.
    short side of the viewport       phones are narrow whichever way they are
                                     held; tablets sit between; a mouse-driven
                                     window of any size is a desktop.
  A touch laptop with a wide window is a desktop — touch alone decides
  nothing. The reviewer can flip the chip if the guess is wrong.
*/

import type { Device } from "../core/types.js";

export function classifyDevice(): Device {
  const touch = (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 0;
  const uaMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  const w = innerWidth;
  const h = innerHeight;
  /* The SCREEN's short side too, not just the viewport's: a page with no
     <meta viewport> lays out at 980px on an iPhone, and Safari has no
     userAgentData to say "phone" — screen.width (390) still does. */
  const short = Math.min(w, h, screen.width || Infinity, screen.height || Infinity);
  let kind: Device["kind"];
  if (uaMobile === true) kind = "phone";
  else if (touch && short < 600) kind = "phone";
  else if (touch && short <= 1100) kind = "tablet";
  else kind = "desktop";
  return { kind, orientation: w > h ? "landscape" : "portrait", touch };
}

export const DEVICE_ORDER: Device["kind"][] = ["phone", "tablet", "desktop"];

export function nextKind(kind: Device["kind"]): Device["kind"] {
  return DEVICE_ORDER[(DEVICE_ORDER.indexOf(kind) + 1) % DEVICE_ORDER.length]!;
}

export const deviceIcon = (kind: Device["kind"]) => (kind === "phone" ? "📱" : kind === "tablet" ? "📟" : "🖥");
