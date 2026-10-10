import axios from "axios";
import type { ApiErrorBody } from "../types/auth";

export function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data.error?.message ?? fallback;
  }
  return fallback;
}
