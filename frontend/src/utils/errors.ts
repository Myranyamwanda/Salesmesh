import axios from "axios";
import type { ApiErrorBody } from "../types/auth";

const UNREACHABLE =
  "Cannot reach SalesMesh. Check your connection and try again. If you are online, the service may be restarting.";
const TIMED_OUT =
  "The server took too long to answer. Check your connection and try again.";

export function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    if (error.code === "ECONNABORTED") return TIMED_OUT;
    if (!error.response) return UNREACHABLE;
    return error.response.data?.error?.message ?? fallback;
  }
  return fallback;
}

/** The API's stable error code, such as "account_pending", or "". */
export function apiErrorCode(error: unknown) {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data.error?.code ?? "";
  }
  return "";
}
