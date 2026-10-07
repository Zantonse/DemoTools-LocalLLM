import { decodeJwt } from "jose";
import { config } from "../config";
import { mockIdp } from "./mock";
import { oktaIdp } from "./okta";

export const idp = config.mode === "okta" ? oktaIdp : mockIdp;

/** Seconds until a JWT expires (0 if unknown or already expired). */
export function secondsLeft(token: string) {
  try {
    const exp = decodeJwt(token).exp;
    return exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 0;
  } catch {
    return 0;
  }
}
