"use strict";

/* =========================================================================
 * Shared UI state
 *
 * Mutable state shared by the UI modules. Kept in one place so it is easy to audit:
 * currentPayload contains the Wi-Fi password and must never be logged or rendered as text.
 * ========================================================================= */

let currentQR = null;
let currentType = "wifi";
let currentSummary = ""; // short, non-secret description of the content (never the Wi-Fi password)
let isDemo = true;
let logoImage = null;
let logoDataUrl = null;
let currentPayload = null; // kept in memory only, used for the local scan self-test
